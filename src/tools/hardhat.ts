/**
 * Hardhat Tools for MCP
 * Provides 15 tools for Hardhat development on Hedera
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { hardhatService } from '../services/hardhat-service.js';
import logger from '../utils/logger.js';
import { ToolResult } from '../types/index.js';
import {
  generateHederaHardhatConfig,
  generateEnvTemplate,
  generateSampleContract,
  generateSampleDeployScript,
  generateSampleTest,
  generateGitignore,
  generateReadme,
} from '../utils/hardhat-config-generator.js';

/**
 * 1. Initialize Hardhat project
 */
export async function hardhatInit(args: {
  directory?: string;
  networks?: Array<'mainnet' | 'testnet' | 'previewnet' | 'local'>;
  solidity?: string;
  typescript?: boolean;
}): Promise<ToolResult> {
  try {
    const directory = args.directory || process.cwd();
    const networks = args.networks || ['testnet', 'local'];
    const solidity = args.solidity || '0.8.20';
    const typescript = args.typescript || false;

    logger.info('Initializing Hardhat project', { directory, networks, solidity, typescript });

    // Create directory if it doesn't exist
    await fs.mkdir(directory, { recursive: true });

    // Create directory structure
    await fs.mkdir(path.join(directory, 'contracts'), { recursive: true });
    await fs.mkdir(path.join(directory, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(directory, 'test'), { recursive: true });

    // Generate hardhat.config file
    const configContent = generateHederaHardhatConfig({ solidity, networks, typescript });
    const configFile = typescript ? 'hardhat.config.ts' : 'hardhat.config.js';
    await fs.writeFile(path.join(directory, configFile), configContent);

    // Generate .env.example
    const envContent = generateEnvTemplate(networks);
    await fs.writeFile(path.join(directory, '.env.example'), envContent);

    // Generate sample contract
    const contractContent = generateSampleContract();
    await fs.writeFile(path.join(directory, 'contracts', 'Greeter.sol'), contractContent);

    // Generate deployment script
    const deployScript = generateSampleDeployScript(typescript);
    const scriptExt = typescript ? 'ts' : 'js';
    await fs.writeFile(path.join(directory, 'scripts', `deploy.${scriptExt}`), deployScript);

    // Generate test file
    const testContent = generateSampleTest(typescript);
    await fs.writeFile(path.join(directory, 'test', `Greeter.test.${scriptExt}`), testContent);

    // Generate .gitignore
    const gitignoreContent = generateGitignore();
    await fs.writeFile(path.join(directory, '.gitignore'), gitignoreContent);

    // Generate README
    const readmeContent = generateReadme();
    await fs.writeFile(path.join(directory, 'README.md'), readmeContent);

    // Create package.json if it doesn't exist (Hardhat v3 requires ESM)
    const packageJsonPath = path.join(directory, 'package.json');
    try {
      await fs.access(packageJsonPath);
    } catch {
      const packageJson = {
        name: path.basename(directory),
        version: '1.0.0',
        type: 'module', // Required for Hardhat v3 ESM
        description: 'Hedera Hardhat Project',
        scripts: {
          compile: 'hardhat compile',
          test: 'hardhat test',
          deploy: 'hardhat run scripts/deploy.' + scriptExt,
        },
        devDependencies: {},
      };
      await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
    }

    // Install dependencies (Hardhat v3 with new toolbox package)
    logger.info('Installing Hardhat dependencies...');
    const originalCwd = process.cwd();
    process.chdir(directory);

    try {
      execSync(
        'npm install --save-dev hardhat@^3.0.11 @nomicfoundation/hardhat-toolbox-mocha-ethers@^3.0.1 dotenv',
        {
          stdio: 'inherit',
        }
      );
    } finally {
      process.chdir(originalCwd);
    }

    logger.info('Hardhat project initialized successfully', { directory });

    return {
      success: true,
      data: {
        directory,
        networks,
        typescript,
        files: [
          configFile,
          '.env.example',
          'contracts/Greeter.sol',
          `scripts/deploy.${scriptExt}`,
          `test/Greeter.test.${scriptExt}`,
          '.gitignore',
          'README.md',
        ],
      },
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat init',
      },
    };
  } catch (error) {
    logger.error('Hardhat initialization failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Initialization failed',
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat init',
      },
    };
  }
}

/**
 * 2. Compile contracts
 */
export async function hardhatCompile(args: { force?: boolean; directory?: string }): Promise<ToolResult> {
  try {
    logger.info('Compiling contracts', { force: args.force, directory: args.directory });

    const result = await hardhatService.compile(args.force, args.directory);

    if (result.success) {
      return {
        success: true,
        data: {
          artifactCount: result.artifacts?.length || 0,
          artifacts: result.artifacts,
        },
        metadata: {
          executedVia: 'hardhat',
          command: 'hardhat compile',
        },
      };
    } else {
      return {
        success: false,
        error: result.errors?.join('\n') || 'Compilation failed',
        metadata: {
          executedVia: 'hardhat',
          command: 'hardhat compile',
        },
      };
    }
  } catch (error) {
    logger.error('Compilation failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Compilation failed',
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat compile',
      },
    };
  }
}

/**
 * 3. Run tests
 */
export async function hardhatTest(args: {
  testFiles?: string[];
  grep?: string;
  network?: string;
  directory?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Running tests', args);

    const result = await hardhatService.test({
      testFiles: args.testFiles,
      grep: args.grep,
      network: args.network,
      directory: args.directory,
    });

    return {
      success: result.success,
      data: {
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        duration: result.duration,
        failures: result.failures,
      },
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat test',
      },
    };
  } catch (error) {
    logger.error('Tests failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tests failed',
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat test',
      },
    };
  }
}

/**
 * 4. Clean artifacts
 */
export async function hardhatClean(args: { directory?: string } = {}): Promise<ToolResult> {
  try {
    logger.info('Cleaning artifacts and cache', { directory: args.directory });

    const success = await hardhatService.clean(args.directory);

    return {
      success,
      data: {
        message: success ? 'Artifacts and cache cleaned' : 'Clean failed',
      },
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat clean',
      },
    };
  } catch (error) {
    logger.error('Clean failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Clean failed',
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat clean',
      },
    };
  }
}

/**
 * 5. Deploy contracts (via script)
 */
export async function hardhatDeploy(args: {
  script: string;
  network?: string;
  directory?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Deploying contracts', { script: args.script, network: args.network, directory: args.directory });

    // Import and inject operator environment variables
    const { getDeploymentEnvVars } = await import('../utils/key-converter.js');
    const envVars = getDeploymentEnvVars();

    // Inject operator credentials into environment
    for (const [key, value] of Object.entries(envVars)) {
      if (!process.env[key]) {
        // Only set if not already set
        process.env[key] = value;
      }
    }

    const hre = await hardhatService.getHRE(args.directory);

    // Run the deployment script
    await hre.run('run', { script: args.script, network: args.network });

    return {
      success: true,
      data: {
        message: 'Deployment script executed successfully',
        script: args.script,
        network: args.network || hre.network.name,
      },
      metadata: {
        executedVia: 'hardhat',
        command: `hardhat run ${args.script}`,
      },
    };
  } catch (error) {
    logger.error('Deployment failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Deployment failed',
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat run',
      },
    };
  }
}

/**
 * 6. Verify contract on HashScan
 */
export async function hardhatVerify(args: { address: string; constructorArgs?: any[]; directory?: string }): Promise<ToolResult> {
  try {
    logger.info('Getting verification file', { address: args.address, directory: args.directory });

    const verificationFile = await hardhatService.getVerificationFile(args.directory);

    if (!verificationFile) {
      return {
        success: false,
        error: 'No verification file found. Run hardhat compile first.',
        metadata: {
          executedVia: 'hardhat',
          command: 'hardhat verify',
        },
      };
    }

    return {
      success: true,
      data: {
        message: 'Verification metadata ready',
        verificationFile,
        address: args.address,
        constructorArgs: args.constructorArgs,
        instructions: [
          '1. Navigate to https://hashscan.io/ or https://verify.hashscan.io/',
          '2. Find your deployed contract by address',
          `3. Click "Verify Contract"`,
          `4. Upload the verification file: ${verificationFile}`,
          '5. Contract will be verified automatically',
        ],
      },
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat verify',
      },
    };
  } catch (error) {
    logger.error('Verification preparation failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Verification failed',
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat verify',
      },
    };
  }
}

/**
 * 7. Flatten contracts
 */
export async function hardhatFlatten(args: { files?: string[]; directory?: string }): Promise<ToolResult> {
  try {
    logger.info('Flattening contracts', { files: args.files, directory: args.directory });

    const flattened = await hardhatService.flatten(args.files, args.directory);

    return {
      success: true,
      data: {
        flattened,
        fileCount: args.files?.length || 0,
      },
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat flatten',
      },
    };
  } catch (error) {
    logger.error('Flatten failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Flatten failed',
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat flatten',
      },
    };
  }
}

/**
 * 8. Configure/Add network
 */
export async function hardhatConfigAddNetwork(args: {
  network: 'mainnet' | 'testnet' | 'previewnet' | 'local' | string;
  rpcUrl: string;
  chainId: number;
  privateKey?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Adding network configuration', { network: args.network });

    // This would require modifying the hardhat.config.js file
    // For now, we'll return instructions
    return {
      success: true,
      data: {
        message: `Add this configuration to your hardhat.config.js:`,
        config: `
    ${args.network}: {
      url: "${args.rpcUrl}",
      accounts: [process.env.${args.network.toUpperCase()}_PRIVATE_KEY],
      chainId: ${args.chainId},
    }`,
        envVar: `${args.network.toUpperCase()}_PRIVATE_KEY=${args.privateKey || 'your-private-key-here'}`,
      },
      metadata: {
        executedVia: 'hardhat',
        command: 'config add network',
      },
    };
  } catch (error) {
    logger.error('Network configuration failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Configuration failed',
      metadata: {
        executedVia: 'hardhat',
        command: 'config add network',
      },
    };
  }
}

/**
 * 9. Get compiled artifacts
 */
export async function hardhatGetArtifacts(args: { contractName?: string; directory?: string }): Promise<ToolResult> {
  try {
    logger.info('Getting artifacts', { contractName: args.contractName, directory: args.directory });

    const artifacts = await hardhatService.getArtifacts(args.contractName, args.directory);

    return {
      success: true,
      data: {
        artifacts,
        count: artifacts.length,
      },
      metadata: {
        executedVia: 'hardhat',
        command: 'get artifacts',
      },
    };
  } catch (error) {
    logger.error('Failed to get artifacts', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get artifacts',
      metadata: {
        executedVia: 'hardhat',
        command: 'get artifacts',
      },
    };
  }
}

/**
 * 10. Call contract function (read-only)
 */
export async function hardhatCallContract(args: {
  address: string;
  abi: any[];
  method: string;
  args?: any[];
  network?: string;
  directory?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Calling contract function', { address: args.address, method: args.method, directory: args.directory });

    const result = await hardhatService.callContract({
      address: args.address,
      abi: args.abi,
      method: args.method,
      args: args.args,
      network: args.network,
      directory: args.directory,
    });

    return {
      success: true,
      data: {
        method: args.method,
        result,
      },
      metadata: {
        executedVia: 'hardhat',
        command: 'contract call',
      },
    };
  } catch (error) {
    logger.error('Contract call failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Contract call failed',
      metadata: {
        executedVia: 'hardhat',
        command: 'contract call',
      },
    };
  }
}

/**
 * 11. Execute contract transaction (state-changing)
 */
export async function hardhatExecuteContract(args: {
  address: string;
  abi: any[];
  method: string;
  args?: any[];
  value?: string;
  gasLimit?: number;
  directory?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Executing contract transaction', { address: args.address, method: args.method, directory: args.directory });

    // Import and inject operator environment variables
    const { getDeploymentEnvVars } = await import('../utils/key-converter.js');
    const envVars = getDeploymentEnvVars();

    // Inject operator credentials into environment
    for (const [key, value] of Object.entries(envVars)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }

    const result = await hardhatService.executeContract({
      address: args.address,
      abi: args.abi,
      method: args.method,
      args: args.args,
      value: args.value,
      gasLimit: args.gasLimit,
      directory: args.directory,
    });

    return {
      success: true,
      data: {
        method: args.method,
        transactionHash: result.hash,
        blockNumber: result.receipt.blockNumber,
        gasUsed: result.receipt.gasUsed.toString(),
      },
      metadata: {
        executedVia: 'hardhat',
        command: 'contract execute',
      },
    };
  } catch (error) {
    logger.error('Contract execution failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Contract execution failed',
      metadata: {
        executedVia: 'hardhat',
        command: 'contract execute',
      },
    };
  }
}

/**
 * 12. Get available accounts
 */
export async function hardhatGetAccounts(args: { directory?: string } = {}): Promise<ToolResult> {
  try {
    logger.info('Getting available accounts', { directory: args.directory });

    const accounts = await hardhatService.getAccounts(args.directory);

    return {
      success: true,
      data: {
        accounts,
        count: accounts.length,
      },
      metadata: {
        executedVia: 'hardhat',
        command: 'get accounts',
      },
    };
  } catch (error) {
    logger.error('Failed to get accounts', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get accounts',
      metadata: {
        executedVia: 'hardhat',
        command: 'get accounts',
      },
    };
  }
}

/**
 * 13. Deploy via Ignition (modern deployment)
 */
export async function hardhatDeployIgnition(args: {
  module: string;
  parameters?: any;
  network?: string;
  directory?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Deploying via Ignition', { module: args.module, network: args.network, directory: args.directory });

    // Import and inject operator environment variables
    const { getDeploymentEnvVars } = await import('../utils/key-converter.js');
    const envVars = getDeploymentEnvVars();

    // Inject operator credentials into environment
    for (const [key, value] of Object.entries(envVars)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }

    const hre = await hardhatService.getHRE(args.directory);

    // Run ignition deployment
    await hre.run('ignition:deploy', {
      module: args.module,
      parameters: args.parameters,
      network: args.network,
    });

    return {
      success: true,
      data: {
        message: 'Ignition deployment executed successfully',
        module: args.module,
        network: args.network || hre.network.name,
      },
      metadata: {
        executedVia: 'hardhat',
        command: 'ignition deploy',
      },
    };
  } catch (error) {
    logger.error('Ignition deployment failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Ignition deployment failed',
      metadata: {
        executedVia: 'hardhat',
        command: 'ignition deploy',
      },
    };
  }
}

/**
 * 14. Run custom task
 */
export async function hardhatRunTask(args: { task: string; params?: any; directory?: string }): Promise<ToolResult> {
  try {
    logger.info('Running custom task', { task: args.task, directory: args.directory });

    const result = await hardhatService.runTask(args.task, args.params, args.directory);

    return {
      success: true,
      data: {
        task: args.task,
        result,
      },
      metadata: {
        executedVia: 'hardhat',
        command: `hardhat ${args.task}`,
      },
    };
  } catch (error) {
    logger.error('Task execution failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Task execution failed',
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat task',
      },
    };
  }
}

/**
 * 15. List available tasks
 */
export async function hardhatListTasks(args: { directory?: string } = {}): Promise<ToolResult> {
  try {
    logger.info('Listing available tasks', { directory: args.directory });

    const tasks = await hardhatService.listTasks(args.directory);

    return {
      success: true,
      data: {
        tasks,
        count: tasks.length,
      },
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat list tasks',
      },
    };
  } catch (error) {
    logger.error('Failed to list tasks', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list tasks',
      metadata: {
        executedVia: 'hardhat',
        command: 'hardhat list tasks',
      },
    };
  }
}

/**
 * Export tool definitions for MCP
 */
export const hardhatTools = [
  {
    name: 'hardhat_init',
    description:
      'Initialize a new Hardhat project with Hedera network configuration. Creates directory structure, config files, sample contracts, tests, and deployment scripts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (default: current directory)',
        },
        networks: {
          type: 'array',
          description: 'Networks to configure (default: ["testnet", "local"])',
          items: {
            type: 'string',
            enum: ['mainnet', 'testnet', 'previewnet', 'local'],
          },
        },
        solidity: {
          type: 'string',
          description: 'Solidity compiler version (default: "0.8.20")',
          default: '0.8.20',
        },
        typescript: {
          type: 'boolean',
          description: 'Use TypeScript configuration (default: false)',
          default: false,
        },
      },
    },
  },
  {
    name: 'hardhat_compile',
    description:
      'Compile all Solidity contracts in the project. Generates artifacts (ABI, bytecode) and build-info files for verification.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
        force: {
          type: 'boolean',
          description: 'Force recompilation (default: false)',
          default: false,
        },
      },
    },
  },
  {
    name: 'hardhat_test',
    description: 'Run Mocha/Chai tests for smart contracts. Supports filtering by file or pattern.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
        testFiles: {
          type: 'array',
          description: 'Specific test files to run (default: all test files)',
          items: {
            type: 'string',
          },
        },
        grep: {
          type: 'string',
          description: 'Filter tests by pattern (Mocha grep)',
        },
        network: {
          type: 'string',
          description: 'Network to run tests on (default: hardhat local)',
        },
      },
    },
  },
  {
    name: 'hardhat_clean',
    description: 'Clean cache and artifacts directories. Useful before fresh compilation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
      },
    },
  },
  {
    name: 'hardhat_deploy',
    description: 'Execute deployment script to deploy contracts to Hedera networks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
        script: {
          type: 'string',
          description: 'Path to deployment script (e.g., "scripts/deploy.js")',
        },
        network: {
          type: 'string',
          description: 'Network to deploy to (e.g., "testnet", "mainnet")',
        },
      },
      required: ['script'],
    },
  },
  {
    name: 'hardhat_verify',
    description:
      'Get verification metadata for HashScan contract verification. Returns build-info file path.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
        address: {
          type: 'string',
          description: 'Deployed contract address (0x... or 0.0.xxxxx)',
        },
        constructorArgs: {
          type: 'array',
          description: 'Constructor arguments used during deployment',
          items: {},
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'hardhat_flatten',
    description: 'Flatten contracts into single file for easier verification.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
        files: {
          type: 'array',
          description: 'Contract files to flatten (default: all contracts)',
          items: {
            type: 'string',
          },
        },
      },
    },
  },
  {
    name: 'hardhat_config_add_network',
    description: 'Generate network configuration snippet for hardhat.config.js.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: {
          type: 'string',
          description: 'Network name (e.g., "mainnet", "testnet", "previewnet", "local", or custom)',
        },
        rpcUrl: {
          type: 'string',
          description: 'RPC endpoint URL for the network',
        },
        chainId: {
          type: 'number',
          description: 'Chain ID for the network (e.g., 296 for mainnet, 297 for testnet)',
        },
        privateKey: {
          type: 'string',
          description: 'Optional: Private key for the network (will be prompted for env var)',
        },
      },
      required: ['network', 'rpcUrl', 'chainId'],
    },
  },
  {
    name: 'hardhat_get_artifacts',
    description: 'Get compiled contract artifacts (ABI, bytecode, etc.).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
        contractName: {
          type: 'string',
          description: 'Specific contract name (default: all contracts)',
        },
      },
    },
  },
  {
    name: 'hardhat_call_contract',
    description: 'Call read-only contract function (view/pure). No gas cost.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
        address: {
          type: 'string',
          description: 'Contract address (0x... or 0.0.xxxxx)',
        },
        abi: {
          type: 'array',
          description: 'Contract ABI (JSON array)',
          items: {},
        },
        method: {
          type: 'string',
          description: 'Method name to call',
        },
        args: {
          type: 'array',
          description: 'Method arguments (default: [])',
          items: {},
        },
        network: {
          type: 'string',
          description: 'Network to call on (default: current network)',
        },
      },
      required: ['address', 'abi', 'method'],
    },
  },
  {
    name: 'hardhat_execute_contract',
    description: 'Execute state-changing contract function. Requires gas and sends transaction.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
        address: {
          type: 'string',
          description: 'Contract address (0x... or 0.0.xxxxx)',
        },
        abi: {
          type: 'array',
          description: 'Contract ABI (JSON array)',
          items: {},
        },
        method: {
          type: 'string',
          description: 'Method name to execute',
        },
        args: {
          type: 'array',
          description: 'Method arguments (default: [])',
          items: {},
        },
        value: {
          type: 'string',
          description: 'HBAR to send with transaction (in wei)',
        },
        gasLimit: {
          type: 'number',
          description: 'Gas limit for transaction',
        },
      },
      required: ['address', 'abi', 'method'],
    },
  },
  {
    name: 'hardhat_get_accounts',
    description: 'Get list of available accounts with balances.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
      },
    },
  },
  {
    name: 'hardhat_deploy_ignition',
    description: 'Deploy contracts using Hardhat Ignition (modern declarative deployment).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
        module: {
          type: 'string',
          description: 'Ignition module path (e.g., "ignition/modules/MyModule")',
        },
        parameters: {
          type: 'object',
          description: 'Deployment parameters (JSON object)',
        },
        network: {
          type: 'string',
          description: 'Network to deploy to (e.g., "testnet", "mainnet")',
        },
      },
      required: ['module'],
    },
  },
  {
    name: 'hardhat_run_task',
    description: 'Execute any Hardhat task programmatically.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
        task: {
          type: 'string',
          description: 'Task name to execute (e.g., "compile", "test", "clean")',
        },
        params: {
          type: 'object',
          description: 'Task parameters (JSON object)',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'hardhat_list_tasks',
    description: 'List all available Hardhat tasks (built-in and custom).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Project directory path (absolute path to Hardhat project)',
        },
      },
    },
  },
];
