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
import { stripLoneSurrogates } from '../utils/text.js';
import { appendFileSync } from 'fs';

/**
 * When HASHPILOT_INDEX_MANIFEST names a file, append each written chunk id to
 * it as "<collection>\t<id>". `index-all` sets it for its child indexers.
 */
function recordWrittenIds(ids: string[], collection: string): void {
  const manifest = process.env.HASHPILOT_INDEX_MANIFEST;
  if (!manifest || ids.length === 0) return;
  appendFileSync(manifest, ids.map((id) => `${collection}\t${id}`).join('\n') + '\n');
}

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
  /**
   * Read-only mode: never create collections. Use for query paths that run
   * with a read-only gateway token; indexers leave this false.
   */
  readOnly?: boolean;
}

/**
 * Embeddings are computed by HashPilot (OpenAI) before they reach Chroma, so
 * collections are opened with an embedding function that refuses to run.
 */
const externalEmbeddingFunction = {
  generate: async (_texts: string[]): Promise<number[][]> => {
    throw new Error(
      'HashPilot computes embeddings itself; the collection embedding function must not be called'
    );
  },
};

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
    readOnly: boolean;
  };

  constructor(config: ChromaDBConfig) {
    this.config = {
      url: config.url.replace(/\/+$/, ''),
      authToken: config.authToken,
      defaultCollection: config.defaultCollection || 'hedera-docs-all',
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 2000,
      readOnly: config.readOnly ?? false,
    };

    logger.info('ChromaDBService initialized', {
      url: this.config.url,
      hasAuth: !!this.config.authToken,
      readOnly: this.config.readOnly,
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

      // Token is sent as X-Chroma-Token; the HashPilot gateway (docker/railway)
      // accepts it and distinguishes read-only from admin tokens.
      if (this.config.authToken) {
        clientConfig.auth = {
          provider: 'token',
          credentials: this.config.authToken,
          tokenHeaderType: 'X_CHROMA_TOKEN',
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
    return retryablePatterns.some((pattern) => errorMessage.includes(pattern));
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      // Read path first: works with a read-only gateway token
      let collection: Collection;
      try {
        collection = await this.client.getCollection({
          name: collectionConfig.name,
          embeddingFunction: externalEmbeddingFunction,
        });
      } catch (getError: any) {
        if (this.config.readOnly) {
          throw new Error(
            `The documentation index "${collectionConfig.name}" is not available at ${this.config.url}. ` +
              'The Hedera docs tools (docs_search, docs_ask, docs_get_example, code_generate) need an indexed ChromaDB collection. ' +
              'If you are using your own CHROMA_URL, build the index with: ' +
              'CHROMA_URL=<your server> CHROMA_AUTH_TOKEN=<admin token> OPENAI_API_KEY=sk-... npm run index-all. ' +
              'Otherwise the hosted index is temporarily unavailable; every other HashPilot tool keeps working. ' +
              `(underlying error: ${getError.message})`
          );
        }
        collection = await this.client.getOrCreateCollection({
          name: collectionConfig.name,
          metadata: collectionConfig.metadata,
          embeddingFunction: externalEmbeddingFunction,
        });
      }

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
  async addChunks(chunks: Chunk[], collectionName?: string): Promise<void> {
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

        const ids = batch.map((c) => c.id);
        // Every string sent to Chroma is scrubbed of unpaired surrogates,
        // which would otherwise make the whole batch invalid JSON.
        const documents = batch.map((c) => stripLoneSurrogates(c.text));
        const metadatas = batch.map((c) => ({
          documentId: c.documentId,
          chunkIndex: c.index,
          totalChunks: c.totalChunks,
          url: stripLoneSurrogates(c.metadata.url),
          title: stripLoneSurrogates(c.metadata.title),
          contentType: c.metadata.contentType,
          hasCode: c.metadata.hasCode,
          tags: stripLoneSurrogates(c.metadata.tags?.join(',') || ''),
          language: c.metadata.language || '',
          crawledAt: c.metadata.crawledAt,
          sectionPath: stripLoneSurrogates(c.metadata.sectionPath || ''),
        }));
        const embeddings = batch.map((c) => c.embedding!);

        // upsert keeps re-indexing idempotent (chunk ids are derived from the document id)
        await collection.upsert({
          ids,
          documents,
          metadatas,
          embeddings,
        });

        // A full re-index records every id it wrote, so chunks it did not
        // rewrite (pages deleted or renamed upstream) can be pruned afterwards.
        recordWrittenIds(ids, collection.name);

        logger.info('Batch inserted to collection', {
          collection: collection.name,
          batch: `${batchNumber}/${totalBatches}`,
          batchSize: batch.length,
          progress: `${Math.round(((i + batch.length) / chunks.length) * 100)}%`,
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
      /** Only consider chunks whose text contains this exact string */
      documentContains?: string;
    } = {}
  ): Promise<SearchResult[]> {
    const collection = await this.getDefaultCollection(options.collectionName);
    const nResults = options.nResults || 5;

    try {
      // Build where clause from filters
      const where = this.buildWhereClause(options.filters);

      // Post-filtered fields are evaluated after retrieval, so ask for more
      // rows than requested to avoid coming back short.
      const postFilter = this.needsPostFilter(options.filters);
      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: postFilter ? Math.min(nResults * 5, 200) : nResults,
        where: where || undefined,
        whereDocument: options.documentContains
          ? ({ $contains: options.documentContains } as any)
          : undefined,
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

          // Convert distance to similarity score (cosine similarity).
          // Cosine distance runs 0..2, so `1 - distance` goes negative for a
          // chunk pointing away from the query. Callers render this as a
          // percentage relevance, and results were being shown at -11%.
          const score = Math.max(0, Math.min(1, 1 - distance));

          // Skip results below minimum score
          if (options.filters?.minScore && score < options.filters.minScore) {
            continue;
          }

          if (postFilter && !this.matchesPostFilters(metadata, options.filters)) {
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
              language: metadata.language ? (String(metadata.language) as any) : undefined,
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

          // Stop once the caller's requested count is met from the over-fetch
          if (postFilter && searchResults.length >= nResults) {
            break;
          }
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

    // ChromaDB's v2 API accepts exactly one operator per `where` object, so a
    // multi-key object like `{ hasCode: true, language: 'go' }` is rejected
    // outright. Conditions are collected and combined explicitly with `$and`.
    // (An earlier workaround disabled the language filter instead, which made
    // `docs_get_example` return whatever the embedding liked regardless of the
    // language the caller asked for.)
    const conditions: Record<string, any>[] = [];

    // Content type filter
    if (filters.contentType) {
      conditions.push({
        contentType: Array.isArray(filters.contentType)
          ? { $in: filters.contentType }
          : { $eq: filters.contentType },
      });
    }

    // Language filter
    if (filters.language) {
      conditions.push({
        language: Array.isArray(filters.language)
          ? { $in: filters.language }
          : { $eq: filters.language },
      });
    }

    // Has code filter
    if (filters.hasCode !== undefined) {
      conditions.push({ hasCode: { $eq: filters.hasCode } });
    }

    // Single-document filter
    if (filters.documentId) {
      conditions.push({ documentId: { $eq: filters.documentId } });
    }

    if (conditions.length === 0) {
      return null;
    }

    return conditions.length === 1 ? conditions[0] : { $and: conditions };
  }

  /**
   * Filters ChromaDB cannot express in a metadata `where` clause.
   *
   * Tags are stored as one comma-joined string and URL matching is a substring
   * test, neither of which maps onto Chroma's metadata operators, so both are
   * applied to the returned rows instead.
   */
  private needsPostFilter(filters?: SearchFilters): boolean {
    return Boolean(filters?.urlPattern || filters?.tags?.length);
  }

  private matchesPostFilters(metadata: Record<string, any>, filters?: SearchFilters): boolean {
    if (!filters) {
      return true;
    }

    if (filters.urlPattern && !String(metadata.url || '').includes(filters.urlPattern)) {
      return false;
    }

    if (filters.tags?.length) {
      const tags = String(metadata.tags || '')
        .split(',')
        .filter(Boolean);
      if (!filters.tags.every((tag) => tags.includes(tag))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Every chunk id in a collection, read a page at a time
   */
  async listIds(collectionName?: string, pageSize = 1000): Promise<string[]> {
    const collection = await this.getDefaultCollection(collectionName);
    const ids: string[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await collection.get({ limit: pageSize, offset, include: [] as any });
      ids.push(...page.ids);
      if (page.ids.length < pageSize) break;
    }
    return ids;
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
