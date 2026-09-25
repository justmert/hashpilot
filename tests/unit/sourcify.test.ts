/**
 * Sourcify APIv2 verification: the parts that can be checked without the network.
 *
 * Every HTTP call goes through a stubbed global fetch, so these tests never touch
 * sourcify.dev. Shapes are taken from the official OpenAPI document at
 * https://sourcify.dev/server/api-docs/swagger.json (APIv2 2.1.0).
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  HashScanService,
  HEDERA_CHAIN_IDS,
  SOURCIFY_SUPPORTED_NETWORKS,
  DEFAULT_SOURCIFY_API_URL,
  UnsupportedNetworkError,
  chainIdForVerification,
  isSourcifySupported,
  mapSourcifyMatch,
  normalizeCompilerVersion,
  isFullCompilerVersion,
  parsePragmaVersion,
  findContractIdentifier,
  contractIdentifierFromMetadata,
  standardJsonFromMetadata,
  buildSubmissionFromBuildInfo,
  buildSubmissionFromSources,
  buildFileTree,
  getSourcifyApiUrl,
} from '../../src/services/hashscan-service';

import { verifyContract, verificationStatus, getVerifiedSource } from '../../src/tools/verify';

// ---------------------------------------------------------------------------
// fetch stub
// ---------------------------------------------------------------------------

interface StubbedCall {
  url: string;
  method: string;
  body?: any;
}

interface StubbedResponse {
  status: number;
  body?: any;
}

type StubHandler = (call: StubbedCall) => StubbedResponse;

const realFetch = globalThis.fetch;
let calls: StubbedCall[] = [];

function stubFetch(handler: StubHandler): void {
  calls = [];
  (globalThis as any).fetch = async (input: any, init: any = {}) => {
    const call: StubbedCall = {
      url: String(input),
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const response = handler(call);
    const text = response.body === undefined ? '' : JSON.stringify(response.body);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => text,
      json: async () => response.body,
    };
  };
}

/** Answer each call from a queue, failing loudly on an unexpected extra call. */
function stubFetchSequence(responses: StubbedResponse[]): void {
  let index = 0;
  stubFetch((call) => {
    if (index >= responses.length) {
      throw new Error(`Unexpected extra fetch: ${call.method} ${call.url}`);
    }
    return responses[index++];
  });
}

function failOnFetch(): void {
  calls = [];
  (globalThis as any).fetch = async (input: any) => {
    throw new Error(`Network access is not allowed in unit tests: ${String(input)}`);
  };
}

afterEach(() => {
  (globalThis as any).fetch = realFetch;
  delete process.env.SOURCIFY_API_URL;
});

const ADDRESS = '0x8f9EE0a9Aae23fDe01e12cF6A6c9F024C59D4DB9';

/** A VerifiedContractMinimal, the shape Sourcify returns for match state. */
function minimal(match: 'exact_match' | 'match' | null, chainId = '296') {
  return {
    match,
    creationMatch: match,
    runtimeMatch: match,
    chainId,
    address: ADDRESS,
    ...(match ? { verifiedAt: '2026-09-09T13:14:06Z', matchId: '48093010' } : {}),
  };
}

// ---------------------------------------------------------------------------

describe('chain id mapping', () => {
  it('maps Hedera networks to their chain IDs', () => {
    expect(HEDERA_CHAIN_IDS.mainnet).toBe('295');
    expect(HEDERA_CHAIN_IDS.testnet).toBe('296');
    expect(HEDERA_CHAIN_IDS.previewnet).toBe('297');
  });

  it('resolves the verifiable networks', () => {
    expect(chainIdForVerification('mainnet')).toBe('295');
    expect(chainIdForVerification('testnet')).toBe('296');
    expect([...SOURCIFY_SUPPORTED_NETWORKS]).toEqual(['mainnet', 'testnet']);
  });

  it('reports which networks Sourcify serves', () => {
    expect(isSourcifySupported('mainnet')).toBe(true);
    expect(isSourcifySupported('testnet')).toBe(true);
    expect(isSourcifySupported('previewnet')).toBe(false);
    expect(isSourcifySupported('local')).toBe(false);
  });
});

describe('previewnet rejection', () => {
  it('throws an actionable error for previewnet', () => {
    expect(() => chainIdForVerification('previewnet')).toThrow(UnsupportedNetworkError);

    try {
      chainIdForVerification('previewnet');
      throw new Error('expected a throw');
    } catch (error: any) {
      expect(error).toBeInstanceOf(UnsupportedNetworkError);
      expect(error.network).toBe('previewnet');
      expect(error.chainId).toBe('297');
      // The message has to say what is wrong and what to do instead.
      expect(error.message).toMatch(/does not support Hedera previewnet/);
      expect(error.message).toMatch(/297/);
      expect(error.message).toMatch(/mainnet and testnet/);
      expect(error.message).toMatch(/296/);
    }
  });

  it('throws for an unknown network without inventing a chain id', () => {
    try {
      chainIdForVerification('devnet');
      throw new Error('expected a throw');
    } catch (error: any) {
      expect(error).toBeInstanceOf(UnsupportedNetworkError);
      expect(error.chainId).toBeUndefined();
    }
  });

  it('verify_contract rejects previewnet before making any request', async () => {
    failOnFetch();

    const result = await verifyContract({
      address: ADDRESS,
      network: 'previewnet',
      contractName: 'Greeter',
      filePath: '/nonexistent/Greeter.sol',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not support Hedera previewnet/);
    expect(result.metadata?.supportedNetworks).toEqual(['mainnet', 'testnet']);
    expect(calls).toHaveLength(0);
  });

  it('verification_status and get_verified_source reject previewnet too', async () => {
    failOnFetch();

    const status = await verificationStatus({ address: ADDRESS, network: 'previewnet' });
    expect(status.success).toBe(false);
    expect(status.error).toMatch(/previewnet/);

    const source = await getVerifiedSource({ address: ADDRESS, network: 'previewnet' });
    expect(source.success).toBe(false);
    expect(source.error).toMatch(/previewnet/);

    expect(calls).toHaveLength(0);
  });
});

describe('base URL configuration', () => {
  it('defaults to the public Sourcify server', () => {
    delete process.env.SOURCIFY_API_URL;
    expect(getSourcifyApiUrl()).toBe(DEFAULT_SOURCIFY_API_URL);
    expect(DEFAULT_SOURCIFY_API_URL).toBe('https://sourcify.dev/server');
  });

  it('honours SOURCIFY_API_URL and strips trailing slashes', () => {
    process.env.SOURCIFY_API_URL = 'http://localhost:5555/server/';
    expect(getSourcifyApiUrl()).toBe('http://localhost:5555/server');
    expect(new HashScanService().baseUrl).toBe('http://localhost:5555/server');
  });

  it('ignores an empty SOURCIFY_API_URL', () => {
    process.env.SOURCIFY_API_URL = '   ';
    expect(getSourcifyApiUrl()).toBe(DEFAULT_SOURCIFY_API_URL);
  });

  it('sends requests to the configured host', async () => {
    process.env.SOURCIFY_API_URL = 'http://localhost:5555/server';
    stubFetchSequence([{ status: 200, body: minimal('exact_match') }]);

    await new HashScanService().checkVerificationStatus(ADDRESS, 'testnet');

    expect(calls[0].url).toBe(`http://localhost:5555/server/v2/contract/296/${ADDRESS}`);
  });
});

describe('match state parsing', () => {
  it('maps the three Sourcify match states', () => {
    expect(mapSourcifyMatch('exact_match')).toBe('perfect');
    expect(mapSourcifyMatch('match')).toBe('partial');
    expect(mapSourcifyMatch(null)).toBe('not_verified');
    expect(mapSourcifyMatch(undefined)).toBe('not_verified');
  });

  it('reads an exact match into VerificationStatus', async () => {
    stubFetchSequence([{ status: 200, body: minimal('exact_match') }]);

    const status = await new HashScanService().checkVerificationStatus(ADDRESS, 'testnet');

    expect(status).toMatchObject({
      address: ADDRESS,
      chainId: '296',
      status: 'perfect',
      match: 'exact_match',
      creationMatch: 'exact_match',
      runtimeMatch: 'exact_match',
      matchId: '48093010',
      verifiedAt: '2026-09-09T13:14:06Z',
    });
    expect(calls[0].url).toBe(`${DEFAULT_SOURCIFY_API_URL}/v2/contract/296/${ADDRESS}`);
    expect(calls[0].method).toBe('GET');
  });

  it('reads a partial match into VerificationStatus', async () => {
    stubFetchSequence([{ status: 200, body: minimal('match') }]);

    const status = await new HashScanService().checkVerificationStatus(ADDRESS, 'mainnet');

    expect(status.status).toBe('partial');
    expect(status.match).toBe('match');
    expect(calls[0].url).toContain('/v2/contract/295/');
  });

  it('treats the 404 body as not verified rather than an error', async () => {
    // Sourcify answers 404 with a VerifiedContractMinimal whose matches are null.
    stubFetchSequence([{ status: 404, body: minimal(null) }]);

    const status = await new HashScanService().checkVerificationStatus(ADDRESS, 'testnet');

    expect(status.status).toBe('not_verified');
    expect(status.match).toBeNull();
    expect(status.matchId).toBeUndefined();
  });

  it('surfaces a real API error', async () => {
    stubFetchSequence([
      {
        status: 400,
        body: {
          customCode: 'unsupported_chain',
          message: 'Chain 296 not found',
          errorId: 'abc',
        },
      },
    ]);

    await expect(new HashScanService().checkVerificationStatus(ADDRESS, 'testnet')).rejects.toThrow(
      /Chain 296 not found \(unsupported_chain\)/
    );
  });

  it('fans a batch out to the single-contract endpoint', async () => {
    const second = '0x6f928358707997E80990CEDc17E8956F1a2a6492';
    stubFetch((call) => {
      if (call.url.includes(second)) return { status: 404, body: minimal(null) };
      return { status: 200, body: minimal('match') };
    });

    const results = await new HashScanService().checkBatchVerificationStatus(
      [ADDRESS, second],
      'testnet'
    );

    expect(results).toEqual([
      { address: ADDRESS, chainIds: [{ chainId: '296', status: 'partial' }] },
      { address: second, chainIds: [{ chainId: '296', status: 'not_verified' }] },
    ]);
    expect(calls).toHaveLength(2);
  });
});

describe('compiler version helpers', () => {
  it('normalises compiler versions', () => {
    expect(normalizeCompilerVersion('v0.8.28+commit.7893614a')).toBe('0.8.28+commit.7893614a');
    expect(normalizeCompilerVersion('soljson-v0.8.28+commit.7893614a.js')).toBe(
      '0.8.28+commit.7893614a'
    );
    expect(normalizeCompilerVersion('  0.8.7+commit.e28d00a7 ')).toBe('0.8.7+commit.e28d00a7');
  });

  it('recognises a full version', () => {
    expect(isFullCompilerVersion('0.8.28+commit.7893614a')).toBe(true);
    expect(isFullCompilerVersion('0.8.28')).toBe(false);
  });

  it('reads the first version literal out of a pragma', () => {
    expect(parsePragmaVersion('pragma solidity ^0.8.20;')).toBe('0.8.20');
    expect(parsePragmaVersion('pragma solidity >=0.7.0 <0.9.0;')).toBe('0.7.0');
    expect(parsePragmaVersion('pragma solidity 0.8.28;')).toBe('0.8.28');
    expect(parsePragmaVersion('// no pragma here')).toBeUndefined();
  });
});

describe('contract identifier resolution', () => {
  it('prefers a file whose basename matches the contract', () => {
    expect(
      findContractIdentifier({ 'contracts/Greeter.sol': {}, 'contracts/Other.sol': {} }, 'Greeter')
    ).toBe('contracts/Greeter.sol:Greeter');
  });

  it('falls back to the file that declares the contract', () => {
    const sources = { 'contracts/Bundle.sol': {} };
    const contents = { 'contracts/Bundle.sol': 'contract Greeter { }' };
    expect(findContractIdentifier(sources, 'Greeter', contents)).toBe(
      'contracts/Bundle.sol:Greeter'
    );
  });

  it('finds abstract contracts, libraries and interfaces', () => {
    const contents = { 'a.sol': 'library Maths { }' };
    expect(findContractIdentifier({ 'a.sol': {} }, 'Maths', contents)).toBe('a.sol:Maths');
  });

  it('returns undefined when nothing declares the contract', () => {
    expect(findContractIdentifier({ 'a.sol': {} }, 'Missing', { 'a.sol': 'contract A {}' })).toBe(
      undefined
    );
  });

  it('reads the identifier out of a metadata compilationTarget', () => {
    expect(
      contractIdentifierFromMetadata({ settings: { compilationTarget: { 'src/G.sol': 'G' } } })
    ).toBe('src/G.sol:G');
    expect(contractIdentifierFromMetadata({ settings: {} })).toBeUndefined();
  });
});

describe('standard JSON input from a Hardhat build-info fixture', () => {
  const buildInfo = {
    _format: 'hh-sol-build-info-1',
    id: 'a1b2c3',
    solcVersion: '0.8.28',
    solcLongVersion: '0.8.28+commit.7893614a',
    input: {
      language: 'Solidity',
      sources: {
        'contracts/Greeter.sol': {
          content:
            '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.28;\ncontract Greeter {}\n',
        },
        'contracts/Lib.sol': { content: 'library Lib {}\n' },
      },
      settings: {
        optimizer: { enabled: true, runs: 999 },
        evmVersion: 'cancun',
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
      },
    },
    output: {
      contracts: {
        'contracts/Greeter.sol': { Greeter: { abi: [] } },
        'contracts/Lib.sol': { Lib: { abi: [] } },
      },
    },
  };

  it('submits the embedded standard JSON input verbatim', () => {
    const submission = buildSubmissionFromBuildInfo(buildInfo, 'Greeter');

    expect(submission.compilerVersion).toBe('0.8.28+commit.7893614a');
    expect(submission.contractIdentifier).toBe('contracts/Greeter.sol:Greeter');
    expect(submission.stdJsonInput.language).toBe('Solidity');
    expect(Object.keys(submission.stdJsonInput.sources)).toEqual([
      'contracts/Greeter.sol',
      'contracts/Lib.sol',
    ]);
    // The exact settings from the compilation are what make the match work.
    expect(submission.stdJsonInput.settings).toMatchObject({
      optimizer: { enabled: true, runs: 999 },
      evmVersion: 'cancun',
    });
    expect(submission.creationTransactionHash).toBeUndefined();
  });

  it('carries the creation transaction hash when given', () => {
    const txHash = `0x${'a'.repeat(64)}`;
    expect(buildSubmissionFromBuildInfo(buildInfo, 'Lib', txHash).creationTransactionHash).toBe(
      txHash
    );
  });

  it('rejects a file that is not build-info', () => {
    expect(() => buildSubmissionFromBuildInfo({ abi: [] }, 'Greeter')).toThrow(/no `input` object/);
  });

  it('rejects an unknown contract name', () => {
    expect(() => buildSubmissionFromBuildInfo(buildInfo, 'Absent')).toThrow(
      /"Absent" was not found/
    );
  });

  it('reads build-info from disk', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hp-buildinfo-'));
    const buildInfoPath = path.join(dir, 'artifacts', 'build-info', 'a1b2c3.json');
    await fs.mkdir(path.dirname(buildInfoPath), { recursive: true });
    await fs.writeFile(buildInfoPath, JSON.stringify(buildInfo));

    const submission = await new HashScanService().readHardhatBuildInfo(buildInfoPath, 'Greeter');

    expect(submission.contractIdentifier).toBe('contracts/Greeter.sol:Greeter');
    expect(submission.compilerVersion).toBe('0.8.28+commit.7893614a');

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reports a missing build-info file clearly', async () => {
    await expect(
      new HashScanService().readHardhatBuildInfo('/nonexistent/build-info.json', 'Greeter')
    ).rejects.toThrow(/Failed to read build-info file/);
  });
});

describe('standard JSON input from a Foundry artifact fixture', () => {
  const metadata = {
    compiler: { version: '0.8.28+commit.7893614a' },
    language: 'Solidity',
    settings: {
      compilationTarget: { 'src/Greeter.sol': 'Greeter' },
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      remappings: ['forge-std/=lib/forge-std/src/'],
      metadata: { bytecodeHash: 'ipfs' },
    },
    sources: {
      'src/Greeter.sol': { keccak256: '0x01', urls: [], license: 'MIT' },
      'lib/forge-std/src/Base.sol': { keccak256: '0x02', urls: [], license: 'MIT' },
    },
    version: 1,
  };

  const GREETER =
    '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.28;\ncontract Greeter {}\n';
  const BASE = 'abstract contract Base {}\n';

  async function writeFoundryProject(): Promise<{ root: string; artifactPath: string }> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hp-foundry-'));
    const artifactPath = path.join(root, 'out', 'Greeter.sol', 'Greeter.json');

    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, JSON.stringify({ abi: [], metadata }));

    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'Greeter.sol'), GREETER);

    await fs.mkdir(path.join(root, 'lib', 'forge-std', 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'lib', 'forge-std', 'src', 'Base.sol'), BASE);

    return { root, artifactPath };
  }

  it('builds standard JSON from the artifact metadata and the project sources', async () => {
    const { root, artifactPath } = await writeFoundryProject();

    const submission = await new HashScanService().readFoundryArtifact(artifactPath, 'Greeter');

    expect(submission.compilerVersion).toBe('0.8.28+commit.7893614a');
    expect(submission.contractIdentifier).toBe('src/Greeter.sol:Greeter');
    expect(submission.stdJsonInput.sources).toEqual({
      'src/Greeter.sol': { content: GREETER },
      'lib/forge-std/src/Base.sol': { content: BASE },
    });
    // compilationTarget is metadata-only; solc rejects it inside standard JSON settings.
    expect(submission.stdJsonInput.settings).not.toHaveProperty('compilationTarget');
    expect(submission.stdJsonInput.settings).toMatchObject({
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
      remappings: ['forge-std/=lib/forge-std/src/'],
    });

    await fs.rm(root, { recursive: true, force: true });
  });

  it('fails clearly when a source file is missing from the project', async () => {
    const { root, artifactPath } = await writeFoundryProject();
    await fs.rm(path.join(root, 'lib', 'forge-std', 'src', 'Base.sol'));

    await expect(
      new HashScanService().readFoundryArtifact(artifactPath, 'Greeter')
    ).rejects.toThrow(/Missing source content for "lib\/forge-std\/src\/Base.sol"/);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects an artifact with no metadata', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hp-foundry-bare-'));
    const artifactPath = path.join(dir, 'out', 'Greeter.sol', 'Greeter.json');
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, JSON.stringify({ abi: [] }));

    await expect(
      new HashScanService().readFoundryArtifact(artifactPath, 'Greeter')
    ).rejects.toThrow(/extra_output = \["metadata"\]/);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('strips metadata-only settings and keeps the rest', () => {
    const stdJson = standardJsonFromMetadata(metadata, {
      'src/Greeter.sol': GREETER,
      'lib/forge-std/src/Base.sol': BASE,
    });

    expect(stdJson.language).toBe('Solidity');
    expect(stdJson.settings).not.toHaveProperty('compilationTarget');
    expect(stdJson.settings).toHaveProperty('optimizer');
  });
});

describe('standard JSON input from raw sources', () => {
  it('builds sources and settings with the supplied overrides', () => {
    const submission = buildSubmissionFromSources(
      { 'Greeter.sol': 'pragma solidity ^0.8.28;\ncontract Greeter {}\n' },
      'Greeter',
      '0.8.28+commit.7893614a',
      { optimizerEnabled: true, optimizerRuns: 500, evmVersion: 'paris' }
    );

    expect(submission.contractIdentifier).toBe('Greeter.sol:Greeter');
    expect(submission.stdJsonInput.sources['Greeter.sol'].content).toContain('contract Greeter');
    expect(submission.stdJsonInput.settings).toEqual({
      optimizer: { enabled: true, runs: 500 },
      evmVersion: 'paris',
    });
  });

  it('defaults the optimizer to off with 200 runs', () => {
    const submission = buildSubmissionFromSources(
      { 'Greeter.sol': 'contract Greeter {}' },
      'Greeter',
      '0.8.28+commit.7893614a'
    );
    expect(submission.stdJsonInput.settings).toEqual({
      optimizer: { enabled: false, runs: 200 },
    });
  });

  it('refuses when no source declares the contract', () => {
    expect(() =>
      buildSubmissionFromSources({ 'A.sol': 'contract A {}' }, 'Greeter', '0.8.28+commit.7893614a')
    ).toThrow(/declare a contract named "Greeter"/);
  });

  it('refuses with no sources at all', () => {
    expect(() => buildSubmissionFromSources({}, 'Greeter', '0.8.28+commit.7893614a')).toThrow(
      /No Solidity sources/
    );
  });
});

describe('submitting a verification', () => {
  const submission = buildSubmissionFromSources(
    { 'Greeter.sol': 'pragma solidity ^0.8.28;\ncontract Greeter {}\n' },
    'Greeter',
    '0.8.28+commit.7893614a'
  );

  it('posts standard JSON and polls the job to an exact match', async () => {
    stubFetchSequence([
      { status: 202, body: { verificationId: 'job-1' } },
      {
        status: 200,
        body: {
          isJobCompleted: true,
          verificationId: 'job-1',
          contract: minimal('exact_match'),
        },
      },
    ]);

    const result = await new HashScanService().verifyWithStandardJson(
      ADDRESS,
      'testnet',
      submission,
      { pollIntervalMs: 1 }
    );

    expect(result).toMatchObject({
      success: true,
      status: 'perfect',
      match: 'exact_match',
      chainId: '296',
      verificationId: 'job-1',
      compilerVersion: '0.8.28+commit.7893614a',
    });

    expect(calls[0]).toMatchObject({
      url: `${DEFAULT_SOURCIFY_API_URL}/v2/verify/296/${ADDRESS}`,
      method: 'POST',
    });
    // The body is exactly what the OpenAPI document requires.
    expect(Object.keys(calls[0].body).sort()).toEqual([
      'compilerVersion',
      'contractIdentifier',
      'stdJsonInput',
    ]);
    expect(calls[0].body.stdJsonInput.language).toBe('Solidity');
    expect(calls[1]).toMatchObject({
      url: `${DEFAULT_SOURCIFY_API_URL}/v2/verify/job-1`,
      method: 'GET',
    });
  });

  it('waits for a job that is still running', async () => {
    stubFetchSequence([
      { status: 202, body: { verificationId: 'job-2' } },
      { status: 200, body: { isJobCompleted: false, verificationId: 'job-2' } },
      { status: 200, body: { isJobCompleted: true, contract: minimal('match') } },
    ]);

    const result = await new HashScanService().verifyWithStandardJson(
      ADDRESS,
      'testnet',
      submission,
      { pollIntervalMs: 1 }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('partial');
    expect(calls).toHaveLength(3);
  });

  it('turns a no_match job into a failure with an actionable hint', async () => {
    stubFetchSequence([
      { status: 202, body: { verificationId: 'job-3' } },
      {
        status: 200,
        body: {
          isJobCompleted: true,
          contract: minimal(null),
          error: {
            customCode: 'no_match',
            message: "The onchain and recompiled bytecodes don't match.",
            errorId: 'e1',
          },
        },
      },
    ]);

    const result = await new HashScanService().verifyWithStandardJson(
      ADDRESS,
      'testnet',
      submission,
      { pollIntervalMs: 1 }
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.customCode).toBe('no_match');
    expect(result.message).toMatch(/buildInfoPath/);
    expect(result.message).toMatch(/artifactPath/);
  });

  it('treats already_verified as verified, reading the stored match', async () => {
    stubFetchSequence([
      { status: 202, body: { verificationId: 'job-4' } },
      {
        status: 200,
        body: {
          isJobCompleted: true,
          contract: minimal(null),
          error: {
            customCode: 'already_verified',
            message: "The contract is already verified and the job didn't yield a better match.",
            errorId: 'e2',
          },
        },
      },
      { status: 200, body: minimal('exact_match') },
    ]);

    const result = await new HashScanService().verifyWithStandardJson(
      ADDRESS,
      'testnet',
      submission,
      { pollIntervalMs: 1 }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('perfect');
    expect(result.customCode).toBe('already_verified');
    expect(calls[2].url).toContain('/v2/contract/296/');
  });

  it('reports a rejected submission without polling', async () => {
    stubFetchSequence([
      {
        status: 400,
        body: {
          customCode: 'unsupported_chain',
          message: 'Chain 296 not found',
          errorId: 'e3',
        },
      },
    ]);

    const result = await new HashScanService().verifyWithStandardJson(
      ADDRESS,
      'testnet',
      submission,
      { pollIntervalMs: 1 }
    );

    expect(result.success).toBe(false);
    expect(result.customCode).toBe('unsupported_chain');
    expect(calls).toHaveLength(1);
  });

  it('gives up on a job that never completes', async () => {
    stubFetch(() => ({ status: 200, body: { isJobCompleted: false } }));

    await expect(
      new HashScanService().waitForVerification('job-5', { timeoutMs: 5, pollIntervalMs: 1 })
    ).rejects.toThrow(/did not finish within/);
  });
});

describe('reading verified sources', () => {
  const contractBody = {
    ...minimal('exact_match'),
    sources: {
      'src/Greeter.sol': { content: 'contract Greeter {}' },
      'lib/Base.sol': { content: 'contract Base {}' },
    },
    metadata: { output: { abi: [{ type: 'function', name: 'greet' }] } },
    compilation: { fullyQualifiedName: 'src/Greeter.sol:Greeter' },
  };

  it('returns the sources plus a synthesised metadata.json', async () => {
    stubFetchSequence([{ status: 200, body: contractBody }]);

    const files = await new HashScanService().getContractFiles(ADDRESS, 'testnet', 'perfect');

    expect(files.map((f) => f.path)).toEqual(['src/Greeter.sol', 'lib/Base.sol', 'metadata.json']);
    expect(files[0].name).toBe('Greeter.sol');

    // src/tools/deploy.ts pulls the ABI out of the file named metadata.json.
    const metadataFile = files.find((f) => f.name === 'metadata.json');
    expect(JSON.parse(metadataFile!.content).output.abi[0].name).toBe('greet');

    // `match` is always returned and is rejected as a field selector, so it is not listed.
    expect(calls[0].url).toContain('fields=sources%2Cmetadata%2Ccompilation');
    expect(calls[0].url).not.toContain('%2Cmatch');
  });

  it('returns nothing when only a partial match exists and perfect was asked for', async () => {
    stubFetchSequence([{ status: 200, body: { ...contractBody, match: 'match' } }]);

    const files = await new HashScanService().getContractFiles(ADDRESS, 'testnet', 'perfect');
    expect(files).toEqual([]);
  });

  it('accepts a partial match when matchType is any', async () => {
    stubFetchSequence([{ status: 200, body: { ...contractBody, match: 'match' } }]);

    const files = await new HashScanService().getContractFiles(ADDRESS, 'testnet', 'any');
    expect(files.length).toBeGreaterThan(0);
  });

  it('returns nothing for an unverified contract', async () => {
    stubFetchSequence([{ status: 404, body: minimal(null) }]);

    expect(await new HashScanService().getContractFiles(ADDRESS, 'testnet')).toEqual([]);
  });

  it('derives a file tree from the source paths', async () => {
    stubFetchSequence([{ status: 200, body: contractBody }]);

    const tree = await new HashScanService().getContractFileTree(ADDRESS, 'testnet');

    expect(tree.paths).toEqual(['src/Greeter.sol', 'lib/Base.sol']);
    expect(tree.tree).toEqual({
      src: { 'Greeter.sol': null },
      lib: { 'Base.sol': null },
    });
  });

  it('nests deep paths', () => {
    expect(buildFileTree(['a/b/c.sol', 'a/d.sol'])).toEqual({
      a: { b: { 'c.sol': null }, 'd.sol': null },
    });
  });
});

describe('listing verified contracts', () => {
  it('reads the results array from GET /v2/contracts/{chainId}', async () => {
    stubFetchSequence([
      {
        status: 200,
        body: { results: [minimal('exact_match'), { ...minimal('match'), address: '0xabc' }] },
      },
    ]);

    const results = await new HashScanService().listVerifiedContractsDetailed('testnet', {
      limit: 5,
      sort: 'desc',
    });

    expect(results.map((r) => r.status)).toEqual(['perfect', 'partial']);
    expect(calls[0].url).toContain('/v2/contracts/296?');
    expect(calls[0].url).toContain('limit=5');
    expect(calls[0].url).toContain('sort=desc');
  });

  it('clamps the limit to the documented maximum of 200', async () => {
    stubFetchSequence([{ status: 200, body: { results: [] } }]);
    await new HashScanService().listVerifiedContractsDetailed('testnet', { limit: 9999 });
    expect(calls[0].url).toContain('limit=200');
  });
});

describe('HashScan URLs', () => {
  it('points at the HashScan contract page for each network', () => {
    const service = new HashScanService();
    expect(service.getContractUrl(ADDRESS, 'mainnet')).toBe(
      `https://hashscan.io/mainnet/contract/${ADDRESS}`
    );
    expect(service.getContractUrl(ADDRESS, 'testnet')).toBe(
      `https://hashscan.io/testnet/contract/${ADDRESS}`
    );
    // HashScan still has previewnet pages even though Sourcify cannot verify there.
    expect(service.getContractUrl(ADDRESS, 'previewnet')).toBe(
      `https://hashscan.io/previewnet/contract/${ADDRESS}`
    );
  });
});

describe('verify_contract tool', () => {
  it('requires one of filePath, buildInfoPath or artifactPath', async () => {
    failOnFetch();

    const result = await verifyContract({
      address: ADDRESS,
      network: 'testnet',
      contractName: 'Greeter',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/buildInfoPath/);
    expect(calls).toHaveLength(0);
  });

  it('reports a not-verified contract as a clean failure, not a crash', async () => {
    stubFetchSequence([{ status: 404, body: minimal(null) }]);

    const result = await verificationStatus({ address: ADDRESS, network: 'testnet' });

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('not_verified');
    expect(result.data.isVerified).toBe(false);
    expect(result.data.hashScanUrl).toBe(`https://hashscan.io/testnet/contract/${ADDRESS}`);
  });
});
