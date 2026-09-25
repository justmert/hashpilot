/**
 * Hardhat Service
 *
 * Drives the Hardhat CLI that is installed in the user's project (the same
 * binary `npx hardhat` would run) instead of loading Hardhat into the MCP
 * server process. The server therefore works with whichever Hardhat major
 * the project uses (2 or 3) and never ships its own copy of Hardhat.
 *
 * Contract interaction (deploy, call, execute) does not go through Hardhat
 * at all: it reads compiled artifacts from disk and talks to the Hedera
 * JSON-RPC relay through `jsonRpcService`, signing with the MCP operator key
 * or an explicitly supplied key.
 */

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { Wallet, formatEther } from 'ethers';
import logger from '../utils/logger.js';
import { jsonRpcService } from './json-rpc-service.js';
import { hederaClient } from './hedera-client.js';
import { getHederaConfig } from '../utils/config.js';
import {
  getChainId,
  getDeploymentEnvVars,
  getNetworkEnvVarName,
  parseOperatorKey,
} from '../utils/key-converter.js';

/** Hard cap on captured stdout+stderr of a Hardhat run */
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
/** Default wall-clock limit for a Hardhat run */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
/** How much output to keep in results and error messages */
const OUTPUT_TAIL_CHARS = 4000;

const CONFIG_FILE_NAMES = [
  'hardhat.config.js',
  'hardhat.config.ts',
  'hardhat.config.cjs',
  'hardhat.config.mjs',
  'hardhat.config.cts',
  'hardhat.config.mts',
];

/**
 * Compilation result
 */
export interface CompilationResult {
  success: boolean;
  /** Artifact JSON files relative to the project root */
  artifacts?: string[];
  errors?: string[];
  warnings?: string[];
  /** Tail of the compiler output */
  output?: string;
}

/**
 * Test result
 */
export interface TestResult {
  success: boolean;
  passed?: number;
  failed?: number;
  skipped?: number;
  /** Duration reported by mocha, in milliseconds */
  duration?: number;
  gasReport?: any;
  failures?: Array<{
    test: string;
    error: string;
  }>;
  /** Tail of the test runner output */
  output?: string;
}

/**
 * Deployment result
 */
export interface DeploymentResult {
  success: boolean;
  address?: string;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  constructorArgs?: any[];
  /** Address that signed the deployment */
  deployer?: string;
  network?: string;
  /** 'json-rpc' for artifact deployments, 'script' for `hardhat run` */
  method?: 'json-rpc' | 'script';
  /** Tail of the script output (script deployments only) */
  output?: string;
}

/**
 * Artifact info
 */
export interface ArtifactInfo {
  contractName: string;
  abi: any[];
  bytecode: string;
  deployedBytecode: string;
  sourceName: string;
}

/**
 * Result of one Hardhat CLI invocation
 */
export interface HardhatCommandResult {
  /** Human-readable command, e.g. `hardhat compile --force` */
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * A task or subtask listed by `hardhat --help`
 */
export interface HardhatTask {
  name: string;
  description: string;
  kind: 'task' | 'subtask' | 'scope';
}

/**
 * An account the server can sign with
 */
export interface HardhatAccount {
  address: string;
  /** Balance in HBAR (decimal string) */
  balance: string;
  balanceWei: string;
  source: 'operator';
  operatorId?: string;
}

/**
 * Thrown when Hardhat exits with a non-zero code, times out, or floods output.
 * Carries the captured output so callers can surface it.
 */
export class HardhatCommandError extends Error {
  constructor(
    message: string,
    public readonly result: HardhatCommandResult
  ) {
    super(message);
    this.name = 'HardhatCommandError';
  }
}

/* -------------------------------------------------------------------------- */
/*  Pure helpers (exported for unit tests)                                     */
/* -------------------------------------------------------------------------- */

/** Remove ANSI colour/cursor escape sequences */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

/** Last `chars` characters of a string, with a marker when truncated */
export function tail(text: string, chars = OUTPUT_TAIL_CHARS): string {
  const clean = stripAnsi(text).trimEnd();
  if (clean.length <= chars) {
    return clean;
  }
  return `…[${clean.length - chars} chars omitted]\n${clean.slice(-chars)}`;
}

/** Convert a mocha duration such as `18ms`, `2s`, `1m` to milliseconds */
function durationToMs(value: string, unit: string): number {
  const n = Number(value);
  switch (unit) {
    case 'ms':
      return n;
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    default:
      return n;
  }
}

/**
 * Parse the summary printed by mocha (`N passing (2s)`, `N failing`,
 * `N pending`) and by the Hardhat 3 Solidity test runner
 * (`N tests passed, N failed, N skipped`). Failure blocks (`1) Suite
 * test title: Error...`) are collected into `failures`.
 */
export function parseTestOutput(rawOutput: string): {
  passed: number;
  failed: number;
  skipped: number;
  duration?: number;
  failures: Array<{ test: string; error: string }>;
  found: boolean;
} {
  const output = stripAnsi(rawOutput);
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let duration: number | undefined;
  let found = false;

  const passing = /(\d+) passing(?: \((\d+(?:\.\d+)?)(ms|s|m)\))?/.exec(output);
  if (passing) {
    found = true;
    passed += Number(passing[1]);
    if (passing[2] && passing[3]) {
      duration = durationToMs(passing[2], passing[3]);
    }
  }
  const failing = /(\d+) failing/.exec(output);
  if (failing) {
    found = true;
    failed += Number(failing[1]);
  }
  const pending = /(\d+) pending/.exec(output);
  if (pending) {
    found = true;
    skipped += Number(pending[1]);
  }

  // Hardhat 3 Solidity tests: "Ran 1 test suite ...: 2 tests passed, 1 failed, 0 skipped (3 total tests)"
  const solidity = /(\d+) tests? passed, (\d+) failed, (\d+) skipped/.exec(output);
  if (solidity) {
    found = true;
    passed += Number(solidity[1]);
    failed += Number(solidity[2]);
    skipped += Number(solidity[3]);
  }

  return { passed, failed, skipped, duration, failures: parseMochaFailures(output), found };
}

/** Extract mocha failure blocks that follow the `N failing` line */
function parseMochaFailures(output: string): Array<{ test: string; error: string }> {
  const lines = output.split('\n');
  const start = lines.findIndex((line) => /^\s*\d+ failing\b/.test(line));
  if (start === -1) {
    return [];
  }

  const failures: Array<{ test: string; error: string }> = [];
  let current: { titleLines: string[]; errorLines: string[]; inTitle: boolean } | null = null;

  const flush = (): void => {
    if (!current) return;
    const test = current.titleLines.join(' ').replace(/:$/, '').trim();
    const error = current.errorLines
      .filter((line) => !/^\s*at /.test(line))
      .join('\n')
      .trim()
      .slice(0, 1000);
    if (test) {
      failures.push({ test, error });
    }
    current = null;
  };

  for (const line of lines.slice(start + 1)) {
    const header = /^\s*(\d+)\) (.*)$/.exec(line);
    if (header) {
      flush();
      current = { titleLines: [header[2].trim()], errorLines: [], inTitle: true };
      continue;
    }
    if (!current) continue;
    if (current.inTitle) {
      if (line.trim() === '') {
        current.inTitle = false;
      } else {
        current.titleLines.push(line.trim());
      }
      continue;
    }
    current.errorLines.push(line.replace(/^\s{4,}/, ''));
  }
  flush();
  return failures;
}

/**
 * Parse the task table printed by `hardhat --help`. Handles Hardhat 2
 * ("AVAILABLE TASKS:", "AVAILABLE TASK SCOPES:") and Hardhat 3
 * ("AVAILABLE TASKS:", "AVAILABLE SUBTASKS:").
 */
export function parseTaskList(helpText: string): HardhatTask[] {
  const tasks: HardhatTask[] = [];
  let kind: HardhatTask['kind'] | null = null;

  for (const rawLine of stripAnsi(helpText).split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const section = /^AVAILABLE (TASKS|SUBTASKS|TASK SCOPES)\b/i.exec(line.trim());
    if (section) {
      const which = section[1].toUpperCase();
      kind = which === 'TASKS' ? 'task' : which === 'SUBTASKS' ? 'subtask' : 'scope';
      continue;
    }
    // Any other upper-case header ends the current section
    if (/^[A-Z][A-Z ]+:?\s*$/.test(line.trim()) && line.trim().length > 0) {
      kind = null;
      continue;
    }
    if (!kind) continue;

    const entry = /^\s{2,}(\S(?:.*?\S)?)\s{2,}(\S.*)$/.exec(line);
    if (entry) {
      tasks.push({ name: entry[1], description: entry[2].trim(), kind });
    }
  }
  return tasks;
}

/**
 * Find EVM addresses in deployment output. `named` holds Ignition-style
 * `Module#Contract - 0x…` lines; `addresses` is every 0x address seen, in
 * order, with a "deployed to/at" match preferred as `primary`.
 */
export function parseDeployedAddresses(rawOutput: string): {
  primary?: string;
  addresses: string[];
  named: Record<string, string>;
} {
  const output = stripAnsi(rawOutput);
  const named: Record<string, string> = {};
  for (const match of output.matchAll(/^\s*(\S+#\S+)\s+-\s+(0x[0-9a-fA-F]{40})\s*$/gm)) {
    named[match[1]] = match[2];
  }
  const addresses = Array.from(output.matchAll(/0x[0-9a-fA-F]{40}/g), (m) => m[0]);
  const deployedTo = /deployed (?:to|at)[:\s]+(0x[0-9a-fA-F]{40})/i.exec(output);
  const primary =
    deployedTo?.[1] ??
    Object.values(named)[0] ??
    (addresses.length > 0 ? addresses[addresses.length - 1] : undefined);
  return { primary, addresses: Array.from(new Set(addresses)), named };
}

/**
 * Convert a Hedera entity ID (0.0.x) to its long-zero EVM address; pass
 * 0x addresses through unchanged.
 */
export function toEvmAddress(address: string): string {
  const trimmed = (address || '').trim();
  const entity = /^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (entity) {
    const [shard, realm, num] = entity.slice(1).map((n) => BigInt(n));
    return (
      '0x' +
      shard.toString(16).padStart(8, '0') +
      realm.toString(16).padStart(16, '0') +
      num.toString(16).padStart(16, '0')
    );
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^[0-9a-fA-F]{40}$/.test(trimmed)) {
    return `0x${trimmed}`;
  }
  throw new Error(
    `Invalid contract address "${address}": expected a 0x EVM address or a Hedera entity ID (0.0.x)`
  );
}

/**
 * Make an ethers result JSON-serialisable: BigInt -> decimal string, named
 * `Result` tuples -> plain objects, everything else recursively copied.
 */
export function toPlainValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    const maybeResult = value as unknown as { toObject?: () => Record<string, unknown> };
    if (typeof maybeResult.toObject === 'function') {
      try {
        const obj = maybeResult.toObject();
        if (obj && Object.keys(obj).length === value.length && value.length > 0) {
          return toPlainValue(obj);
        }
      } catch {
        // unnamed outputs; fall through to array form
      }
    }
    return value.map(toPlainValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = toPlainValue(entry);
    }
    return out;
  }
  return value;
}

/** Wei amount (decimal or hex string, number, bigint) as a 0x quantity */
export function toHexQuantity(value: string | number | bigint): string {
  const big = typeof value === 'string' ? BigInt(value.trim()) : BigInt(value);
  if (big < 0n) {
    throw new Error('value must not be negative');
  }
  return `0x${big.toString(16)}`;
}

/** camelCase -> kebab-case for CLI flags */
function toKebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^-/, '');
}

/**
 * Turn task parameters into CLI arguments. Objects become `--flag value`
 * pairs (`true` -> bare flag, `false`/null -> omitted, arrays -> repeated);
 * an array, or the `_` / `args` keys, become positional arguments.
 */
export function paramsToArgs(params?: Record<string, unknown> | unknown[] | null): string[] {
  if (!params) return [];
  if (Array.isArray(params)) {
    return params.map((p) => String(p));
  }
  const flags: string[] = [];
  const positional: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === '_' || key === 'args' || key === 'positional') {
      const list = Array.isArray(value) ? value : [value];
      positional.push(...list.map((p) => String(p)));
      continue;
    }
    const flag = key.startsWith('-') ? key : `--${toKebab(key)}`;
    if (value === true) {
      flags.push(flag);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        flags.push(flag, String(item));
      }
    } else {
      flags.push(flag, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  }
  return [...flags, ...positional];
}

/**
 * Read compiled artifacts from a Hardhat `artifacts/` directory without
 * loading Hardhat. Skips `build-info/` and `*.dbg.json`. `contractName`
 * may be a bare name or a fully qualified `path/File.sol:Name`.
 */
export async function readArtifactsFromDir(
  artifactsDir: string,
  contractName?: string
): Promise<ArtifactInfo[]> {
  const files = await listArtifactFiles(artifactsDir);
  const artifacts: ArtifactInfo[] = [];

  let wantedSource: string | undefined;
  let wantedName = contractName?.trim();
  if (wantedName && wantedName.includes(':')) {
    const idx = wantedName.lastIndexOf(':');
    wantedSource = wantedName.slice(0, idx);
    wantedName = wantedName.slice(idx + 1);
  }

  for (const file of files) {
    let parsed: any;
    try {
      parsed = JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch (error) {
      logger.debug('Skipping unreadable artifact', { file, error });
      continue;
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.contractName !== 'string' ||
      !Array.isArray(parsed.abi) ||
      typeof parsed.bytecode !== 'string'
    ) {
      continue;
    }
    if (wantedName && parsed.contractName !== wantedName) continue;
    if (wantedSource && parsed.sourceName !== wantedSource) continue;

    artifacts.push({
      contractName: parsed.contractName,
      abi: parsed.abi,
      bytecode: parsed.bytecode,
      deployedBytecode: typeof parsed.deployedBytecode === 'string' ? parsed.deployedBytecode : '',
      sourceName: typeof parsed.sourceName === 'string' ? parsed.sourceName : '',
    });
  }

  return artifacts.sort((a, b) =>
    `${a.sourceName}:${a.contractName}`.localeCompare(`${b.sourceName}:${b.contractName}`)
  );
}

/** All contract artifact JSON files under `artifactsDir` (no build-info, no *.dbg.json) */
export async function listArtifactFiles(artifactsDir: string): Promise<string[]> {
  if (!existsSync(artifactsDir)) {
    return [];
  }
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'build-info') continue;
        await walk(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.json') &&
        !entry.name.endsWith('.dbg.json')
      ) {
        found.push(full);
      }
    }
  };
  await walk(artifactsDir);
  return found.sort();
}

/* -------------------------------------------------------------------------- */
/*  Service                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Hardhat Service for smart contract development
 */
export class HardhatService {
  /**
   * Detect Hardhat project in directory tree
   */
  async detectHardhatProject(startDir?: string): Promise<string | null> {
    const start = startDir || process.cwd();
    let currentDir = path.resolve(start);

    // Walk up the tree (including the filesystem root) looking for a config file
    for (;;) {
      for (const name of CONFIG_FILE_NAMES) {
        if (existsSync(path.join(currentDir, name))) {
          logger.info('Hardhat project detected', { projectRoot: currentDir });
          return currentDir;
        }
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }

    logger.warn('No Hardhat project found', { searchStarted: start });
    return null;
  }

  /**
   * Resolve the project root or throw a descriptive error
   */
  private async requireProjectRoot(directory?: string): Promise<string> {
    const root = await this.detectHardhatProject(directory);
    if (!root) {
      throw new Error(
        `No Hardhat project found at or above ${directory || process.cwd()} ` +
          '(looked for hardhat.config.{js,ts,cjs,mjs}). Pass the project directory, ' +
          'or create one with hardhat_project init.'
      );
    }
    return root;
  }

  /**
   * Locate the Hardhat CLI entry point installed for the project (walks up
   * node_modules so hoisted monorepo installs work).
   */
  private resolveHardhatBin(projectRoot: string): string {
    let dir = projectRoot;
    for (;;) {
      const pkgPath = path.join(dir, 'node_modules', 'hardhat', 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.hardhat;
        if (typeof bin === 'string') {
          return path.join(path.dirname(pkgPath), bin);
        }
        throw new Error(`hardhat package at ${path.dirname(pkgPath)} has no CLI entry point`);
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(
      `Hardhat is not installed for the project at ${projectRoot}. ` +
        'Run `npm install` in the project (or `npm install --save-dev hardhat`) and retry.'
    );
  }

  /**
   * Environment for the Hardhat child process: the server's environment,
   * filled in with the operator credentials as <NETWORK>_PRIVATE_KEY /
   * <NETWORK>_RPC_URL (never overriding values already set), colour
   * disabled so output can be parsed.
   */
  private buildEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };

    let deploymentEnv: Record<string, string> = {};
    try {
      deploymentEnv = getDeploymentEnvVars();
    } catch (error) {
      logger.warn('Operator credentials not injected into Hardhat environment', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const config = getHederaConfig();
    if (config.jsonRpcRelayUrl && config.network) {
      deploymentEnv[getNetworkEnvVarName(config.network, 'RPC_URL')] = config.jsonRpcRelayUrl;
    }
    for (const [key, value] of Object.entries(deploymentEnv)) {
      if (env[key] === undefined || env[key] === '') {
        env[key] = value;
      }
    }

    Object.assign(env, extraEnv);
    env.FORCE_COLOR = '0';
    env.NO_COLOR = '1';
    env.HARDHAT_DISABLE_TELEMETRY_PROMPT = 'true';
    return env;
  }

  /**
   * Run the project's Hardhat CLI. Resolves with the captured output; throws
   * HardhatCommandError on a non-zero exit (unless `allowFailure`), on
   * timeout, or when output exceeds the buffer cap.
   */
  private async runHardhat(
    args: string[],
    projectRoot: string,
    extraEnv?: Record<string, string>,
    options: { allowFailure?: boolean; timeoutMs?: number } = {}
  ): Promise<HardhatCommandResult> {
    const bin = this.resolveHardhatBin(projectRoot);
    const command = `hardhat ${args.join(' ')}`;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const env = this.buildEnv(extraEnv);
    const started = Date.now();

    logger.info('Running Hardhat', { command, projectRoot });

    const result = await new Promise<HardhatCommandResult>((resolve, reject) => {
      const child = spawn(process.execPath, [bin, ...args], {
        cwd: projectRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let bytes = 0;
      let abort: 'timeout' | 'output' | null = null;

      const collect =
        (target: 'stdout' | 'stderr') =>
        (chunk: Buffer): void => {
          bytes += chunk.length;
          if (bytes > MAX_OUTPUT_BYTES) {
            if (!abort) {
              abort = 'output';
              child.kill('SIGKILL');
            }
            return;
          }
          if (target === 'stdout') stdout += chunk.toString();
          else stderr += chunk.toString();
        };
      child.stdout?.on('data', collect('stdout'));
      child.stderr?.on('data', collect('stderr'));

      const timer = setTimeout(() => {
        abort = 'timeout';
        child.kill('SIGKILL');
      }, timeoutMs);

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`Failed to start ${command}: ${error.message}`));
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        const outcome: HardhatCommandResult = {
          command,
          exitCode: code ?? (signal ? -1 : 0),
          stdout,
          stderr,
          durationMs: Date.now() - started,
        };
        if (abort === 'timeout') {
          reject(
            new HardhatCommandError(
              `${command} timed out after ${Math.round(timeoutMs / 1000)}s\n${tail(stderr || stdout)}`,
              outcome
            )
          );
        } else if (abort === 'output') {
          reject(
            new HardhatCommandError(
              `${command} produced more than ${MAX_OUTPUT_BYTES / (1024 * 1024)} MB of output and was stopped`,
              outcome
            )
          );
        } else {
          resolve(outcome);
        }
      });
    });

    logger.info('Hardhat finished', {
      command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });

    if (result.exitCode !== 0 && !options.allowFailure) {
      const detail = tail(result.stderr.trim() ? result.stderr : result.stdout);
      throw new HardhatCommandError(
        `${command} exited with code ${result.exitCode}${detail ? `:\n${detail}` : ''}`,
        result
      );
    }
    return result;
  }

  /**
   * Compile contracts (`hardhat compile [--force]`)
   */
  async compile(options: { force?: boolean } = {}, directory?: string): Promise<CompilationResult> {
    const projectRoot = await this.requireProjectRoot(directory);
    const args = ['compile'];
    if (options.force) args.push('--force');

    let run: HardhatCommandResult;
    try {
      run = await this.runHardhat(args, projectRoot);
    } catch (error) {
      if (error instanceof HardhatCommandError) {
        logger.error('Compilation failed', { command: error.result.command });
        return {
          success: false,
          errors: [error.message],
          output: tail(`${error.result.stdout}\n${error.result.stderr}`),
        };
      }
      throw error;
    }

    const combined = stripAnsi(`${run.stdout}\n${run.stderr}`);
    const warnings = combined
      .split('\n')
      .filter((line) => /warning/i.test(line))
      .map((line) => line.trim());
    const files = await listArtifactFiles(path.join(projectRoot, 'artifacts'));

    logger.info('Compilation successful', { artifactCount: files.length });
    return {
      success: true,
      artifacts: files.map((file) => path.relative(projectRoot, file)),
      warnings: warnings.length > 0 ? warnings : undefined,
      output: tail(combined, 2000),
    };
  }

  /**
   * Clean cache and artifacts (`hardhat clean`)
   */
  async clean(directory?: string): Promise<{ output: string }> {
    const projectRoot = await this.requireProjectRoot(directory);
    const run = await this.runHardhat(['clean'], projectRoot);
    return { output: tail(`${run.stdout}\n${run.stderr}`, 2000) };
  }

  /**
   * Run tests (`hardhat test [files] [--grep x] [--network n]`)
   */
  async test(
    options: { testFiles?: string[]; grep?: string; network?: string } = {},
    directory?: string
  ): Promise<TestResult> {
    const projectRoot = await this.requireProjectRoot(directory);
    const args = ['test'];
    if (options.network) args.push('--network', options.network);
    if (options.grep) args.push('--grep', options.grep);
    if (options.testFiles?.length) args.push(...options.testFiles);

    let run: HardhatCommandResult;
    try {
      run = await this.runHardhat(args, projectRoot, undefined, { allowFailure: true });
    } catch (error) {
      if (error instanceof HardhatCommandError) {
        return {
          success: false,
          failures: [{ test: error.result.command, error: error.message }],
          output: tail(`${error.result.stdout}\n${error.result.stderr}`),
        };
      }
      throw error;
    }

    const combined = `${run.stdout}\n${run.stderr}`;
    const parsed = parseTestOutput(combined);
    const success = run.exitCode === 0;

    const failures = parsed.failures.length > 0 ? parsed.failures : undefined;
    const result: TestResult = {
      success,
      passed: parsed.found ? parsed.passed : undefined,
      failed: parsed.found ? parsed.failed : undefined,
      skipped: parsed.found ? parsed.skipped : undefined,
      duration: parsed.duration,
      failures:
        !success && !failures
          ? [{ test: run.command, error: tail(run.stderr.trim() ? run.stderr : run.stdout) }]
          : failures,
      output: tail(combined),
    };

    logger.info('Tests completed', {
      success,
      passed: result.passed,
      failed: result.failed,
      skipped: result.skipped,
    });
    return result;
  }

  /**
   * Flatten contracts (`hardhat flatten [files]`); returns the flattened source
   */
  async flatten(files?: string[], directory?: string): Promise<string> {
    const projectRoot = await this.requireProjectRoot(directory);
    const run = await this.runHardhat(['flatten', ...(files || [])], projectRoot);
    return run.stdout;
  }

  /**
   * Get compiled artifacts from disk (no Hardhat involved)
   */
  async getArtifacts(contractName?: string, directory?: string): Promise<ArtifactInfo[]> {
    const projectRoot = await this.requireProjectRoot(directory);
    const artifactsDir = path.join(projectRoot, 'artifacts');
    if (!existsSync(artifactsDir)) {
      throw new Error(
        `No artifacts directory at ${artifactsDir}. Run hardhat_project compile first.`
      );
    }

    const artifacts = await readArtifactsFromDir(artifactsDir, contractName);
    if (contractName && artifacts.length === 0) {
      throw new Error(
        `No compiled artifact named "${contractName}" under ${artifactsDir}. ` +
          'Check the contract name (or use "path/File.sol:Name") and compile first.'
      );
    }
    return artifacts;
  }

  /**
   * Load exactly one artifact for a contract name
   */
  private async requireArtifact(contractName: string, directory?: string): Promise<ArtifactInfo> {
    const artifacts = await this.getArtifacts(contractName, directory);
    if (artifacts.length > 1) {
      const names = artifacts.map((a) => `${a.sourceName}:${a.contractName}`).join(', ');
      throw new Error(
        `Contract name "${contractName}" is ambiguous (${names}). Use the fully qualified name.`
      );
    }
    return artifacts[0];
  }

  /**
   * Resolve an ABI from an explicit array or a compiled contract name
   */
  private async resolveAbi(options: {
    abi?: any[];
    contractName?: string;
    directory?: string;
  }): Promise<any[]> {
    if (Array.isArray(options.abi) && options.abi.length > 0) {
      return options.abi;
    }
    if (options.contractName) {
      return (await this.requireArtifact(options.contractName, options.directory)).abi;
    }
    throw new Error('Provide either an abi array or a contractName (compiled in the project)');
  }

  /**
   * Get verification metadata file (newest build-info JSON). Hardhat 3
   * writes `<id>.json` (compiler input) and `<id>.output.json`; the input
   * file is the one verification services need.
   */
  async getVerificationFile(directory?: string): Promise<string | null> {
    try {
      const projectRoot = await this.detectHardhatProject(directory);
      if (!projectRoot) {
        return null;
      }

      const buildInfoDir = path.join(projectRoot, 'artifacts', 'build-info');
      if (!existsSync(buildInfoDir)) {
        return null;
      }

      const files = (await fs.readdir(buildInfoDir)).filter(
        (f) => f.endsWith('.json') && !f.endsWith('.output.json')
      );
      if (files.length === 0) {
        return null;
      }

      const stats = await Promise.all(
        files.map(async (file) => {
          const filePath = path.join(buildInfoDir, file);
          const stat = await fs.stat(filePath);
          return { path: filePath, mtime: stat.mtime.getTime() };
        })
      );
      stats.sort((a, b) => b.mtime - a.mtime);
      return stats[0].path;
    } catch (error) {
      logger.error('Failed to get verification file', { error });
      return null;
    }
  }

  /**
   * Call a contract function (read-only) through the JSON-RPC relay
   */
  async callContract(options: {
    address: string;
    abi?: any[];
    contractName?: string;
    functionName: string;
    args?: any[];
    network?: string;
    directory?: string;
  }): Promise<unknown> {
    const abi = await this.resolveAbi(options);
    const network = this.resolveNetwork(options.network);
    const contractAddress = toEvmAddress(options.address);

    const result = await jsonRpcService.callContract({
      contractAddress,
      abi,
      functionName: options.functionName,
      args: options.args || [],
      network,
    });

    logger.info('Contract call successful', {
      address: contractAddress,
      functionName: options.functionName,
      network,
    });
    return toPlainValue(result);
  }

  /**
   * Execute a contract transaction (state-changing) through the JSON-RPC relay
   */
  async executeContract(options: {
    address: string;
    abi?: any[];
    contractName?: string;
    functionName: string;
    args?: any[];
    /** Wei, decimal or hex string */
    value?: string;
    gasLimit?: number;
    network?: string;
    privateKey?: string;
    directory?: string;
  }): Promise<{
    transactionHash: string;
    blockNumber?: number;
    gasUsed?: string;
    status: 'success' | 'failed';
    from: string;
    to: string | null;
    receipt: unknown;
  }> {
    const abi = await this.resolveAbi(options);
    const network = this.resolveNetwork(options.network);
    const contractAddress = toEvmAddress(options.address);

    const { transactionHash, receipt } = await jsonRpcService.executeContract({
      contractAddress,
      abi,
      functionName: options.functionName,
      args: options.args || [],
      value: options.value !== undefined ? toHexQuantity(options.value) : undefined,
      gasLimit: options.gasLimit,
      privateKey: options.privateKey,
      network,
    });

    logger.info('Transaction confirmed', {
      hash: transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    });

    return {
      transactionHash,
      blockNumber: receipt.blockNumber ? parseInt(receipt.blockNumber, 16) : undefined,
      gasUsed: receipt.gasUsed ? BigInt(receipt.gasUsed).toString() : undefined,
      status: receipt.status === '0x1' ? 'success' : 'failed',
      from: receipt.from,
      to: receipt.to,
      receipt,
    };
  }

  /**
   * Deploy a compiled contract through the JSON-RPC relay, or run a
   * deployment script with the project's Hardhat (`hardhat run <script>`).
   */
  async deploy(
    options: {
      contractName?: string;
      constructorArgs?: any[];
      network?: string;
      privateKey?: string;
      gasLimit?: number;
      /** Wei; only supported by script deployments */
      value?: string;
      deployScript?: string;
    },
    directory?: string
  ): Promise<DeploymentResult> {
    if (options.deployScript) {
      const network = options.network || hederaClient.getCurrentNetwork();
      const projectRoot = await this.requireProjectRoot(directory);
      const extraEnv: Record<string, string> = {};
      if (options.privateKey) {
        extraEnv[getNetworkEnvVarName(network, 'PRIVATE_KEY')] = options.privateKey;
      }
      const run = await this.runHardhat(
        ['run', options.deployScript, '--network', network],
        projectRoot,
        extraEnv
      );
      const found = parseDeployedAddresses(run.stdout);
      return {
        success: true,
        address: found.primary,
        network,
        method: 'script',
        output: tail(`${run.stdout}\n${run.stderr}`),
      };
    }

    if (!options.contractName) {
      throw new Error('Provide contractName (a compiled contract) or deployScript (a path)');
    }
    const network = this.resolveNetwork(options.network);
    if (options.value !== undefined && BigInt(options.value) > 0n) {
      throw new Error(
        'Sending HBAR with an artifact deployment is not supported; deploy through a script (deployScript) instead.'
      );
    }

    const artifact = await this.requireArtifact(options.contractName, directory);
    if (!artifact.bytecode || artifact.bytecode === '0x') {
      throw new Error(
        `${artifact.contractName} has no bytecode (abstract contract or interface) and cannot be deployed`
      );
    }

    logger.info('Deploying contract via JSON-RPC relay', {
      contractName: artifact.contractName,
      network,
      constructorArgs: options.constructorArgs,
    });

    const deployed = await jsonRpcService.deployContract({
      bytecode: artifact.bytecode,
      abi: artifact.abi,
      constructorArgs: options.constructorArgs || [],
      gasLimit: options.gasLimit,
      privateKey: options.privateKey,
      network,
    });

    return {
      success: true,
      address: deployed.contractAddress,
      transactionHash: deployed.transactionHash,
      blockNumber: deployed.receipt.blockNumber
        ? parseInt(deployed.receipt.blockNumber, 16)
        : undefined,
      gasUsed: deployed.receipt.gasUsed ? BigInt(deployed.receipt.gasUsed).toString() : undefined,
      constructorArgs: options.constructorArgs || [],
      deployer: deployed.receipt.from,
      network,
      method: 'json-rpc',
    };
  }

  /**
   * Deploy with Hardhat Ignition (`hardhat ignition deploy <module> --network n`)
   */
  async deployIgnition(
    options: {
      module: string;
      network?: string;
      /** Module parameters: an object (written to a temp file) or a JSON file path */
      parameters?: Record<string, unknown> | string;
      deploymentId?: string;
      reset?: boolean;
    },
    directory?: string
  ): Promise<{
    success: boolean;
    network: string;
    deploymentId?: string;
    addresses: Record<string, string>;
    output: string;
  }> {
    const projectRoot = await this.requireProjectRoot(directory);
    const network = options.network || hederaClient.getCurrentNetwork();
    const args = ['ignition', 'deploy', options.module, '--network', network];

    let tempFile: string | null = null;
    if (options.parameters !== undefined) {
      if (typeof options.parameters === 'string') {
        args.push('--parameters', options.parameters);
      } else {
        tempFile = path.join(
          await fs.mkdtemp(path.join(os.tmpdir(), 'hashpilot-ignition-')),
          'parameters.json'
        );
        await fs.writeFile(tempFile, JSON.stringify(options.parameters, null, 2));
        args.push('--parameters', tempFile);
      }
    }
    if (options.deploymentId) args.push('--deployment-id', options.deploymentId);
    if (options.reset) args.push('--reset');

    try {
      const run = await this.runHardhat(args, projectRoot);
      const parsed = parseDeployedAddresses(run.stdout);
      const addresses = { ...parsed.named };

      // Ignition also records addresses on disk; prefer that when present
      const deploymentId = options.deploymentId || `chain-${this.chainIdFor(network) ?? ''}`;
      const onDisk = path.join(
        projectRoot,
        'ignition',
        'deployments',
        deploymentId,
        'deployed_addresses.json'
      );
      if (existsSync(onDisk)) {
        try {
          Object.assign(addresses, JSON.parse(await fs.readFile(onDisk, 'utf-8')));
        } catch (error) {
          logger.debug('Could not read Ignition deployed_addresses.json', { onDisk, error });
        }
      }

      return {
        success: true,
        network,
        deploymentId: existsSync(onDisk) ? deploymentId : undefined,
        addresses,
        output: tail(`${run.stdout}\n${run.stderr}`),
      };
    } finally {
      if (tempFile) {
        await fs
          .rm(path.dirname(tempFile), { recursive: true, force: true })
          .catch(() => undefined);
      }
    }
  }

  /**
   * Accounts the server can sign with: the MCP operator's ECDSA key,
   * with its balance on the target network (via the JSON-RPC relay).
   */
  async getAccounts(
    _directory?: string,
    network?: string
  ): Promise<{ accounts: HardhatAccount[]; network: string; message?: string }> {
    const config = getHederaConfig();
    const targetNetwork = this.resolveNetwork(network);

    if (!config.operatorKey) {
      return {
        accounts: [],
        network: targetNetwork,
        message:
          'No operator key configured. Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY (an ECDSA key) ' +
          'in the MCP server environment; Hardhat deployments and transactions are signed with that key.',
      };
    }

    const parsed = parseOperatorKey(config.operatorKey);
    if (parsed.key.type === 'ED25519') {
      return {
        accounts: [],
        network: targetNetwork,
        message:
          'The operator key is ED25519. EVM transactions through the JSON-RPC relay need an ECDSA key; ' +
          'configure an ECDSA operator account or pass privateKey explicitly.',
      };
    }

    const wallet = new Wallet(`0x${parsed.key.toStringRaw()}`);
    const balanceHex: string = await jsonRpcService.call(
      'eth_getBalance',
      [wallet.address, 'latest'],
      targetNetwork
    );
    const balanceWei = BigInt(balanceHex);

    return {
      accounts: [
        {
          address: wallet.address,
          balance: formatEther(balanceWei),
          balanceWei: balanceWei.toString(),
          source: 'operator',
          operatorId: config.operatorId,
        },
      ],
      network: targetNetwork,
    };
  }

  /**
   * Run any Hardhat task (`hardhat <task> [--flag value ...]`)
   */
  async runTask(
    taskName: string,
    taskArgs?: Record<string, unknown> | unknown[] | null,
    directory?: string
  ): Promise<HardhatCommandResult> {
    const projectRoot = await this.requireProjectRoot(directory);
    const task = (taskName || '').trim();
    if (!task || !/^[\w:.-]+(?:\s+[\w:.-]+)*$/.test(task)) {
      throw new Error(`Invalid task name "${taskName}"`);
    }
    const args = [...task.split(/\s+/), ...paramsToArgs(taskArgs)];
    return this.runHardhat(args, projectRoot);
  }

  /**
   * List available tasks (`hardhat --help`)
   */
  async listTasks(directory?: string): Promise<HardhatTask[]> {
    const projectRoot = await this.requireProjectRoot(directory);
    const run = await this.runHardhat(['--help'], projectRoot);
    const tasks = parseTaskList(run.stdout);
    return tasks.length > 0 ? tasks : parseTaskList(run.stderr);
  }

  /**
   * Validate a network name, defaulting to the server's current network
   */
  private resolveNetwork(network?: string): string {
    const target = (network || hederaClient.getCurrentNetwork()).toLowerCase();
    getChainId(target); // throws for unknown networks
    return target;
  }

  private chainIdFor(network: string): number | undefined {
    try {
      return getChainId(network);
    } catch {
      return undefined;
    }
  }
}

/**
 * Global Hardhat service instance
 */
export const hardhatService = new HardhatService();
