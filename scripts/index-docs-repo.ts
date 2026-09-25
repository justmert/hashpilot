#!/usr/bin/env tsx
/**
 * Hedera Documentation Indexer (git-based)
 *
 * Indexes docs.hedera.com from its source repository (hashgraph/hedera-docs,
 * a Mintlify site: MDX pages plus API specs) instead of crawling the rendered
 * site. This covers every page, needs no crawler credits, and re-runs cheaply.
 *
 * Covers: native services (HTS, HCS, File Service, Smart Contract Service),
 * EVM guides, SDK and REST API references, network configuration and fee
 * schedules, tutorials, solutions, and support pages.
 *
 * Usage:
 *   npm run index-docs-repo                 # clone/update and index everything
 *   npm run index-docs-repo -- --dry-run    # parse and chunk only, no OpenAI/Chroma
 *   npm run index-docs-repo -- --max 50     # limit pages (smoke testing)
 *   npm run index-docs-repo -- --dir /path/to/hedera-docs   # use an existing checkout
 *
 * Environment: OPENAI_API_KEY (embeddings), CHROMA_URL, CHROMA_AUTH_TOKEN (admin token)
 */

import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { ChromaDBService } from '../src/services/chromadb-service.js';
import { EmbeddingService } from '../src/services/embedding-service.js';
import { DocumentChunker } from '../src/utils/document-chunker.js';
import { createRAGConfig, validateRAGConfig } from '../src/config/rag.js';
import { Document, DocumentContentType, Chunk } from '../src/types/rag.js';
import { splitFrontmatter, mdxToMarkdown, detectLanguage } from '../src/utils/mdx.js';

loadEnv();

const REPO = 'https://github.com/hashgraph/hedera-docs.git';
const SITE = 'https://docs.hedera.com';
const DEFAULT_CHECKOUT = path.resolve('cache', 'hedera-docs');

/** Directories with no textual value */
const SKIP_DIRS = new Set([
  'images',
  'public',
  'logo',
  '.github',
  '.claude',
  '.vscode',
  'node_modules',
]);

/** Top-level directory -> content type */
const CONTENT_TYPE_BY_DIR: Record<string, DocumentContentType> = {
  learn: 'concept',
  native: 'guide',
  evm: 'guide',
  reference: 'api',
  networks: 'reference',
  operators: 'guide',
  solutions: 'tutorial',
  support: 'guide',
  snippets: 'reference',
};

const SERVICE_TAGS: Array<[RegExp, string]> = [
  [/token|hts|nft|fungible/i, 'hts'],
  [/consensus|hcs|topic/i, 'hcs'],
  [/smart-contract|solidity|evm|contract/i, 'smart-contracts'],
  [/file-service|file/i, 'file-service'],
  [/mirror|rest-api|graphql/i, 'mirror-node'],
  [/fee|pricing/i, 'fees'],
  [/account|key|wallet/i, 'accounts'],
  [/staking|node|network/i, 'network'],
  [/sdk/i, 'sdk'],
];

interface Options {
  dir: string;
  max: number;
  dryRun: boolean;
  branch: string;
  collection?: string;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = { dir: DEFAULT_CHECKOUT, max: Infinity, dryRun: false, branch: 'main' };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dir':
        options.dir = path.resolve(args[++i]);
        break;
      case '--max':
        options.max = parseInt(args[++i], 10);
        break;
      case '--branch':
        options.branch = args[++i];
        break;
      case '--collection':
        options.collection = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        console.log(
          'Usage: npm run index-docs-repo -- [--dir path] [--max N] [--branch main] [--collection name] [--dry-run]'
        );
        process.exit(0);
    }
  }
  return options;
}

/**
 * Shallow, sparse clone (skips image directories) or fast-forward an existing checkout.
 */
function ensureCheckout(dir: string, branch: string): void {
  const git = (cmdArgs: string[], cwd?: string) =>
    execFileSync('git', cmdArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' });

  if (existsSync(path.join(dir, '.git'))) {
    console.log(`📥 Updating checkout at ${dir}`);
    try {
      git(['fetch', '--depth', '1', 'origin', branch], dir);
      git(['reset', '--hard', `origin/${branch}`], dir);
    } catch (error: any) {
      console.warn(`   ⚠️  update failed, using existing checkout: ${error.message}`);
    }
    return;
  }

  console.log(`📥 Cloning ${REPO} (${branch}, sparse, no images) into ${dir}`);
  fsSync.mkdirSync(path.dirname(dir), { recursive: true });
  git([
    'clone',
    '--quiet',
    '--depth',
    '1',
    '--branch',
    branch,
    '--filter=blob:none',
    '--sparse',
    REPO,
    dir,
  ]);
  git(['sparse-checkout', 'set', '--no-cone', '/*', '!/images', '!/public', '!/logo'], dir);
}

import { existsSync } from 'fs';
import * as fsSync from 'fs';

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, root, out);
    } else if (/\.(mdx?|md)$/i.test(entry.name)) {
      out.push(full);
    }
  }
}

function toDocument(filePath: string, root: string, raw: string): Document | null {
  const rel = path.relative(root, filePath).replace(/\\/g, '/');
  const { title, description, body } = splitFrontmatter(raw);
  const markdown = mdxToMarkdown(body);
  if (markdown.replace(/\s+/g, '').length < 80) return null; // stub or redirect page

  const urlPath = rel.replace(/\.(mdx?|md)$/i, '').replace(/\/index$/, '');
  const url = `${SITE}/${urlPath}`;
  const topDir = rel.split('/')[0];
  const headingTitle = markdown.match(/^#\s+(.+)$/m)?.[1];
  const finalTitle = (title || headingTitle || path.basename(urlPath).replace(/-/g, ' ')).trim();

  const tags = new Set<string>(['hedera-docs', topDir]);
  for (const [pattern, tag] of SERVICE_TAGS) {
    if (pattern.test(rel)) tags.add(tag);
  }
  const language = detectLanguage(markdown);

  const content = `# ${finalTitle}\n\n${description ? `${description}\n\n` : ''}${markdown}`;
  const id = `docs-${createHash('sha1').update(urlPath).digest('hex').slice(0, 16)}`;

  return {
    id,
    url,
    title: finalTitle,
    content,
    metadata: {
      url,
      title: finalTitle,
      description,
      contentType: CONTENT_TYPE_BY_DIR[topDir] || 'guide',
      tags: Array.from(tags),
      language,
      crawledAt: new Date().toISOString(),
    },
  };
}

async function main(): Promise<void> {
  const options = parseArgs();
  console.log('🚀 Hedera documentation indexing (git-based)\n');

  ensureCheckout(options.dir, options.branch);
  const files: string[] = [];
  await walk(options.dir, options.dir, files);
  files.sort();
  console.log(`📄 ${files.length} markdown pages found`);

  const documents: Document[] = [];
  let skipped = 0;
  for (const file of files.slice(0, options.max)) {
    const raw = await fs.readFile(file, 'utf-8');
    const doc = toDocument(file, options.dir, raw);
    if (doc) documents.push(doc);
    else skipped++;
  }
  console.log(`   ${documents.length} documents, ${skipped} skipped as stubs\n`);

  const chunker = new DocumentChunker();
  const chunks: Chunk[] = [];
  const byType: Record<string, number> = {};
  for (const doc of documents) {
    const docChunks = chunker.chunk(doc);
    chunks.push(...docChunks);
    byType[doc.metadata.contentType] = (byType[doc.metadata.contentType] || 0) + 1;
  }
  console.log(
    `🧩 ${chunks.length} chunks (avg ${(chunks.length / Math.max(documents.length, 1)).toFixed(1)} per page)`
  );
  console.log(`   by content type: ${JSON.stringify(byType)}`);

  if (options.dryRun) {
    const sample = documents[Math.floor(documents.length / 2)];
    console.log(
      `\n🔍 sample: ${sample.url}\n   tags=${sample.metadata.tags?.join(',')} language=${sample.metadata.language || '-'}`
    );
    console.log(`   ${sample.content.slice(0, 400).replace(/\n/g, ' ')}...`);
    console.log('\n✅ dry run complete (no embeddings generated)');
    return;
  }

  const ragConfig = createRAGConfig();
  const validation = validateRAGConfig(ragConfig);
  if (!validation.valid) {
    console.error(`❌ Configuration invalid: ${validation.errors.join(', ')}`);
    process.exit(1);
  }

  const chromaService = new ChromaDBService({
    url: ragConfig.chromaUrl,
    authToken: ragConfig.chromaAuthToken,
    defaultCollection: options.collection,
  });
  await chromaService.initialize();
  console.log(`✅ ChromaDB connected (${ragConfig.chromaUrl})`);

  const embeddingService = new EmbeddingService(ragConfig.openaiApiKey, ragConfig.embeddingModel);

  // Embed and upsert in slices so a failure late in the run does not lose everything
  const slice = 500;
  let done = 0;
  const started = Date.now();
  for (let i = 0; i < chunks.length; i += slice) {
    const batch = chunks.slice(i, i + slice);
    const embeddings = await embeddingService.generateEmbeddingsBatch(
      batch.map((c) => c.text),
      { useCache: false }
    );
    batch.forEach((chunk, idx) => {
      chunk.embedding = embeddings[idx];
    });
    await chromaService.addChunks(batch, options.collection);
    done += batch.length;
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`   ✓ ${done}/${chunks.length} chunks indexed (${elapsed}s)`);
  }

  const total = await chromaService.getCollectionCount(options.collection);
  console.log(`\n📊 Pages: ${documents.length}, chunks written: ${chunks.length}`);
  console.log(`Total chunks in ChromaDB: ${total}`);
  await chromaService.close();
  console.log('✅ Documentation indexing complete');
}

main().catch((error) => {
  console.error('❌ Indexing failed:', error);
  process.exit(1);
});
