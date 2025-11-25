/**
 * RAG MCP Tools
 *
 * Model Context Protocol tools for RAG (Retrieval-Augmented Generation) functionality.
 * Provides semantic search, Q&A, code examples, and indexing capabilities.
 */

import OpenAI from 'openai';
import { ChromaDBService } from '../services/chromadb-service.js';
import { EmbeddingService } from '../services/embedding-service.js';
import { FirecrawlService } from '../services/firecrawl-service.js';
import { RAGService } from '../services/rag-service.js';
import { DocumentChunker } from '../utils/document-chunker.js';
import { createRAGConfig, validateRAGConfig, CHROMA_COLLECTIONS } from '../config/rag.js';
import { IndexingProgress } from '../types/rag.js';
import { logger } from '../utils/logger.js';

/**
 * Lazy-initialized RAG services (initialized on first use)
 * Core services work without Firecrawl - it's only needed for indexing
 */
let ragServices: {
  chromaService: ChromaDBService;
  embeddingService: EmbeddingService;
  ragService: RAGService;
  openai: OpenAI;
  config: ReturnType<typeof createRAGConfig>;
} | null = null;

/**
 * Lazy-initialized Firecrawl service (only for indexing operations)
 */
let firecrawlServiceInstance: FirecrawlService | null = null;

/**
 * Initialize core RAG services (ChromaDB, embeddings, OpenAI)
 * Does NOT require Firecrawl - that's only needed for indexing
 */
async function initializeRAGServices(): Promise<typeof ragServices> {
  if (ragServices) {
    return ragServices;
  }

  try {
    logger.info('Initializing core RAG services...');

    // Load and validate configuration
    const config = createRAGConfig();
    const validation = validateRAGConfig(config);

    if (!validation.valid) {
      throw new Error(`Invalid RAG configuration: ${validation.errors.join(', ')}`);
    }

    // Initialize core services (no Firecrawl needed for queries)
    const chromaService = new ChromaDBService({
      url: config.chromaUrl,
      authToken: config.chromaAuthToken,
      defaultCollection: CHROMA_COLLECTIONS.all.name,
    });

    await chromaService.initialize();

    const embeddingService = new EmbeddingService(
      config.openaiApiKey,
      config.embeddingModel,
    );

    const openai = new OpenAI({ apiKey: config.openaiApiKey });

    const ragService = new RAGService({
      chromaService,
      embeddingService,
      openai,
      completionModel: config.completionModel,
    });

    ragServices = {
      chromaService,
      embeddingService,
      ragService,
      openai,
      config,
    };

    logger.info('Core RAG services initialized successfully (Firecrawl not required for queries)');

    return ragServices;
  } catch (error: any) {
    logger.error('Failed to initialize RAG services', { error: error.message });
    throw new Error(`RAG initialization failed: ${error.message}`);
  }
}

/**
 * Initialize Firecrawl service (only when needed for indexing)
 */
function getFirecrawlService(config: ReturnType<typeof createRAGConfig>): FirecrawlService {
  if (firecrawlServiceInstance) {
    return firecrawlServiceInstance;
  }

  // Check if Firecrawl is configured
  const firecrawlConfig = config.firecrawlUrl || config.firecrawlApiKey;
  if (!firecrawlConfig) {
    throw new Error(
      'Firecrawl is required for indexing operations. ' +
      'Set FIRECRAWL_URL (for local Firecrawl) or FIRECRAWL_API_KEY (for cloud) in environment variables.'
    );
  }

  firecrawlServiceInstance = new FirecrawlService(firecrawlConfig);
  logger.info('Firecrawl service initialized for indexing');

  return firecrawlServiceInstance;
}

/**
 * Tool 1: docs_search - Search Hedera documentation
 */
export const docsSearchTool = {
  name: 'docs_search',
  description: 'Search Hedera knowledge base using semantic search. Finds documentation, tutorials, API references, conceptual explanations, best practices, architecture patterns, SDK guides, HIPs (Hedera Improvement Proposals), and implementation examples. Use this tool for finding specific information about Hedera services (HTS, HCS, Smart Contract Service), SDK usage (JavaScript, Java, Go, Python, Rust), network configuration, fee schedules, staking parameters, and development patterns. Supports filtering by content type and programming language.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query in natural language. Can be technical terms, concepts, questions, or descriptions of what you are looking for.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return',
        minimum: 1,
        maximum: 20,
        default: 5,
      },
      contentType: {
        type: 'string',
        enum: ['tutorial', 'api', 'concept', 'example', 'guide', 'reference'],
        description: 'Filter by content type: tutorial (step-by-step guides), api (API references), concept (explanatory docs), example (code samples), guide (how-to guides), reference (technical specifications)',
      },
      language: {
        type: 'string',
        enum: ['javascript', 'typescript', 'java', 'python', 'go', 'solidity'],
        description: 'Filter by programming language for SDK-specific results',
      },
      hasCode: {
        type: 'boolean',
        description: 'Only return results with code examples',
      },
      queryType: {
        type: 'string',
        enum: ['conceptual', 'how_to', 'comparison', 'troubleshooting', 'best_practices', 'use_case', 'general'],
        description: 'Type of query to optimize search: conceptual (what is X?), how_to (how do I?), comparison (X vs Y), troubleshooting (errors/issues), best_practices (recommendations), use_case (suitability), general (default)',
      },
    },
    required: ['query'],
  },
};

export async function docsSearch(args: {
  query: string;
  limit?: number;
  contentType?: string;
  language?: string;
  hasCode?: boolean;
  queryType?: string;
}) {
  try {
    const services = await initializeRAGServices();

    if (!services) {
      throw new Error('RAG services not initialized');
    }

    // Build filters
    const filters: any = {};
    if (args.contentType) filters.contentType = args.contentType;
    if (args.language) filters.language = args.language;
    if (args.hasCode !== undefined) filters.hasCode = args.hasCode;

    // Perform search
    const results = await services.ragService.search(args.query, {
      topK: args.limit || 5,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    });

    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No relevant documentation found for your query.',
          },
        ],
      };
    }

    // Format results
    const formattedResults = results.map((result, index) => ({
      rank: index + 1,
      title: result.chunk.metadata.title,
      url: result.chunk.metadata.url,
      contentType: result.chunk.metadata.contentType,
      excerpt: result.chunk.text.substring(0, 300) + (result.chunk.text.length > 300 ? '...' : ''),
      score: Math.round(result.score * 100) / 100,
      hasCode: result.chunk.metadata.hasCode,
      language: result.chunk.metadata.language,
    }));

    // Format sources as a readable list at the bottom
    const sourcesSection = formattedResults.length > 0
      ? '\n\n---\n**Sources:**\n' + formattedResults.map((r, i) =>
          `${i + 1}. [${r.title}](${r.url}) (score: ${Math.round(r.score * 100)}%)`
        ).join('\n') + '\n\n*Answered by HashPilot RAG System*'
      : '\n\n*Answered by HashPilot RAG System*';

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: args.query,
            resultsFound: results.length,
            results: formattedResults,
          }, null, 2) + sourcesSection,
        },
      ],
    };
  } catch (error: any) {
    logger.error('docs_search failed', { error: error.message });
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool 2: docs_ask - Ask questions about Hedera documentation
 */
export const docsAskTool = {
  name: 'docs_ask',
  description: 'Answer ANY knowledge-based question about Hedera Network and ecosystem. Handles: conceptual questions (what is Hedera Consensus Service?), how-to questions (how to create tokens?), comparison questions (Hedera vs Ethereum, HTS vs ERC-20), best practices (security recommendations, gas optimization), troubleshooting (why did transaction fail?), architecture queries (how does hashgraph consensus work?), use case guidance (is Hedera suitable for my DeFi app?), security questions (auditing smart contracts), migration help (moving from Ethereum), SDK usage questions, network configuration, fee structures, staking mechanics, and any educational/learning questions. Returns AI-generated answers with source citations from official Hedera documentation, SDKs, HIPs, and tutorials. USE THIS TOOL FOR ALL QUESTIONS ABOUT HEDERA THAT DO NOT REQUIRE EXECUTING AN ACTION ON THE BLOCKCHAIN.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      question: {
        type: 'string',
        description: 'Any question about Hedera in natural language. Can be conceptual, technical, comparative, or practical.',
      },
      includeCodeExamples: {
        type: 'boolean',
        description: 'Include code examples in the answer when relevant',
        default: false,
      },
      language: {
        type: 'string',
        enum: ['javascript', 'typescript', 'java', 'python', 'go', 'solidity'],
        description: 'Preferred programming language for code examples',
      },
      contentType: {
        type: 'string',
        enum: ['tutorial', 'api', 'concept', 'example', 'guide', 'reference'],
        description: 'Filter sources by content type',
      },
      queryIntent: {
        type: 'string',
        enum: ['conceptual', 'how_to', 'comparison', 'troubleshooting', 'best_practices', 'use_case', 'architecture', 'migration', 'security', 'general'],
        description: 'Intent of the question to provide more targeted answers: conceptual (explain X), how_to (steps to do Y), comparison (X vs Y), troubleshooting (fix error), best_practices (recommendations), use_case (suitability check), architecture (system design), migration (platform transition), security (safety/audits), general (default)',
      },
      expertiseLevel: {
        type: 'string',
        enum: ['beginner', 'intermediate', 'advanced'],
        description: 'User expertise level to adjust answer complexity and detail',
        default: 'intermediate',
      },
    },
    required: ['question'],
  },
};

export async function docsAsk(args: {
  question: string;
  includeCodeExamples?: boolean;
  language?: string;
  contentType?: string;
  queryIntent?: string;
  expertiseLevel?: string;
}) {
  try {
    const services = await initializeRAGServices();

    if (!services) {
      throw new Error('RAG services not initialized');
    }

    // Build filters
    const filters: any = {};
    if (args.contentType) filters.contentType = args.contentType;

    // Auto-detect intent if not provided
    const detectedIntent = args.queryIntent || services.ragService.classifyQueryIntent(args.question);
    const expertiseLevel = args.expertiseLevel || 'intermediate';

    logger.info('Processing docs_ask with intent detection', {
      question: args.question.substring(0, 100),
      detectedIntent,
      providedIntent: args.queryIntent,
      expertiseLevel,
    });

    // Ask question with intent awareness
    const answer = await services.ragService.askQuestionWithIntent(args.question, {
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      includeCodeExamples: args.includeCodeExamples || false,
      language: args.language,
      queryIntent: detectedIntent as any,
      expertiseLevel: expertiseLevel as any,
    });

    // Format response with enhanced metadata
    const response = {
      question: args.question,
      detectedIntent,
      expertiseLevel,
      answer: answer.answer,
      sources: answer.sources.map(source => ({
        title: source.title,
        url: source.url,
        relevance: Math.round(source.score * 100) / 100,
      })),
      hasCodeExamples: answer.hasCodeExamples,
      model: answer.model,
    };

    // Format sources as a readable list at the bottom
    const sourcesSection = answer.sources.length > 0
      ? '\n\n---\n**Sources:**\n' + answer.sources.map((source, i) =>
          `${i + 1}. [${source.title}](${source.url}) (relevance: ${Math.round(source.score * 100)}%)`
        ).join('\n') + '\n\n*Answered by HashPilot RAG System*'
      : '\n\n*Answered by HashPilot RAG System*';

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2) + sourcesSection,
        },
      ],
    };
  } catch (error: any) {
    logger.error('docs_ask failed', { error: error.message });
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool 3: docs_get_example - Find code examples
 */
export const docsGetExampleTool = {
  name: 'docs_get_example',
  description: 'Find working code examples and implementation patterns for ANY Hedera functionality. Search by feature description: account creation, token operations (create, mint, burn, transfer, freeze), HCS messaging (topic create, message submit), smart contract deployment, file service operations, key management, scheduled transactions, multi-signature workflows, and more. Retrieves annotated code snippets from official Hedera SDKs (JavaScript/TypeScript, Java, Python, Go, Rust) and Solidity smart contracts. Returns code with explanations, context, and source references. Use this when you need actual implementation code, not just conceptual explanations.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      description: {
        type: 'string',
        description: 'Description of the functionality you need code for. Be specific about the operation (e.g., "create fungible token with custom fees", "submit message to HCS topic", "deploy ERC-20 contract on Hedera")',
      },
      language: {
        type: 'string',
        enum: ['javascript', 'typescript', 'java', 'python', 'go', 'rust', 'solidity'],
        description: 'Preferred programming language for the code example',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of examples to return',
        minimum: 1,
        maximum: 10,
        default: 5,
      },
      complexity: {
        type: 'string',
        enum: ['simple', 'intermediate', 'advanced'],
        description: 'Desired complexity level of the code example',
      },
    },
    required: ['description'],
  },
};

export async function docsGetExample(args: {
  description: string;
  language?: string;
  limit?: number;
  complexity?: string;
}) {
  try {
    const services = await initializeRAGServices();

    if (!services) {
      throw new Error('RAG services not initialized');
    }

    // Find code examples
    const examples = await services.ragService.findCodeExamples(args.description, {
      language: args.language,
      limit: args.limit || 5,
    });

    if (examples.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No code examples found matching your description.',
          },
        ],
      };
    }

    // Format examples
    const formattedExamples = examples.map((example, index) => ({
      rank: index + 1,
      title: example.title,
      language: example.language,
      code: example.code,
      explanation: example.explanation,
      sourceUrl: example.sourceUrl,
      relevance: Math.round(example.score * 100) / 100,
    }));

    // Format sources as a readable list at the bottom
    const sourcesSection = formattedExamples.length > 0
      ? '\n\n---\n**Sources:**\n' + formattedExamples.map((ex, i) =>
          `${i + 1}. [${ex.title}](${ex.sourceUrl}) (relevance: ${Math.round(ex.relevance * 100)}%)`
        ).join('\n') + '\n\n*Answered by HashPilot RAG System*'
      : '\n\n*Answered by HashPilot RAG System*';

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            description: args.description,
            examplesFound: examples.length,
            examples: formattedExamples,
          }, null, 2) + sourcesSection,
        },
      ],
    };
  } catch (error: any) {
    logger.error('docs_get_example failed', { error: error.message });
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool 4: docs_update_index - Manually trigger documentation reindexing
 */
export const docsUpdateIndexTool = {
  name: 'docs_update_index',
  description: 'Manually trigger documentation reindexing. Crawls Hedera documentation and updates the vector database.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      mode: {
        type: 'string',
        enum: ['full', 'incremental'],
        description: 'Indexing mode: full (reindex everything) or incremental (only new/updated)',
        default: 'full',
      },
      maxPages: {
        type: 'number',
        description: 'Maximum pages to crawl',
        minimum: 1,
        maximum: 500,
        default: 200,
      },
    },
  },
};

export async function docsUpdateIndex(args: {
  mode?: string;
  maxPages?: number;
}) {
  try {
    const services = await initializeRAGServices();

    if (!services) {
      throw new Error('RAG services not initialized');
    }

    // Lazy-load Firecrawl only when indexing is requested
    const firecrawlService = getFirecrawlService(services.config);

    const mode = args.mode || 'full';
    const maxPages = args.maxPages || 200;

    logger.info('Starting documentation reindexing', { mode, maxPages });

    // Track progress
    const progress: IndexingProgress = {
      status: 'crawling',
      message: 'Starting crawl...',
      documentsProcessed: 0,
      totalDocuments: 0,
      chunksCreated: 0,
      embeddingsGenerated: 0,
      errors: [],
      startTime: new Date(),
    };

    // Step 1: Crawl documentation
    progress.status = 'crawling';
    progress.message = 'Crawling Hedera documentation...';

    const crawlResult = await firecrawlService.crawlHederaDocs({
      maxPages,
      onProgress: (current, total, url) => {
        progress.documentsProcessed = current;
        progress.totalDocuments = total;
        logger.info(`Crawling: ${current}/${total} - ${url}`);
      },
    });

    progress.documentsProcessed = crawlResult.totalPages;
    progress.totalDocuments = crawlResult.totalPages;
    progress.errors.push(...crawlResult.errors);

    if (crawlResult.documents.length === 0) {
      throw new Error('No documents were crawled');
    }

    // Step 2: Chunk documents
    progress.status = 'chunking';
    progress.message = `Chunking ${crawlResult.documents.length} documents...`;

    const chunker = new DocumentChunker();
    const allChunks = [];

    for (const doc of crawlResult.documents) {
      try {
        const chunks = chunker.chunk(doc);
        allChunks.push(...chunks);
      } catch (error: any) {
        progress.errors.push(`Failed to chunk ${doc.url}: ${error.message}`);
      }
    }

    progress.chunksCreated = allChunks.length;

    // Step 3: Generate embeddings
    progress.status = 'embedding';
    progress.message = `Generating embeddings for ${allChunks.length} chunks...`;

    const embeddings = await services.embeddingService.generateEmbeddingsBatch(
      allChunks.map(c => c.text),
      {
        onProgress: (current, total) => {
          progress.embeddingsGenerated = current;
          logger.info(`Embeddings: ${current}/${total}`);
        },
      },
    );

    progress.embeddingsGenerated = embeddings.length;

    // Attach embeddings to chunks
    allChunks.forEach((chunk, index) => {
      chunk.embedding = embeddings[index];
    });

    // Step 4: Store in ChromaDB
    progress.status = 'storing';
    progress.message = `Storing ${allChunks.length} chunks in ChromaDB...`;

    // Clear existing collection if full reindex
    if (args.mode === 'full') {
      // Note: In production, you might want to create a new collection and swap
      // For now, we'll just add new chunks (ChromaDB will update if ID exists)
      logger.info('Full reindex: will update existing chunks by ID');
    }

    await services.chromaService.addChunks(allChunks, CHROMA_COLLECTIONS.all.name);

    // Step 5: Complete
    progress.status = 'completed';
    progress.message = 'Indexing completed successfully';
    progress.endTime = new Date();

    const duration = progress.endTime.getTime() - progress.startTime.getTime();

    logger.info('Documentation reindexing completed', {
      duration,
      documents: progress.documentsProcessed,
      chunks: progress.chunksCreated,
      embeddings: progress.embeddingsGenerated,
      errors: progress.errors.length,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'completed',
            summary: {
              documentsProcessed: progress.documentsProcessed,
              chunksCreated: progress.chunksCreated,
              embeddingsGenerated: progress.embeddingsGenerated,
              duration: `${Math.round(duration / 1000)}s`,
              errors: progress.errors.length,
            },
            errors: progress.errors.length > 0 ? progress.errors.slice(0, 10) : [],
          }, null, 2),
        },
      ],
    };
  } catch (error: any) {
    logger.error('docs_update_index failed', { error: error.message });
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Tool 5: code_generate - Generate context-aware Hedera SDK code
 */
export const codeGenerateTool = {
  name: 'code_generate',
  description: 'Generate context-aware Hedera SDK code from natural language descriptions. Synthesizes new, working code based on your requirements using knowledge from official documentation and SDK references. Use this tool when you need to create custom Hedera implementations: account creation workflows, token operations (create, transfer, mint), HCS messaging patterns, smart contract interactions, scheduled transactions, multi-signature setups, and more. Returns complete, runnable code with explanations and best practices.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      description: {
        type: 'string',
        description: 'Natural language description of the code you need. Be specific about the functionality (e.g., "create a fungible token with 1000 initial supply and 2 decimal places", "transfer HBAR from one account to another with memo", "subscribe to HCS topic and process messages")',
      },
      language: {
        type: 'string',
        enum: ['javascript', 'typescript', 'java', 'python', 'go', 'solidity'],
        description: 'Target programming language for the generated code',
        default: 'javascript',
      },
      includeImports: {
        type: 'boolean',
        description: 'Include necessary import statements',
        default: true,
      },
      includeErrorHandling: {
        type: 'boolean',
        description: 'Include try-catch blocks and error handling',
        default: true,
      },
      style: {
        type: 'string',
        enum: ['minimal', 'complete', 'production'],
        description: 'Code style: minimal (core logic only), complete (with setup), production (with best practices, validation, logging)',
        default: 'complete',
      },
    },
    required: ['description'],
  },
};

export async function codeGenerate(args: {
  description: string;
  language?: string;
  includeImports?: boolean;
  includeErrorHandling?: boolean;
  style?: string;
}) {
  try {
    const services = await initializeRAGServices();

    if (!services) {
      throw new Error('RAG services not initialized. Ensure OPENAI_API_KEY and CHROMA_URL are configured.');
    }

    const language = args.language || 'javascript';
    const includeImports = args.includeImports !== false;
    const includeErrorHandling = args.includeErrorHandling !== false;
    const style = args.style || 'complete';

    logger.info('Generating code from description', {
      description: args.description.substring(0, 100),
      language,
      style,
    });

    // Step 1: Search for relevant documentation and examples
    const relevantDocs = await services.ragService.search(args.description, {
      topK: 5,
      filters: { hasCode: true },
    });

    // Step 2: Build context from relevant documentation
    const contextChunks = relevantDocs.map(doc => ({
      content: doc.chunk.text,
      source: doc.chunk.metadata.url,
      title: doc.chunk.metadata.title,
    }));

    // Step 3: Generate code using OpenAI with RAG context
    const systemPrompt = `You are an expert Hedera Network developer. Generate clean, working ${language} code based on the user's requirements.

IMPORTANT GUIDELINES:
${language === 'solidity' ? `- Write Solidity smart contracts optimized for Hedera EVM
- Use pragma solidity ^0.8.0 or higher
- Follow OpenZeppelin standards when applicable (e.g., ERC-20, ERC-721)
- Optimize for gas efficiency on Hedera
- Include SPDX license identifier
- Add NatSpec documentation comments` : `- Use the official Hedera SDK (@hashgraph/sdk for JavaScript/TypeScript)`}
- Follow best practices from the provided documentation context
- ${includeImports ? 'Include all necessary import statements' : 'Omit import statements'}
- ${includeErrorHandling ? (language === 'solidity' ? 'Include require statements and custom errors for validation' : 'Include proper error handling with try-catch blocks') : 'Focus on core logic without extensive error handling'}
- Style: ${style === 'minimal' ? 'Minimal - just the core logic' : style === 'complete' ? 'Complete - include setup and teardown' : 'Production-ready - include validation, logging, and best practices'}
- Add clear comments explaining each step
- ${language === 'solidity' ? 'Ensure the contract is deployable on Hedera EVM' : 'Ensure the code is immediately runnable (after setting up credentials)'}

CONTEXT FROM HEDERA DOCUMENTATION:
${contextChunks.map(c => `--- ${c.title} (${c.source}) ---\n${c.content}`).join('\n\n')}`;

    const userPrompt = `Generate ${language} code for: ${args.description}

Requirements:
- Language: ${language}
- Include imports: ${includeImports}
- Include error handling: ${includeErrorHandling}
- Style: ${style}

Please provide:
1. Complete working code
2. Brief explanation of what the code does
3. Any prerequisites or setup requirements
4. Example usage if applicable`;

    const completion = await services.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 3000,
    });

    const generatedResponse = completion.choices[0]?.message?.content || '';

    // Parse the response to extract code and explanation
    const codeMatch = generatedResponse.match(/```(?:javascript|typescript|java|python|go|solidity)?\n([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : generatedResponse;

    const response = {
      description: args.description,
      language,
      style,
      generatedCode: code,
      fullResponse: generatedResponse,
      sources: contextChunks.map(c => ({
        title: c.title,
        url: c.source,
      })),
      metadata: {
        model: 'gpt-4o-mini',
        includeImports,
        includeErrorHandling,
        contextDocuments: contextChunks.length,
      },
    };

    // Format sources as a readable list at the bottom
    const sourcesSection = contextChunks.length > 0
      ? '\n\n---\n**Sources Used for Code Generation:**\n' + contextChunks.map((c, i) =>
          `${i + 1}. [${c.title}](${c.source})`
        ).join('\n') + '\n\n*Generated by HashPilot RAG System*'
      : '\n\n*Generated by HashPilot RAG System*';

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2) + sourcesSection,
        },
      ],
    };
  } catch (error: any) {
    logger.error('code_generate failed', { error: error.message });
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Export all RAG tools
 */
export const ragTools = [
  docsSearchTool,
  docsAskTool,
  docsGetExampleTool,
  docsUpdateIndexTool,
  codeGenerateTool,
];
