#!/usr/bin/env tsx
/**
 * SDK Documentation Indexer
 *
 * Fetches documentation and examples from Hedera SDK GitHub repositories
 * and indexes them into ChromaDB for RAG queries.
 */

import { config as loadEnv } from 'dotenv';
import { ChromaDBService } from '../src/services/chromadb-service.js';
import { EmbeddingService } from '../src/services/embedding-service.js';
import { DocumentChunker } from '../src/utils/document-chunker.js';
import { createRAGConfig, validateRAGConfig } from '../src/config/rag.js';
import {
  SDK_REPOS,
  SDKLanguage,
  SDKRepoConfig,
  getAllSDKLanguages,
  buildRawUrl,
  buildApiUrl,
  buildRepoUrl,
} from '../src/config/sdk-repos.js';
import { Document, Chunk, DocumentContentType } from '../src/types/rag.js';
import { logger } from '../src/utils/logger.js';

// Load environment variables
loadEnv();

interface GitHubFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
}

interface IndexingStats {
  totalFiles: number;
  totalChunks: number;
  errors: string[];
  byLanguage: Record<SDKLanguage, { files: number; chunks: number }>;
}

/**
 * Parse CLI arguments
 */
function parseArgs(): { sdks: SDKLanguage[]; maxExamples: number } {
  const args = process.argv.slice(2);
  let sdks: SDKLanguage[] = getAllSDKLanguages();
  let maxExamples = 9999; // Default: unlimited (fetch all available examples)

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sdks' && args[i + 1]) {
      const requested = args[i + 1].split(',') as SDKLanguage[];
      sdks = requested.filter(sdk => SDK_REPOS[sdk]);
      i++;
    } else if (args[i] === '--max-examples' && args[i + 1]) {
      maxExamples = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help') {
      console.log(`
SDK Documentation Indexer

Usage: npm run index-sdk [options]

Options:
  --sdks <list>           Comma-separated list of SDKs to index
                          Available: javascript,java,go,python,rust
                          Default: all SDKs
  --max-examples <n>      Maximum examples per SDK (default: 50)
  --help                  Show this help message

Examples:
  npm run index-sdk
  npm run index-sdk -- --sdks javascript,python
  npm run index-sdk -- --max-examples 100
`);
      process.exit(0);
    }
  }

  return { sdks, maxExamples };
}

/**
 * Fetch file content from GitHub
 */
async function fetchFileContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        return null; // File not found, skip
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.text();
  } catch (error: any) {
    logger.warn(`Failed to fetch ${url}`, { error: error.message });
    return null;
  }
}

/**
 * List files in a GitHub directory
 */
async function listGitHubDirectory(apiUrl: string): Promise<GitHubFile[]> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Hedera-MCP-Indexer',
    };

    // Add GitHub token for higher rate limits (5000/hour vs 60/hour)
    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken) {
      headers['Authorization'] = `token ${githubToken}`;
    }

    const response = await fetch(apiUrl, { headers });

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error: any) {
    logger.warn(`Failed to list directory`, { apiUrl, error: error.message });
    return [];
  }
}

/**
 * Recursively list example files matching patterns
 */
async function listExampleFiles(
  config: SDKRepoConfig,
  dirPath: string,
  patterns: string[],
  maxFiles: number,
  depth: number = 0,
): Promise<string[]> {
  if (depth > 5 || maxFiles <= 0) {
    return [];
  }

  const files: string[] = [];
  const apiUrl = buildApiUrl(config, dirPath);
  const entries = await listGitHubDirectory(apiUrl);

  for (const entry of entries) {
    if (files.length >= maxFiles) break;

    if (entry.type === 'dir') {
      // Skip excluded directories
      if (config.excludeDirs.some(exc => entry.name === exc || entry.path.includes(exc))) {
        continue;
      }

      // Recurse into subdirectory
      const subFiles = await listExampleFiles(
        config,
        entry.path,
        patterns,
        maxFiles - files.length,
        depth + 1,
      );
      files.push(...subFiles);
    } else if (entry.type === 'file') {
      // Check if file matches any pattern
      const matches = patterns.some(pattern => {
        if (pattern.startsWith('*.')) {
          const ext = pattern.slice(1);
          return entry.name.endsWith(ext);
        }
        return entry.name === pattern;
      });

      if (matches) {
        files.push(entry.path);
      }
    }
  }

  return files.slice(0, maxFiles);
}

/**
 * Create document from fetched content
 */
function createDocument(
  content: string,
  filePath: string,
  config: SDKRepoConfig,
  language: SDKLanguage,
): Document {
  const url = `${buildRepoUrl(config)}/blob/${config.branch}/${filePath}`;
  const title = extractTitle(content, filePath);
  const contentType = classifyContentType(filePath);

  const id = `sdk-${language}-${filePath.replace(/[^a-zA-Z0-9-_]/g, '-')}`;

  return {
    id,
    url,
    title,
    content,
    metadata: {
      url,
      title,
      description: `${config.displayName} - ${filePath}`,
      contentType,
      tags: extractTags(filePath, language),
      language: mapSDKToCodeLanguage(language),
      crawledAt: new Date().toISOString(),
    },
  };
}

/**
 * Extract title from content or filename
 */
function extractTitle(content: string, filePath: string): string {
  // Try to extract from markdown heading
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  // Extract from filename
  const fileName = filePath.split('/').pop() || filePath;
  return fileName
    .replace(/\.[^.]+$/, '') // Remove extension
    .replace(/[-_]/g, ' ') // Replace dashes/underscores with spaces
    .replace(/\b\w/g, c => c.toUpperCase()); // Title case
}

/**
 * Classify content type from file path
 */
function classifyContentType(filePath: string): DocumentContentType {
  const pathLower = filePath.toLowerCase();

  if (pathLower.includes('example') || pathLower.includes('/examples/')) {
    return 'example';
  }
  if (pathLower.includes('tutorial') || pathLower.includes('getting-started')) {
    return 'tutorial';
  }
  if (pathLower.includes('api') || pathLower.includes('reference')) {
    return 'api';
  }
  if (
    pathLower.endsWith('.md') &&
    (pathLower.includes('readme') || pathLower.includes('guide') || pathLower.includes('manual'))
  ) {
    return 'guide';
  }

  // Code files are examples
  if (pathLower.match(/\.(js|ts|java|go|py|rs)$/)) {
    return 'example';
  }

  return 'guide';
}

/**
 * Map SDK language to code language type
 */
function mapSDKToCodeLanguage(
  sdk: SDKLanguage,
): 'javascript' | 'typescript' | 'java' | 'python' | 'go' | 'solidity' | undefined {
  switch (sdk) {
    case 'javascript':
      return 'javascript';
    case 'java':
      return 'java';
    case 'go':
      return 'go';
    case 'python':
      return 'python';
    case 'rust':
      return undefined; // Rust not in our type system yet
    default:
      return undefined;
  }
}

/**
 * Extract tags from file path and SDK
 */
function extractTags(filePath: string, sdk: SDKLanguage): string[] {
  const tags: Set<string> = new Set(['sdk', sdk, 'hedera']);

  // Extract from path segments
  const segments = filePath.split('/').filter(Boolean);
  segments.forEach(seg => {
    const cleaned = seg.toLowerCase().replace(/[^a-z0-9]/g, '-');
    if (cleaned.length > 2 && cleaned.length < 30) {
      tags.add(cleaned);
    }
  });

  // Add operation-specific tags
  const pathLower = filePath.toLowerCase();
  if (pathLower.includes('account')) tags.add('account');
  if (pathLower.includes('token')) tags.add('token');
  if (pathLower.includes('transfer')) tags.add('transfer');
  if (pathLower.includes('contract')) tags.add('smart-contract');
  if (pathLower.includes('consensus') || pathLower.includes('topic')) tags.add('consensus');
  if (pathLower.includes('file')) tags.add('file');
  if (pathLower.includes('schedule')) tags.add('scheduled-transaction');

  return Array.from(tags).slice(0, 15);
}

/**
 * Main indexing function
 */
async function main() {
  console.log('🚀 Starting Hedera SDK Documentation Indexing\n');

  const { sdks, maxExamples } = parseArgs();
  console.log(`📚 SDKs to index: ${sdks.join(', ')}`);
  console.log(`📄 Max examples per SDK: ${maxExamples}`);

  // Check for GitHub token
  if (process.env.GITHUB_TOKEN) {
    console.log(`🔑 GitHub token detected (rate limit: 5000/hour)`);
  } else {
    console.log(`⚠️  No GITHUB_TOKEN set (rate limit: 60/hour - may hit limits)`);
  }
  console.log();

  // Initialize services
  console.log('⚙️  Loading configuration...');
  const ragConfig = createRAGConfig();
  const validation = validateRAGConfig(ragConfig);

  if (!validation.valid) {
    console.error('❌ Configuration validation failed:');
    validation.errors.forEach(err => console.error(`   - ${err}`));
    process.exit(1);
  }
  console.log('✅ Configuration validated\n');

  console.log('🔧 Initializing services...');

  // ChromaDB
  const chromaService = new ChromaDBService({
    url: ragConfig.chromaUrl,
    authToken: ragConfig.chromaAuthToken,
  });
  await chromaService.initialize();
  console.log('✅ ChromaDB connected');

  // Embedding service
  const embeddingService = new EmbeddingService(
    ragConfig.openaiApiKey,
    ragConfig.embeddingModel
  );
  console.log('✅ Embedding service initialized');

  // Chunking service
  const documentChunker = new DocumentChunker();
  console.log('✅ Chunking service initialized\n');

  // Stats tracking
  const stats: IndexingStats = {
    totalFiles: 0,
    totalChunks: 0,
    errors: [],
    byLanguage: {} as any,
  };

  // Process each SDK
  for (const sdk of sdks) {
    console.log(`\n📦 Processing ${SDK_REPOS[sdk].displayName}...`);
    const config = SDK_REPOS[sdk];
    const sdkDocuments: Document[] = [];

    stats.byLanguage[sdk] = { files: 0, chunks: 0 };

    // 1. Fetch documentation files
    console.log('   📄 Fetching documentation files...');
    for (const docFile of config.docFiles) {
      const url = buildRawUrl(config, docFile);
      const content = await fetchFileContent(url);

      if (content) {
        const doc = createDocument(content, docFile, config, sdk);
        sdkDocuments.push(doc);
        console.log(`      ✓ ${docFile}`);
      } else {
        console.log(`      ✗ ${docFile} (not found)`);
      }
    }

    // 2. Fetch example files
    console.log(`   💻 Fetching example files (max ${maxExamples})...`);
    const exampleFiles = await listExampleFiles(
      config,
      config.examplesDir,
      config.examplePatterns,
      maxExamples,
    );

    console.log(`      Found ${exampleFiles.length} example files`);

    for (const exampleFile of exampleFiles) {
      const url = buildRawUrl(config, exampleFile);
      const content = await fetchFileContent(url);

      if (content) {
        const doc = createDocument(content, exampleFile, config, sdk);
        sdkDocuments.push(doc);
      }

      // Rate limit to avoid GitHub throttling
      if (exampleFiles.indexOf(exampleFile) % 10 === 9) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    stats.byLanguage[sdk].files = sdkDocuments.length;
    stats.totalFiles += sdkDocuments.length;
    console.log(`   ✅ Fetched ${sdkDocuments.length} documents for ${sdk}`);

    // 3. Chunk documents
    console.log('   ✂️  Chunking documents...');
    const allChunks: Chunk[] = [];

    for (const doc of sdkDocuments) {
      const chunks = documentChunker.chunk(doc);
      allChunks.push(...chunks);
    }

    console.log(`   ✅ Created ${allChunks.length} chunks`);

    // 4. Generate embeddings
    console.log('   🧮 Generating embeddings...');
    const texts = allChunks.map(c => c.text);
    const embeddings = await embeddingService.generateEmbeddingsBatch(texts);

    // Attach embeddings to chunks
    for (let i = 0; i < allChunks.length; i++) {
      allChunks[i].embedding = embeddings[i];
    }
    console.log(`   ✅ Generated ${embeddings.length} embeddings`);

    // 5. Store in ChromaDB
    console.log('   💾 Storing in ChromaDB...');
    await chromaService.addChunks(allChunks);

    stats.byLanguage[sdk].chunks = allChunks.length;
    stats.totalChunks += allChunks.length;
    console.log(`   ✅ Stored ${allChunks.length} chunks`);
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('🎉 SDK INDEXING COMPLETED');
  console.log('='.repeat(60));
  console.log(`\n📊 Summary:`);
  console.log(`   Total Files: ${stats.totalFiles}`);
  console.log(`   Total Chunks: ${stats.totalChunks}`);
  console.log(`\n📦 By SDK:`);

  for (const sdk of sdks) {
    const s = stats.byLanguage[sdk];
    console.log(`   ${SDK_REPOS[sdk].displayName}:`);
    console.log(`      Files: ${s.files}, Chunks: ${s.chunks}`);
  }

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  Errors (${stats.errors.length}):`);
    stats.errors.forEach(err => console.log(`   - ${err}`));
  }

  // Check total chunks in ChromaDB
  const totalCount = await chromaService.getCollectionCount();
  console.log(`\n📈 Total chunks in ChromaDB: ${totalCount}`);

  console.log('\n✨ SDK documentation now available for RAG queries!');
  console.log('   Try: docs_search "How to create account in JavaScript SDK"\n');

  await chromaService.close();
}

// Run
main().catch(error => {
  console.error('❌ Fatal error:', error.message);
  logger.error('SDK indexing failed', { error: error.message });
  process.exit(1);
});
