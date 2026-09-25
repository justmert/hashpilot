#!/usr/bin/env tsx
/**
 * HIP (Hedera Improvement Proposal) Indexer
 *
 * Fetches and indexes all HIPs from the official GitHub repository
 * for comprehensive coverage of Hedera specifications and proposals.
 */

import { config as loadEnv } from 'dotenv';
import { ChromaDBService } from '../src/services/chromadb-service.js';
import { EmbeddingService } from '../src/services/embedding-service.js';
import { DocumentChunker } from '../src/utils/document-chunker.js';
import { createRAGConfig, validateRAGConfig } from '../src/config/rag.js';
import { Document } from '../src/types/rag.js';
import { logger } from '../src/utils/logger.js';

// Load environment variables
loadEnv();

interface GitHubFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
}

interface HIPMetadata {
  hipNumber: number;
  title: string;
  author: string;
  status: string;
  type: string;
  category?: string;
  created?: string;
}

interface IndexingStats {
  totalHIPs: number;
  totalChunks: number;
  errors: string[];
}

const HIP_CONFIG = {
  owner: 'hiero-ledger',
  repo: 'hiero-improvement-proposals', // moved from hashgraph/hedera-improvement-proposal
  branch: 'main',
  hipsDir: 'HIP',
};

/**
 * Build GitHub API URL for directory listing
 */
function buildApiUrl(dirPath: string): string {
  return `https://api.github.com/repos/${HIP_CONFIG.owner}/${HIP_CONFIG.repo}/contents/${dirPath}?ref=${HIP_CONFIG.branch}`;
}

/**
 * Build raw content URL
 */
function buildRawUrl(filePath: string): string {
  return `https://raw.githubusercontent.com/${HIP_CONFIG.owner}/${HIP_CONFIG.repo}/${HIP_CONFIG.branch}/${filePath}`;
}

/**
 * List files in GitHub directory
 */
async function listGitHubDirectory(apiUrl: string): Promise<GitHubFile[]> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Hedera-MCP-HIP-Indexer',
    };

    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken) {
      headers['Authorization'] = `token ${githubToken}`;
    }

    const response = await fetch(apiUrl, { headers });

    if (!response.ok) {
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
 * Parse HIP front matter to extract metadata
 */
function parseHIPMetadata(content: string, fileName: string): HIPMetadata {
  const hipNumber = parseInt(fileName.match(/hip-(\d+)/i)?.[1] || '0', 10);

  // Default metadata
  const metadata: HIPMetadata = {
    hipNumber,
    title: `HIP-${hipNumber}`,
    author: 'Unknown',
    status: 'Unknown',
    type: 'Unknown',
  };

  // Try to parse YAML front matter (between --- markers)
  const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontMatterMatch) {
    const frontMatter = frontMatterMatch[1];

    // Extract title
    const titleMatch = frontMatter.match(/title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) metadata.title = titleMatch[1].trim();

    // Extract author
    const authorMatch = frontMatter.match(/author:\s*["']?(.+?)["']?\s*$/m);
    if (authorMatch) metadata.author = authorMatch[1].trim();

    // Extract status
    const statusMatch = frontMatter.match(/status:\s*["']?(\w+)["']?\s*$/m);
    if (statusMatch) metadata.status = statusMatch[1].trim();

    // Extract type
    const typeMatch = frontMatter.match(/type:\s*["']?(\w+)["']?\s*$/m);
    if (typeMatch) metadata.type = typeMatch[1].trim();

    // Extract category
    const categoryMatch = frontMatter.match(/category:\s*["']?(\w+)["']?\s*$/m);
    if (categoryMatch) metadata.category = categoryMatch[1].trim();

    // Extract created date
    const createdMatch = frontMatter.match(/created:\s*["']?(.+?)["']?\s*$/m);
    if (createdMatch) metadata.created = createdMatch[1].trim();
  }

  // Fallback: try to extract title from first # heading
  if (metadata.title === `HIP-${hipNumber}`) {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
      metadata.title = h1Match[1].trim();
    }
  }

  return metadata;
}

/**
 * Create document from HIP content
 */
function createHIPDocument(content: string, filePath: string, metadata: HIPMetadata): Document {
  const url = `https://github.com/${HIP_CONFIG.owner}/${HIP_CONFIG.repo}/blob/${HIP_CONFIG.branch}/${filePath}`;

  const id = `hip-${metadata.hipNumber}-${filePath.replace(/[^a-zA-Z0-9-_]/g, '-')}`;

  // Extract tags from content
  const tags = ['hip', 'hedera', 'improvement-proposal', metadata.status.toLowerCase()];
  if (metadata.type) tags.push(metadata.type.toLowerCase());
  if (metadata.category) tags.push(metadata.category.toLowerCase());

  // Add topic-specific tags based on content
  const contentLower = content.toLowerCase();
  if (contentLower.includes('token')) tags.push('token');
  if (contentLower.includes('consensus')) tags.push('consensus');
  if (contentLower.includes('smart contract') || contentLower.includes('evm'))
    tags.push('smart-contract');
  if (contentLower.includes('file service')) tags.push('file-service');
  if (contentLower.includes('account')) tags.push('account');

  return {
    id,
    url,
    title: `HIP-${metadata.hipNumber}: ${metadata.title}`,
    content,
    metadata: {
      url,
      title: `HIP-${metadata.hipNumber}: ${metadata.title}`,
      description: `Hedera Improvement Proposal ${metadata.hipNumber} - ${metadata.title}. Status: ${metadata.status}. Type: ${metadata.type}.`,
      contentType: 'reference',
      tags: [...new Set(tags)].slice(0, 15),
      crawledAt: new Date().toISOString(),
    },
  };
}

/**
 * Main indexing function
 */
async function main() {
  console.log('🚀 Starting Hedera Improvement Proposal (HIP) Indexing\n');

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
    totalHIPs: 0,
    totalChunks: 0,
    errors: [],
  };

  // Fetch HIP list
  console.log('📄 Fetching HIP list from GitHub...');
  const apiUrl = buildApiUrl(HIP_CONFIG.hipsDir);
  const hipFiles = await listGitHubDirectory(apiUrl);

  // Filter for HIP markdown files
  const hipMarkdownFiles = hipFiles.filter(
    (f) => f.type === 'file' && f.name.match(/^hip-\d+\.md$/i)
  );

  console.log(`   Found ${hipMarkdownFiles.length} HIPs\n`);

  if (hipMarkdownFiles.length === 0) {
    console.error('❌ No HIPs found. Check repository structure.');
    process.exit(1);
  }

  // Process HIPs in batches
  const batchSize = 50;
  const allDocuments: Document[] = [];

  for (let i = 0; i < hipMarkdownFiles.length; i += batchSize) {
    const batch = hipMarkdownFiles.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(hipMarkdownFiles.length / batchSize);

    console.log(`📦 Processing HIP batch ${batchNum}/${totalBatches} (${batch.length} HIPs)...`);

    // Fetch HIP contents
    const batchDocs: Document[] = [];
    for (const file of batch) {
      const rawUrl = buildRawUrl(`${HIP_CONFIG.hipsDir}/${file.name}`);
      const content = await fetchFileContent(rawUrl);

      if (content) {
        const metadata = parseHIPMetadata(content, file.name);
        const doc = createHIPDocument(content, `${HIP_CONFIG.hipsDir}/${file.name}`, metadata);
        batchDocs.push(doc);
        stats.totalHIPs++;

        // Log progress every 10 HIPs
        if (stats.totalHIPs % 10 === 0) {
          console.log(`   ✓ Fetched ${stats.totalHIPs} HIPs...`);
        }
      } else {
        stats.errors.push(`Failed to fetch ${file.name}`);
      }

      // Rate limit to avoid GitHub throttling
      if (batchDocs.length % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    allDocuments.push(...batchDocs);
    console.log(`   ✅ Fetched ${batchDocs.length} HIPs in batch ${batchNum}`);
  }

  console.log(`\n📊 Total HIPs fetched: ${stats.totalHIPs}\n`);

  // Chunk all documents
  console.log('✂️  Chunking HIPs...');
  const allChunks: any[] = [];

  for (const doc of allDocuments) {
    const chunks = documentChunker.chunk(doc);
    allChunks.push(...chunks);
  }

  console.log(
    `✅ Created ${allChunks.length} chunks (avg ${(allChunks.length / stats.totalHIPs).toFixed(1)} chunks/HIP)\n`
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
  console.log('🎉 HIP INDEXING COMPLETED');
  console.log('='.repeat(60));
  console.log(`\n📊 Summary:`);
  console.log(`   Total HIPs: ${stats.totalHIPs}`);
  console.log(`   Total Chunks: ${stats.totalChunks}`);
  console.log(`   Avg Chunks/HIP: ${(stats.totalChunks / stats.totalHIPs).toFixed(1)}`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  Errors (${stats.errors.length}):`);
    stats.errors.slice(0, 10).forEach((err) => console.log(`   - ${err}`));
    if (stats.errors.length > 10) {
      console.log(`   ... and ${stats.errors.length - 10} more errors`);
    }
  }

  // Check total chunks in ChromaDB
  const totalCount = await chromaService.getCollectionCount();
  console.log(`\n📈 Total chunks in ChromaDB: ${totalCount}`);

  console.log('\n✨ HIP specifications now available for RAG queries!');
  console.log('   Try: docs_search "What is the HIP process?" or "HIP for token service"\n');

  await chromaService.close();
}

// Run
main().catch((error) => {
  console.error('❌ Fatal error:', error.message);
  logger.error('HIP indexing failed', { error: error.message });
  process.exit(1);
});
