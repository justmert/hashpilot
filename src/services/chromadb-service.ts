/**
 * ChromaDB Service
 *
 * Service for interacting with ChromaDB vector database.
 * Supports both local (Docker) and remote (AWS EC2) deployments.
 */

import { ChromaClient, Collection, IncludeEnum } from 'chromadb';
import { Chunk, SearchResult, SearchFilters, CollectionConfig } from '../types/rag.js';
import { INDEXING_CONFIG } from '../config/rag.js';
import { logger } from '../utils/logger.js';

/**
 * ChromaDB connection configuration
 */
export interface ChromaDBConfig {
  /** ChromaDB server URL */
  url: string;
  /** Authentication token (for remote deployments) */
  authToken?: string;
  /** Default collection name */
  defaultCollection?: string;
  /** Connection timeout (ms) */
  timeout?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Retry delay (ms) */
  retryDelay?: number;
}

/**
 * ChromaDB Service
 */
export class ChromaDBService {
  private client: ChromaClient | null = null;
  private collections: Map<string, Collection> = new Map();
  private config: {
    url: string;
    authToken?: string;
    defaultCollection: string;
    timeout: number;
    maxRetries: number;
    retryDelay: number;
  };

  constructor(config: ChromaDBConfig) {
    this.config = {
      url: config.url,
      authToken: config.authToken,
      defaultCollection: config.defaultCollection || 'hedera-docs-all',
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 2000,
    };

    logger.info('ChromaDBService initialized', {
      url: this.config.url,
      hasAuth: !!this.config.authToken,
      defaultCollection: this.config.defaultCollection,
    });
  }

  /**
   * Initialize connection to ChromaDB
   */
  async initialize(): Promise<void> {
    try {
      await this.connectWithRetry();
      logger.info('ChromaDB connection established successfully');
    } catch (error: any) {
      logger.error('Failed to initialize ChromaDB connection', { error: error.message });
      throw new Error(`ChromaDB initialization failed: ${error.message}`);
    }
  }

  /**
   * Connect to ChromaDB with retry logic
   */
  private async connectWithRetry(attempt: number = 1): Promise<void> {
    try {
      // Create client
      const clientConfig: any = {
        path: this.config.url,
      };

      // Add authentication if token is provided
      if (this.config.authToken) {
        clientConfig.auth = {
          provider: 'token',
          credentials: this.config.authToken,
        };
      }

      this.client = new ChromaClient(clientConfig);

      // Test connection with heartbeat
      await this.client.heartbeat();

      logger.info('ChromaDB client connected', { attempt });
    } catch (error: any) {
      if (attempt < this.config.maxRetries && this.isRetryableError(error)) {
        logger.warn(`ChromaDB connection attempt ${attempt} failed, retrying...`, {
          error: error.message,
          nextAttempt: attempt + 1,
        });

        await this.sleep(this.config.retryDelay * attempt);
        return this.connectWithRetry(attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    const retryablePatterns = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNRESET',
      'Network Error',
      'timeout',
    ];

    const errorMessage = error.message || String(error);
    return retryablePatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get or create a collection
   */
  async getOrCreateCollection(collectionConfig: CollectionConfig): Promise<Collection> {
    if (!this.client) {
      throw new Error('ChromaDB client not initialized. Call initialize() first.');
    }

    // Check cache first
    if (this.collections.has(collectionConfig.name)) {
      return this.collections.get(collectionConfig.name)!;
    }

    try {
      // Try to get existing collection
      const collection = await this.client.getOrCreateCollection({
        name: collectionConfig.name,
        metadata: collectionConfig.metadata,
      });

      // Cache collection
      this.collections.set(collectionConfig.name, collection);

      logger.info('Collection retrieved or created', {
        name: collectionConfig.name,
        metadata: collectionConfig.metadata,
      });

      return collection;
    } catch (error: any) {
      logger.error('Failed to get or create collection', {
        name: collectionConfig.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Add chunks to collection (with batching to avoid payload limits)
   */
  async addChunks(
    chunks: Chunk[],
    collectionName?: string,
  ): Promise<void> {
    if (chunks.length === 0) {
      logger.warn('No chunks to add');
      return;
    }

    const collection = await this.getDefaultCollection(collectionName);
    const batchSize = INDEXING_CONFIG.chromaBatchSize;
    const totalBatches = Math.ceil(chunks.length / batchSize);

    try {
      // Process chunks in batches to avoid HTTP payload too large errors
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batchNumber = Math.floor(i / batchSize) + 1;
        const batch = chunks.slice(i, i + batchSize);

        const ids = batch.map(c => c.id);
        const documents = batch.map(c => c.text);
        const metadatas = batch.map(c => ({
          documentId: c.documentId,
          chunkIndex: c.index,
          totalChunks: c.totalChunks,
          url: c.metadata.url,
          title: c.metadata.title,
          contentType: c.metadata.contentType,
          hasCode: c.metadata.hasCode,
          tags: c.metadata.tags?.join(',') || '',
          language: c.metadata.language || '',
          crawledAt: c.metadata.crawledAt,
          sectionPath: c.metadata.sectionPath || '',
        }));
        const embeddings = batch.map(c => c.embedding!);

        await collection.add({
          ids,
          documents,
          metadatas,
          embeddings,
        });

        logger.info('Batch inserted to collection', {
          collection: collection.name,
          batch: `${batchNumber}/${totalBatches}`,
          batchSize: batch.length,
          progress: `${Math.round((i + batch.length) / chunks.length * 100)}%`,
        });
      }

      logger.info('All chunks added to collection', {
        collection: collection.name,
        totalChunks: chunks.length,
        totalBatches,
      });
    } catch (error: any) {
      logger.error('Failed to add chunks to collection', {
        collection: collection.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Query collection by embedding
   */
  async query(
    queryEmbedding: number[],
    options: {
      nResults?: number;
      filters?: SearchFilters;
      collectionName?: string;
    } = {},
  ): Promise<SearchResult[]> {
    const collection = await this.getDefaultCollection(options.collectionName);
    const nResults = options.nResults || 5;

    try {
      // Build where clause from filters
      const where = this.buildWhereClause(options.filters);

      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults,
        where: where || undefined,
        include: [IncludeEnum.Documents, IncludeEnum.Metadatas, IncludeEnum.Distances],
      });

      // Transform results to SearchResult format
      const searchResults: SearchResult[] = [];

      if (results.ids && results.ids[0]) {
        for (let i = 0; i < results.ids[0].length; i++) {
          const id = results.ids[0][i];
          const document = results.documents?.[0]?.[i] || '';
          const metadata = results.metadatas?.[0]?.[i] || {};
          const distance = results.distances?.[0]?.[i] || 0;

          // Convert distance to similarity score (cosine similarity)
          // ChromaDB returns distance, we convert to similarity (1 - distance)
          const score = 1 - distance;

          // Skip results below minimum score
          if (options.filters?.minScore && score < options.filters.minScore) {
            continue;
          }

          const chunk: Chunk = {
            id,
            documentId: String(metadata.documentId || ''),
            text: String(document),
            index: Number(metadata.chunkIndex || 0),
            totalChunks: Number(metadata.totalChunks || 1),
            metadata: {
              url: String(metadata.url || ''),
              title: String(metadata.title || ''),
              contentType: String(metadata.contentType || 'concept') as any,
              hasCode: Boolean(metadata.hasCode),
              tags: metadata.tags ? String(metadata.tags).split(',').filter(Boolean) : [],
              language: metadata.language ? String(metadata.language) as any : undefined,
              crawledAt: String(metadata.crawledAt || new Date().toISOString()),
              sectionPath: metadata.sectionPath ? String(metadata.sectionPath) : undefined,
              documentId: String(metadata.documentId || ''),
              chunkIndex: Number(metadata.chunkIndex || 0),
              totalChunks: Number(metadata.totalChunks || 1),
              headingLevel: metadata.headingLevel ? Number(metadata.headingLevel) : undefined,
              codeLanguages: metadata.codeLanguages as any,
            },
          };

          searchResults.push({
            chunk,
            score,
            distance,
          });
        }
      }

      logger.info('Query executed successfully', {
        collection: collection.name,
        resultsFound: searchResults.length,
        requestedResults: nResults,
      });

      return searchResults;
    } catch (error: any) {
      logger.error('Query failed', {
        collection: collection.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Build ChromaDB where clause from filters
   */
  private buildWhereClause(filters?: SearchFilters): Record<string, any> | null {
    if (!filters) {
      return null;
    }

    const where: Record<string, any> = {};

    // Content type filter
    if (filters.contentType) {
      if (Array.isArray(filters.contentType)) {
        where.contentType = { $in: filters.contentType };
      } else {
        where.contentType = filters.contentType;
      }
    }

    // Language filter - skip for now due to ChromaDB compatibility issues
    // Rely on semantic search to find language-specific content
    // The query embedding will naturally prioritize language-relevant results
    // if (filters.language) {
    //   if (Array.isArray(filters.language)) {
    //     where.language = { $in: filters.language };
    //   } else {
    //     where.language = filters.language;
    //   }
    // }

    // Has code filter
    if (filters.hasCode !== undefined) {
      where.hasCode = filters.hasCode;
    }

    // URL pattern filter
    if (filters.urlPattern) {
      where.url = { $contains: filters.urlPattern };
    }

    return Object.keys(where).length > 0 ? where : null;
  }

  /**
   * Delete chunks by IDs
   */
  async deleteChunks(ids: string[], collectionName?: string): Promise<void> {
    const collection = await this.getDefaultCollection(collectionName);

    try {
      await collection.delete({ ids });

      logger.info('Chunks deleted from collection', {
        collection: collection.name,
        count: ids.length,
      });
    } catch (error: any) {
      logger.error('Failed to delete chunks', {
        collection: collection.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Delete all chunks for a document
   */
  async deleteDocument(documentId: string, collectionName?: string): Promise<void> {
    const collection = await this.getDefaultCollection(collectionName);

    try {
      await collection.delete({
        where: { documentId },
      });

      logger.info('Document deleted from collection', {
        collection: collection.name,
        documentId,
      });
    } catch (error: any) {
      logger.error('Failed to delete document', {
        collection: collection.name,
        documentId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get collection count
   */
  async getCollectionCount(collectionName?: string): Promise<number> {
    const collection = await this.getDefaultCollection(collectionName);

    try {
      const count = await collection.count();
      return count;
    } catch (error: any) {
      logger.error('Failed to get collection count', {
        collection: collection.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      await this.client.heartbeat();
      return true;
    } catch (error: any) {
      logger.error('ChromaDB health check failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get default collection
   */
  private async getDefaultCollection(collectionName?: string): Promise<Collection> {
    const name = collectionName || this.config.defaultCollection;

    return this.getOrCreateCollection({
      name,
      metadata: { type: 'default' },
      distanceMetric: 'cosine',
    });
  }

  /**
   * Clear collection cache
   */
  clearCache(): void {
    this.collections.clear();
    logger.info('Collection cache cleared');
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    this.collections.clear();
    this.client = null;
    logger.info('ChromaDB connection closed');
  }
}
