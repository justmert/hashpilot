#!/usr/bin/env tsx
/**
 * Manual, read-only check of the Sourcify APIv2 integration.
 *
 * Confirms the verification service can talk to the live API without deploying or
 * verifying anything: it lists verified contracts on the chosen Hedera network, reads
 * the match state and sources of a real one, and checks that an unverified address and
 * an unsupported network both come back with clear answers.
 *
 * Usage:
 *   npm run check:sourcify
 *
 * Environment:
 *   SOURCIFY_NETWORK   mainnet or testnet (default: testnet)
 *   SOURCIFY_ADDRESS   optional: check this contract instead of one from the list
 *   SOURCIFY_API_URL   optional: point at a self-hosted Sourcify server
 *
 * Nothing is submitted. Exit code is non-zero if any check fails.
 */

import {
  hashScanService,
  isSourcifySupported,
  HederaNetwork,
  UnsupportedNetworkError,
} from '../src/services/hashscan-service.js';

const network = (process.env.SOURCIFY_NETWORK || 'testnet') as HederaNetwork;
const explicitAddress = process.env.SOURCIFY_ADDRESS;

let failures = 0;

function pass(message: string): void {
  console.log(`  ok    ${message}`);
}

function fail(message: string): void {
  failures++;
  console.log(`  FAIL  ${message}`);
}

async function main(): Promise<void> {
  if (!isSourcifySupported(network)) {
    console.error(`SOURCIFY_NETWORK must be mainnet or testnet, got "${network}"`);
    process.exit(1);
  }

  console.log('Sourcify APIv2 check');
  console.log(`  server   ${hashScanService.baseUrl}`);
  console.log(`  network  ${network}`);
  console.log('');

  // 1. List verified contracts on this chain.
  console.log('GET /v2/contracts/{chainId}');
  let listed: Awaited<ReturnType<typeof hashScanService.listVerifiedContractsDetailed>> = [];
  try {
    listed = await hashScanService.listVerifiedContractsDetailed(network, { limit: 5 });
    if (listed.length === 0) {
      fail(`no verified contracts returned for ${network}`);
    } else {
      pass(`${listed.length} verified contracts listed`);
      for (const entry of listed) {
        console.log(
          `        ${entry.address}  ${entry.status.padEnd(8)} match=${entry.match}  verifiedAt=${entry.verifiedAt ?? 'n/a'}`
        );
      }
    }
  } catch (error: any) {
    fail(`listing failed: ${error.message}`);
  }

  // 2. Read one verified contract in full.
  const target = explicitAddress ?? listed.find((c) => c.status !== 'not_verified')?.address;

  if (!target) {
    fail('no verified contract available to inspect');
  } else {
    console.log('');
    console.log(`GET /v2/contract/{chainId}/{address}  (${target})`);
    try {
      const status = await hashScanService.checkVerificationStatus(target, network);
      console.log(`        status        ${status.status}`);
      console.log(`        match         ${status.match}`);
      console.log(`        creationMatch ${status.creationMatch}`);
      console.log(`        runtimeMatch  ${status.runtimeMatch}`);
      console.log(`        chainId       ${status.chainId}`);
      console.log(`        verifiedAt    ${status.verifiedAt ?? 'n/a'}`);
      console.log(`        hashscan      ${hashScanService.getContractUrl(target, network)}`);

      if (status.status === 'not_verified') {
        fail(`${target} came back unverified; expected a real match`);
      } else {
        pass(`${target} reports a real match (${status.status}/${status.match})`);
      }
    } catch (error: any) {
      fail(`status lookup failed: ${error.message}`);
    }

    // 3. Read the verified sources back.
    console.log('');
    console.log('GET /v2/contract/{chainId}/{address}?fields=sources,metadata,compilation');
    try {
      const files = await hashScanService.getContractFiles(target, network, 'any');
      const sources = files.filter((f) => f.name.endsWith('.sol'));
      const metadata = files.find((f) => f.name === 'metadata.json');

      if (sources.length === 0) {
        fail('no Solidity sources returned for a verified contract');
      } else {
        pass(`${sources.length} source files returned`);
        for (const file of sources.slice(0, 5)) {
          console.log(`        ${file.path}  (${file.content.length} bytes)`);
        }
        if (sources.length > 5) console.log(`        ... and ${sources.length - 5} more`);
      }

      if (!metadata) {
        fail('no metadata.json synthesised (contract_info reads the ABI from it)');
      } else {
        const abi = JSON.parse(metadata.content)?.output?.abi;
        if (Array.isArray(abi)) {
          pass(`metadata.json carries an ABI with ${abi.length} entries`);
        } else {
          fail('metadata.json has no output.abi');
        }
      }
    } catch (error: any) {
      fail(`source download failed: ${error.message}`);
    }
  }

  // 4. An address that is definitely not verified must read as not_verified, not crash.
  const unverified = '0x0000000000000000000000000000000000000002';
  console.log('');
  console.log(`GET /v2/contract/{chainId}/{address}  (${unverified}, expected unverified)`);
  try {
    const status = await hashScanService.checkVerificationStatus(unverified, network);
    if (status.status === 'not_verified') {
      pass('unverified address reports not_verified rather than erroring');
    } else {
      fail(`expected not_verified, got ${status.status}`);
    }
  } catch (error: any) {
    fail(`unverified lookup threw instead of reporting not_verified: ${error.message}`);
  }

  // 5. Previewnet must be refused locally, with no request sent.
  console.log('');
  console.log('previewnet guard');
  try {
    await hashScanService.checkVerificationStatus(unverified, 'previewnet');
    fail('previewnet was accepted; it should be refused');
  } catch (error: any) {
    if (error instanceof UnsupportedNetworkError) {
      pass('previewnet refused before any request');
      console.log(`        ${error.message}`);
    } else {
      fail(`previewnet raised the wrong error: ${error.message}`);
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('All Sourcify checks passed.');
}

main().catch((error) => {
  console.error('check:sourcify crashed:', error);
  process.exit(1);
});
