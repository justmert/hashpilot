/**
 * Contract verification service (Sourcify APIv2)
 *
 * HashScan does not run its own verification server any more. The old host
 * `server-verify.hashscan.io` 308-redirects every path to `https://sourcify.dev/server`
 * and drops the path, and Sourcify switched the legacy v1 API off on 2026-07-07, so
 * every v1 route (`POST /verify`, `/check-by-addresses`, `/files/...`) is gone.
 *
 * This service targets Sourcify APIv2 directly. HashScan reads its verification
 * badge from Sourcify, so `getContractUrl` still points at hashscan.io.
 *
 * Base URL:  https://sourcify.dev/server  (override with SOURCIFY_API_URL)
 * API docs:  https://sourcify.dev/server/api-docs/  (OpenAPI: /api-docs/swagger.json)
 * Hedera:    https://docs.hedera.com/reference/verification-api
 *
 * Endpoints used:
 *   POST /v2/verify/{chainId}/{address}   submit standard JSON input -> { verificationId }
 *   GET  /v2/verify/{verificationId}      poll the job -> { isJobCompleted, contract, error }
 *   GET  /v2/contract/{chainId}/{address} read match state, sources, metadata
 *   GET  /v2/contracts/{chainId}          list verified contracts on a chain
 */

import { logger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Hedera network chain IDs.
 *
 * All three are real Hedera chain IDs and are used for HashScan links, but only
 * mainnet and testnet are verifiable: previewnet (297) is absent from Sourcify's
 * `GET /chains`. See SOURCIFY_SUPPORTED_NETWORKS.
 */
export const HEDERA_CHAIN_IDS = {
  mainnet: '295',
  testnet: '296',
  previewnet: '297',
} as const;

export type HederaNetwork = keyof typeof HEDERA_CHAIN_IDS;

/** Networks Sourcify will actually verify contracts on. */
export const SOURCIFY_SUPPORTED_NETWORKS = ['mainnet', 'testnet'] as const;

export type SourcifyNetwork = (typeof SOURCIFY_SUPPORTED_NETWORKS)[number];

/** Default Sourcify APIv2 base URL. */
export const DEFAULT_SOURCIFY_API_URL = 'https://sourcify.dev/server';

/** Where the official solc release index lives, used to resolve a pragma to a full version. */
export const SOLC_RELEASES_URL = 'https://binaries.soliditylang.org/bin/list.json';

/**
 * Resolve the Sourcify base URL, honouring SOURCIFY_API_URL. Read at call time so
 * tests and self-hosted deployments can change it without reloading the module.
 */
export function getSourcifyApiUrl(): string {
  const raw = process.env.SOURCIFY_API_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_SOURCIFY_API_URL).replace(/\/+$/, '');
}

/**
 * Match quality as reported by Sourcify v2.
 * `exact_match` includes the metadata hash, `match` does not, `null` means unverified.
 */
export type SourcifyMatch = 'exact_match' | 'match' | null;

/**
 * Match quality in this server's vocabulary. Kept as `perfect`/`partial` because
 * callers outside this module (src/tools/deploy.ts) compare against those strings.
 */
export type MatchType = 'perfect' | 'partial';

/**
 * Verification status result
 */
export interface VerificationStatus {
  address: string;
  chainId: string;
  status: MatchType | 'not_verified';
  libraryMap?: Record<string, string>;
  /** Raw Sourcify v2 values, kept so callers can distinguish creation from runtime matches. */
  match?: SourcifyMatch;
  creationMatch?: SourcifyMatch;
  runtimeMatch?: SourcifyMatch;
  verifiedAt?: string;
  matchId?: string;
}

/**
 * Verification result
 */
export interface VerificationResult {
  success: boolean;
  address: string;
  chainId: string;
  status: MatchType | 'failed';
  message?: string;
  libraryMap?: Record<string, string>;
  /** Sourcify job id, useful for support requests. */
  verificationId?: string;
  /** Sourcify error token, e.g. `no_match`, `already_verified`, `unsupported_chain`. */
  customCode?: string;
  match?: SourcifyMatch;
  creationMatch?: SourcifyMatch;
  runtimeMatch?: SourcifyMatch;
  /** Compiler version actually submitted, so callers can see what was assumed. */
  compilerVersion?: string;
}

/**
 * Contract file information
 */
export interface ContractFile {
  name: string;
  path: string;
  content: string;
}

/**
 * Batch verification status
 */
export interface BatchVerificationStatus {
  address: string;
  chainIds: Array<{
    chainId: string;
    status: MatchType | 'not_verified';
  }>;
}

/**
 * Solidity standard JSON input, the format Sourcify v2 takes for verification.
 * https://docs.soliditylang.org/en/latest/using-the-compiler.html#input-description
 */
export interface StandardJsonInput {
  language: string;
  sources: Record<string, { content?: string; urls?: string[] }>;
  settings?: Record<string, unknown>;
}

/**
 * Body of POST /v2/verify/{chainId}/{address}
 */
export interface VerificationSubmission {
  stdJsonInput: StandardJsonInput;
  compilerVersion: string;
  /** `path/to/File.sol:ContractName` */
  contractIdentifier: string;
  creationTransactionHash?: string;
}

/**
 * Body of GET /v2/verify/{verificationId}
 */
export interface VerificationJob {
  isJobCompleted: boolean;
  verificationId?: string;
  jobStartTime?: string;
  jobFinishTime?: string;
  compilationTime?: string;
  contract?: {
    match: SourcifyMatch;
    creationMatch: SourcifyMatch;
    runtimeMatch: SourcifyMatch;
    chainId: string;
    address: string;
    verifiedAt?: string;
    matchId?: string;
  };
  error?: {
    customCode: string;
    message: string;
    errorId?: string;
    [key: string]: unknown;
  };
}

/** Options for the direct-source verification path. */
export interface CompilerSettingsOverrides {
  /** Full solc version, e.g. `0.8.28+commit.7893614a`. Resolved from the pragma when absent. */
  compilerVersion?: string;
  optimizerEnabled?: boolean;
  optimizerRuns?: number;
  evmVersion?: string;
  viaIR?: boolean;
}

/**
 * Raised when a caller asks to verify on a network Sourcify does not serve.
 */
export class UnsupportedNetworkError extends Error {
  readonly network: string;
  readonly chainId?: string;

  constructor(network: string, chainId?: string) {
    super(
      `Sourcify does not support Hedera ${network}` +
        (chainId ? ` (chain ID ${chainId})` : '') +
        `. Contract verification is available on ${SOURCIFY_SUPPORTED_NETWORKS.join(' and ')} only. ` +
        `Redeploy the contract to testnet (chain ID 296) or mainnet (chain ID 295) to verify it.`
    );
    this.name = 'UnsupportedNetworkError';
    this.network = network;
    this.chainId = chainId;
  }
}

/** True when Sourcify verifies the given network. */
export function isSourcifySupported(network: string): network is SourcifyNetwork {
  return (SOURCIFY_SUPPORTED_NETWORKS as readonly string[]).includes(network);
}

/**
 * Chain ID for a verifiable network.
 * @throws UnsupportedNetworkError for previewnet or any unknown network.
 */
export function chainIdForVerification(network: string): string {
  if (!isSourcifySupported(network)) {
    const known = (HEDERA_CHAIN_IDS as Record<string, string>)[network];
    throw new UnsupportedNetworkError(network, known);
  }
  return HEDERA_CHAIN_IDS[network];
}

/**
 * Map a Sourcify v2 match value onto this server's status vocabulary.
 * `exact_match` -> perfect, `match` -> partial, null/absent -> not_verified.
 */
export function mapSourcifyMatch(match: SourcifyMatch | undefined): MatchType | 'not_verified' {
  if (match === 'exact_match') return 'perfect';
  if (match === 'match') return 'partial';
  return 'not_verified';
}

/**
 * Normalise a compiler version to the `x.y.z+commit.hash` form Sourcify expects.
 * Strips a leading `v` and any `soljson-`/`.js` wrapper from the solc release index.
 */
export function normalizeCompilerVersion(version: string): string {
  return version
    .trim()
    .replace(/^soljson-/, '')
    .replace(/\.js$/, '')
    .replace(/^v/, '');
}

/** True when a version string already carries a commit hash. */
export function isFullCompilerVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+.*\+commit\.[0-9a-f]+/.test(normalizeCompilerVersion(version));
}

/**
 * Pull the first version literal out of a Solidity pragma.
 * `pragma solidity ^0.8.20;` -> `0.8.20`, `pragma solidity >=0.7.0 <0.9.0;` -> `0.7.0`.
 */
export function parsePragmaVersion(source: string): string | undefined {
  const pragma = source.match(/pragma\s+solidity\s+([^;]+);/);
  if (!pragma) return undefined;
  const literal = pragma[1].match(/(\d+\.\d+\.\d+)/);
  return literal ? literal[1] : undefined;
}

/**
 * Fully qualified `path:ContractName` for a contract, given the source paths.
 * Prefers a file whose basename matches the contract, then any file that declares it.
 */
export function findContractIdentifier(
  sources: Record<string, unknown>,
  contractName: string,
  contents?: Record<string, string>
): string | undefined {
  const paths = Object.keys(sources);
  if (paths.length === 0) return undefined;

  const byBasename = paths.find((p) => path.basename(p, '.sol') === contractName);
  if (byBasename) return `${byBasename}:${contractName}`;

  if (contents) {
    const declaration = new RegExp(
      `(?:^|\\s)(?:abstract\\s+)?(?:contract|library|interface)\\s+${contractName}\\b`
    );
    const byDeclaration = paths.find((p) => contents[p] && declaration.test(contents[p]));
    if (byDeclaration) return `${byDeclaration}:${contractName}`;
  }

  return undefined;
}

/**
 * Settings keys that live in a Solidity metadata blob but are not valid standard
 * JSON input settings. solc rejects unknown keys, so they have to come out.
 */
const METADATA_ONLY_SETTINGS = ['compilationTarget'];

/**
 * Build standard JSON input from a Solidity metadata object plus the source contents.
 * Metadata carries the exact compiler settings but only source hashes and URLs, so the
 * file contents have to be supplied separately.
 */
export function standardJsonFromMetadata(
  metadata: any,
  sourceContents: Record<string, string>
): StandardJsonInput {
  const settings: Record<string, unknown> = { ...(metadata?.settings ?? {}) };
  for (const key of METADATA_ONLY_SETTINGS) {
    delete settings[key];
  }

  const sources: StandardJsonInput['sources'] = {};
  for (const sourcePath of Object.keys(metadata?.sources ?? {})) {
    const content = sourceContents[sourcePath];
    if (content === undefined) {
      throw new Error(
        `Missing source content for "${sourcePath}". Verification needs every source file listed ` +
          `in the artifact metadata. Run the tool from the project root, or pass buildInfoPath ` +
          `for a Hardhat build-info file which already embeds all sources.`
      );
    }
    sources[sourcePath] = { content };
  }

  return {
    language: metadata?.language ?? 'Solidity',
    sources,
    settings,
  };
}

/**
 * `path/to/File.sol:Name` from a metadata `compilationTarget`.
 */
export function contractIdentifierFromMetadata(metadata: any): string | undefined {
  const target = metadata?.settings?.compilationTarget;
  if (!target || typeof target !== 'object') return undefined;
  const [sourcePath] = Object.keys(target);
  if (!sourcePath) return undefined;
  return `${sourcePath}:${target[sourcePath]}`;
}

/**
 * Build a submission from a Hardhat build-info object. Build-info already contains the
 * full standard JSON input under `.input` and the exact compiler under `.solcLongVersion`,
 * so this is the most reliable input path.
 */
export function buildSubmissionFromBuildInfo(
  buildInfo: any,
  contractName: string,
  creationTransactionHash?: string
): VerificationSubmission {
  const stdJsonInput = buildInfo?.input;
  if (!stdJsonInput || typeof stdJsonInput !== 'object' || !stdJsonInput.sources) {
    throw new Error(
      'Build-info file has no `input` object. Point buildInfoPath at a file under ' +
        'artifacts/build-info/, not at a contract artifact.'
    );
  }

  const compilerVersion = normalizeCompilerVersion(
    buildInfo.solcLongVersion || buildInfo.solcVersion || ''
  );
  if (!compilerVersion) {
    throw new Error('Build-info file has no `solcLongVersion`; cannot determine the compiler.');
  }

  // Prefer the compiled output, which lists the fully qualified names verbatim.
  let contractIdentifier: string | undefined;
  const outputContracts = buildInfo.output?.contracts;
  if (outputContracts && typeof outputContracts === 'object') {
    for (const sourcePath of Object.keys(outputContracts)) {
      if (outputContracts[sourcePath] && contractName in outputContracts[sourcePath]) {
        contractIdentifier = `${sourcePath}:${contractName}`;
        break;
      }
    }
  }

  if (!contractIdentifier) {
    const contents: Record<string, string> = {};
    for (const [p, entry] of Object.entries<any>(stdJsonInput.sources)) {
      if (entry?.content) contents[p] = entry.content;
    }
    contractIdentifier = findContractIdentifier(stdJsonInput.sources, contractName, contents);
  }

  if (!contractIdentifier) {
    throw new Error(
      `Contract "${contractName}" was not found in the build-info file. ` +
        `Check the contract name, or recompile so the build-info covers it.`
    );
  }

  return {
    stdJsonInput: {
      language: stdJsonInput.language ?? 'Solidity',
      sources: stdJsonInput.sources,
      settings: stdJsonInput.settings,
    },
    compilerVersion,
    contractIdentifier,
    ...(creationTransactionHash ? { creationTransactionHash } : {}),
  };
}

/**
 * Build a submission from a Foundry artifact object plus its source contents.
 * The artifact's `metadata` carries the compiler version, settings and the source list.
 */
export function buildSubmissionFromFoundryArtifact(
  artifact: any,
  contractName: string,
  sourceContents: Record<string, string>,
  creationTransactionHash?: string
): VerificationSubmission {
  const metadata = artifact?.metadata;
  if (!metadata || typeof metadata !== 'object') {
    throw new Error(
      'Foundry artifact has no `metadata` object. Set `extra_output = ["metadata"]` in ' +
        'foundry.toml (or use `forge build --extra-output metadata`) and rebuild.'
    );
  }

  const compilerVersion = normalizeCompilerVersion(metadata.compiler?.version || '');
  if (!compilerVersion) {
    throw new Error('Foundry artifact metadata has no `compiler.version`.');
  }

  const stdJsonInput = standardJsonFromMetadata(metadata, sourceContents);

  const contractIdentifier =
    contractIdentifierFromMetadata(metadata) ??
    findContractIdentifier(metadata.sources ?? {}, contractName, sourceContents);

  if (!contractIdentifier) {
    throw new Error(
      `Could not work out the fully qualified name for "${contractName}" from the artifact metadata.`
    );
  }

  return {
    stdJsonInput,
    compilerVersion,
    contractIdentifier,
    ...(creationTransactionHash ? { creationTransactionHash } : {}),
  };
}

/**
 * Build a submission from raw sources. This is the least reliable path: the compiler
 * settings are guessed unless the caller supplies them, and Sourcify only matches when
 * they reproduce the deployed bytecode exactly.
 */
export function buildSubmissionFromSources(
  sourceContents: Record<string, string>,
  contractName: string,
  compilerVersion: string,
  overrides: CompilerSettingsOverrides = {},
  creationTransactionHash?: string
): VerificationSubmission {
  const paths = Object.keys(sourceContents);
  if (paths.length === 0) {
    throw new Error('No Solidity sources were supplied.');
  }

  const contractIdentifier = findContractIdentifier(sourceContents, contractName, sourceContents);
  if (!contractIdentifier) {
    throw new Error(
      `None of the supplied sources (${paths.join(', ')}) declare a contract named "${contractName}".`
    );
  }

  const settings: Record<string, unknown> = {
    optimizer: {
      enabled: overrides.optimizerEnabled ?? false,
      runs: overrides.optimizerRuns ?? 200,
    },
  };
  if (overrides.evmVersion) settings.evmVersion = overrides.evmVersion;
  if (overrides.viaIR !== undefined) settings.viaIR = overrides.viaIR;

  const sources: StandardJsonInput['sources'] = {};
  for (const [p, content] of Object.entries(sourceContents)) {
    sources[p] = { content };
  }

  return {
    stdJsonInput: { language: 'Solidity', sources, settings },
    compilerVersion: normalizeCompilerVersion(compilerVersion),
    contractIdentifier,
    ...(creationTransactionHash ? { creationTransactionHash } : {}),
  };
}

/**
 * Turn a flat list of source paths into a nested tree, replacing the v1 `/files/tree`
 * endpoint which Sourcify v2 does not provide.
 */
export function buildFileTree(paths: string[]): Record<string, any> {
  const tree: Record<string, any> = {};
  for (const filePath of paths) {
    const segments = filePath.split('/').filter(Boolean);
    let node = tree;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) {
        node[segment] = null;
      } else {
        node[segment] = node[segment] ?? {};
        node = node[segment];
      }
    });
  }
  return tree;
}

interface SourcifyHttpResponse {
  status: number;
  ok: boolean;
  data: any;
}

/**
 * Contract verification against Sourcify APIv2.
 */
export class HashScanService {
  private readonly timeoutMs: number;
  /** Cached solc release index, so a pragma lookup costs one request per process. */
  private solcReleases?: Record<string, string>;

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 60000;
  }

  /** Current Sourcify base URL. */
  get baseUrl(): string {
    return getSourcifyApiUrl();
  }

  private async request(
    method: 'GET' | 'POST',
    pathname: string,
    body?: unknown
  ): Promise<SourcifyHttpResponse> {
    const url = `${this.baseUrl}${pathname}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: any) {
      logger.error('Sourcify request failed', { method, url, error: error?.message });
      throw new Error(`Sourcify request to ${pathname} failed: ${error?.message ?? error}`);
    }

    const text = await response.text();
    let data: any;
    try {
      data = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      data = { message: text.slice(0, 500) };
    }

    if (!response.ok) {
      logger.debug('Sourcify non-OK response', {
        method,
        url,
        status: response.status,
        customCode: data?.customCode,
      });
    }

    return { status: response.status, ok: response.ok, data };
  }

  /** Human-readable error text from a Sourcify error body. */
  private describeError(data: any, fallback: string): string {
    if (!data) return fallback;
    if (typeof data.message === 'string') {
      return data.customCode ? `${data.message} (${data.customCode})` : data.message;
    }
    return fallback;
  }

  /**
   * Get chain ID for a Hedera network. Verification-only: previewnet throws.
   */
  private getChainId(network: HederaNetwork): string {
    return chainIdForVerification(network);
  }

  // ---------------------------------------------------------------------------
  // Reading verification state
  // ---------------------------------------------------------------------------

  /**
   * GET /v2/contract/{chainId}/{address}
   *
   * Returns the parsed body plus the HTTP status. Sourcify answers 404 with a
   * VerifiedContractMinimal whose match fields are null, so the body is still useful.
   */
  async getContract(
    address: string,
    network: HederaNetwork,
    options: { fields?: string; omit?: string } = {}
  ): Promise<SourcifyHttpResponse> {
    const chainId = this.getChainId(network);
    const query = new URLSearchParams();
    if (options.fields) query.set('fields', options.fields);
    else if (options.omit) query.set('omit', options.omit);
    const suffix = query.toString() ? `?${query.toString()}` : '';

    return this.request('GET', `/v2/contract/${chainId}/${address}${suffix}`);
  }

  /**
   * Check verification status for a single contract.
   *
   * @throws UnsupportedNetworkError when the network is not verifiable.
   */
  async checkVerificationStatus(
    address: string,
    network: HederaNetwork
  ): Promise<VerificationStatus> {
    const chainId = this.getChainId(network);
    logger.debug('Checking verification status on Sourcify', { address, network, chainId });

    const { status, ok, data } = await this.getContract(address, network);

    // 404 means "not verified"; the body still carries the address and null matches.
    if (!ok && status !== 404) {
      throw new Error(
        this.describeError(data, `Sourcify returned HTTP ${status} for ${address} on ${network}`)
      );
    }

    return {
      address: data?.address ?? address,
      chainId: data?.chainId ?? chainId,
      status: mapSourcifyMatch(data?.match ?? null),
      match: data?.match ?? null,
      creationMatch: data?.creationMatch ?? null,
      runtimeMatch: data?.runtimeMatch ?? null,
      ...(data?.verifiedAt ? { verifiedAt: data.verifiedAt } : {}),
      ...(data?.matchId ? { matchId: data.matchId } : {}),
    };
  }

  /**
   * Check verification status for several contracts.
   *
   * Sourcify v2 dropped the v1 batch route (`/check-all-by-addresses`), so this fans
   * out to the single-contract endpoint with a small concurrency cap.
   */
  async checkBatchVerificationStatus(
    addresses: string[],
    network: HederaNetwork
  ): Promise<BatchVerificationStatus[]> {
    const chainId = this.getChainId(network);
    logger.debug('Checking batch verification status on Sourcify', {
      count: addresses.length,
      network,
      chainId,
    });

    const concurrency = 5;
    const results: BatchVerificationStatus[] = new Array(addresses.length);

    for (let offset = 0; offset < addresses.length; offset += concurrency) {
      const slice = addresses.slice(offset, offset + concurrency);
      const settled = await Promise.all(
        slice.map(async (address) => {
          try {
            const status = await this.checkVerificationStatus(address, network);
            return status.status;
          } catch (error: any) {
            logger.warn('Verification status lookup failed', {
              address,
              error: error?.message,
            });
            return 'not_verified' as const;
          }
        })
      );
      settled.forEach((status, index) => {
        results[offset + index] = {
          address: slice[index],
          chainIds: [{ chainId, status }],
        };
      });
    }

    return results;
  }

  /**
   * Get the verified sources of a contract, plus a synthesised `metadata.json`.
   *
   * @param matchType `perfect` returns files only for an exact match; `any` accepts a
   *                  partial match too. Returns an empty array when nothing qualifies.
   */
  async getContractFiles(
    address: string,
    network: HederaNetwork,
    matchType: 'perfect' | 'any' = 'perfect'
  ): Promise<ContractFile[]> {
    // `match`, `creationMatch`, `runtimeMatch`, `chainId`, `address` and `verifiedAt` are
    // always returned and are rejected as field selectors, so only the extras are listed.
    const { status, ok, data } = await this.getContract(address, network, {
      fields: 'sources,metadata,compilation',
    });

    if (status === 404) return [];
    if (!ok) {
      throw new Error(
        this.describeError(data, `Failed to retrieve contract files: HTTP ${status}`)
      );
    }

    const mapped = mapSourcifyMatch(data?.match ?? null);
    if (mapped === 'not_verified') return [];
    if (matchType === 'perfect' && mapped !== 'perfect') return [];

    const files: ContractFile[] = [];
    for (const [sourcePath, entry] of Object.entries<any>(data?.sources ?? {})) {
      if (typeof entry?.content !== 'string') continue;
      files.push({
        name: path.basename(sourcePath),
        path: sourcePath,
        content: entry.content,
      });
    }

    // src/tools/deploy.ts reads the ABI out of a file literally named metadata.json,
    // which is what the v1 API used to return alongside the sources.
    if (data?.metadata) {
      files.push({
        name: 'metadata.json',
        path: 'metadata.json',
        content: JSON.stringify(data.metadata, null, 2),
      });
    }

    return files;
  }

  /**
   * File tree for a verified contract.
   *
   * Sourcify v2 has no tree endpoint, so this is derived from the verified source paths.
   */
  async getContractFileTree(
    address: string,
    network: HederaNetwork,
    matchType: 'perfect' | 'any' = 'perfect'
  ): Promise<{ paths: string[]; tree: Record<string, any> }> {
    const files = await this.getContractFiles(address, network, matchType);
    const paths = files.filter((f) => f.path !== 'metadata.json').map((f) => f.path);
    return { paths, tree: buildFileTree(paths) };
  }

  /**
   * GET /v2/contracts/{chainId} - verified contracts on a chain, newest first.
   */
  async listVerifiedContractsDetailed(
    network: HederaNetwork,
    options: { limit?: number; sort?: 'asc' | 'desc'; afterMatchId?: string } = {}
  ): Promise<VerificationStatus[]> {
    const chainId = this.getChainId(network);
    const query = new URLSearchParams();
    query.set('limit', String(Math.min(Math.max(options.limit ?? 200, 1), 200)));
    if (options.sort) query.set('sort', options.sort);
    if (options.afterMatchId) query.set('afterMatchId', options.afterMatchId);

    const { ok, status, data } = await this.request(
      'GET',
      `/v2/contracts/${chainId}?${query.toString()}`
    );
    if (!ok) {
      throw new Error(
        this.describeError(data, `Failed to list verified contracts: HTTP ${status}`)
      );
    }

    return (data?.results ?? []).map((entry: any) => ({
      address: entry.address,
      chainId: entry.chainId ?? chainId,
      status: mapSourcifyMatch(entry.match ?? null),
      match: entry.match ?? null,
      creationMatch: entry.creationMatch ?? null,
      runtimeMatch: entry.runtimeMatch ?? null,
      ...(entry.verifiedAt ? { verifiedAt: entry.verifiedAt } : {}),
      ...(entry.matchId ? { matchId: entry.matchId } : {}),
    }));
  }

  /**
   * Addresses of verified contracts on a chain.
   */
  async listVerifiedContracts(network: HederaNetwork): Promise<string[]> {
    const results = await this.listVerifiedContractsDetailed(network);
    return results.map((r) => r.address);
  }

  // ---------------------------------------------------------------------------
  // Submitting verifications
  // ---------------------------------------------------------------------------

  /**
   * POST /v2/verify/{chainId}/{address} - queues a verification job.
   *
   * @returns the job id, or a Sourcify error when the submission was rejected outright.
   */
  async submitVerification(
    address: string,
    network: HederaNetwork,
    submission: VerificationSubmission
  ): Promise<{ verificationId?: string; error?: { customCode?: string; message: string } }> {
    const chainId = this.getChainId(network);

    logger.info('Submitting contract verification to Sourcify', {
      address,
      network,
      chainId,
      contractIdentifier: submission.contractIdentifier,
      compilerVersion: submission.compilerVersion,
      sourceCount: Object.keys(submission.stdJsonInput.sources ?? {}).length,
    });

    const { status, ok, data } = await this.request(
      'POST',
      `/v2/verify/${chainId}/${address}`,
      submission
    );

    if (ok && data?.verificationId) {
      return { verificationId: data.verificationId };
    }

    return {
      error: {
        customCode: data?.customCode,
        message: this.describeError(data, `Sourcify rejected the submission (HTTP ${status})`),
      },
    };
  }

  /**
   * GET /v2/verify/{verificationId} - one poll of a verification job.
   */
  async getVerificationJob(verificationId: string): Promise<VerificationJob> {
    const { status, ok, data } = await this.request('GET', `/v2/verify/${verificationId}`);
    if (!ok) {
      throw new Error(
        this.describeError(
          data,
          `Failed to read verification job ${verificationId}: HTTP ${status}`
        )
      );
    }
    return data as VerificationJob;
  }

  /**
   * Poll a verification job until it completes.
   */
  async waitForVerification(
    verificationId: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<VerificationJob> {
    const timeoutMs = options.timeoutMs ?? 120000;
    const pollIntervalMs = options.pollIntervalMs ?? 2000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const job = await this.getVerificationJob(verificationId);
      if (job.isJobCompleted) return job;

      if (Date.now() + pollIntervalMs >= deadline) {
        throw new Error(
          `Verification job ${verificationId} did not finish within ${Math.round(timeoutMs / 1000)}s. ` +
            `It may still complete; check GET ${this.baseUrl}/v2/verify/${verificationId}.`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * Submit a standard JSON input and wait for the result.
   */
  async verifyWithStandardJson(
    address: string,
    network: HederaNetwork,
    submission: VerificationSubmission,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<VerificationResult> {
    const chainId = this.getChainId(network);

    const submitted = await this.submitVerification(address, network, submission);
    if (!submitted.verificationId) {
      return {
        success: false,
        address,
        chainId,
        status: 'failed',
        message: submitted.error?.message ?? 'Sourcify did not return a verification id',
        customCode: submitted.error?.customCode,
        compilerVersion: submission.compilerVersion,
      };
    }

    const job = await this.waitForVerification(submitted.verificationId, options);
    return this.jobToResult(job, address, chainId, submission, submitted.verificationId, network);
  }

  /**
   * Turn a completed job into a VerificationResult.
   *
   * `already_verified` is reported as success: the contract is verified on Sourcify,
   * this submission simply did not improve on the stored match.
   */
  private async jobToResult(
    job: VerificationJob,
    address: string,
    chainId: string,
    submission: VerificationSubmission,
    verificationId: string,
    network: HederaNetwork
  ): Promise<VerificationResult> {
    const base = {
      address: job.contract?.address ?? address,
      chainId: job.contract?.chainId ?? chainId,
      verificationId,
      compilerVersion: submission.compilerVersion,
    };

    if (job.error) {
      if (job.error.customCode === 'already_verified') {
        // The stored match is the truth here; the job returns null matches in this case.
        let stored: VerificationStatus | undefined;
        try {
          stored = await this.checkVerificationStatus(address, network);
        } catch (error: any) {
          logger.warn('Could not read stored match after already_verified', {
            address,
            error: error?.message,
          });
        }

        const status = stored?.status ?? 'partial';
        return {
          ...base,
          success: status !== 'not_verified',
          status: status === 'not_verified' ? 'failed' : status,
          message: 'Contract was already verified on Sourcify; the existing match was kept.',
          customCode: job.error.customCode,
          match: stored?.match ?? null,
          creationMatch: stored?.creationMatch ?? null,
          runtimeMatch: stored?.runtimeMatch ?? null,
        };
      }

      logger.error('Sourcify verification failed', {
        address,
        customCode: job.error.customCode,
        message: job.error.message,
      });

      return {
        ...base,
        success: false,
        status: 'failed',
        message: this.explainFailure(job.error, submission),
        customCode: job.error.customCode,
        match: job.contract?.match ?? null,
        creationMatch: job.contract?.creationMatch ?? null,
        runtimeMatch: job.contract?.runtimeMatch ?? null,
      };
    }

    const mapped = mapSourcifyMatch(job.contract?.match ?? null);
    if (mapped === 'not_verified') {
      return {
        ...base,
        success: false,
        status: 'failed',
        message: 'Sourcify completed the job without recording a match.',
        match: job.contract?.match ?? null,
        creationMatch: job.contract?.creationMatch ?? null,
        runtimeMatch: job.contract?.runtimeMatch ?? null,
      };
    }

    logger.info('Contract verified on Sourcify', {
      address,
      status: mapped,
      chainId: base.chainId,
    });

    return {
      ...base,
      success: true,
      status: mapped,
      match: job.contract?.match ?? null,
      creationMatch: job.contract?.creationMatch ?? null,
      runtimeMatch: job.contract?.runtimeMatch ?? null,
    };
  }

  /** Add an actionable hint to the raw Sourcify error message. */
  private explainFailure(
    error: { customCode?: string; message: string },
    submission: VerificationSubmission
  ): string {
    const base = error.customCode ? `${error.message} (${error.customCode})` : error.message;
    if (error.customCode === 'no_match') {
      return (
        `${base} The submitted sources compile, but the result does not match the deployed ` +
        `bytecode. This usually means the compiler settings differ. Submitted compiler ` +
        `${submission.compilerVersion} with settings ` +
        `${JSON.stringify(submission.stdJsonInput.settings ?? {})}. Pass buildInfoPath ` +
        `(Hardhat, artifacts/build-info/*.json) or artifactPath (Foundry, out/<Source>.sol/<Contract>.json) ` +
        `so the exact settings are used.`
      );
    }
    return base;
  }

  // ---------------------------------------------------------------------------
  // Input paths
  // ---------------------------------------------------------------------------

  /**
   * Read a Hardhat build-info file and turn it into a submission.
   */
  async readHardhatBuildInfo(
    buildInfoPath: string,
    contractName: string,
    creationTransactionHash?: string
  ): Promise<VerificationSubmission> {
    let buildInfo: any;
    try {
      buildInfo = JSON.parse(await fs.readFile(buildInfoPath, 'utf-8'));
    } catch (error: any) {
      throw new Error(`Failed to read build-info file ${buildInfoPath}: ${error.message}`);
    }
    return buildSubmissionFromBuildInfo(buildInfo, contractName, creationTransactionHash);
  }

  /**
   * Read a Foundry artifact and turn it into a submission.
   *
   * Foundry metadata lists source paths relative to the project root but stores only
   * their hashes, so the files are read from disk. The root is inferred from the
   * artifact path (`<root>/out/<Source>.sol/<Contract>.json`) with the working
   * directory as a fallback.
   */
  async readFoundryArtifact(
    artifactPath: string,
    contractName: string,
    creationTransactionHash?: string
  ): Promise<VerificationSubmission> {
    let artifact: any;
    try {
      artifact = JSON.parse(await fs.readFile(artifactPath, 'utf-8'));
    } catch (error: any) {
      throw new Error(`Failed to read artifact file ${artifactPath}: ${error.message}`);
    }

    const sourcePaths = Object.keys(artifact?.metadata?.sources ?? {});
    const sourceContents = await this.readProjectSources(artifactPath, sourcePaths);

    return buildSubmissionFromFoundryArtifact(
      artifact,
      contractName,
      sourceContents,
      creationTransactionHash
    );
  }

  /**
   * Resolve source paths against the candidate project roots for a Foundry artifact.
   */
  private async readProjectSources(
    artifactPath: string,
    sourcePaths: string[]
  ): Promise<Record<string, string>> {
    if (sourcePaths.length === 0) return {};

    const artifactDir = path.dirname(path.resolve(artifactPath));
    const candidates = [
      path.resolve(artifactDir, '..', '..'), // <root>/out/<Source>.sol/<Contract>.json
      path.resolve(artifactDir, '..'),
      artifactDir,
      process.cwd(),
    ];

    const contents: Record<string, string> = {};
    for (const sourcePath of sourcePaths) {
      let found = false;
      for (const root of candidates) {
        try {
          contents[sourcePath] = await fs.readFile(path.resolve(root, sourcePath), 'utf-8');
          found = true;
          break;
        } catch {
          // try the next candidate root
        }
      }
      if (!found) {
        logger.warn('Could not locate source file for verification', { sourcePath });
      }
    }
    return contents;
  }

  /**
   * Read one .sol file, or every .sol file in a directory, keyed by path.
   */
  async readSources(filePath: string): Promise<Record<string, string>> {
    const stats = await fs.stat(filePath);
    const sources: Record<string, string> = {};

    if (stats.isDirectory()) {
      const entries = await fs.readdir(filePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.sol')) {
          sources[entry.name] = await fs.readFile(path.join(filePath, entry.name), 'utf-8');
        }
      }
      if (Object.keys(sources).length === 0) {
        throw new Error(`No .sol files found in ${filePath}`);
      }
    } else {
      sources[path.basename(filePath)] = await fs.readFile(filePath, 'utf-8');
    }

    return sources;
  }

  /**
   * Fetch and cache the official solc release index.
   */
  async getSolcReleases(): Promise<Record<string, string>> {
    if (this.solcReleases) return this.solcReleases;

    const response = await fetch(SOLC_RELEASES_URL, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch the solc release list: HTTP ${response.status}`);
    }
    const data: any = await response.json();
    this.solcReleases = data?.releases ?? {};
    return this.solcReleases as Record<string, string>;
  }

  /**
   * Work out the full compiler version to submit.
   *
   * Uses the caller's value when given, otherwise resolves the first version literal in
   * the source pragma against the solc release index. A pragma range such as `^0.8.20`
   * resolves to 0.8.20, which is a guess: the contract may have been compiled with a
   * later 0.8.x. The resolved version is reported back in the result.
   */
  async resolveCompilerVersion(
    sourceContents: Record<string, string>,
    override?: string
  ): Promise<string> {
    if (override) {
      const normalized = normalizeCompilerVersion(override);
      if (isFullCompilerVersion(normalized)) return normalized;
      const releases = await this.getSolcReleases();
      const release = releases[normalized];
      if (!release) {
        throw new Error(
          `Unknown Solidity version "${override}". Pass a released version such as 0.8.28, ` +
            `or the full form 0.8.28+commit.7893614a.`
        );
      }
      return normalizeCompilerVersion(release);
    }

    let pragmaVersion: string | undefined;
    for (const content of Object.values(sourceContents)) {
      pragmaVersion = parsePragmaVersion(content);
      if (pragmaVersion) break;
    }

    if (!pragmaVersion) {
      throw new Error(
        'Could not determine the Solidity compiler version: no `pragma solidity` found. ' +
          'Pass compilerVersion, or use buildInfoPath / artifactPath so the exact compiler is read ' +
          'from the build output.'
      );
    }

    const releases = await this.getSolcReleases();
    const release = releases[pragmaVersion];
    if (!release) {
      throw new Error(
        `Solidity ${pragmaVersion} (from the source pragma) is not a published release. ` +
          `Pass compilerVersion explicitly.`
      );
    }
    return normalizeCompilerVersion(release);
  }

  /**
   * Verify a contract from raw sources.
   *
   * Prefer buildInfoPath or artifactPath: they carry the exact compiler settings, which
   * this path has to assume.
   */
  async verifyFromSources(
    address: string,
    network: HederaNetwork,
    sourceContents: Record<string, string>,
    contractName: string,
    overrides: CompilerSettingsOverrides = {},
    creationTransactionHash?: string
  ): Promise<VerificationResult> {
    const compilerVersion = await this.resolveCompilerVersion(
      sourceContents,
      overrides.compilerVersion
    );
    const submission = buildSubmissionFromSources(
      sourceContents,
      contractName,
      compilerVersion,
      overrides,
      creationTransactionHash
    );
    return this.verifyWithStandardJson(address, network, submission);
  }

  /**
   * Verify a contract, choosing the input path from what the caller supplied.
   */
  async verifyContract(options: {
    address: string;
    network: HederaNetwork;
    contractName: string;
    filePath?: string;
    buildInfoPath?: string;
    artifactPath?: string;
    creatorTxHash?: string;
    compilerSettings?: CompilerSettingsOverrides;
  }): Promise<VerificationResult> {
    const chainId = this.getChainId(options.network);

    try {
      if (options.buildInfoPath) {
        const submission = await this.readHardhatBuildInfo(
          options.buildInfoPath,
          options.contractName,
          options.creatorTxHash
        );
        return await this.verifyWithStandardJson(options.address, options.network, submission);
      }

      if (options.artifactPath) {
        const submission = await this.readFoundryArtifact(
          options.artifactPath,
          options.contractName,
          options.creatorTxHash
        );
        return await this.verifyWithStandardJson(options.address, options.network, submission);
      }

      if (!options.filePath) {
        throw new Error('Provide filePath, buildInfoPath or artifactPath to verify a contract.');
      }

      const sources = await this.readSources(options.filePath);
      return await this.verifyFromSources(
        options.address,
        options.network,
        sources,
        options.contractName,
        options.compilerSettings ?? {},
        options.creatorTxHash
      );
    } catch (error: any) {
      logger.error('Contract verification failed', {
        address: options.address,
        error: error?.message,
      });
      return {
        success: false,
        address: options.address,
        chainId,
        status: 'failed',
        message: error?.message ?? String(error),
      };
    }
  }

  /**
   * HashScan contract page. HashScan reads verification state from Sourcify, so this
   * link shows the verified badge once Sourcify has the contract.
   */
  getContractUrl(address: string, network: HederaNetwork): string {
    return `https://hashscan.io/${network}/contract/${address}`;
  }
}

// Export singleton instance
export const hashScanService = new HashScanService();
