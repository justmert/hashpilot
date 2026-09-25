#!/usr/bin/env tsx
/**
 * MCP protocol integration test.
 *
 * Drives the built server over stdio exactly as an MCP client does, rather than
 * calling tool functions directly. Everything here is a regression that unit
 * tests could not have caught, because each one lives in the protocol layer:
 *
 *   - `network_switch` persisted an unvalidated network name, so one bad call
 *     left every later call failing with "Unknown network: <junk>" — and the
 *     value survived restarts, bricking the install until the state file was
 *     deleted by hand.
 *   - The dispatcher cast arguments straight through without checking them
 *     against the schema each tool advertises, so a missing required parameter
 *     surfaced as "Cannot read properties of undefined (reading 'length')".
 *   - The server never exited when its client disconnected, because the Hedera
 *     SDK's gRPC connections keep the event loop alive, so every session leaked
 *     a process.
 *
 * Usage:
 *   npm run build && npm run test:mcp
 *
 * Requires no credentials. Read-only: it queries public mirror node data and
 * never signs anything. Set OPENAI_API_KEY to include the documentation tools.
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const CALL_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 15_000;

interface Response {
  id?: number;
  result?: { content?: Array<{ text?: string }>; tools?: unknown[]; isError?: boolean };
  error?: { message?: string };
}

class McpClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private pending = new Map<number, (value: Response) => void>();
  private nextId = 1;

  constructor(env: Record<string, string> = {}) {
    this.child = spawn('node', [SERVER], {
      env: { ...process.env, HEDERA_NETWORK: 'testnet', LOG_LEVEL: 'error', ...env },
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line) as Response;
          if (message.id !== undefined) {
            this.pending.get(message.id)?.(message);
            this.pending.delete(message.id);
          }
        } catch {
          // Not JSON-RPC; ignore stray output
        }
      }
    });
  }

  private send(method: string, params: unknown): Promise<Response> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${CALL_TIMEOUT_MS}ms`));
      }, CALL_TIMEOUT_MS);

      this.pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });

      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async handshake(): Promise<Response> {
    const response = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'hashpilot-protocol-test', version: '1.0' },
    });
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
    return response;
  }

  listTools(): Promise<Response> {
    return this.send('tools/list', {});
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const response = await this.send('tools/call', { name, arguments: args });
    if (response.error) return `JSONRPC_ERROR: ${response.error.message}`;
    return response.result?.content?.[0]?.text || '';
  }

  /** Close stdin and report how long the server took to exit */
  async closeAndWait(): Promise<number | null> {
    const started = Date.now();
    this.child.stdin.end();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill('SIGKILL');
        resolve(null);
      }, EXIT_TIMEOUT_MS);

      this.child.on('exit', () => {
        clearTimeout(timer);
        resolve(Date.now() - started);
      });
    });
  }
}

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`   ✅ ${label}`);
  } else {
    failed++;
    console.log(`   ❌ ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  console.log('🔌 MCP protocol integration test\n');

  // --- Handshake and discovery -------------------------------------------
  console.log('Handshake and tool discovery');
  const client = new McpClient();
  const initialize = await client.handshake();
  check(
    'initialize returns a server identity',
    Boolean(initialize.result),
    JSON.stringify(initialize).slice(0, 160)
  );

  const tools = await client.listTools();
  const toolCount = (tools.result?.tools || []).length;
  check(`tools/list advertises tools (${toolCount})`, toolCount > 0);

  const health = await client.call('health_check');
  check(
    'health_check reports healthy',
    health.includes('"status": "healthy"'),
    health.slice(0, 160)
  );

  // --- Argument validation ------------------------------------------------
  console.log('\nArgument validation (schemas are enforced, not just advertised)');
  const noQuery = await client.call('docs_search', {});
  check(
    'missing required parameter is named',
    noQuery.includes('Missing required parameter: query'),
    noQuery.slice(0, 160)
  );

  const badEnum = await client.call('network_switch', { network: 'fakenet' });
  check(
    'value outside an enum is rejected with the valid options',
    badEnum.includes('Invalid value') && badEnum.includes('mainnet'),
    badEnum.slice(0, 160)
  );

  const badType = await client.call('account_balance', { accountId: 12345 });
  check(
    'wrong parameter type is rejected',
    badType.includes('must be of type string'),
    badType.slice(0, 160)
  );

  const unknownTool = await client.call('no_such_tool', {});
  check(
    'unknown tool name fails gracefully',
    unknownTool.includes('Unknown tool'),
    unknownTool.slice(0, 160)
  );

  // --- State integrity ----------------------------------------------------
  console.log('\nState integrity after a rejected call');
  const networkInfo = await client.call('network_info');
  check(
    'network_info still works after the invalid switch',
    networkInfo.includes('"network": "testnet"'),
    networkInfo.slice(0, 160)
  );

  const balance = await client.call('account_balance', { accountId: '0.0.2' });
  check(
    'account_balance still works after the invalid switch',
    balance.includes('"success": true'),
    balance.slice(0, 160)
  );

  // --- Real read-only data ------------------------------------------------
  console.log('\nRead-only network data (no operator configured)');
  check(
    'treasury account 0.0.2 returns an hbar balance',
    balance.includes('hbar'),
    balance.slice(0, 160)
  );

  const explained = await client.call('error_explain', { error: 'INSUFFICIENT_PAYER_BALANCE' });
  check(
    'error_explain recognises a real status code',
    explained.length > 40,
    explained.slice(0, 160)
  );

  // --- Mirror Node queries -----------------------------------------------
  console.log('\nMirror Node queries (mirror_query)');
  const token = await client.call('mirror_query', { resource: 'network_info' });
  check(
    'mirror_query network_info returns the live exchange rate',
    token.includes('"success": true') && token.includes('cent_equivalent'),
    token.slice(0, 160)
  );

  const transaction = await client.call('mirror_query', { resource: 'transactions', limit: 1 });
  check(
    'mirror_query transactions returns recent transactions',
    transaction.includes('"success": true') && transaction.includes('transactionId'),
    transaction.slice(0, 160)
  );

  const missingField = await client.call('mirror_query', { resource: 'nft', tokenId: '0.0.1' });
  check(
    "mirror_query names a resource's missing field",
    missingField.includes('requires serialNumber'),
    missingField.slice(0, 160)
  );

  // --- GraphQL --------------------------------------------------------------
  console.log('\nGraphQL (Hgraph)');
  const keylessGraphql = new McpClient({ HGRAPH_API_KEY: '' });
  await keylessGraphql.handshake();
  const graphqlTools = await keylessGraphql.listTools();
  check(
    'graphql tool is advertised',
    JSON.stringify(graphqlTools.result?.tools || []).includes('"name":"graphql"')
  );
  const noKey = await keylessGraphql.call('graphql', {
    operation: 'execute',
    query: '{ token(limit: 1) { token_id } }',
  });
  check(
    'without HGRAPH_API_KEY, graphql says how to get a key',
    noKey.includes('HGRAPH_API_KEY') && noKey.includes('app.hgraph.com'),
    noKey.slice(0, 160)
  );
  const mutation = await keylessGraphql.call('graphql', {
    operation: 'execute',
    query: 'mutation { delete_token { affected_rows } }',
  });
  check('graphql refuses a mutation', mutation.includes('read-only'), mutation.slice(0, 160));
  await keylessGraphql.closeAndWait();

  if (process.env.HGRAPH_API_KEY) {
    const live = await client.call('graphql', {
      operation: 'generate',
      entity: 'transaction',
      fields: ['consensus_timestamp'],
      orderBy: { consensus_timestamp: 'desc' },
      limit: 1,
      execute: true,
    });
    // A nanosecond timestamp must survive as an exact 19-digit string
    check(
      'graphql runs a live query with exact nanosecond timestamps',
      /"consensus_timestamp": "\d{19}"/.test(live),
      live.slice(0, 200)
    );
  } else {
    console.log('   ⏭️  live GraphQL query skipped (set HGRAPH_API_KEY to include it)');
  }

  // --- Documentation ------------------------------------------------------
  console.log('\nDocumentation tools');
  const keyless = new McpClient({ OPENAI_API_KEY: '' });
  await keyless.handshake();
  const fallback = await keyless.call('docs_search', {
    query: 'create a fungible token',
    limit: 2,
  });
  check(
    'without an OpenAI key, docs_search answers from the official Hedera docs',
    fallback.includes('official-hedera-docs-mcp') && fallback.includes('docs.hedera.com'),
    fallback.slice(0, 160)
  );
  await keyless.closeAndWait();

  if (process.env.OPENAI_API_KEY) {
    const search = await client.call('docs_search', { query: 'create a fungible token', limit: 2 });
    check(
      "with a key, docs_search answers from HashPilot's own index",
      search.includes('http') && !search.includes('official-hedera-docs-mcp'),
      search.slice(0, 160)
    );

    const example = await client.call('docs_get_example', {
      description: 'create a fungible token',
      language: 'go',
      limit: 1,
    });
    check(
      'docs_get_example returns a Go example',
      example.includes('"language": "go"'),
      example.slice(0, 160)
    );
  } else {
    console.log("   ⏭️  HashPilot's own index skipped (set OPENAI_API_KEY to include it)");
  }

  // --- Shutdown -----------------------------------------------------------
  console.log('\nShutdown');
  const exitedIn = await client.closeAndWait();
  check(
    'server exits when its client disconnects',
    exitedIn !== null,
    `still running after ${EXIT_TIMEOUT_MS}ms; the Hedera SDK's gRPC connections keep the event loop alive`
  );

  // --- Persisted state is not corrupted across a restart ------------------
  console.log('\nRestart (the invalid network must not have been persisted)');
  const restarted = new McpClient();
  await restarted.handshake();
  const afterRestart = await restarted.call('network_info');
  check(
    'a fresh process still starts on a valid network',
    afterRestart.includes('"network": "testnet"'),
    afterRestart.slice(0, 160)
  );
  await restarted.closeAndWait();

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('❌ Protocol test failed to run:', error);
  process.exit(1);
});
