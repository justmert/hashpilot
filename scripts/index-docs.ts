#!/usr/bin/env tsx

/**
 * Documentation Indexing Script
 *
 * Crawls Hedera documentation and indexes it into ChromaDB.
 * Run this script manually or via cron job to keep documentation up-to-date.
 *
 * Usage:
 *   npm run index-docs              # Full reindex with default settings
 *   npm run index-docs -- --max 100 # Limit to 100 pages
 *   npm run index-docs -- --help    # Show help
 */

import * as dotenv from 'dotenv';
import { ChromaDBService } from '../src/services/chromadb-service.js';
import { EmbeddingService } from '../src/services/embedding-service.js';
import { FirecrawlService } from '../src/services/firecrawl-service.js';
import { DocumentChunker } from '../src/utils/document-chunker.js';
import { createRAGConfig, validateRAGConfig, CHROMA_COLLECTIONS } from '../src/config/rag.js';
import { IndexingProgress } from '../src/types/rag.js';
import { logger } from '../src/utils/logger.js';

// Load environment variables
dotenv.config();

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    maxPages: 1000,
    help: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--max':
      case '-m':
        options.maxPages = parseInt(args[++i], 10);
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
Documentation Indexing Script

Usage:
  npm run index-docs [options]

Options:
  --max, -m <number>    Maximum pages to crawl (default: 200)
  --verbose, -v         Enable verbose logging
  --help, -h            Show this help message

Examples:
  npm run index-docs
  npm run index-docs -- --max 100
  npm run index-docs -- --verbose

Environment Variables:
  CHROMA_URL            ChromaDB server URL (default: http://localhost:8000)
  OPENAI_API_KEY        OpenAI API key (required)
  FIRECRAWL_API_KEY     Firecrawl API key (required)
`);
}

/**
 * Format progress message
 */
function formatProgress(progress: IndexingProgress): string {
  const lines = [`Status: ${progress.status}`, `Message: ${progress.message}`];

  if (progress.totalDocuments > 0) {
    lines.push(`Documents: ${progress.documentsProcessed}/${progress.totalDocuments}`);
  }

  if (progress.chunksCreated > 0) {
    lines.push(`Chunks: ${progress.chunksCreated}`);
  }

  if (progress.embeddingsGenerated > 0) {
    lines.push(`Embeddings: ${progress.embeddingsGenerated}`);
  }

  if (progress.errors.length > 0) {
    lines.push(`Errors: ${progress.errors.length}`);
  }

  return lines.join(' | ');
}

/**
 * Main indexing function
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log('🚀 Starting Hedera Documentation Indexing');
  console.log(`📄 Max pages: ${options.maxPages}`);
  console.log('');

  try {
    // Load and validate configuration
    console.log('⚙️  Loading configuration...');
    const config = createRAGConfig();
    const validation = validateRAGConfig(config);

    if (!validation.valid) {
      console.error('❌ Invalid configuration:');
      validation.errors.forEach((error) => console.error(`   - ${error}`));
      process.exit(1);
    }

    console.log('✅ Configuration validated');
    console.log(`   ChromaDB: ${config.chromaUrl}`);
    console.log(`   Embedding Model: ${config.embeddingModel}`);
    console.log('');

    // Initialize services
    console.log('🔧 Initializing services...');

    const chromaService = new ChromaDBService({
      url: config.chromaUrl,
      authToken: config.chromaAuthToken,
      defaultCollection: CHROMA_COLLECTIONS.all.name,
    });

    await chromaService.initialize();
    console.log('✅ ChromaDB connected');

    const embeddingService = new EmbeddingService(config.openaiApiKey, config.embeddingModel);
    console.log('✅ Embedding service initialized');

    // Use FIRECRAWL_URL for local instance, or FIRECRAWL_API_KEY for cloud
    const firecrawlConfig = config.firecrawlUrl || config.firecrawlApiKey;
    if (!firecrawlConfig) {
      console.error('❌ Firecrawl not configured. Set FIRECRAWL_URL or FIRECRAWL_API_KEY in .env');
      process.exit(1);
    }
    const firecrawlService = new FirecrawlService(firecrawlConfig);
    console.log('✅ Firecrawl service initialized');

    console.log('');

    // Initialize progress tracking
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
    console.log('📡 Step 1/4: Crawling Hedera documentation...');
    progress.status = 'crawling';

    const crawlResult = await firecrawlService.crawlHederaDocs({
      maxPages: options.maxPages,
      onProgress: (current, total, url) => {
        progress.documentsProcessed = current;
        progress.totalDocuments = total;
        if (options.verbose) {
          console.log(`   📄 ${current}/${total}: ${url}`);
        } else {
          process.stdout.write(`\r   Progress: ${current}/${total} pages`);
        }
      },
    });

    if (!options.verbose) {
      process.stdout.write('\n');
    }

    progress.documentsProcessed = crawlResult.totalPages;
    progress.totalDocuments = crawlResult.totalPages;
    progress.errors.push(...crawlResult.errors);

    console.log(`✅ Crawled ${crawlResult.documents.length} documents`);
    if (crawlResult.failedUrls.length > 0) {
      console.log(`⚠️  Failed: ${crawlResult.failedUrls.length} URLs`);
    }
    console.log('');

    if (crawlResult.documents.length === 0) {
      console.error('❌ No documents were crawled');
      process.exit(1);
    }

    // Step 2: Chunk documents
    console.log('✂️  Step 2/4: Chunking documents...');
    progress.status = 'chunking';

    const chunker = new DocumentChunker();
    const allChunks = [];

    for (const doc of crawlResult.documents) {
      try {
        const chunks = chunker.chunk(doc);
        allChunks.push(...chunks);

        if (options.verbose) {
          console.log(`   ✂️  ${doc.title}: ${chunks.length} chunks`);
        }
      } catch (error: any) {
        const errorMsg = `Failed to chunk ${doc.url}: ${error.message}`;
        progress.errors.push(errorMsg);
        if (options.verbose) {
          console.log(`   ❌ ${errorMsg}`);
        }
      }
    }

    progress.chunksCreated = allChunks.length;
    console.log(`✅ Created ${allChunks.length} chunks`);
    console.log('');

    // Step 3: Generate embeddings
    console.log('🧮 Step 3/4: Generating embeddings...');
    progress.status = 'embedding';

    const embeddings = await embeddingService.generateEmbeddingsBatch(
      allChunks.map((c) => c.text),
      {
        onProgress: (current, total) => {
          progress.embeddingsGenerated = current;
          if (options.verbose) {
            console.log(`   🧮 ${current}/${total} embeddings`);
          } else {
            process.stdout.write(`\r   Progress: ${current}/${total} embeddings`);
          }
        },
      }
    );

    if (!options.verbose) {
      process.stdout.write('\n');
    }

    progress.embeddingsGenerated = embeddings.length;

    // Attach embeddings to chunks
    allChunks.forEach((chunk, index) => {
      chunk.embedding = embeddings[index];
    });

    console.log(`✅ Generated ${embeddings.length} embeddings`);
    console.log('');

    // Step 4: Store in ChromaDB
    console.log('💾 Step 4/4: Storing in ChromaDB...');
    progress.status = 'storing';

    await chromaService.addChunks(allChunks, CHROMA_COLLECTIONS.all.name);

    console.log(`✅ Stored ${allChunks.length} chunks in ChromaDB`);
    console.log('');

    // Complete
    progress.status = 'completed';
    progress.endTime = new Date();

    const duration = progress.endTime.getTime() - progress.startTime.getTime();
    const durationSeconds = Math.round(duration / 1000);
    const durationMinutes = Math.round(durationSeconds / 60);

    console.log('🎉 Indexing completed successfully!');
    console.log('');
    console.log('📊 Summary:');
    console.log(`   Documents: ${progress.documentsProcessed}`);
    console.log(`   Chunks: ${progress.chunksCreated}`);
    console.log(`   Embeddings: ${progress.embeddingsGenerated}`);
    console.log(`   Duration: ${durationMinutes}m ${durationSeconds % 60}s`);
    console.log(`   Errors: ${progress.errors.length}`);

    if (progress.errors.length > 0 && options.verbose) {
      console.log('');
      console.log('⚠️  Errors:');
      progress.errors.forEach((error) => console.log(`   - ${error}`));
    }

    console.log('');
    console.log('✨ You can now use the RAG tools in Claude Desktop or Cursor!');
    console.log('   Try: docs_search, docs_ask, docs_get_example');

    await chromaService.close();
    process.exit(0);
  } catch (error: any) {
    console.error('');
    console.error('❌ Indexing failed:', error.message);
    if (options.verbose && error.stack) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
