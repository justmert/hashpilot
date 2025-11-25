/**
 * Hardhat Service
 * Provides programmatic access to Hardhat development environment
 * Supports compilation, testing, deployment, and contract interaction
 */

import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import logger from '../utils/logger.js';

/**
 * Hardhat Runtime Environment type (simplified)
 */
interface HardhatRuntimeEnvironment {
  run: (taskName: string, taskArguments?: any) => Promise<any>;
  ethers: any;
  network: {
    name: string;
    config: any;
  };
  config: any;
  artifacts: any;
}

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
  skipped?: number;
  duration?: number;
  gasReport?: any;
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
  constructorArgs?: any[];
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
 * Hardhat Service for smart contract development
 */
export class HardhatService {
  private projectRoot: string | null = null;
  private hre: HardhatRuntimeEnvironment | null = null;

  /**
   * Detect Hardhat project in directory tree
   */
  async detectHardhatProject(startDir?: string): Promise<string | null> {
    const start = startDir || process.cwd();
    let currentDir = path.resolve(start);
    const root = path.parse(currentDir).root;

    // Walk up directory tree looking for hardhat.config.js/ts
    while (currentDir !== root) {
      const jsConfig = path.join(currentDir, 'hardhat.config.js');
      const tsConfig = path.join(currentDir, 'hardhat.config.ts');

      if (existsSync(jsConfig) || existsSync(tsConfig)) {
        logger.info('Hardhat project detected', { projectRoot: currentDir });
        this.projectRoot = currentDir;
        return currentDir;
      }

      // Move up one directory
      currentDir = path.dirname(currentDir);
    }

    logger.warn('No Hardhat project found', { searchStarted: start });
    return null;
  }

  /**
   * Get Hardhat Runtime Environment
   */
  async getHRE(projectPath?: string): Promise<HardhatRuntimeEnvironment> {
    // If HRE already loaded and no path change, return cached
    if (this.hre && (!projectPath || projectPath === this.projectRoot)) {
      return this.hre;
    }

    // Detect or use provided project path
    const projectRoot = projectPath || (await this.detectHardhatProject());

    if (!projectRoot) {
      throw new Error(
        'No Hardhat project found. Please run hardhat_init or navigate to a Hardhat project directory.'
      );
    }

    // Change working directory to project root
    const originalCwd = process.cwd();
    try {
      process.chdir(projectRoot);

      // Dynamic import of Hardhat
      const hardhatModule = await import('hardhat');
      this.hre = hardhatModule.default as unknown as HardhatRuntimeEnvironment;
      this.projectRoot = projectRoot;

      logger.info('Hardhat Runtime Environment loaded', {
        projectRoot,
        network: this.hre.network.name,
      });

      return this.hre;
    } catch (error) {
      process.chdir(originalCwd);
      throw new Error(
        `Failed to load Hardhat: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Compile contracts
   */
  async compile(force = false, directory?: string): Promise<CompilationResult> {
    try {
      const hre = await this.getHRE(directory);

      logger.info('Compiling contracts', { force, directory });

      // Run compile task
      await hre.run('compile', { force, quiet: false });

      // Get list of compiled artifacts
      const artifactPaths = await hre.artifacts.getArtifactPaths();

      logger.info('Compilation successful', { artifactCount: artifactPaths.length });

      return {
        success: true,
        artifacts: artifactPaths,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown compilation error';
      logger.error('Compilation failed', { error: errorMessage });

      return {
        success: false,
        errors: [errorMessage],
      };
    }
  }

  /**
   * Clean cache and artifacts
   */
  async clean(directory?: string): Promise<boolean> {
    try {
      const hre = await this.getHRE(directory);

      logger.info('Cleaning artifacts and cache', { directory });
      await hre.run('clean');

      logger.info('Clean successful');
      return true;
    } catch (error) {
      logger.error('Clean failed', { error });
      return false;
    }
  }

  /**
   * Run tests
   */
  async test(options?: {
    testFiles?: string[];
    grep?: string;
    network?: string;
    parallel?: boolean;
    directory?: string;
  }): Promise<TestResult> {
    try {
      const hre = await this.getHRE(options?.directory);

      logger.info('Running tests', options);

      const taskArgs: any = {};
      if (options?.testFiles) {
        taskArgs.testFiles = options.testFiles;
      }
      if (options?.grep) {
        taskArgs.grep = options.grep;
      }
      if (options?.parallel !== undefined) {
        taskArgs.parallel = options.parallel;
      }

      // Run test task
      await hre.run('test', taskArgs);

      // Note: Hardhat test task doesn't return results directly
      // We parse from console output or test reporter
      logger.info('Tests completed');

      return {
        success: true,
        // Results would need to be captured from test reporter
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown test error';
      logger.error('Tests failed', { error: errorMessage });

      return {
        success: false,
        failures: [
          {
            test: 'Test execution',
            error: errorMessage,
          },
        ],
      };
    }
  }

  /**
   * Flatten contracts for verification
   */
  async flatten(files?: string[], directory?: string): Promise<string> {
    try {
      const hre = await this.getHRE(directory);

      logger.info('Flattening contracts', { files, directory });

      const flattened = await hre.run('flatten', { files });

      return flattened;
    } catch (error) {
      throw new Error(
        `Flatten failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get compiled artifacts for a contract
   */
  async getArtifacts(contractName?: string, directory?: string): Promise<ArtifactInfo[]> {
    try {
      const hre = await this.getHRE(directory);

      if (contractName) {
        // Get specific contract
        const artifact = await hre.artifacts.readArtifact(contractName);

        return [
          {
            contractName: artifact.contractName,
            abi: artifact.abi,
            bytecode: artifact.bytecode,
            deployedBytecode: artifact.deployedBytecode,
            sourceName: artifact.sourceName,
          },
        ];
      } else {
        // Get all contracts
        const artifactPaths = await hre.artifacts.getArtifactPaths();
        const artifacts: ArtifactInfo[] = [];

        for (const artifactPath of artifactPaths) {
          const artifact = await hre.artifacts.readArtifactSync(artifactPath);
          artifacts.push({
            contractName: artifact.contractName,
            abi: artifact.abi,
            bytecode: artifact.bytecode,
            deployedBytecode: artifact.deployedBytecode,
            sourceName: artifact.sourceName,
          });
        }

        return artifacts;
      }
    } catch (error) {
      throw new Error(
        `Failed to get artifacts: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get verification metadata file (build-info JSON)
   */
  async getVerificationFile(directory?: string): Promise<string | null> {
    try {
      if (!this.projectRoot || directory) {
        await this.detectHardhatProject(directory);
      }

      if (!this.projectRoot) {
        return null;
      }

      const buildInfoDir = path.join(this.projectRoot, 'artifacts', 'build-info');

      // Check if build-info directory exists
      if (!existsSync(buildInfoDir)) {
        return null;
      }

      // Get the most recent build-info file
      const files = await fs.readdir(buildInfoDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      if (jsonFiles.length === 0) {
        return null;
      }

      // Sort by modification time (most recent first)
      const fileStats = await Promise.all(
        jsonFiles.map(async (file) => {
          const filePath = path.join(buildInfoDir, file);
          const stats = await fs.stat(filePath);
          return { file, mtime: stats.mtime, path: filePath };
        })
      );

      fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      return fileStats[0].path;
    } catch (error) {
      logger.error('Failed to get verification file', { error });
      return null;
    }
  }

  /**
   * Call a contract function (read-only)
   */
  async callContract(options: {
    address: string;
    abi: any[];
    method: string;
    args?: any[];
    network?: string;
    directory?: string;
  }): Promise<any> {
    try {
      const hre = await this.getHRE(options.directory);

      // Get contract instance
      const contract = await hre.ethers.getContractAt(options.abi, options.address);

      // Call the method
      const result = await contract[options.method](...(options.args || []));

      logger.info('Contract call successful', {
        address: options.address,
        method: options.method,
        result,
      });

      return result;
    } catch (error) {
      throw new Error(
        `Contract call failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Execute a contract transaction (state-changing)
   */
  async executeContract(options: {
    address: string;
    abi: any[];
    method: string;
    args?: any[];
    value?: string;
    gasLimit?: number;
    directory?: string;
  }): Promise<{ hash: string; receipt: any }> {
    try {
      const hre = await this.getHRE(options.directory);

      // Get contract instance
      const contract = await hre.ethers.getContractAt(options.abi, options.address);

      // Prepare transaction options
      const txOptions: any = {};
      if (options.value) {
        txOptions.value = options.value;
      }
      if (options.gasLimit) {
        txOptions.gasLimit = options.gasLimit;
      }

      // Execute the transaction
      const tx = await contract[options.method](...(options.args || []), txOptions);

      logger.info('Transaction sent', { hash: tx.hash });

      // Wait for confirmation
      const receipt = await tx.wait();

      logger.info('Transaction confirmed', {
        hash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      });

      return {
        hash: tx.hash,
        receipt,
      };
    } catch (error) {
      throw new Error(
        `Contract execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get available accounts
   */
  async getAccounts(directory?: string): Promise<
    Array<{
      address: string;
      balance: string;
    }>
  > {
    try {
      const hre = await this.getHRE(directory);

      const signers = await hre.ethers.getSigners();
      const accounts = await Promise.all(
        signers.map(async (signer: any) => {
          const address = await signer.getAddress();
          const balance = await hre.ethers.provider.getBalance(address);
          return {
            address,
            balance: hre.ethers.formatEther(balance),
          };
        })
      );

      return accounts;
    } catch (error) {
      throw new Error(
        `Failed to get accounts: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Run a custom Hardhat task
   */
  async runTask(taskName: string, taskArgs?: any, directory?: string): Promise<any> {
    try {
      const hre = await this.getHRE(directory);

      logger.info('Running task', { taskName, taskArgs, directory });

      const result = await hre.run(taskName, taskArgs);

      logger.info('Task completed', { taskName });

      return result;
    } catch (error) {
      throw new Error(
        `Task failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * List available tasks
   */
  async listTasks(directory?: string): Promise<
    Array<{
      name: string;
      description: string;
    }>
  > {
    try {
      const hre = await this.getHRE(directory);

      // Get task definitions from HRE
      const tasks: any = (hre as any).tasks;

      if (!tasks) {
        return [];
      }

      const taskList = Object.keys(tasks).map((taskName) => ({
        name: taskName,
        description: tasks[taskName].description || 'No description',
      }));

      return taskList;
    } catch (error) {
      throw new Error(
        `Failed to list tasks: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

/**
 * Global Hardhat service instance
 */
export const hardhatService = new HardhatService();
