/**
 * Foundry Tools for MCP
 * Provides 20 tools for Foundry development on Hedera
 */

import fs from 'fs/promises';
import path from 'path';
import { foundryService } from '../services/foundry-service.js';
import logger from '../utils/logger.js';
import { ToolResult } from '../types/index.js';
import {
  generateHederaFoundryConfig,
  generateEnvTemplate,
  generateSampleContract,
  generateSampleTest,
  generateSampleDeployScript,
  generateGitignore,
  generateReadme,
  generateRemappings,
} from '../utils/foundry-config-generator.js';

/**
 * 1. Initialize Foundry project
 */
export async function foundryInit(args: {
  directory?: string;
  networks?: Array<'mainnet' | 'testnet' | 'previewnet' | 'local'>;
  solidity?: string;
  template?: 'basic' | 'advanced';
}): Promise<ToolResult> {
  try {
    const directory = args.directory || process.cwd();
    const networks = args.networks || ['testnet', 'local'];
    const solidity = args.solidity || '0.8.20';

    logger.info('Initializing Foundry project', { directory, networks, solidity });

    // Create directory if it doesn't exist
    await fs.mkdir(directory, { recursive: true });

    // Create directory structure
    await fs.mkdir(path.join(directory, 'src'), { recursive: true });
    await fs.mkdir(path.join(directory, 'test'), { recursive: true });
    await fs.mkdir(path.join(directory, 'script'), { recursive: true });
    await fs.mkdir(path.join(directory, 'lib'), { recursive: true });

    // Generate foundry.toml
    const configContent = generateHederaFoundryConfig({ solidity, networks });
    await fs.writeFile(path.join(directory, 'foundry.toml'), configContent);

    // Generate .env.example
    const envContent = generateEnvTemplate(networks);
    await fs.writeFile(path.join(directory, '.env.example'), envContent);

    // Generate sample contract
    const contractContent = generateSampleContract();
    await fs.writeFile(path.join(directory, 'src', 'Greeter.sol'), contractContent);

    // Generate test file
    const testContent = generateSampleTest();
    await fs.writeFile(path.join(directory, 'test', 'Greeter.t.sol'), testContent);

    // Generate deployment script
    const deployScript = generateSampleDeployScript();
    await fs.writeFile(path.join(directory, 'script', 'Deploy.s.sol'), deployScript);

    // Generate .gitignore
    const gitignoreContent = generateGitignore();
    await fs.writeFile(path.join(directory, '.gitignore'), gitignoreContent);

    // Generate README
    const readmeContent = generateReadme();
    await fs.writeFile(path.join(directory, 'README.md'), readmeContent);

    // Generate remappings.txt
    const remappingsContent = generateRemappings();
    await fs.writeFile(path.join(directory, 'remappings.txt'), remappingsContent);

    logger.info('Foundry project initialized successfully', { directory });

    return {
      success: true,
      data: {
        directory,
        networks,
        files: [
          'foundry.toml',
          '.env.example',
          'src/Greeter.sol',
          'test/Greeter.t.sol',
          'script/Deploy.s.sol',
          '.gitignore',
          'README.md',
          'remappings.txt',
        ],
        nextSteps: [
          '1. Copy .env.example to .env and add your private keys',
          '2. Run: forge install foundry-rs/forge-std',
          '3. Run: forge build',
          '4. Run: forge test',
        ],
      },
      metadata: {
        executedVia: 'foundry',
        command: 'foundry init',
      },
    };
  } catch (error) {
    logger.error('Foundry initialization failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Initialization failed',
      metadata: {
        executedVia: 'foundry',
        command: 'foundry init',
      },
    };
  }
}

/**
 * 2. Install dependency
 */
export async function foundryInstall(args: { dependency: string }): Promise<ToolResult> {
  try {
    logger.info('Installing dependency', { dependency: args.dependency });

    const success = await foundryService.install(args.dependency);

    return {
      success,
      data: {
        message: success ? `Dependency ${args.dependency} installed successfully` : 'Installation failed',
        dependency: args.dependency,
      },
      metadata: {
        executedVia: 'foundry',
        command: `forge install ${args.dependency}`,
      },
    };
  } catch (error) {
    logger.error('Dependency installation failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Installation failed',
      metadata: {
        executedVia: 'foundry',
        command: 'forge install',
      },
    };
  }
}

/**
 * 3. Update dependencies
 */
export async function foundryUpdate(): Promise<ToolResult> {
  try {
    logger.info('Updating dependencies');

    const success = await foundryService.update();

    return {
      success,
      data: {
        message: success ? 'Dependencies updated successfully' : 'Update failed',
      },
      metadata: {
        executedVia: 'foundry',
        command: 'forge update',
      },
    };
  } catch (error) {
    logger.error('Dependency update failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Update failed',
      metadata: {
        executedVia: 'foundry',
        command: 'forge update',
      },
    };
  }
}

/**
 * 4. Remove dependency
 */
export async function foundryRemove(args: { dependency: string }): Promise<ToolResult> {
  try {
    logger.info('Removing dependency', { dependency: args.dependency });

    const success = await foundryService.remove(args.dependency);

    return {
      success,
      data: {
        message: success ? `Dependency ${args.dependency} removed successfully` : 'Removal failed',
        dependency: args.dependency,
      },
      metadata: {
        executedVia: 'foundry',
        command: `forge remove ${args.dependency}`,
      },
    };
  } catch (error) {
    logger.error('Dependency removal failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Removal failed',
      metadata: {
        executedVia: 'foundry',
        command: 'forge remove',
      },
    };
  }
}

/**
 * 5. Clean artifacts
 */
export async function foundryClean(args: { directory?: string } = {}): Promise<ToolResult> {
  try {
    logger.info('Cleaning artifacts and cache', { directory: args.directory });

    const success = await foundryService.clean(args.directory);

    return {
      success,
      data: {
        message: success ? 'Artifacts and cache cleaned' : 'Clean failed',
      },
      metadata: {
        executedVia: 'foundry',
        command: 'forge clean',
      },
    };
  } catch (error) {
    logger.error('Clean failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Clean failed',
      metadata: {
        executedVia: 'foundry',
        command: 'forge clean',
      },
    };
  }
}

/**
 * 6. Build contracts
 */
export async function foundryBuild(args: {
  force?: boolean;
  optimize?: boolean;
  optimizerRuns?: number;
  viaIr?: boolean;
  directory?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Building contracts', args);

    const result = await foundryService.build({
      force: args.force,
      optimize: args.optimize,
      optimizerRuns: args.optimizerRuns,
      via_ir: args.viaIr,
    }, args.directory);

    if (result.success) {
      return {
        success: true,
        data: {
          message: 'Contracts compiled successfully',
          artifactCount: result.artifacts?.length || 0,
        },
        metadata: {
          executedVia: 'foundry',
          command: 'forge build',
        },
      };
    } else {
      return {
        success: false,
        error: result.errors?.join('\n') || 'Compilation failed',
        metadata: {
          executedVia: 'foundry',
          command: 'forge build',
        },
      };
    }
  } catch (error) {
    logger.error('Build failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Build failed',
      metadata: {
        executedVia: 'foundry',
        command: 'forge build',
      },
    };
  }
}

/**
 * 7. Format Solidity code
 */
export async function foundryFmt(args: { directory?: string } = {}): Promise<ToolResult> {
  try {
    logger.info('Formatting Solidity code', { directory: args.directory });

    const success = await foundryService.fmt(args.directory);

    return {
      success,
      data: {
        message: success ? 'Code formatted successfully' : 'Format failed',
      },
      metadata: {
        executedVia: 'foundry',
        command: 'forge fmt',
      },
    };
  } catch (error) {
    logger.error('Format failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Format failed',
      metadata: {
        executedVia: 'foundry',
        command: 'forge fmt',
      },
    };
  }
}

/**
 * 8. Inspect contract
 */
export async function foundryInspect(args: {
  contractName: string;
  field: 'abi' | 'bytecode' | 'deployedBytecode' | 'assembly' | 'storage-layout' | 'methods';
}): Promise<ToolResult> {
  try {
    logger.info('Inspecting contract', args);

    const result = await foundryService.inspect(args.contractName, args.field);

    return {
      success: true,
      data: {
        contractName: args.contractName,
        field: args.field,
        result,
      },
      metadata: {
        executedVia: 'foundry',
        command: `forge inspect ${args.contractName} ${args.field}`,
      },
    };
  } catch (error) {
    logger.error('Inspect failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Inspect failed',
      metadata: {
        executedVia: 'foundry',
        command: 'forge inspect',
      },
    };
  }
}

/**
 * 9. Run tests
 */
export async function foundryTest(args: {
  matchTest?: string;
  matchContract?: string;
  forkUrl?: string;
  gasReport?: boolean;
  verbosity?: number;
  directory?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Running tests', args);

    const result = await foundryService.test({
      matchTest: args.matchTest,
      matchContract: args.matchContract,
      forkUrl: args.forkUrl,
      gasReport: args.gasReport,
      verbosity: args.verbosity,
    }, args.directory);

    return {
      success: result.success,
      data: {
        passed: result.passed,
        failed: result.failed,
        total: result.total,
        duration: result.duration,
        gasReport: result.gasReport,
        failures: result.failures,
      },
      metadata: {
        executedVia: 'foundry',
        command: 'forge test',
      },
    };
  } catch (error) {
    logger.error('Tests failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tests failed',
      metadata: {
        executedVia: 'foundry',
        command: 'forge test',
      },
    };
  }
}

/**
 * 10. Create gas snapshot
 */
export async function foundrySnapshot(args: { directory?: string } = {}): Promise<ToolResult> {
  try {
    logger.info('Creating gas snapshot', { directory: args.directory });

    const result = await foundryService.snapshot(args.directory);

    return {
      success: result.success,
      data: {
        message: result.success ? 'Gas snapshot created' : 'Snapshot failed',
        snapshots: result.snapshots,
        diff: result.diff,
      },
      metadata: {
        executedVia: 'foundry',
        command: 'forge snapshot',
      },
    };
  } catch (error) {
    logger.error('Snapshot failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Snapshot failed',
      metadata: {
        executedVia: 'foundry',
        command: 'forge snapshot',
      },
    };
  }
}

/**
 * 11. Deploy contract using forge create
 */
export async function foundryCreate(args: {
  contractPath: string;
  constructorArgs?: string[];
  rpcUrl?: string;
  privateKey?: string;
  gasLimit?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Deploying contract', { contractPath: args.contractPath });

    // Import key converter utilities
    const { resolvePrivateKey, getRpcUrl } = await import('../utils/key-converter.js');

    // Auto-resolve private key and RPC URL if not provided
    const privateKey = resolvePrivateKey(args.privateKey);
    const rpcUrl = args.rpcUrl || getRpcUrl();

    const result = await foundryService.create({
      contractPath: args.contractPath,
      constructorArgs: args.constructorArgs,
      rpcUrl,
      privateKey,
      gasLimit: args.gasLimit,
    });

    if (result.success) {
      return {
        success: true,
        data: {
          message: 'Contract deployed successfully',
          address: result.address,
          transactionHash: result.transactionHash,
          blockNumber: result.blockNumber,
        },
        metadata: {
          executedVia: 'foundry',
          command: 'forge create',
        },
      };
    } else {
      return {
        success: false,
        error: 'Deployment failed',
        metadata: {
          executedVia: 'foundry',
          command: 'forge create',
        },
      };
    }
  } catch (error) {
    logger.error('Deployment failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Deployment failed',
      metadata: {
        executedVia: 'foundry',
        command: 'forge create',
      },
    };
  }
}

/**
 * 12. Run Solidity deployment script
 */
export async function foundryScript(args: {
  scriptPath: string;
  broadcast?: boolean;
  rpcUrl?: string;
  privateKey?: string;
  verify?: boolean;
}): Promise<ToolResult> {
  try {
    logger.info('Running deployment script', { scriptPath: args.scriptPath });

    // Import key converter utilities for auto-resolution
    const { resolvePrivateKey, getRpcUrl } = await import('../utils/key-converter.js');

    // Auto-resolve private key and RPC URL if broadcasting
    let privateKey = args.privateKey;
    let rpcUrl = args.rpcUrl;

    if (args.broadcast) {
      // For broadcasting, we need private key and RPC URL
      privateKey = privateKey || resolvePrivateKey();
      rpcUrl = rpcUrl || getRpcUrl();
    }

    const result = await foundryService.runScript(args.scriptPath, {
      broadcast: args.broadcast,
      rpcUrl,
      privateKey,
      verify: args.verify,
    });

    return {
      success: result.success,
      data: {
        message: result.success ? 'Script executed successfully' : 'Script failed',
        transactions: result.transactions,
        output: result.output,
      },
      metadata: {
        executedVia: 'foundry',
        command: 'forge script',
      },
    };
  } catch (error) {
    logger.error('Script execution failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Script failed',
      metadata: {
        executedVia: 'foundry',
        command: 'forge script',
      },
    };
  }
}

/**
 * 13. Get compiled artifacts
 */
export async function foundryGetArtifacts(args: { contractName?: string; directory?: string }): Promise<ToolResult> {
  try {
    logger.info('Getting artifacts', { contractName: args.contractName, directory: args.directory });

    const artifacts = await foundryService.getArtifacts(args.contractName, args.directory);

    return {
      success: true,
      data: {
        artifacts,
        count: artifacts.length,
      },
      metadata: {
        executedVia: 'foundry',
        command: 'get artifacts',
      },
    };
  } catch (error) {
    logger.error('Failed to get artifacts', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get artifacts',
      metadata: {
        executedVia: 'foundry',
        command: 'get artifacts',
      },
    };
  }
}

/**
 * 14. Call contract function (read-only)
 */
export async function foundryCall(args: {
  address: string;
  signature: string;
  args?: string[];
  rpcUrl?: string;
  blockNumber?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Calling contract function', { address: args.address, signature: args.signature });

    const result = await foundryService.call({
      address: args.address,
      signature: args.signature,
      args: args.args,
      rpcUrl: args.rpcUrl,
      blockNumber: args.blockNumber,
    });

    return {
      success: true,
      data: {
        result,
      },
      metadata: {
        executedVia: 'foundry',
        command: 'cast call',
      },
    };
  } catch (error) {
    logger.error('Contract call failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Contract call failed',
      metadata: {
        executedVia: 'foundry',
        command: 'cast call',
      },
    };
  }
}

/**
 * 15. Send transaction
 */
export async function foundrySend(args: {
  address: string;
  signature: string;
  args?: string[];
  rpcUrl: string;
  privateKey: string;
  value?: string;
  gasLimit?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Sending transaction', { address: args.address, signature: args.signature });

    const result = await foundryService.send({
      address: args.address,
      signature: args.signature,
      args: args.args,
      rpcUrl: args.rpcUrl,
      privateKey: args.privateKey,
      value: args.value,
      gasLimit: args.gasLimit,
    });

    return {
      success: true,
      data: {
        transactionHash: result.transactionHash,
        output: result.output,
      },
      metadata: {
        executedVia: 'foundry',
        command: 'cast send',
      },
    };
  } catch (error) {
    logger.error('Transaction failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Transaction failed',
      metadata: {
        executedVia: 'foundry',
        command: 'cast send',
      },
    };
  }
}

/**
 * 16. Start Anvil local node
 */
export async function foundryAnvilStart(args: {
  port?: number;
  forkUrl?: string;
  chainId?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Starting Anvil', args);

    const success = await foundryService.startAnvil({
      port: args.port,
      forkUrl: args.forkUrl,
      chainId: args.chainId,
    });

    return {
      success,
      data: {
        message: success ? 'Anvil started successfully' : 'Failed to start Anvil',
        port: args.port || 8545,
        forkUrl: args.forkUrl,
        chainId: args.chainId,
      },
      metadata: {
        executedVia: 'foundry',
        command: 'anvil',
      },
    };
  } catch (error) {
    logger.error('Failed to start Anvil', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start Anvil',
      metadata: {
        executedVia: 'foundry',
        command: 'anvil',
      },
    };
  }
}

/**
 * 17. Stop Anvil local node
 */
export async function foundryAnvilStop(): Promise<ToolResult> {
  try {
    logger.info('Stopping Anvil');

    const success = await foundryService.stopAnvil();

    return {
      success,
      data: {
        message: success ? 'Anvil stopped successfully' : 'Anvil was not running',
      },
      metadata: {
        executedVia: 'foundry',
        command: 'anvil stop',
      },
    };
  } catch (error) {
    logger.error('Failed to stop Anvil', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop Anvil',
      metadata: {
        executedVia: 'foundry',
        command: 'anvil stop',
      },
    };
  }
}

/**
 * Export tool definitions for MCP
 */
export const foundryTools = [
  {
    name: 'foundry_init',
    description:
      'Initialize a new Foundry project with Hedera network configuration. Creates directory structure, config files, sample contracts, tests, and deployment scripts.',
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
        template: {
          type: 'string',
          description: 'Project template (default: "basic")',
          enum: ['basic', 'advanced'],
          default: 'basic',
        },
      },
    },
  },
  {
    name: 'foundry_install',
    description:
      'Install a dependency via git submodule. Examples: forge-std, openzeppelin-contracts. Use format: org/repo (e.g., "OpenZeppelin/openzeppelin-contracts")',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dependency: {
          type: 'string',
          description: 'Dependency to install (format: org/repo, e.g., "foundry-rs/forge-std")',
        },
      },
      required: ['dependency'],
    },
  },
  {
    name: 'foundry_update',
    description: 'Update all git submodule dependencies to their latest versions.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'foundry_remove',
    description: 'Remove a dependency from the project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dependency: {
          type: 'string',
          description: 'Dependency to remove (e.g., "forge-std")',
        },
      },
      required: ['dependency'],
    },
  },
  {
    name: 'foundry_clean',
    description: 'Clean build artifacts and cache directories. Useful before fresh compilation.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'foundry_build',
    description:
      'Compile all Solidity contracts in the project. Significantly faster than Hardhat (3-4x). Generates artifacts in out/ directory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        force: {
          type: 'boolean',
          description: 'Force recompilation (default: false)',
          default: false,
        },
        optimize: {
          type: 'boolean',
          description: 'Enable optimizer (default: false)',
          default: false,
        },
        optimizerRuns: {
          type: 'number',
          description: 'Optimizer runs (default: 200)',
          default: 200,
        },
        viaIr: {
          type: 'boolean',
          description: 'Compile via Yul IR (default: false)',
          default: false,
        },
      },
    },
  },
  {
    name: 'foundry_fmt',
    description: 'Format all Solidity code in the project according to Foundry style guide.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'foundry_inspect',
    description:
      'Inspect compiled contract artifacts. Can retrieve ABI, bytecode, storage layout, assembly, and more.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractName: {
          type: 'string',
          description: 'Contract name to inspect (e.g., "Greeter")',
        },
        field: {
          type: 'string',
          description: 'Field to inspect',
          enum: ['abi', 'bytecode', 'deployedBytecode', 'assembly', 'storage-layout', 'methods'],
        },
      },
      required: ['contractName', 'field'],
    },
  },
  {
    name: 'foundry_test',
    description:
      'Run Forge test suite with native fuzzing support. Tests are written in Solidity. Supports filtering, gas reports, and forking.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        matchTest: {
          type: 'string',
          description: 'Run tests matching pattern (e.g., "testTransfer")',
        },
        matchContract: {
          type: 'string',
          description: 'Run tests in contracts matching pattern (e.g., "GreeterTest")',
        },
        forkUrl: {
          type: 'string',
          description: 'Fork from a live network (e.g., "https://testnet.hashio.io/api")',
        },
        gasReport: {
          type: 'boolean',
          description: 'Generate detailed gas report (default: false)',
          default: false,
        },
        verbosity: {
          type: 'number',
          description: 'Verbosity level 1-5 (default: 3)',
          default: 3,
        },
      },
    },
  },
  {
    name: 'foundry_snapshot',
    description:
      'Create or compare gas snapshots for all tests. Useful for tracking gas optimizations over time.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'foundry_create',
    description:
      'Deploy a single contract to Hedera network using forge create. For complex multi-contract deployments, use foundry_script instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractPath: {
          type: 'string',
          description: 'Contract path (e.g., "src/Greeter.sol:Greeter")',
        },
        constructorArgs: {
          type: 'array',
          description: 'Constructor arguments (e.g., ["Hello, Hedera!"])',
          items: {
            type: 'string',
          },
        },
        rpcUrl: {
          type: 'string',
          description: 'RPC URL (e.g., "https://testnet.hashio.io/api")',
        },
        privateKey: {
          type: 'string',
          description: 'Deployer private key (0x...)',
        },
        gasLimit: {
          type: 'number',
          description: 'Gas limit override',
        },
      },
      required: ['contractPath', 'rpcUrl', 'privateKey'],
    },
  },
  {
    name: 'foundry_script',
    description:
      'Run a Solidity deployment script. Scripts provide more control than forge create for complex deployments with multiple contracts and configuration.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        scriptPath: {
          type: 'string',
          description: 'Script path (e.g., "script/Deploy.s.sol")',
        },
        broadcast: {
          type: 'boolean',
          description: 'Broadcast transactions to network (default: false)',
          default: false,
        },
        rpcUrl: {
          type: 'string',
          description: 'RPC URL (e.g., "https://testnet.hashio.io/api")',
        },
        privateKey: {
          type: 'string',
          description: 'Deployer private key (0x...)',
        },
        verify: {
          type: 'boolean',
          description: 'Verify contracts on HashScan (default: false)',
          default: false,
        },
      },
      required: ['scriptPath'],
    },
  },
  {
    name: 'foundry_get_artifacts',
    description: 'Get compiled contract artifacts including ABI, bytecode, and metadata from out/ directory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractName: {
          type: 'string',
          description: 'Specific contract name (default: all contracts)',
        },
      },
    },
  },
  {
    name: 'foundry_call',
    description:
      'Call a contract function (read-only, no gas cost). Uses cast call. For state-changing transactions, use foundry_send.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Contract address (0x...)',
        },
        signature: {
          type: 'string',
          description: 'Function signature (e.g., "greet()(string)" or "balanceOf(address)(uint256)")',
        },
        args: {
          type: 'array',
          description: 'Function arguments (default: [])',
          items: {
            type: 'string',
          },
        },
        rpcUrl: {
          type: 'string',
          description: 'RPC URL (default: from foundry.toml)',
        },
        blockNumber: {
          type: 'string',
          description: 'Block number or "latest" (default: "latest")',
        },
      },
      required: ['address', 'signature'],
    },
  },
  {
    name: 'foundry_send',
    description: 'Send a transaction to a contract (state-changing, requires gas). Uses cast send.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Contract address (0x...)',
        },
        signature: {
          type: 'string',
          description: 'Function signature (e.g., "setGreeting(string)" or "transfer(address,uint256)")',
        },
        args: {
          type: 'array',
          description: 'Function arguments (default: [])',
          items: {
            type: 'string',
          },
        },
        rpcUrl: {
          type: 'string',
          description: 'RPC URL (e.g., "https://testnet.hashio.io/api")',
        },
        privateKey: {
          type: 'string',
          description: 'Sender private key (0x...)',
        },
        value: {
          type: 'string',
          description: 'HBAR value to send in wei (default: "0")',
        },
        gasLimit: {
          type: 'number',
          description: 'Gas limit override',
        },
      },
      required: ['address', 'signature', 'rpcUrl', 'privateKey'],
    },
  },
  {
    name: 'foundry_anvil_start',
    description:
      'Start Anvil local Ethereum node for testing. Can fork from Hedera testnet/mainnet for realistic testing environment.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        port: {
          type: 'number',
          description: 'Port to run on (default: 8545)',
          default: 8545,
        },
        forkUrl: {
          type: 'string',
          description: 'Fork from network URL (e.g., "https://testnet.hashio.io/api")',
        },
        chainId: {
          type: 'number',
          description: 'Chain ID (default: 31337)',
          default: 31337,
        },
      },
    },
  },
  {
    name: 'foundry_anvil_stop',
    description: 'Stop the running Anvil local node.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];
