#!/usr/bin/env tsx
/**
 * Comprehensive Tutorial Indexer
 *
 * Fetches tutorials and learning materials from:
 * - Official Hedera tutorials repository
 * - Getting started guides
 * - Service-specific tutorials
 * - Integration guides
 */

import { config as loadEnv } from 'dotenv';
import { ChromaDBService } from '../src/services/chromadb-service.js';
import { EmbeddingService } from '../src/services/embedding-service.js';
import { DocumentChunker } from '../src/utils/document-chunker.js';
import { createRAGConfig, validateRAGConfig } from '../src/config/rag.js';
import { Document } from '../src/types/rag.js';
import { logger } from '../src/utils/logger.js';
import { sourceLanguageFromPath } from '../src/utils/source-language.js';

// Load environment variables
loadEnv();

interface GitHubFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
}

interface IndexingStats {
  totalTutorials: number;
  totalChunks: number;
  errors: string[];
}

interface TutorialSource {
  name: string;
  owner: string;
  repo: string;
  branch: string;
  paths: string[];
  patterns: string[];
}

// Tutorial sources to index
const TUTORIAL_SOURCES: TutorialSource[] = [
  {
    name: 'Hedera Examples',
    owner: 'hiero-ledger',
    repo: 'hiero-consensus-node', // formerly hashgraph/hedera-services
    branch: 'main',
    paths: ['docs', 'examples'],
    patterns: ['*.md'],
  },
  {
    name: 'Hedera JSON-RPC Relay',
    owner: 'hiero-ledger',
    repo: 'hiero-json-rpc-relay', // formerly hashgraph/hedera-json-rpc-relay
    branch: 'main',
    paths: ['docs', 'examples'],
    patterns: ['*.md'],
  },
  {
    name: 'Hedera Local Node',
    owner: 'hiero-ledger',
    repo: 'hiero-local-node', // deprecated in favour of Solo, kept for reference
    branch: 'main',
    paths: ['.'],
    patterns: ['*.md'],
  },
  {
    name: 'Hedera Smart Contracts',
    owner: 'hashgraph',
    repo: 'hedera-smart-contracts',
    branch: 'main',
    paths: ['contracts', 'docs', 'test'],
    patterns: ['*.md', '*.sol'],
  },
  // Solo replaces the deprecated Hiero Local Node for running a local network
  {
    name: 'Solo (local network)',
    owner: 'hiero-ledger',
    repo: 'solo',
    branch: 'main',
    paths: ['docs', 'examples'],
    patterns: ['*.md'],
  },
  {
    name: 'Solo documentation',
    owner: 'hiero-ledger',
    repo: 'solo-docs',
    branch: 'main',
    paths: ['content'],
    patterns: ['*.md'],
  },
  // The CLI HashPilot's own wrapper looks for
  {
    name: 'Hiero CLI',
    owner: 'hiero-ledger',
    repo: 'hiero-cli',
    branch: 'main',
    paths: ['docs', 'skills'],
    patterns: ['*.md'],
  },
  // Stablecoin Studio: HashPilot ships a stablecoin_manage tool built on it
  {
    name: 'Stablecoin Studio',
    owner: 'hashgraph',
    repo: 'stablecoin-studio',
    branch: 'main',
    paths: ['documentation', 'docs'],
    patterns: ['*.md'],
  },
  // Official agent tooling, the closest neighbour to HashPilot itself
  {
    name: 'Hedera Agent Kit (JS)',
    owner: 'hashgraph',
    repo: 'hedera-agent-kit-js',
    branch: 'main',
    paths: ['docs', 'examples'],
    patterns: ['*.md'],
  },
  // Wallet integration, a common integration guide request
  {
    name: 'Hedera Wallet Connect',
    owner: 'hashgraph',
    repo: 'hedera-wallet-connect',
    branch: 'main',
    paths: ['.'],
    patterns: ['*.md'],
  },
  {
    name: 'Hedera NFT SDK',
    owner: 'hashgraph',
    repo: 'hedera-nft-sdk',
    branch: 'main',
    paths: ['docs', 'examples', '.'],
    patterns: ['*.md'],
  },
  // Mirror Node REST/web3 API documentation, straight from the implementation
  {
    name: 'Hiero Mirror Node',
    owner: 'hiero-ledger',
    repo: 'hiero-mirror-node',
    branch: 'main',
    paths: ['docs'],
    patterns: ['*.md'],
  },
];

// Additional single-file tutorials to fetch
const SINGLE_FILE_TUTORIALS = [
  {
    name: 'SDK JS Getting Started',
    owner: 'hiero-ledger',
    repo: 'hiero-sdk-js',
    branch: 'main',
    path: 'README.md',
  },
  {
    name: 'SDK Java Getting Started',
    owner: 'hiero-ledger',
    repo: 'hiero-sdk-java',
    branch: 'main',
    path: 'README.md',
  },
  {
    name: 'JSON-RPC Relay Setup',
    owner: 'hiero-ledger',
    repo: 'hiero-json-rpc-relay', // formerly hashgraph/hedera-json-rpc-relay
    branch: 'main',
    path: 'README.md',
  },
];

/**
 * Build GitHub API URL for directory listing
 */
function buildApiUrl(owner: string, repo: string, dirPath: string, branch: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
}

/**
 * Build raw content URL
 */
function buildRawUrl(owner: string, repo: string, filePath: string, branch: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

/**
 * List files in GitHub directory
 */
async function listGitHubDirectory(apiUrl: string): Promise<GitHubFile[]> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Hedera-MCP-Tutorial-Indexer',
    };

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
 * Fetch file content from GitHub
 */
async function fetchFileContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        return null;
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
 * Recursively list tutorial files
 */
async function listTutorialFiles(
  source: TutorialSource,
  dirPath: string,
  maxFiles: number,
  depth: number = 0
): Promise<string[]> {
  if (depth > 4 || maxFiles <= 0) {
    return [];
  }

  const files: string[] = [];
  const apiUrl = buildApiUrl(source.owner, source.repo, dirPath, source.branch);
  const entries = await listGitHubDirectory(apiUrl);

  for (const entry of entries) {
    if (files.length >= maxFiles) break;

    if (entry.type === 'dir') {
      // Skip certain directories
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'target' ||
        entry.name === 'build' ||
        entry.name === 'dist'
      ) {
        continue;
      }

      // Recurse into subdirectory
      const subFiles = await listTutorialFiles(
        source,
        entry.path,
        maxFiles - files.length,
        depth + 1
      );
      files.push(...subFiles);
    } else if (entry.type === 'file') {
      // Check if file matches any pattern
      const matches = source.patterns.some((pattern) => {
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
 * Extract title from content
 */
function extractTitle(content: string, filePath: string): string {
  // Try markdown heading
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  // Try YAML front matter title
  const frontMatterMatch = content.match(/^---\n[\s\S]*?title:\s*[\"']?(.+?)[\"']?\s*$/m);
  if (frontMatterMatch) {
    return frontMatterMatch[1].trim();
  }

  // Fallback to filename
  const fileName = filePath.split('/').pop() || filePath;
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Classify tutorial type
 */
function classifyTutorialType(filePath: string, content: string): string {
  const pathLower = filePath.toLowerCase();
  const contentLower = content.toLowerCase();

  if (pathLower.includes('getting-started') || pathLower.includes('quickstart')) {
    return 'getting-started';
  }
  if (pathLower.includes('example') || pathLower.includes('/examples/')) {
    return 'example';
  }
  if (contentLower.includes('step 1') || contentLower.includes('## step')) {
    return 'step-by-step';
  }
  if (pathLower.endsWith('.sol')) {
    return 'smart-contract';
  }
  if (pathLower.includes('api') || pathLower.includes('reference')) {
    return 'api-guide';
  }
  if (pathLower.includes('migration') || pathLower.includes('upgrade')) {
    return 'migration';
  }

  return 'tutorial';
}

/**
 * Extract tags from tutorial
 */
function extractTags(filePath: string, sourceName: string, content: string): string[] {
  const tags: Set<string> = new Set(['tutorial', 'hedera', 'guide']);

  // Add source tag
  tags.add(sourceName.toLowerCase().replace(/\s+/g, '-'));

  // Extract from path
  const segments = filePath.split('/').filter(Boolean);
  segments.forEach((seg) => {
    const cleaned = seg.toLowerCase().replace(/[^a-z0-9]/g, '-');
    if (cleaned.length > 2 && cleaned.length < 25 && !cleaned.match(/^\d+$/)) {
      tags.add(cleaned);
    }
  });

  // Extract from content keywords
  const contentLower = content.toLowerCase();
  if (contentLower.includes('account')) tags.add('account');
  if (contentLower.includes('token')) tags.add('token');
  if (contentLower.includes('hts') || contentLower.includes('hedera token service'))
    tags.add('hts');
  if (contentLower.includes('hcs') || contentLower.includes('consensus')) tags.add('hcs');
  if (contentLower.includes('smart contract') || contentLower.includes('solidity'))
    tags.add('smart-contract');
  if (contentLower.includes('evm')) tags.add('evm');
  if (contentLower.includes('nft')) tags.add('nft');
  if (contentLower.includes('defi')) tags.add('defi');
  if (contentLower.includes('json-rpc')) tags.add('json-rpc');
  if (contentLower.includes('local node')) tags.add('local-development');
  if (contentLower.includes('test')) tags.add('testing');

  return Array.from(tags).slice(0, 15);
}

/**
 * Create document from tutorial content
 */
function createTutorialDocument(
  content: string,
  filePath: string,
  source: TutorialSource | { name: string; owner: string; repo: string; branch: string }
): Document {
  const url = `https://github.com/${source.owner}/${source.repo}/blob/${source.branch}/${filePath}`;
  const title = extractTitle(content, filePath);
  const tutorialType = classifyTutorialType(filePath, content);
  const tags = extractTags(filePath, source.name, content);

  const id = `tutorial-${source.owner}-${source.repo}-${filePath.replace(/[^a-zA-Z0-9-_]/g, '-')}`;

  return {
    id,
    url,
    title: `${source.name}: ${title}`,
    content,
    metadata: {
      url,
      title: `${source.name}: ${title}`,
      description: `${tutorialType.replace(/-/g, ' ')} from ${source.name} - ${title}`,
      contentType: 'tutorial',
      tags,
      crawledAt: new Date().toISOString(),
    },
  };
}

/**
 * Main indexing function
 */
async function main() {
  console.log('🚀 Starting Comprehensive Tutorial Indexing\n');

  // Parse arguments
  const args = process.argv.slice(2);
  let maxFilesPerSource = 100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-files' && args[i + 1]) {
      maxFilesPerSource = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help') {
      console.log(`
Comprehensive Tutorial Indexer

Usage: npm run index-tutorials [options]

Options:
  --max-files <n>  Maximum files per source (default: 100)
  --help           Show this help message

Examples:
  npm run index-tutorials
  npm run index-tutorials -- --max-files 200
`);
      process.exit(0);
    }
  }

  console.log(`📚 Max files per source: ${maxFilesPerSource}`);

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
    validation.errors.forEach((err) => console.error(`   - ${err}`));
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
  const embeddingService = new EmbeddingService(ragConfig.openaiApiKey, ragConfig.embeddingModel);
  console.log('✅ Embedding service initialized');

  // Chunking service
  const documentChunker = new DocumentChunker();
  console.log('✅ Chunking service initialized\n');

  // Stats tracking
  const stats: IndexingStats = {
    totalTutorials: 0,
    totalChunks: 0,
    errors: [],
  };

  const allDocuments: Document[] = [];

  // Process each tutorial source
  for (const source of TUTORIAL_SOURCES) {
    console.log(`\n📦 Processing ${source.name}...`);

    const sourceDocuments: Document[] = [];

    for (const basePath of source.paths) {
      console.log(`   📂 Scanning ${basePath}...`);

      const files = await listTutorialFiles(source, basePath, maxFilesPerSource);
      console.log(`      Found ${files.length} files`);

      // Fetch file contents
      let fetchedCount = 0;
      for (const filePath of files) {
        const url = buildRawUrl(source.owner, source.repo, filePath, source.branch);
        const content = await fetchFileContent(url);

        if (content && content.length > 100) {
          const doc = createTutorialDocument(content, filePath, source);
          sourceDocuments.push(doc);
          fetchedCount++;
        }

        // Rate limiting
        if (fetchedCount % 10 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      console.log(`      ✅ Fetched ${fetchedCount} documents`);
    }

    stats.totalTutorials += sourceDocuments.length;
    allDocuments.push(...sourceDocuments);
    console.log(`   ✅ Total for ${source.name}: ${sourceDocuments.length} tutorials`);
  }

  // Process single file tutorials
  console.log('\n📄 Fetching single-file tutorials...');
  for (const tutorial of SINGLE_FILE_TUTORIALS) {
    const url = buildRawUrl(tutorial.owner, tutorial.repo, tutorial.path, tutorial.branch);
    const content = await fetchFileContent(url);

    if (content) {
      const doc = createTutorialDocument(content, tutorial.path, tutorial);
      allDocuments.push(doc);
      console.log(`   ✅ ${tutorial.name}`);
      stats.totalTutorials++;
    }
  }

  console.log(`\n📊 Total tutorials fetched: ${stats.totalTutorials}\n`);

  if (allDocuments.length === 0) {
    console.error('❌ No tutorials found. Check repository access.');
    process.exit(1);
  }

  // Chunk documents
  console.log('✂️  Chunking tutorials...');
  const allChunks: any[] = [];

  for (const doc of allDocuments) {
    const chunks = documentChunker.chunk(doc);

    // A raw source file has no markdown fences, so the chunker stores it as
    // prose. Mark it as code in its own language, or the code tools never see
    // it (this hid all 327 Solidity contracts from hedera-smart-contracts).
    const language = sourceLanguageFromPath(doc.url);
    if (language) {
      for (const chunk of chunks) {
        chunk.metadata.hasCode = true;
        chunk.metadata.language = language;
        chunk.metadata.codeLanguages = [language];
      }
    }

    allChunks.push(...chunks);
  }

  console.log(
    `✅ Created ${allChunks.length} chunks (avg ${(allChunks.length / stats.totalTutorials).toFixed(1)} chunks/tutorial)\n`
  );

  // Generate embeddings
  console.log('🧮 Generating embeddings...');
  const texts = allChunks.map((c) => c.text);
  const embeddings = await embeddingService.generateEmbeddingsBatch(texts);

  // Attach embeddings to chunks
  for (let i = 0; i < allChunks.length; i++) {
    allChunks[i].embedding = embeddings[i];
  }
  console.log(`✅ Generated ${embeddings.length} embeddings\n`);

  // Store in ChromaDB
  console.log('💾 Storing in ChromaDB...');
  await chromaService.addChunks(allChunks);

  stats.totalChunks = allChunks.length;
  console.log(`✅ Stored ${stats.totalChunks} chunks\n`);

  // Final summary
  console.log('='.repeat(60));
  console.log('🎉 TUTORIAL INDEXING COMPLETED');
  console.log('='.repeat(60));
  console.log(`\n📊 Summary:`);
  console.log(`   Total Tutorials: ${stats.totalTutorials}`);
  console.log(`   Total Chunks: ${stats.totalChunks}`);
  console.log(`   Avg Chunks/Tutorial: ${(stats.totalChunks / stats.totalTutorials).toFixed(1)}`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  Errors (${stats.errors.length}):`);
    stats.errors.slice(0, 10).forEach((err) => console.log(`   - ${err}`));
  }

  // Check total chunks in ChromaDB
  const totalCount = await chromaService.getCollectionCount();
  console.log(`\n📈 Total chunks in ChromaDB: ${totalCount}`);

  console.log('\n✨ Tutorials now available for RAG queries!');
  console.log('   Try: docs_search "How to deploy smart contract on Hedera"');
  console.log('   Or: docs_search "Getting started with Hedera local node"\n');

  await chromaService.close();
}

// Run
main().catch((error) => {
  console.error('❌ Fatal error:', error.message);
  logger.error('Tutorial indexing failed', { error: error.message });
  process.exit(1);
});
