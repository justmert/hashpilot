#!/usr/bin/env tsx
/**
 * Hedera Service Specification Indexer
 *
 * Indexes the two canonical, machine-readable specification sources that the
 * prose documentation is derived from:
 *
 *   1. hashgraph/hedera-protobufs — the authoritative protobuf service
 *      definitions for HTS, HCS, the Smart Contract Service, the File Service,
 *      the Schedule Service and the network/admin services. This is what
 *      answers "which fields does TokenCreateTransactionBody actually take".
 *
 *   2. hiero-ledger/hiero-consensus-specifications — the canonical HCS
 *      application standards (HCS-1 .. HCS-20+), which define how the
 *      ecosystem uses topics for files, registries, agents and tokens.
 *
 * Usage:
 *   npm run index-specs                       # both sources
 *   npm run index-specs -- --source protobufs # one source
 *   npm run index-specs -- --dry-run          # parse and chunk only, no cost
 *   npm run index-specs -- --max 20           # limit files per source
 *
 * Environment: OPENAI_API_KEY, CHROMA_URL, CHROMA_AUTH_TOKEN (admin),
 * optional GITHUB_TOKEN to lift the API rate limit.
 */

import { config as loadEnv } from 'dotenv';
import { ChromaDBService } from '../src/services/chromadb-service.js';
import { EmbeddingService } from '../src/services/embedding-service.js';
import { DocumentChunker } from '../src/utils/document-chunker.js';
import { createRAGConfig, validateRAGConfig } from '../src/config/rag.js';
import { Document, Chunk, DocumentContentType } from '../src/types/rag.js';
import { splitFrontmatter, mdxToMarkdown } from '../src/utils/mdx.js';

loadEnv();

interface SpecSource {
  key: string;
  name: string;
  owner: string;
  repo: string;
  branch: string;
  /** Only files under these prefixes are considered */
  include: RegExp;
  /** Skip anything matching this */
  exclude?: RegExp;
  contentType: DocumentContentType;
  /** Wrap the raw file in a fenced code block using this language */
  fence?: string;
  tags: string[];
}

const SOURCES: SpecSource[] = [
  {
    key: 'protobufs',
    name: 'Hedera protobuf service definitions',
    owner: 'hashgraph',
    repo: 'hedera-protobufs',
    branch: 'main',
    include: /\.proto$/,
    // Block-stream internals are implementation detail, not a service API
    exclude: /^(block\/stream\/|platform\/)/,
    contentType: 'reference',
    fence: 'protobuf',
    tags: ['specification', 'protobuf', 'hapi'],
  },
  {
    key: 'hcs-standards',
    name: 'Hiero consensus (HCS) standards',
    owner: 'hiero-ledger',
    repo: 'hiero-consensus-specifications',
    branch: 'main',
    include: /^docs\/.*\.md$/,
    // hcs-XX.md is the blank template new standards are copied from, with
    // placeholder headings ("HCS-XX — <short title>"). Indexed, it ranked above
    // the real HCS-10 spec when asked what HCS-10 defines.
    exclude: /(^|\/)(hcs-xx|template)[^/]*\.md$/i,
    contentType: 'reference',
    tags: ['specification', 'hcs', 'standard'],
  },
];

/** Map a protobuf path to the Hedera service it specifies */
const SERVICE_TAGS: Array<[RegExp, string]> = [
  [/token/i, 'hts'],
  [/consensus/i, 'hcs'],
  [/contract|smart/i, 'smart-contracts'],
  [/file/i, 'file-service'],
  [/schedule/i, 'schedule-service'],
  [/crypto|account/i, 'accounts'],
  [/network|address_book|node/i, 'network'],
  [/freeze|util/i, 'admin'],
];

interface Options {
  sources: string[];
  max: number;
  dryRun: boolean;
  collection?: string;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = { sources: SOURCES.map((s) => s.key), max: Infinity, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source':
        options.sources = [args[++i]];
        break;
      case '--max':
        options.max = parseInt(args[++i], 10);
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
          'Usage: npm run index-specs -- [--source protobufs|hcs-standards] [--max N] [--collection name] [--dry-run]'
        );
        process.exit(0);
    }
  }
  return options;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'hashpilot-spec-indexer',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

/** List every file in a repository via one recursive tree call */
async function listRepoFiles(source: SpecSource): Promise<string[]> {
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${source.branch}?recursive=1`;
  const response = await fetch(url, { headers: githubHeaders() });
  if (!response.ok) {
    throw new Error(
      `GitHub tree for ${source.owner}/${source.repo} failed: HTTP ${response.status}`
    );
  }
  const body = (await response.json()) as {
    tree?: Array<{ path: string; type: string }>;
    truncated?: boolean;
  };
  if (body.truncated) {
    console.warn(`   ⚠️  tree listing truncated for ${source.repo}; some files may be missing`);
  }
  return (body.tree || [])
    .filter((entry) => entry.type === 'blob')
    .map((entry) => entry.path)
    .filter((path) => source.include.test(path) && !(source.exclude && source.exclude.test(path)))
    .sort();
}

async function fetchFile(source: SpecSource, path: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/${path}`;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'hashpilot-spec-indexer' } });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/** Human title for a spec file */
function titleFor(source: SpecSource, path: string, content: string): string {
  if (!source.fence) {
    const front = splitFrontmatter(content);
    if (front.title) return front.title;
    const heading = content.match(/^#\s+(.+)$/m);
    if (heading) return heading[1].trim();
  }
  const base = path.split('/').pop() || path;
  const name = base.replace(/\.(proto|md)$/, '').replace(/[_-]/g, ' ');
  return source.fence ? `${name} (protobuf)` : name;
}

function buildDocument(source: SpecSource, path: string, raw: string): Document | null {
  const url = `https://github.com/${source.owner}/${source.repo}/blob/${source.branch}/${path}`;
  const title = titleFor(source, path, raw);

  let body: string;
  if (source.fence) {
    // Wrap the raw definition in a fence so the chunker keeps it intact and
    // recognises it as code, and prefix context the embedding can match on.
    const comments = raw
      .split('\n')
      .filter((line) => line.trim().startsWith('*') || line.trim().startsWith('//'))
      .map((line) => line.replace(/^\s*(\*|\/\/)\s?/, ''))
      .join(' ')
      .slice(0, 600);
    body = `Protobuf definition \`${path}\` from the authoritative Hedera protobuf repository.\n\n${
      comments ? `${comments}\n\n` : ''
    }\`\`\`${source.fence}\n${raw}\n\`\`\``;
  } else {
    const front = splitFrontmatter(raw);
    body = mdxToMarkdown(front.body);
  }

  if (body.replace(/\s+/g, '').length < 60) return null;

  const tags = new Set<string>(source.tags);
  for (const [pattern, tag] of SERVICE_TAGS) {
    if (pattern.test(path)) tags.add(tag);
  }

  const id = `spec-${source.key}-${path.replace(/[^a-zA-Z0-9-_]/g, '-')}`;

  return {
    id,
    url,
    title,
    content: `# ${title}\n\n${body}`,
    metadata: {
      url,
      title,
      description: `${source.name} - ${path}`,
      contentType: source.contentType,
      tags: Array.from(tags),
      crawledAt: new Date().toISOString(),
    },
  };
}

async function main(): Promise<void> {
  const options = parseArgs();
  console.log('🚀 Hedera service specification indexing\n');
  if (!process.env.GITHUB_TOKEN) {
    console.log('⚠️  No GITHUB_TOKEN set (GitHub allows 60 API requests/hour)\n');
  }

  const selected = SOURCES.filter((s) => options.sources.includes(s.key));
  if (selected.length === 0) {
    console.error(`No such source. Available: ${SOURCES.map((s) => s.key).join(', ')}`);
    process.exit(1);
  }

  const chunker = new DocumentChunker();
  const perSource: Array<{ name: string; files: number; chunks: number }> = [];
  const allChunks: Chunk[] = [];

  for (const source of selected) {
    console.log(`📦 ${source.name} (${source.owner}/${source.repo})`);
    const paths = (await listRepoFiles(source)).slice(0, options.max);
    console.log(`   ${paths.length} files match`);

    const documents: Document[] = [];
    for (const path of paths) {
      const raw = await fetchFile(source, path);
      if (!raw) continue;
      const doc = buildDocument(source, path, raw);
      if (doc) documents.push(doc);
      if (documents.length % 25 === 0 && documents.length > 0) {
        console.log(`   ✓ fetched ${documents.length}/${paths.length}`);
      }
    }

    const chunks: Chunk[] = [];
    for (const doc of documents) {
      chunks.push(...chunker.chunk(doc));
    }
    console.log(`   ✅ ${documents.length} documents, ${chunks.length} chunks\n`);
    perSource.push({ name: source.name, files: documents.length, chunks: chunks.length });
    allChunks.push(...chunks);
  }

  if (allChunks.length === 0) {
    console.error('❌ Nothing to index');
    process.exit(1);
  }

  if (options.dryRun) {
    const sample = allChunks[Math.floor(allChunks.length / 2)];
    console.log(`🔍 sample chunk from ${sample.metadata.url}`);
    console.log(`   hasCode=${sample.metadata.hasCode} tags=${sample.metadata.tags?.join(',')}`);
    console.log(`   ${sample.text.slice(0, 300).replace(/\n/g, ' ')}...`);
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

  const slice = 500;
  let done = 0;
  const started = Date.now();
  for (let i = 0; i < allChunks.length; i += slice) {
    const batch = allChunks.slice(i, i + slice);
    const embeddings = await embeddingService.generateEmbeddingsBatch(
      batch.map((c) => c.text),
      { useCache: false }
    );
    batch.forEach((chunk, index) => {
      chunk.embedding = embeddings[index];
    });
    await chromaService.addChunks(batch, options.collection);
    done += batch.length;
    console.log(
      `   ✓ ${done}/${allChunks.length} chunks indexed (${((Date.now() - started) / 1000).toFixed(0)}s)`
    );
  }

  console.log('\n📊 Summary');
  for (const s of perSource) {
    console.log(`   ${s.name}: ${s.files} files, ${s.chunks} chunks`);
  }
  console.log(
    `Total chunks in ChromaDB: ${await chromaService.getCollectionCount(options.collection)}`
  );
  await chromaService.close();
  console.log('✅ Specification indexing complete');
}

main().catch((error) => {
  console.error('❌ Specification indexing failed:', error);
  process.exit(1);
});
