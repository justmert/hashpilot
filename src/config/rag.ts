/**
 * RAG Configuration
 *
 * Configuration constants for the Retrieval-Augmented Generation system.
 */

import { CollectionConfig, RAGConfig } from '../types/rag.js';

/**
 * OpenAI Model Configuration
 */
export const OPENAI_CONFIG = {
  /** Embedding model (optimized for cost and performance) */
  embeddingModel: 'text-embedding-3-small',
  /** Embedding dimensions (512 for efficiency, can use 1536 for max quality) */
  embeddingDimensions: 512,
  /** Completion model for Q&A */
  completionModel: 'gpt-4o-mini',
  /** Max tokens for completion */
  maxTokens: 1000,
  /** Temperature for completion (0 = deterministic, 1 = creative) */
  temperature: 0.1,
} as const;

/**
 * ChromaDB Collection Configurations
 */
export const CHROMA_COLLECTIONS: Record<string, CollectionConfig> = {
  /** Tutorial documentation */
  tutorials: {
    name: 'hedera-docs-tutorials',
    metadata: {
      type: 'tutorial',
      description: 'Step-by-step guides and tutorials',
    },
    distanceMetric: 'cosine',
  },
  /** API reference documentation */
  api: {
    name: 'hedera-docs-api',
    metadata: {
      type: 'api',
      description: 'API reference and technical specifications',
    },
    distanceMetric: 'cosine',
  },
  /** Conceptual documentation */
  concepts: {
    name: 'hedera-docs-concepts',
    metadata: {
      type: 'concept',
      description: 'Conceptual explanations and architecture',
    },
    distanceMetric: 'cosine',
  },
  /** Code examples */
  examples: {
    name: 'hedera-docs-examples',
    metadata: {
      type: 'example',
      description: 'Code examples and snippets',
    },
    distanceMetric: 'cosine',
  },
  /** All documentation (unified collection) */
  all: {
    name: 'hedera-docs-all',
    metadata: {
      type: 'all',
      description: 'All Hedera documentation',
    },
    distanceMetric: 'cosine',
  },
} as const;

/**
 * Document Chunking Configuration
 *
 * ⚠️ IMPORTANT: All sizes are now in TOKENS, not words!
 * Using tiktoken for accurate token counting (OpenAI standard)
 */
export const CHUNKING_CONFIG = {
  /** Minimum chunk size (in TOKENS) */
  minChunkSize: 100,
  /** Maximum chunk size (in TOKENS) - must be < 8192 (model limit) */
  maxChunkSize: 512,
  /** Target chunk size (in TOKENS) */
  targetChunkSize: 300,
  /** Overlap between chunks (in TOKENS) */
  overlapSize: 50,
  /** Respect semantic boundaries */
  respectBoundaries: ['heading', 'code-block', 'list', 'paragraph'] as const,
  /** Include document hierarchy in metadata */
  includeHierarchy: true,
  /** Code block handling */
  codeBlockHandling: {
    /** Keep code blocks intact when possible */
    keepIntact: true,
    /** Maximum code block size before splitting (in TOKENS) */
    maxSize: 500,
    /** Include surrounding context for code blocks */
    includeSurroundingContext: true,
  },
} as const;

/**
 * Search Configuration
 */
export const SEARCH_CONFIG = {
  /** Default number of results to retrieve */
  topK: 5,
  /** Minimum similarity score threshold (0-1) */
  minScore: 0.7,
  /** Enable re-ranking of results */
  enableReranking: true,
  /** Number of results after re-ranking */
  rerankedTopK: 5,
  /** Include neighboring chunks for context */
  includeNeighbors: true,
  /** Maximum number of neighbors to include */
  maxNeighbors: 2,
} as const;

/**
 * Firecrawl Configuration
 */
export const FIRECRAWL_CONFIG = {
  /** Base URL for Hedera documentation */
  baseUrls: [
    'https://docs.hedera.com',
    // SDK repositories - docs and examples only
    'https://github.com/hashgraph/hedera-sdk-js',
    'https://github.com/hashgraph/hedera-sdk-java',
    'https://github.com/hashgraph/hedera-sdk-go',
    'https://github.com/hashgraph/hedera-sdk-rust',
    'https://github.com/hiero-ledger/hiero-sdk-python',
  ],
  /** URL patterns to exclude (for all sources) */
  excludePatterns: [
    // Hedera docs exclusions
    '/api/v1/',  // Skip API versioning pages
    '/search',   // Skip search pages
    '/404',      // Skip error pages
    'sitemap',   // Skip sitemaps
    '/rss',      // Skip RSS feeds
    '.xml',      // Skip XML files
    // REST API specs now INCLUDED for comprehensive coverage
    // GitHub SDK exclusions - skip source code, tests, build artifacts
    '/tree/main/src/',      // Source code directories
    '/blob/main/src/',      // Source code files
    '/tree/main/test',      // Test directories
    '/tree/main/tests',     // Test directories
    '/blob/main/test',      // Test files
    '/__tests__/',          // Jest tests
    '.test.js',             // Test files
    '.test.ts',             // Test files
    '.spec.js',             // Spec files
    '.spec.ts',             // Spec files
    '_test.go',             // Go test files
    '_test.rs',             // Rust test files
    '/node_modules/',       // Node dependencies
    '/build/',              // Build output
    '/dist/',               // Distribution
    '/target/',             // Rust/Java build
    '/.github/',            // GitHub workflows
    '/gradle/',             // Gradle files
    '/proto/',              // Protobuf files
    '/protobufs/',          // Protobuf files
    '.gradle',              // Gradle files
    '.lock',                // Lock files
    'package-lock.json',    // NPM lock
    'yarn.lock',            // Yarn lock
    'pnpm-lock.yaml',       // PNPM lock
    'Cargo.lock',           // Cargo lock
    'go.sum',               // Go sum
    '/pulls',               // Pull requests
    '/issues',              // Issues
    '/actions',             // GitHub actions
    '/commits',             // Commit history
    '/branches',            // Branch list
    '/tags',                // Tag list
  ],
  /** URL patterns to include (for GitHub repos) - prioritize docs and examples */
  includePatterns: [
    // Documentation files
    'README.md',
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    'MIGRATION',
    'MIGRATING',
    '/docs/',
    '/manual/',
    '/examples/',
    '/example-',
  ],
  /** Maximum pages per crawl - increased for comprehensive coverage */
  maxPages: 1500, // Increased to ensure full documentation coverage including REST APIs
  /** Rate limit delay (ms) - respects free tier limits */
  rateLimitDelay: 6000, // 10 requests/min = 6000ms between requests
  /** Request timeout (ms) */
  timeout: 30000,
  /** Retry attempts */
  retryAttempts: 3,
  /** Retry delay (ms) */
  retryDelay: 2000,
} as const;

/**
 * Q&A Generation Configuration
 */
export const QA_CONFIG = {
  /** System prompt for Q&A */
  systemPrompt: `You are a helpful assistant specialized in Hedera Hashgraph technology.
Your role is to answer questions about Hedera based on the provided documentation context.

Guidelines:
1. Always base your answers on the provided context
2. If the context doesn't contain enough information, say so clearly
3. Provide code examples when relevant
4. Cite sources by mentioning the documentation section
5. Be concise but comprehensive
6. Use technical terminology accurately
7. If asked about multiple topics, structure your answer clearly
8. If the question is unclear, ask for clarification`,

  /** User prompt template */
  userPromptTemplate: `Context from Hedera documentation:
{context}

Question: {question}

Please provide a comprehensive answer based on the context above. If you include code examples, specify the programming language.`,

  /** Maximum context length (in characters) */
  maxContextLength: 8000,
  /** Include source citations in answer */
  includeCitations: true,
  /** Confidence threshold for providing an answer */
  confidenceThreshold: 0.6,
} as const;

/**
 * Indexing Configuration
 */
export const INDEXING_CONFIG = {
  /** Batch size for embedding generation */
  embeddingBatchSize: 100,
  /** Batch size for ChromaDB insertion */
  chromaBatchSize: 100,
  /** Maximum concurrent operations */
  maxConcurrency: 5,
  /** Skip re-indexing if document hasn't changed */
  skipUnchanged: true,
  /** Document change detection method */
  changeDetection: 'timestamp' as const, // 'timestamp' | 'hash'
} as const;

/**
 * Cache Configuration
 */
export const CACHE_CONFIG = {
  /** Enable caching for search results */
  enableSearchCache: true,
  /** Search cache TTL (ms) */
  searchCacheTTL: 1000 * 60 * 60, // 1 hour
  /** Enable caching for embeddings */
  enableEmbeddingCache: true,
  /** Embedding cache TTL (ms) */
  embeddingCacheTTL: 1000 * 60 * 60 * 24, // 24 hours
} as const;

/**
 * Hosted ChromaDB URL - pre-indexed with Hedera documentation
 * Users don't need to configure this - it's provided by HashPilot
 */
export const HOSTED_CHROMA_URL = 'https://chroma.hash-pilot.app';

/**
 * Create RAG configuration from environment variables
 *
 * Configuration sources:
 * - OPENAI_API_KEY: Required, provided by USER in their MCP config
 * - CHROMA_URL: Optional, defaults to hosted HashPilot instance
 * - FIRECRAWL_URL/FIRECRAWL_API_KEY: Optional, only for admin indexing
 */
export function createRAGConfig(): RAGConfig {
  // ChromaDB - default to hosted instance, allow override for local dev
  const chromaUrl = process.env.CHROMA_URL || HOSTED_CHROMA_URL;
  const chromaAuthToken = process.env.CHROMA_AUTH_TOKEN;

  // OpenAI API key - MUST be provided by user in their MCP config
  // This is read from the "env" section of the user's .mcp.json
  const openaiApiKey = process.env.OPENAI_API_KEY || '';

  // Firecrawl - only needed for admin indexing operations
  const firecrawlUrl = process.env.FIRECRAWL_URL;
  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;

  return {
    chromaUrl,
    chromaAuthToken,
    openaiApiKey,
    firecrawlApiKey: firecrawlApiKey,
    firecrawlUrl: firecrawlUrl,
    embeddingModel: OPENAI_CONFIG.embeddingModel,
    completionModel: OPENAI_CONFIG.completionModel,
    chunkSize: parseInt(process.env.RAG_CHUNK_SIZE || String(CHUNKING_CONFIG.targetChunkSize), 10),
    chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP || String(CHUNKING_CONFIG.overlapSize), 10),
    topK: parseInt(process.env.RAG_TOP_K || String(SEARCH_CONFIG.topK), 10),
    minScore: parseFloat(process.env.RAG_MIN_SCORE || String(SEARCH_CONFIG.minScore)),
    collections: CHROMA_COLLECTIONS,
  };
}

/**
 * Validate RAG configuration
 */
export function validateRAGConfig(config: RAGConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.chromaUrl) {
    errors.push('chromaUrl is required');
  }

  if (!config.openaiApiKey) {
    errors.push('openaiApiKey is required');
  }

  // Firecrawl is optional - only warn if not configured
  // It's only needed for indexing operations, not for querying

  if (config.chunkSize < 100 || config.chunkSize > 2000) {
    errors.push('chunkSize must be between 100 and 2000');
  }

  if (config.chunkOverlap < 0 || config.chunkOverlap >= config.chunkSize) {
    errors.push('chunkOverlap must be between 0 and chunkSize');
  }

  if (config.topK < 1 || config.topK > 100) {
    errors.push('topK must be between 1 and 100');
  }

  if (config.minScore < 0 || config.minScore > 1) {
    errors.push('minScore must be between 0 and 1');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
