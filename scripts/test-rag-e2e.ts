#!/usr/bin/env tsx
/**
 * End-to-end RAG test.
 *
 * Proves the whole documentation pipeline without spending on OpenAI:
 *   1. starts the mock OpenAI server (scripts/mock-openai.ts)
 *   2. indexes a slice of docs.hedera.com into a scratch collection on the
 *      configured Chroma server using the admin token
 *   3. boots the built MCP server with the read token and calls
 *      docs_search, docs_ask, docs_get_example and code_generate
 *   4. deletes the scratch collection
 *
 * Requirements: `npm run build`, CHROMA_ADMIN_TOKEN (gateway admin token),
 * optionally CHROMA_URL (defaults to the hosted gateway), git, network.
 *
 * With a real OPENAI_API_KEY and REAL_OPENAI=1 the same flow runs against
 * OpenAI instead of the mock (costs a few cents).
 */

import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { HOSTED_CHROMA_URL, HOSTED_CHROMA_READ_TOKEN } from '../src/config/rag.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminToken = process.env.CHROMA_ADMIN_TOKEN;
const chromaUrl = (process.env.CHROMA_URL || HOSTED_CHROMA_URL).replace(/\/+$/, '');
const readToken =
  process.env.CHROMA_READ_TOKEN ||
  (chromaUrl === HOSTED_CHROMA_URL ? HOSTED_CHROMA_READ_TOKEN : adminToken);
const useRealOpenAI = process.env.REAL_OPENAI === '1' && Boolean(process.env.OPENAI_API_KEY);
const collection = process.env.RAG_COLLECTION || `hashpilot-e2e-${Date.now().toString(36)}`;
const pages = parseInt(process.env.RAG_E2E_PAGES || '60', 10);
const mockPort = 4141;

if (!adminToken) {
  console.error('CHROMA_ADMIN_TOKEN is required (gateway admin token)');
  process.exit(2);
}

function log(line: string): void {
  console.log(line);
}

async function waitFor(url: string, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`service at ${url} did not come up`);
}

async function main(): Promise<void> {
  let failures = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    if (!ok) failures++;
    log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
  };

  // 1. mock OpenAI
  let mock: ReturnType<typeof spawn> | null = null;
  const openaiEnv: Record<string, string> = useRealOpenAI
    ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY! }
    : { OPENAI_API_KEY: 'sk-mock', OPENAI_BASE_URL: `http://127.0.0.1:${mockPort}/v1` };
  if (!useRealOpenAI) {
    mock = spawn(
      process.execPath,
      ['node_modules/.bin/tsx', 'scripts/mock-openai.ts', String(mockPort)],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'inherit'],
      }
    );
    await waitFor(`http://127.0.0.1:${mockPort}/health`);
    log(`mock OpenAI up on :${mockPort}`);
  } else {
    log('using real OpenAI');
  }

  try {
    // 2. index a slice into the scratch collection (admin token)
    const started = Date.now();
    execFileSync(
      process.execPath,
      [
        'node_modules/.bin/tsx',
        'scripts/index-docs-repo.ts',
        '--max',
        String(pages),
        '--collection',
        collection,
      ],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...openaiEnv,
          CHROMA_URL: chromaUrl,
          CHROMA_AUTH_TOKEN: adminToken,
          LOG_LEVEL: 'error',
        },
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    log(
      `indexed ${pages} pages into ${collection} in ${((Date.now() - started) / 1000).toFixed(0)}s`
    );

    // 3. query through the MCP server with the read token
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'dist', 'index.js')],
      env: {
        ...process.env,
        ...openaiEnv,
        HEDERA_NETWORK: 'testnet',
        LOG_LEVEL: 'error',
        CHROMA_URL: chromaUrl,
        CHROMA_AUTH_TOKEN: readToken!,
        RAG_COLLECTION: collection,
        HASHPILOT_DATA_DIR: process.env.HASHPILOT_DATA_DIR || path.join(root, 'cache', 'e2e-data'),
      } as Record<string, string>,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'rag-e2e', version: '1' });
    await client.connect(transport);

    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: 120000,
      });
      const text = (result.content as Array<{ text?: string }>)?.[0]?.text || '';
      return { isError: Boolean(result.isError), text };
    };

    const search = await call('docs_search', {
      query: 'how do I create a fungible token',
      limit: 3,
    });
    const searchOk = !search.isError && /"resultsFound":\s*[1-9]/.test(search.text);
    check(
      'docs_search returns ranked results',
      searchOk,
      searchOk ? '' : search.text.slice(0, 300).replace(/\s+/g, ' ')
    );
    check(
      'docs_search results carry docs.hedera.com URLs',
      /https:\/\/docs\.hedera\.com\//.test(search.text),
      ''
    );

    const ask = await call('docs_ask', {
      question: 'What is the Hedera Consensus Service used for?',
    });
    check(
      'docs_ask returns an answer with sources',
      !ask.isError && /Sources|sources/.test(ask.text) && ask.text.length > 100,
      ask.isError ? ask.text.slice(0, 200) : ''
    );

    const example = await call('docs_get_example', {
      description: 'transfer HBAR between accounts',
      language: 'javascript',
      limit: 2,
    });
    check(
      'docs_get_example returns without error',
      !example.isError,
      example.isError ? example.text.slice(0, 200) : ''
    );

    const gen = await call('code_generate', {
      description: 'create a topic and submit a message',
      language: 'javascript',
    });
    check(
      'code_generate returns code',
      !gen.isError && /```/.test(gen.text),
      gen.isError ? gen.text.slice(0, 200) : ''
    );

    await client.close();
  } finally {
    // 4. cleanup scratch collection
    try {
      const res = await fetch(
        `${chromaUrl}/api/v2/tenants/default_tenant/databases/default_database/collections/${collection}`,
        {
          method: 'DELETE',
          headers: { 'X-Chroma-Token': adminToken! },
        }
      );
      log(`cleanup: deleted ${collection} (${res.status})`);
    } catch (error) {
      log(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    mock?.kill();
  }

  if (failures) {
    log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  log('\nRAG end-to-end: all checks passed');
  process.exit(0);
}

main().catch((error) => {
  console.error('rag e2e crashed:', error);
  process.exit(1);
});
