/**
 * RAG (Retrieval-Augmented Generation) Type Definitions
 *
 * Types for documentation indexing, search, and Q&A functionality.
 */

/**
 * Document content types
 */
export type DocumentContentType = 'tutorial' | 'api' | 'concept' | 'example' | 'guide' | 'reference';

/**
 * Programming languages for code examples
 */
export type ProgrammingLanguage = 'javascript' | 'typescript' | 'java' | 'python' | 'go' | 'solidity' | 'rust';

/**
 * Document metadata
 */
export interface DocumentMetadata {
  /** Document URL */
  url: string;
  /** Document title */
  title: string;
  /** Optional description */
  description?: string;
  /** Content type classification */
  contentType: DocumentContentType;
  /** Hedera service/feature tags */
  tags?: string[];
  /** Primary programming language (if code example) */
  language?: ProgrammingLanguage;
  /** Last crawled timestamp */
  crawledAt: string;
  /** Last updated timestamp (from source) */
  updatedAt?: string;
}

/**
 * Raw document from crawler
 */
export interface Document {
  /** Unique document ID */
  id: string;
  /** Document URL */
  url: string;
  /** Document title */
  title: string;
  /** Full document content (markdown) */
  content: string;
  /** Document metadata */
  metadata: DocumentMetadata;
}

/**
 * Chunk metadata (includes document context)
 */
export interface ChunkMetadata extends DocumentMetadata {
  /** Parent document ID */
  documentId: string;
  /** Chunk index within document */
  chunkIndex: number;
  /** Total chunks in document */
  totalChunks: number;
  /** Hierarchical section path (e.g., "Getting Started > Installation > Prerequisites") */
  sectionPath?: string;
  /** Heading level (1-6 for h1-h6) */
  headingLevel?: number;
  /** Whether this chunk contains code */
  hasCode: boolean;
  /** Code block languages in this chunk */
  codeLanguages?: ProgrammingLanguage[];
}

/**
 * Document chunk for vector storage
 */
export interface Chunk {
  /** Unique chunk ID */
  id: string;
  /** Parent document ID */
  documentId: string;
  /** Chunk text content */
  text: string;
  /** Chunk index within document (0-based) */
  index: number;
  /** Total number of chunks in parent document */
  totalChunks: number;
  /** Chunk metadata */
  metadata: ChunkMetadata;
  /** Optional pre-computed embedding */
  embedding?: number[];
}

/**
 * Search result from vector database
 */
export interface SearchResult {
  /** Matched chunk */
  chunk: Chunk;
  /** Similarity score (0-1) */
  score: number;
  /** Distance metric (depends on vector DB) */
  distance?: number;
  /** Neighboring chunks for context */
  neighbors?: {
    /** Previous chunk in document */
    before?: Chunk;
    /** Next chunk in document */
    after?: Chunk;
  };
}

/**
 * Q&A answer with sources
 */
export interface QAAnswer {
  /** Generated answer text */
  answer: string;
  /** Source chunks used to generate answer */
  sources: Array<{
    /** Source title */
    title: string;
    /** Source URL */
    url: string;
    /** Relevant excerpt */
    excerpt: string;
    /** Similarity score */
    score: number;
  }>;
  /** Whether the answer includes code examples */
  hasCodeExamples: boolean;
  /** Confidence score (0-1) */
  confidence?: number;
  /** LLM model used */
  model: string;
  /** Token usage */
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Search filters
 */
export interface SearchFilters {
  /** Filter by content type */
  contentType?: DocumentContentType | DocumentContentType[];
  /** Filter by programming language */
  language?: ProgrammingLanguage | ProgrammingLanguage[];
  /** Filter by tags */
  tags?: string[];
  /** Only return chunks with code */
  hasCode?: boolean;
  /** Filter by URL pattern (e.g., "/tutorials/") */
  urlPattern?: string;
  /** Minimum similarity score */
  minScore?: number;
}

/**
 * Indexing progress
 */
export interface IndexingProgress {
  /** Current status */
  status: 'crawling' | 'chunking' | 'embedding' | 'storing' | 'completed' | 'failed';
  /** Current step message */
  message: string;
  /** Documents processed */
  documentsProcessed: number;
  /** Total documents */
  totalDocuments: number;
  /** Chunks created */
  chunksCreated: number;
  /** Embeddings generated */
  embeddingsGenerated: number;
  /** Errors encountered */
  errors: string[];
  /** Start time */
  startTime: Date;
  /** End time (if completed/failed) */
  endTime?: Date;
}

/**
 * Indexing options
 */
export interface IndexingOptions {
  /** Indexing mode */
  mode: 'full' | 'incremental';
  /** Maximum pages to crawl */
  maxPages?: number;
  /** Force re-index even if up-to-date */
  force?: boolean;
  /** Base URLs to crawl */
  baseUrls?: string[];
  /** URL patterns to exclude */
  excludePatterns?: string[];
  /** Progress callback */
  onProgress?: (progress: IndexingProgress) => void;
}

/**
 * ChromaDB collection configuration
 */
export interface CollectionConfig {
  /** Collection name */
  name: string;
  /** Collection metadata */
  metadata?: Record<string, any>;
  /** Embedding function */
  embeddingFunction?: string;
  /** Distance metric */
  distanceMetric?: 'cosine' | 'l2' | 'ip';
}

/**
 * RAG service configuration
 */
export interface RAGConfig {
  /** ChromaDB URL */
  chromaUrl: string;
  /** ChromaDB auth token (for remote) */
  chromaAuthToken?: string;
  /** OpenAI API key */
  openaiApiKey: string;
  /** Firecrawl API key (optional - only needed for indexing) */
  firecrawlApiKey?: string;
  /** Firecrawl URL (optional - only needed for indexing) */
  firecrawlUrl?: string;
  /** Embedding model */
  embeddingModel: string;
  /** Completion model for Q&A */
  completionModel: string;
  /** Chunk size (in words) */
  chunkSize: number;
  /** Chunk overlap (in words) */
  chunkOverlap: number;
  /** Top K results for retrieval */
  topK: number;
  /** Minimum score threshold */
  minScore: number;
  /** Collection configurations */
  collections: Record<string, CollectionConfig>;
}

/**
 * Code example result
 */
export interface CodeExample {
  /** Example title/description */
  title: string;
  /** Code snippet */
  code: string;
  /** Programming language */
  language: ProgrammingLanguage;
  /** Source URL */
  sourceUrl: string;
  /** Explanation/context */
  explanation?: string;
  /** Relevance score */
  score: number;
}
