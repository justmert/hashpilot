/**
 * Foundry Service
 * Provides programmatic access to Foundry development tools (forge, cast, anvil)
 * Supports compilation, testing, deployment, and contract interaction
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import logger from '../utils/logger.js';

/**
 * Compilation result
 */
export interface CompilationResult {
  success: boolean;
  artifacts?: string[];
  errors?: string[];
  warnings?: string[];
}

/**
 * Test result
 */
export interface TestResult {
  success: boolean;
  passed?: number;
  failed?: number;
  total?: number;
  duration?: number;
  gasReport?: string;
  failures?: Array<{
    test: string;
    error: string;
  }>;
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
  deployer?: string;
}

/**
 * Artifact info
 */
export interface ArtifactInfo {
  contractName: string;
  abi: any[];
  bytecode: string;
  deployedBytecode: string;
  metadata?: any;
}

/**
 * Script result
 */
export interface ScriptResult {
  success: boolean;
  transactions?: Array<{
    hash: string;
    contractAddress?: string;
    gasUsed?: string;
  }>;
  output?: string;
}

/**
 * Gas snapshot
 */
export interface GasSnapshot {
  success: boolean;
  snapshots: Record<string, number>;
  diff?: Record<string, number>;
}

/**
 * Build options
 */
export interface BuildOptions {
  force?: boolean;
  optimize?: boolean;
  optimizerRuns?: number;
  via_ir?: boolean;
}

/**
 * Test options
 */
export interface TestOptions {
  matchTest?: string;
  matchContract?: string;
  forkUrl?: string;
  gasReport?: boolean;
  verbosity?: number;
}

/**
 * Deploy options
 */
export interface DeployOptions {
  contractPath: string;
  constructorArgs?: string[];
  rpcUrl: string;
  privateKey: string;
  verify?: boolean;
  gasLimit?: number;
}

/**
 * Script options
 */
export interface ScriptOptions {
  broadcast?: boolean;
  rpcUrl?: string;
  privateKey?: string;
  verify?: boolean;
}

/**
 * Call options
 */
export interface CallOptions {
  address: string;
  signature: string;
  args?: string[];
  rpcUrl?: string;
  blockNumber?: string;
}

/**
 * Send options
 */
export interface SendOptions {
  address: string;
  signature: string;
  args?: string[];
  rpcUrl: string;
  privateKey: string;
  value?: string;
  gasLimit?: number;
}

/**
 * Foundry Service for smart contract development
 */
export class FoundryService {
  private projectRoot: string | null = null;
  private anvilProcess: ChildProcess | null = null;

  /**
   * Detect Foundry project in directory tree
   */
  async detectFoundryProject(startDir?: string): Promise<string | null> {
    const start = startDir || process.cwd();
    let currentDir = path.resolve(start);
    const root = path.parse(currentDir).root;

    // Walk up directory tree looking for foundry.toml
    while (currentDir !== root) {
      const foundryConfig = path.join(currentDir, 'foundry.toml');

      if (existsSync(foundryConfig)) {
        logger.info('Foundry project detected', { projectRoot: currentDir });
        this.projectRoot = currentDir;
        return currentDir;
      }

      currentDir = path.dirname(currentDir);
    }

    logger.warn('No Foundry project found');
    return null;
  }

  /**
   * Check if Foundry is installed
   */
  async checkFoundryInstalled(): Promise<boolean> {
    try {
      // Add Foundry bin directory to PATH for Node.js child_process
      const env = {
        ...process.env,
        PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}`,
      };
      execSync('forge --version', { env, stdio: 'pipe' });
      return true;
    } catch (error) {
      logger.error('Foundry not installed. Install via: curl -L https://foundry.paradigm.xyz | bash');
      return false;
    }
  }

  /**
   * Execute forge command
   */
  private async executeForgeCommand(args: string[], options?: { cwd?: string }): Promise<string> {
    const isInstalled = await this.checkFoundryInstalled();
    if (!isInstalled) {
      throw new Error('Foundry is not installed. Please install it first.');
    }

    const cwd = options?.cwd || this.projectRoot || process.cwd();

    try {
      logger.debug('Executing forge command', { args, cwd });
      // Add Foundry bin directory to PATH for Node.js child_process
      const env = {
        ...process.env,
        PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}`,
      };
      const output = execSync(`forge ${args.join(' ')}`, {
        cwd,
        env,
        encoding: 'utf-8',
        stdio: 'pipe',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });
      return output;
    } catch (error: any) {
      logger.error('Forge command failed', { error: error.message, stderr: error.stderr?.toString() });
      throw new Error(error.stderr?.toString() || error.message);
    }
  }

  /**
   * Execute cast command
   */
  private async executeCastCommand(args: string[], options?: { cwd?: string }): Promise<string> {
    const isInstalled = await this.checkFoundryInstalled();
    if (!isInstalled) {
      throw new Error('Foundry is not installed. Please install it first.');
    }

    const cwd = options?.cwd || this.projectRoot || process.cwd();

    try {
      logger.debug('Executing cast command', { args, cwd });
      // Add Foundry bin directory to PATH for Node.js child_process
      const env = {
        ...process.env,
        PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}`,
      };
      const output = execSync(`cast ${args.join(' ')}`, {
        cwd,
        env,
        encoding: 'utf-8',
        stdio: 'pipe',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });
      return output;
    } catch (error: any) {
      logger.error('Cast command failed', { error: error.message, stderr: error.stderr?.toString() });
      throw new Error(error.stderr?.toString() || error.message);
    }
  }

  /**
   * Build contracts
   */
  async build(options?: BuildOptions, directory?: string): Promise<CompilationResult> {
    try {
      // Set project root if directory provided
      if (directory) {
        await this.detectFoundryProject(directory);
      }

      const args: string[] = ['build'];

      if (options?.force) {
        args.push('--force');
      }

      if (options?.optimize) {
        args.push('--optimize');
        if (options.optimizerRuns) {
          args.push('--optimizer-runs', options.optimizerRuns.toString());
        }
      }

      if (options?.via_ir) {
        args.push('--via-ir');
      }

      const output = await this.executeForgeCommand(args, { cwd: directory || this.projectRoot || undefined });

      // Parse output to find compiled contracts
      const artifacts: string[] = [];
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes('Compiler run successful')) {
          return {
            success: true,
            artifacts,
          };
        }
      }

      return {
        success: true,
        artifacts,
      };
    } catch (error: any) {
      return {
        success: false,
        errors: [error.message],
      };
    }
  }

  /**
   * Run tests
   */
  async test(options?: TestOptions, directory?: string): Promise<TestResult> {
    try {
      // Set project root if directory provided
      if (directory) {
        await this.detectFoundryProject(directory);
      }

      const args: string[] = ['test'];

      if (options?.matchTest) {
        args.push('--match-test', options.matchTest);
      }

      if (options?.matchContract) {
        args.push('--match-contract', options.matchContract);
      }

      if (options?.forkUrl) {
        args.push('--fork-url', options.forkUrl);
      }

      if (options?.gasReport) {
        args.push('--gas-report');
      }

      if (options?.verbosity) {
        args.push('-' + 'v'.repeat(options.verbosity));
      }

      const output = await this.executeForgeCommand(args, { cwd: directory || this.projectRoot || undefined });

      // Parse test results
      const result: TestResult = {
        success: true,
        passed: 0,
        failed: 0,
        total: 0,
      };

      // Parse output for test counts
      const lines = output.split('\n');
      for (const line of lines) {
        // New forge output format: "Ran X test suite(s) in ...: Y tests passed, Z failed, W skipped (N total tests)"
        const newFormatMatch = line.match(/(\d+) tests passed, (\d+) failed, (\d+) skipped \((\d+) total tests\)/);
        if (newFormatMatch) {
          result.passed = parseInt(newFormatMatch[1], 10);
          result.failed = parseInt(newFormatMatch[2], 10);
          result.total = parseInt(newFormatMatch[4], 10);
          break;
        }

        // Old forge output format: "Test result: ok. X passed"
        if (line.includes('Test result:')) {
          const okMatch = line.match(/ok\. (\d+) passed/);
          if (okMatch) {
            result.passed = parseInt(okMatch[1], 10);
            result.total = result.passed;
          }
        }
      }

      // Extract gas report if present
      if (options?.gasReport && output.includes('Gas Report')) {
        result.gasReport = output;
      }

      return result;
    } catch (error: any) {
      // Parse test failures
      const failures: Array<{ test: string; error: string }> = [];

      return {
        success: false,
        failed: 1,
        total: 1,
        failures,
      };
    }
  }

  /**
   * Clean artifacts
   */
  async clean(directory?: string): Promise<boolean> {
    try {
      if (directory) {
        await this.detectFoundryProject(directory);
      }
      await this.executeForgeCommand(['clean'], { cwd: directory || this.projectRoot || undefined });
      return true;
    } catch (error) {
      logger.error('Failed to clean artifacts', { error });
      return false;
    }
  }

  /**
   * Format Solidity code
   */
  async fmt(directory?: string): Promise<boolean> {
    try {
      if (directory) {
        await this.detectFoundryProject(directory);
      }
      await this.executeForgeCommand(['fmt'], { cwd: directory || this.projectRoot || undefined });
      return true;
    } catch (error) {
      logger.error('Failed to format code', { error });
      return false;
    }
  }

  /**
   * Create gas snapshot
   */
  async snapshot(directory?: string): Promise<GasSnapshot> {
    try {
      if (directory) {
        await this.detectFoundryProject(directory);
      }
      await this.executeForgeCommand(['snapshot'], { cwd: directory || this.projectRoot || undefined });

      return {
        success: true,
        snapshots: {},
      };
    } catch (error: any) {
      return {
        success: false,
        snapshots: {},
      };
    }
  }

  /**
   * Get contract artifacts
   */
  async getArtifacts(contractName?: string, directory?: string): Promise<ArtifactInfo[]> {
    if (directory) {
      await this.detectFoundryProject(directory);
    }
    const projectRoot = directory || this.projectRoot || process.cwd();
    const outDir = path.join(projectRoot, 'out');

    if (!existsSync(outDir)) {
      throw new Error('Artifacts not found. Run forge build first.');
    }

    const artifacts: ArtifactInfo[] = [];

    // Read all directories in out/
    const contracts = await fs.readdir(outDir);

    for (const contract of contracts) {
      const contractDir = path.join(outDir, contract);
      const stat = await fs.stat(contractDir);

      if (!stat.isDirectory()) continue;

      // Skip if contractName specified and doesn't match
      if (contractName && !contract.includes(contractName)) continue;

      // Read the .json artifact file
      const jsonFile = path.join(contractDir, `${contract}.json`);

      if (existsSync(jsonFile)) {
        const content = await fs.readFile(jsonFile, 'utf-8');
        const artifact = JSON.parse(content);

        artifacts.push({
          contractName: contract.replace('.sol', ''),
          abi: artifact.abi || [],
          bytecode: artifact.bytecode?.object || '',
          deployedBytecode: artifact.deployedBytecode?.object || '',
          metadata: artifact.metadata,
        });
      }
    }

    return artifacts;
  }

  /**
   * Deploy contract using forge create
   */
  async create(options: DeployOptions): Promise<DeploymentResult> {
    try {
      const args: string[] = [
        'create',
        options.contractPath,
        '--rpc-url',
        options.rpcUrl,
        '--private-key',
        options.privateKey,
      ];

      if (options.constructorArgs && options.constructorArgs.length > 0) {
        args.push('--constructor-args', ...options.constructorArgs);
      }

      if (options.gasLimit) {
        args.push('--gas-limit', options.gasLimit.toString());
      }

      const output = await this.executeForgeCommand(args);

      // Parse deployment output
      const addressMatch = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
      const txHashMatch = output.match(/Transaction hash: (0x[a-fA-F0-9]{64})/);

      return {
        success: true,
        address: addressMatch?.[1],
        transactionHash: txHashMatch?.[1],
      };
    } catch (error: any) {
      return {
        success: false,
      };
    }
  }

  /**
   * Run Solidity script
   */
  async runScript(scriptPath: string, options?: ScriptOptions): Promise<ScriptResult> {
    try {
      const args: string[] = ['script', scriptPath];

      if (options?.broadcast) {
        args.push('--broadcast');
      }

      if (options?.rpcUrl) {
        args.push('--rpc-url', options.rpcUrl);
      }

      if (options?.privateKey) {
        args.push('--private-key', options.privateKey);
      }

      if (options?.verify) {
        args.push('--verify');
      }

      const output = await this.executeForgeCommand(args);

      return {
        success: true,
        output,
        transactions: [],
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
      };
    }
  }

  /**
   * Call contract function (read-only)
   */
  async call(options: CallOptions): Promise<any> {
    try {
      const args: string[] = ['call', options.address, options.signature];

      if (options.args && options.args.length > 0) {
        args.push(...options.args);
      }

      if (options.rpcUrl) {
        args.push('--rpc-url', options.rpcUrl);
      }

      if (options.blockNumber) {
        args.push('--block', options.blockNumber);
      }

      const output = await this.executeCastCommand(args);
      return output.trim();
    } catch (error: any) {
      throw new Error(`Contract call failed: ${error.message}`);
    }
  }

  /**
   * Send transaction
   */
  async send(options: SendOptions): Promise<any> {
    try {
      const args: string[] = [
        'send',
        options.address,
        options.signature,
        '--rpc-url',
        options.rpcUrl,
        '--private-key',
        options.privateKey,
      ];

      if (options.args && options.args.length > 0) {
        args.push(...options.args);
      }

      if (options.value) {
        args.push('--value', options.value);
      }

      if (options.gasLimit) {
        args.push('--gas-limit', options.gasLimit.toString());
      }

      const output = await this.executeCastCommand(args);

      // Parse transaction hash
      const txHashMatch = output.match(/transactionHash\s+(0x[a-fA-F0-9]{64})/);

      return {
        transactionHash: txHashMatch?.[1],
        output: output.trim(),
      };
    } catch (error: any) {
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }

  /**
   * Install dependency
   */
  async install(dependency: string): Promise<boolean> {
    try {
      // Note: --no-commit flag removed in Foundry 1.4.4+
      // Git repo must be initialized before running forge install
      await this.executeForgeCommand(['install', dependency]);
      return true;
    } catch (error) {
      logger.error('Failed to install dependency', { error });
      return false;
    }
  }

  /**
   * Update dependencies
   */
  async update(): Promise<boolean> {
    try {
      await this.executeForgeCommand(['update']);
      return true;
    } catch (error) {
      logger.error('Failed to update dependencies', { error });
      return false;
    }
  }

  /**
   * Remove dependency
   */
  async remove(dependency: string): Promise<boolean> {
    try {
      await this.executeForgeCommand(['remove', dependency]);
      return true;
    } catch (error) {
      logger.error('Failed to remove dependency', { error });
      return false;
    }
  }

  /**
   * Inspect contract
   */
  async inspect(contractName: string, field: string): Promise<any> {
    try {
      const output = await this.executeForgeCommand(['inspect', contractName, field]);
      return JSON.parse(output);
    } catch (error: any) {
      throw new Error(`Inspect failed: ${error.message}`);
    }
  }

  /**
   * Start Anvil local node
   */
  async startAnvil(options?: { port?: number; forkUrl?: string; chainId?: number }): Promise<boolean> {
    try {
      const args: string[] = [];

      if (options?.port) {
        args.push('--port', options.port.toString());
      }

      if (options?.forkUrl) {
        args.push('--fork-url', options.forkUrl);
      }

      if (options?.chainId) {
        args.push('--chain-id', options.chainId.toString());
      }

      // Add Foundry bin directory to PATH for Node.js child_process
      const env = {
        ...process.env,
        PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}`,
      };

      this.anvilProcess = spawn('anvil', args, {
        env,
        stdio: 'pipe',
      });

      logger.info('Anvil started', { pid: this.anvilProcess.pid });
      return true;
    } catch (error) {
      logger.error('Failed to start Anvil', { error });
      return false;
    }
  }

  /**
   * Stop Anvil local node
   */
  async stopAnvil(): Promise<boolean> {
    try {
      if (this.anvilProcess) {
        this.anvilProcess.kill();
        this.anvilProcess = null;
        logger.info('Anvil stopped');
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Failed to stop Anvil', { error });
      return false;
    }
  }

  /**
   * Get Anvil status
   */
  isAnvilRunning(): boolean {
    return this.anvilProcess !== null && !this.anvilProcess.killed;
  }
}

// Singleton instance
export const foundryService = new FoundryService();
