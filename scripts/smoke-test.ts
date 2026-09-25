#!/usr/bin/env tsx
/**
 * Smoke test: boots the built MCP server over stdio and exercises the
 * read-only tools against the configured Hedera network.
 *
 * Usage:
 *   npm run build && npm run smoke
 *
 * Environment:
 *   HEDERA_NETWORK        network to test against (default: testnet)
 *   HEDERA_OPERATOR_ID    optional; when set with the key, operator checks run
 *   HEDERA_OPERATOR_KEY   optional
 *   SMOKE_ACCOUNT         account to query (default: 0.0.2)
 *
 * No transactions are submitted. Exit code is non-zero if any check fails.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, '..', 'dist', 'index.js');
const network = process.env.HEDERA_NETWORK || 'testnet';
const account = process.env.SMOKE_ACCOUNT || '0.0.2';

interface Check {
  name: string;
  tool: string;
  args: Record<string, unknown>;
  /** Return an error string if the result is unacceptable */
  verify?: (payload: any, raw: string) => string | undefined;
}

const checks: Check[] = [
  {
    name: 'health_check reports version and tool count',
    tool: 'health_check',
    args: { verbose: true },
    verify: (p) =>
      p?.data?.version && p?.data?.toolCount > 0 ? undefined : 'missing version/toolCount',
  },
  {
    name: 'network_info matches HEDERA_NETWORK',
    tool: 'network_info',
    args: {},
    verify: (p) => (p?.data?.network === network ? undefined : `network is ${p?.data?.network}`),
  },
  {
    name: 'account_balance via mirror node',
    tool: 'account_balance',
    args: { accountId: account },
    verify: (p) =>
      typeof p?.data?.hbar === 'string' && p.data.hbar.includes('ℏ')
        ? undefined
        : 'no hbar balance',
  },
  {
    name: 'account_info via mirror node',
    tool: 'account_info',
    args: { accountId: account },
    verify: (p) =>
      p?.data?.accountId === account && p?.data?.keyType ? undefined : 'missing account fields',
  },
  {
    name: 'mirror_query_account',
    tool: 'mirror_query_account',
    args: { accountId: account },
    verify: (p) => (p?.data?.accountId === account ? undefined : 'missing accountId'),
  },
  {
    name: 'rpc_call eth_chainId',
    tool: 'rpc_call',
    args: { method: 'eth_chainId' },
    verify: (p) => {
      const expected: Record<string, number> = {
        mainnet: 295,
        testnet: 296,
        previewnet: 297,
        local: 298,
      };
      return p?.data?.decoded?.chainId === expected[network]
        ? undefined
        : `chainId ${p?.data?.decoded?.chainId}`;
    },
  },
  {
    name: 'error_explain known code',
    tool: 'error_explain',
    args: { errorCode: 'INSUFFICIENT_PAYER_BALANCE' },
    verify: (p) => (p?.data?.code === 'INSUFFICIENT_PAYER_BALANCE' ? undefined : 'code not found'),
  },
  {
    name: 'deployment_history lists',
    tool: 'deployment_history',
    args: {},
    verify: (p) => (Array.isArray(p?.data?.deployments) ? undefined : 'no deployments array'),
  },
  {
    name: 'addressbook_manage list',
    tool: 'addressbook_manage',
    args: { operation: 'list' },
    verify: (p) => (Array.isArray(p?.data?.accounts) ? undefined : 'no accounts array'),
  },
  {
    name: 'state_manage export without outputPath',
    tool: 'state_manage',
    args: { operation: 'export' },
    verify: (p) => (p?.data?.filePath ? undefined : 'no filePath'),
  },
];

/**
 * Extra checks that only make sense with an operator configured. Still free
 * and read-only: they prove the operator key parses, matches the account on
 * the Mirror Node, and yields the EVM address the contract tools sign with.
 */
const operatorId = process.env.HEDERA_OPERATOR_ID;
const hasOperator = Boolean(operatorId && process.env.HEDERA_OPERATOR_KEY);

if (hasOperator) {
  checks.push(
    {
      name: 'health_check reports the operator',
      tool: 'health_check',
      args: {},
      verify: (p) =>
        p?.data?.operatorConfigured === true && p?.data?.operatorId === operatorId
          ? undefined
          : `operatorConfigured=${p?.data?.operatorConfigured} operatorId=${p?.data?.operatorId}`,
    },
    {
      name: 'operator account resolves (key matches the account)',
      tool: 'account_info',
      args: { accountId: operatorId },
      verify: (p) => (p?.data?.accountId === operatorId ? undefined : 'operator account not found'),
    },
    {
      name: 'operator balance is readable',
      tool: 'account_balance',
      args: { accountId: operatorId },
      verify: (p) => (typeof p?.data?.hbar === 'string' ? undefined : 'no balance'),
    }
  );
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...process.env,
      HEDERA_NETWORK: network,
      LOG_LEVEL: process.env.LOG_LEVEL || 'error',
    } as Record<string, string>,
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const client = new Client({ name: 'hashpilot-smoke', version: '1' });
  const started = Date.now();
  await client.connect(transport);
  console.log(
    `server up in ${Date.now() - started} ms, network=${network}, ` +
      (hasOperator ? `operator=${operatorId}` : 'no operator (read-only checks only)')
  );

  const tools = await client.listTools();
  console.log(`tools/list -> ${tools.tools.length} tools`);

  let failures = 0;
  for (const check of checks) {
    const t = Date.now();
    try {
      const result = await client.callTool({ name: check.tool, arguments: check.args }, undefined, {
        timeout: 60000,
      });
      const raw = (result.content as Array<{ type: string; text?: string }>)?.[0]?.text || '';
      let payload: any = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        // some tools return prose
      }
      const isError = Boolean(result.isError) || payload?.success === false;
      const problem = isError ? payload?.error || raw.slice(0, 200) : check.verify?.(payload, raw);
      if (problem) {
        failures++;
        console.log(`FAIL  ${check.name} (${Date.now() - t} ms): ${problem}`);
      } else {
        console.log(`ok    ${check.name} (${Date.now() - t} ms)`);
      }
    } catch (error) {
      failures++;
      console.log(`FAIL  ${check.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await client.close();

  if (failures > 0) {
    const errorLines = stderr
      .split('\n')
      .filter((line) => /error/i.test(line))
      .slice(0, 10);
    if (errorLines.length) {
      console.log('\nserver stderr (first error lines):');
      console.log(errorLines.map((l) => `  ${l.slice(0, 300)}`).join('\n'));
    }
    console.log(`\n${failures} of ${checks.length} checks failed`);
    process.exit(1);
  }
  console.log(`\nall ${checks.length} checks passed`);
  process.exit(0);
}

main().catch((error) => {
  console.error('smoke test crashed:', error);
  process.exit(1);
});
