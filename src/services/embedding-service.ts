/**
 * Embedding Service
 *
 * Service for generating text embeddings using OpenAI API.
 * Handles batching, caching, and rate limiting.
 */

import OpenAI from 'openai';
import { OPENAI_CONFIG, INDEXING_CONFIG, CACHE_CONFIG } from '../config/rag.js';
import { getTokenCounter } from '../utils/token-counter.js';
import { logger } from '../utils/logger.js';

/**
 * Embedding cache entry
 */
interface CacheEntry {
  embedding: number[];
  timestamp: number;
}

/**
 * Embedding Service
 */
export class EmbeddingService {
  private openai: OpenAI;
  private model: string;
  private dimensions: number;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(apiKey: string, model?: string, dimensions?: number) {
    this.openai = new OpenAI({ apiKey });
    this.model = model || OPENAI_CONFIG.embeddingModel;
    this.dimensions = dimensions || OPENAI_CONFIG.embeddingDimensions;

    logger.info('EmbeddingService initialized', {
      model: this.model,
      dimensions: this.dimensions,
      cacheEnabled: CACHE_CONFIG.enableEmbeddingCache,
    });
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string, useCache: boolean = true): Promise<number[]> {
    // Check cache first
    if (useCache && CACHE_CONFIG.enableEmbeddingCache) {
      const cached = this.getFromCache(text);
      if (cached) {
        logger.debug('Embedding retrieved from cache');
        return cached;
      }
    }

    try {
      const startTime = Date.now();

      const response = await this.openai.embeddings.create({
        model: this.model,
        input: text,
        dimensions: this.dimensions,
      });

      const embedding = response.data[0].embedding;
      const executionTime = Date.now() - startTime;

      logger.debug('Embedding generated', {
        textLength: text.length,
        embeddingDimensions: embedding.length,
        executionTime,
        usage: response.usage,
      });

      // Cache the embedding
      if (useCache && CACHE_CONFIG.enableEmbeddingCache) {
        this.addToCache(text, embedding);
      }

      return embedding;
    } catch (error: any) {
      logger.error('Failed to generate embedding', {
        error: error.message,
        textLength: text.length,
      });
      throw new Error(`Embedding generation failed: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batches
   */
  async generateEmbeddingsBatch(
    texts: string[],
    options: {
      batchSize?: number;
      useCache?: boolean;
      onProgress?: (current: number, total: number) => void;
    } = {},
  ): Promise<number[][]> {
    const batchSize = options.batchSize || INDEXING_CONFIG.embeddingBatchSize;
    const useCache = options.useCache !== false;
    const embeddings: number[][] = [];
    let processed = 0;

    logger.info('Starting batch embedding generation', {
      totalTexts: texts.length,
      batchSize,
      useCache,
    });

    try {
      // Process in batches
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, Math.min(i + batchSize, texts.length));

        // Check cache for each text in batch
        const uncachedTexts: string[] = [];
        const uncachedIndices: number[] = [];
        const batchEmbeddings: (number[] | null)[] = new Array(batch.length).fill(null);

        if (useCache && CACHE_CONFIG.enableEmbeddingCache) {
          batch.forEach((text, idx) => {
            const cached = this.getFromCache(text);
            if (cached) {
              batchEmbeddings[idx] = cached;
            } else {
              uncachedTexts.push(text);
              uncachedIndices.push(idx);
            }
          });

          if (uncachedTexts.length < batch.length) {
            logger.debug('Cache hit for batch', {
              cached: batch.length - uncachedTexts.length,
              total: batch.length,
            });
          }
        } else {
          uncachedTexts.push(...batch);
          uncachedIndices.push(...batch.map((_, idx) => idx));
        }

        // Generate embeddings for uncached texts
        if (uncachedTexts.length > 0) {
          const startTime = Date.now();

          try {
            const response = await this.openai.embeddings.create({
              model: this.model,
              input: uncachedTexts,
              dimensions: this.dimensions,
            });

            const executionTime = Date.now() - startTime;

            logger.debug('Batch embeddings generated', {
              batchSize: uncachedTexts.length,
              executionTime,
              usage: response.usage,
            });

            // Map embeddings back to batch positions
            response.data.forEach((item, idx) => {
              const batchIdx = uncachedIndices[idx];
              const embedding = item.embedding;
              batchEmbeddings[batchIdx] = embedding;

              // Cache the embedding
              if (useCache && CACHE_CONFIG.enableEmbeddingCache) {
                this.addToCache(uncachedTexts[idx], embedding);
              }
            });
          } catch (error: any) {
            // If batch fails (likely due to token limit), try individual texts
            if (error.message?.includes('maximum context length')) {
              logger.warn('Batch embedding failed due to token limit, trying individual texts', {
                batchSize: uncachedTexts.length,
              });

              for (let idx = 0; idx < uncachedTexts.length; idx++) {
                try {
                  const text = uncachedTexts[idx];
                  const batchIdx = uncachedIndices[idx];

                  // Use tiktoken for accurate token counting
                  const tokenCounter = getTokenCounter();
                  const tokenCount = tokenCounter.countTokens(text);

                  let processedText = text;
                  if (tokenCount > 8000) {
                    // Truncate to 8000 tokens (model limit: 8192, leave buffer)
                    processedText = tokenCounter.truncateToTokens(text, 8000);
                    logger.warn('Truncated long text for embedding', {
                      originalTokens: tokenCount,
                      truncatedTokens: 8000,
                    });
                  }

                  const response = await this.openai.embeddings.create({
                    model: this.model,
                    input: processedText,
                    dimensions: this.dimensions,
                  });

                  const embedding = response.data[0].embedding;
                  batchEmbeddings[batchIdx] = embedding;

                  // Cache the embedding
                  if (useCache && CACHE_CONFIG.enableEmbeddingCache) {
                    this.addToCache(text, embedding);
                  }
                } catch (indivError: any) {
                  logger.error('Individual embedding generation failed', {
                    error: indivError.message,
                    textIndex: idx,
                  });
                  throw indivError;
                }
              }
            } else {
              throw error;
            }
          }
        }

        // Add to results
        embeddings.push(...(batchEmbeddings as number[][]));

        processed += batch.length;

        // Report progress
        if (options.onProgress) {
          options.onProgress(processed, texts.length);
        }

        logger.info('Batch processed', {
          current: processed,
          total: texts.length,
          progress: Math.round((processed / texts.length) * 100) + '%',
        });

        // Rate limiting: small delay between batches
        if (i + batchSize < texts.length) {
          await this.sleep(100);
        }
      }

      logger.info('Batch embedding generation completed', {
        totalEmbeddings: embeddings.length,
        cacheSize: this.cache.size,
      });

      return embeddings;
    } catch (error: any) {
      logger.error('Batch embedding generation failed', {
        error: error.message,
        processed,
        total: texts.length,
      });
      throw new Error(`Batch embedding generation failed: ${error.message}`);
    }
  }

  /**
   * Generate embedding for a query (same as text embedding)
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    return this.generateEmbedding(query, true);
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Get embedding from cache
   */
  private getFromCache(text: string): number[] | null {
    const key = this.getCacheKey(text);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if cache entry is still valid
    const age = Date.now() - entry.timestamp;
    if (age > CACHE_CONFIG.embeddingCacheTTL) {
      this.cache.delete(key);
      return null;
    }

    return entry.embedding;
  }

  /**
   * Add embedding to cache
   */
  private addToCache(text: string, embedding: number[]): void {
    const key = this.getCacheKey(text);
    this.cache.set(key, {
      embedding,
      timestamp: Date.now(),
    });

    // Limit cache size (simple LRU-like behavior)
    if (this.cache.size > 10000) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
  }

  /**
   * Generate cache key from text
   */
  private getCacheKey(text: string): string {
    // Use a simple hash of the text as cache key
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `${this.model}-${this.dimensions}-${hash}`;
  }

  /**
   * Clear embedding cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Embedding cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; enabled: boolean; ttl: number } {
    return {
      size: this.cache.size,
      enabled: CACHE_CONFIG.enableEmbeddingCache,
      ttl: CACHE_CONFIG.embeddingCacheTTL,
    };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
