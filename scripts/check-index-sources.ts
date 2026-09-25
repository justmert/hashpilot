#!/usr/bin/env tsx
/**
 * Verify every documentation source the RAG indexers pull from is reachable
 * and still laid out the way the configuration expects.
 *
 * This is the canary for the maintenance plan: the Hedera SDK repositories
 * moved from the `hashgraph` org to `hiero-ledger` in 2025/2026 and doc files
 * get renamed, which silently shrinks the index. Run it before every re-index
 * and on a schedule.
 *
 *   npm run check:sources
 *   npm run check:sources -- --json
 *
 * Needs no OpenAI key and no ChromaDB. Set GITHUB_TOKEN to lift the
 * unauthenticated GitHub rate limit (60/hour).
 */

import { config as loadEnv } from 'dotenv';
import {
  SDK_REPOS,
  getAllSDKLanguages,
  buildRawUrl,
  buildApiUrl,
} from '../src/config/sdk-repos.js';

loadEnv();

interface Check {
  group: string;
  name: string;
  url: string;
  /** A 404 here is a warning rather than a failure (optional source) */
  optional?: boolean;
  /** Extra validation of the response body */
  validate?: (body: string) => string | undefined;
}

const githubHeaders: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'hashpilot-source-check',
};
if (process.env.GITHUB_TOKEN) {
  githubHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

function collectChecks(): Check[] {
  const checks: Check[] = [];

  // (i) Hedera documentation, indexed from its source repository
  checks.push({
    group: 'docs.hedera.com',
    name: 'hashgraph/hedera-docs repository',
    url: 'https://api.github.com/repos/hashgraph/hedera-docs',
    validate: (body) => {
      const repo = JSON.parse(body) as { full_name?: string; archived?: boolean };
      if (repo.archived) return 'repository is archived';
      return undefined;
    },
  });
  checks.push({
    group: 'docs.hedera.com',
    name: 'docs.json navigation manifest',
    url: 'https://raw.githubusercontent.com/hashgraph/hedera-docs/main/docs.json',
    validate: (body) => (JSON.parse(body).navigation ? undefined : 'no navigation key'),
  });
  for (const dir of ['native', 'evm', 'reference', 'networks', 'learn']) {
    checks.push({
      group: 'docs.hedera.com',
      name: `${dir}/ section present`,
      url: `https://api.github.com/repos/hashgraph/hedera-docs/contents/${dir}?ref=main`,
      validate: (body) => {
        const entries = JSON.parse(body) as unknown[];
        return Array.isArray(entries) && entries.length > 0 ? undefined : 'empty directory';
      },
    });
  }

  // (ii) SDK documentation and examples for all five languages
  for (const language of getAllSDKLanguages()) {
    const repo = SDK_REPOS[language];
    checks.push({
      group: `SDK: ${repo.displayName}`,
      name: `${repo.owner}/${repo.repo} repository`,
      url: `https://api.github.com/repos/${repo.owner}/${repo.repo}`,
      validate: (body) => {
        const meta = JSON.parse(body) as { full_name?: string; archived?: boolean };
        if (meta.archived) return 'repository is archived';
        if (meta.full_name?.toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase()) {
          return `redirects to ${meta.full_name} — update src/config/sdk-repos.ts`;
        }
        return undefined;
      },
    });
    for (const docFile of repo.docFiles) {
      checks.push({
        group: `SDK: ${repo.displayName}`,
        name: docFile,
        url: buildRawUrl(repo, docFile),
        optional: true,
      });
    }
    checks.push({
      group: `SDK: ${repo.displayName}`,
      name: `${repo.examplesDir}/ examples`,
      url: buildApiUrl(repo, repo.examplesDir),
      validate: (body) => {
        const entries = JSON.parse(body) as unknown[];
        return Array.isArray(entries) && entries.length > 0 ? undefined : 'no examples found';
      },
    });
  }

  // (iv) Canonical service specifications
  checks.push({
    group: 'Specifications',
    name: 'hashgraph/hedera-protobufs (authoritative service definitions)',
    url: 'https://api.github.com/repos/hashgraph/hedera-protobufs/git/trees/main?recursive=1',
    validate: (body) => {
      const tree = (JSON.parse(body).tree || []) as Array<{ path: string }>;
      const protos = tree.filter((t) => t.path.endsWith('.proto'));
      return protos.length > 100 ? undefined : `only ${protos.length} .proto files found`;
    },
  });
  checks.push({
    group: 'Specifications',
    name: 'hiero-ledger/hiero-consensus-specifications (HCS standards)',
    url: 'https://api.github.com/repos/hiero-ledger/hiero-consensus-specifications/contents/docs/standards?ref=main',
    validate: (body) => {
      const entries = JSON.parse(body) as unknown[];
      return Array.isArray(entries) && entries.length > 10
        ? undefined
        : 'HCS standards directory looks empty';
    },
  });

  // Ecosystem repositories indexed for tutorials, examples and integration guides
  for (const [owner, repo, path] of [
    ['hiero-ledger', 'solo', 'docs'],
    ['hiero-ledger', 'solo-docs', 'content'],
    ['hiero-ledger', 'hiero-cli', 'docs'],
    ['hiero-ledger', 'hiero-mirror-node', 'docs'],
    ['hashgraph', 'stablecoin-studio', 'documentation'],
    ['hashgraph', 'hedera-agent-kit-js', 'docs'],
    ['hashgraph', 'hedera-smart-contracts', 'contracts'],
    ['hashgraph', 'hedera-nft-sdk', 'examples'],
  ]) {
    checks.push({
      group: 'Ecosystem sources',
      name: `${owner}/${repo}/${path}`,
      url: `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=main`,
      validate: (body) => {
        const entries = JSON.parse(body) as unknown[];
        return Array.isArray(entries) && entries.length > 0 ? undefined : 'empty directory';
      },
    });
  }

  // (iii)/(iv) HIPs: the specifications for HTS, HCS, smart contracts, file service
  checks.push({
    group: 'HIPs',
    name: 'hiero-ledger/hiero-improvement-proposals HIP directory',
    url: 'https://api.github.com/repos/hiero-ledger/hiero-improvement-proposals/contents/HIP?ref=main',
    validate: (body) => {
      const entries = JSON.parse(body) as Array<{ name: string }>;
      const hips = entries.filter((e) => /^hip-\d+\.md$/i.test(e.name));
      return hips.length > 50 ? undefined : `only ${hips.length} HIP files found`;
    },
  });

  // (v) Network configuration, fee schedules and operational parameters
  for (const [network, host] of [
    ['mainnet', 'https://mainnet-public.mirrornode.hedera.com'],
    ['testnet', 'https://testnet.mirrornode.hedera.com'],
    ['previewnet', 'https://previewnet.mirrornode.hedera.com'],
  ]) {
    for (const [label, endpoint] of [
      ['nodes', '/api/v1/network/nodes?limit=1'],
      ['fees', '/api/v1/network/fees'],
      ['exchange rate', '/api/v1/network/exchangerate'],
      ['stake', '/api/v1/network/stake'],
      ['supply', '/api/v1/network/supply'],
    ]) {
      checks.push({ group: `Network config: ${network}`, name: label, url: `${host}${endpoint}` });
    }
  }

  return checks;
}

async function run(check: Check): Promise<{ ok: boolean; detail: string; warned: boolean }> {
  const isGitHubApi = check.url.startsWith('https://api.github.com');
  try {
    const response = await fetch(check.url, {
      headers: isGitHubApi ? githubHeaders : { 'User-Agent': 'hashpilot-source-check' },
      redirect: 'follow',
    });

    if (response.status === 404 && check.optional) {
      return { ok: true, detail: 'not found (optional)', warned: true };
    }
    if (!response.ok) {
      if (response.status === 403 && isGitHubApi) {
        return { ok: false, detail: 'GitHub rate limit — set GITHUB_TOKEN', warned: false };
      }
      return { ok: false, detail: `HTTP ${response.status}`, warned: false };
    }

    if (check.validate) {
      const problem = check.validate(await response.text());
      if (problem) return { ok: false, detail: problem, warned: false };
    }
    return { ok: true, detail: 'ok', warned: false };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      warned: false,
    };
  }
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const checks = collectChecks();
  if (!asJson) {
    console.log(`Checking ${checks.length} documentation sources...\n`);
    if (!process.env.GITHUB_TOKEN)
      console.log('(no GITHUB_TOKEN set: GitHub allows 60 requests/hour)\n');
  }

  const results: Array<Check & { ok: boolean; detail: string; warned: boolean }> = [];
  // Small concurrency: enough to be quick, gentle enough for the GitHub API
  const queue = [...checks];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        results.push({ ...next, ...(await run(next)) });
      }
    })
  );

  const failures = results.filter((r) => !r.ok);
  const warnings = results.filter((r) => r.ok && r.warned);

  if (asJson) {
    console.log(JSON.stringify({ total: results.length, failures, warnings, results }, null, 2));
  } else {
    const groups = [...new Set(checks.map((c) => c.group))];
    for (const group of groups) {
      const inGroup = results.filter((r) => r.group === group);
      const bad = inGroup.filter((r) => !r.ok).length;
      console.log(
        `${bad === 0 ? '✅' : '❌'} ${group} (${inGroup.length - bad}/${inGroup.length})`
      );
      for (const r of inGroup.filter((x) => !x.ok || x.warned)) {
        console.log(`   ${r.ok ? '⚠️ ' : '❌'} ${r.name}: ${r.detail}`);
      }
    }
    console.log(
      `\n${results.length - failures.length}/${results.length} sources reachable` +
        (warnings.length ? `, ${warnings.length} optional file(s) missing` : '')
    );
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('source check crashed:', error);
  process.exit(1);
});
