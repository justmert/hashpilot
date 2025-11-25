/**
 * Composite Tools - Optimized MCP tool patterns
 * Reduces tool count by combining related operations
 */

import { ToolResult } from '../types/index.js';
import logger from '../utils/logger.js';

// Import granular tools
import * as tokenTools from './token.js';
import * as accountTools from './account.js';
import * as consensusTools from './consensus.js';
import * as stateTools from './state.js';

/**
 * Composite Token Management Tool
 * Consolidates 12 token operations into 1 tool
 */
export async function tokenManage(args: {
  operation: 'create' | 'associate' | 'transfer' | 'mint' | 'burn' | 'freeze' | 'unfreeze' | 'kyc_grant' | 'kyc_revoke' | 'wipe' | 'pause' | 'unpause';
  // Common parameters
  tokenId?: string;
  accountId?: string;
  amount?: number;
  // Create-specific
  name?: string;
  symbol?: string;
  decimals?: number;
  initialSupply?: number;
  adminKey?: boolean;
  kycKey?: boolean;
  freezeKey?: boolean;
  wipeKey?: boolean;
  supplyKey?: boolean;
  pauseKey?: boolean;
  memo?: string;
  customFees?: any[];
  // Transfer-specific
  from?: string;
  to?: string;
  senderPrivateKey?: string;
  // Associate-specific
  privateKey?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Token management operation', { operation: args.operation });

    switch (args.operation) {
      case 'create':
        return await tokenTools.createToken({
          name: args.name!,
          symbol: args.symbol!,
          decimals: args.decimals,
          initialSupply: args.initialSupply,
          adminKey: args.adminKey,
          kycKey: args.kycKey,
          freezeKey: args.freezeKey,
          wipeKey: args.wipeKey,
          supplyKey: args.supplyKey,
          pauseKey: args.pauseKey,
          memo: args.memo,
          customFees: args.customFees,
        });

      case 'associate':
        return await tokenTools.associateToken({
          accountId: args.accountId!,
          tokenId: args.tokenId!,
          privateKey: args.privateKey,
        });

      case 'transfer':
        return await tokenTools.transferToken({
          tokenId: args.tokenId!,
          from: args.from!,
          to: args.to!,
          amount: args.amount!,
          senderPrivateKey: args.senderPrivateKey,
        });

      case 'mint':
        return await tokenTools.mintToken({
          tokenId: args.tokenId!,
          amount: args.amount!,
        });

      case 'burn':
        return await tokenTools.burnToken({
          tokenId: args.tokenId!,
          amount: args.amount!,
        });

      case 'freeze':
        return await tokenTools.freezeToken({
          tokenId: args.tokenId!,
          accountId: args.accountId!,
        });

      case 'unfreeze':
        return await tokenTools.unfreezeToken({
          tokenId: args.tokenId!,
          accountId: args.accountId!,
        });

      case 'kyc_grant':
        return await tokenTools.grantKyc({
          tokenId: args.tokenId!,
          accountId: args.accountId!,
        });

      case 'kyc_revoke':
        return await tokenTools.revokeKyc({
          tokenId: args.tokenId!,
          accountId: args.accountId!,
        });

      case 'wipe':
        return await tokenTools.wipeToken({
          tokenId: args.tokenId!,
          accountId: args.accountId!,
          amount: args.amount!,
        });

      case 'pause':
        return await tokenTools.pauseToken({
          tokenId: args.tokenId!,
        });

      case 'unpause':
        return await tokenTools.unpauseToken({
          tokenId: args.tokenId!,
        });

      default:
        return {
          success: false,
          error: `Unknown token operation: ${args.operation}`,
        };
    }
  } catch (error) {
    logger.error('Token management failed', { operation: args.operation, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Composite Address Book Tool
 * Consolidates 4 address book operations into 1 tool
 */
export async function addressBookManage(args: {
  operation: 'add' | 'list' | 'remove' | 'update' | 'import';
  // Common
  alias?: string;
  nickname?: string;
  // Add/Import specific
  accountId?: string;
  privateKey?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Address book operation', { operation: args.operation });

    switch (args.operation) {
      case 'add':
        return await accountTools.addToAddressBook({
          accountId: args.accountId!,
          alias: args.alias!,
          nickname: args.nickname,
        });

      case 'list':
        return await accountTools.listAddressBook();

      case 'remove':
        return await accountTools.removeFromAddressBook({
          alias: args.alias!,
        });

      case 'update':
        return await accountTools.updateAddressBook({
          alias: args.alias!,
          nickname: args.nickname!,
        });

      case 'import':
        return await accountTools.importAccount({
          accountId: args.accountId!,
          privateKey: args.privateKey!,
          alias: args.alias!,
          nickname: args.nickname,
        });

      default:
        return {
          success: false,
          error: `Unknown address book operation: ${args.operation}`,
        };
    }
  } catch (error) {
    logger.error('Address book operation failed', { operation: args.operation, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Composite State Management Tool
 * Consolidates 3 state operations into 1 tool
 */
export async function stateManage(args: {
  operation: 'backup' | 'restore' | 'export';
  // Backup/Export specific
  includePrivateKeys?: boolean;
  outputPath?: string;
  filename?: string;
  format?: 'json' | 'compact' | 'pretty';
  // Restore specific
  backupPath?: string;
  merge?: boolean;
}): Promise<ToolResult> {
  try {
    logger.info('State management operation', { operation: args.operation });

    switch (args.operation) {
      case 'backup':
        return await stateTools.backupState({
          includePrivateKeys: args.includePrivateKeys,
          outputPath: args.outputPath,
          filename: args.filename,
        });

      case 'restore':
        return await stateTools.restoreState({
          backupPath: args.backupPath!,
          merge: args.merge,
        });

      case 'export':
        return await stateTools.exportState({
          outputPath: args.outputPath!,
          format: args.format,
          includePrivateKeys: args.includePrivateKeys,
        });

      default:
        return {
          success: false,
          error: `Unknown state operation: ${args.operation}`,
        };
    }
  } catch (error) {
    logger.error('State management failed', { operation: args.operation, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Composite HCS Topic Tool
 * Consolidates topic operations into 1 tool
 */
export async function hcsTopicManage(args: {
  operation: 'create' | 'update' | 'subscribe' | 'info';
  // Common
  topicId?: string;
  // Create specific
  memo?: string;
  adminKey?: boolean;
  submitKey?: boolean;
  autoRenewPeriod?: number;
  // Update specific
  // Subscribe specific
  startTime?: string;
}): Promise<ToolResult> {
  try {
    logger.info('HCS topic operation', { operation: args.operation });

    switch (args.operation) {
      case 'create':
        return await consensusTools.createTopic({
          memo: args.memo,
          adminKey: args.adminKey,
          submitKey: args.submitKey,
          autoRenewPeriod: args.autoRenewPeriod,
        });

      case 'update':
        return await consensusTools.updateTopic({
          topicId: args.topicId!,
          memo: args.memo,
          autoRenewPeriod: args.autoRenewPeriod,
        });

      case 'subscribe':
        return await consensusTools.subscribeToTopic({
          topicId: args.topicId!,
          startTime: args.startTime,
        });

      default:
        return {
          success: false,
          error: `Unknown topic operation: ${args.operation}`,
        };
    }
  } catch (error) {
    logger.error('HCS topic operation failed', { operation: args.operation, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Composite HCS Message Tool
 * Consolidates message operations into 1 tool
 */
export async function hcsMessageManage(args: {
  operation: 'submit' | 'query';
  topicId: string;
  // Submit specific
  message?: string;
  submitKey?: string;
  // Query specific
  limit?: number;
  order?: 'asc' | 'desc';
  sequenceNumber?: number;
}): Promise<ToolResult> {
  try {
    logger.info('HCS message operation', { operation: args.operation });

    switch (args.operation) {
      case 'submit':
        return await consensusTools.submitMessage({
          topicId: args.topicId,
          message: args.message!,
          submitKey: args.submitKey,
        });

      case 'query':
        return await consensusTools.queryMessages({
          topicId: args.topicId,
          limit: args.limit,
          order: args.order,
          sequenceNumber: args.sequenceNumber,
        });

      default:
        return {
          success: false,
          error: `Unknown message operation: ${args.operation}`,
        };
    }
  } catch (error) {
    logger.error('HCS message operation failed', { operation: args.operation, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Tool definitions for composite tools
export const compositeToolDefinitions = [
  {
    name: 'token_manage',
    description: `Comprehensive Hedera Token Service (HTS) management. Execute ANY token operation through a single unified interface.

OPERATIONS:
- create: Create new fungible token with custom fees, keys, and supply controls
- associate: Associate token with account (required before receiving tokens)
- transfer: Transfer tokens between accounts
- mint: Mint additional tokens (requires supply key)
- burn: Burn tokens from treasury
- freeze/unfreeze: Control account's ability to transfer specific token
- kyc_grant/kyc_revoke: Manage KYC status for regulated tokens
- wipe: Remove tokens from account (requires wipe key)
- pause/unpause: Halt/resume all token operations globally

USE THIS FOR: All token lifecycle management, compliance operations, supply control, and transfer operations.

REQUIRES: Operator account with appropriate keys (admin/supply/freeze/kyc/wipe/pause) based on operation.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'associate', 'transfer', 'mint', 'burn', 'freeze', 'unfreeze', 'kyc_grant', 'kyc_revoke', 'wipe', 'pause', 'unpause'],
          description: 'Token operation to perform',
        },
        tokenId: {
          type: 'string',
          description: 'Token ID (format: 0.0.xxxxx) - required for all ops except create',
        },
        accountId: {
          type: 'string',
          description: 'Target account ID - for associate/freeze/unfreeze/kyc/wipe',
        },
        amount: {
          type: 'number',
          description: 'Amount for transfer/mint/burn/wipe operations',
        },
        name: {
          type: 'string',
          description: 'Token name (for create)',
        },
        symbol: {
          type: 'string',
          description: 'Token symbol (for create)',
        },
        decimals: {
          type: 'number',
          description: 'Decimal places (for create, default: 0)',
        },
        initialSupply: {
          type: 'number',
          description: 'Initial token supply (for create)',
        },
        adminKey: {
          type: 'boolean',
          description: 'Enable admin key (for create)',
        },
        supplyKey: {
          type: 'boolean',
          description: 'Enable supply key for mint/burn (for create)',
        },
        freezeKey: {
          type: 'boolean',
          description: 'Enable freeze key (for create)',
        },
        kycKey: {
          type: 'boolean',
          description: 'Enable KYC key (for create)',
        },
        wipeKey: {
          type: 'boolean',
          description: 'Enable wipe key (for create)',
        },
        pauseKey: {
          type: 'boolean',
          description: 'Enable pause key (for create)',
        },
        memo: {
          type: 'string',
          description: 'Token memo (for create)',
        },
        from: {
          type: 'string',
          description: 'Source account (for transfer)',
        },
        to: {
          type: 'string',
          description: 'Destination account (for transfer)',
        },
      },
      required: ['operation'],
    },
  },
  {
    name: 'addressbook_manage',
    description: `Manage Hedera account address book for multi-account workflows.

OPERATIONS:
- add: Add account to address book (reference only, no private key)
- import: Import account WITH private key for transaction signing
- list: Show all saved accounts with aliases and metadata
- update: Update account nickname
- remove: Remove account from address book

USE THIS FOR: Managing multiple accounts, organizing workflows, quick account reference.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: ['add', 'import', 'list', 'remove', 'update'],
          description: 'Address book operation',
        },
        accountId: {
          type: 'string',
          description: 'Hedera account ID (for add/import)',
        },
        alias: {
          type: 'string',
          description: 'Unique alias for quick reference',
        },
        nickname: {
          type: 'string',
          description: 'Human-readable name',
        },
        privateKey: {
          type: 'string',
          description: 'Private key in DER format (for import only)',
        },
      },
      required: ['operation'],
    },
  },
  {
    name: 'state_manage',
    description: `Manage HashPilot MCP server state through backup/restore/export operations.

OPERATIONS:
- backup: Create timestamped backup (excludes private keys by default for security)
- restore: Restore state from backup file (can merge or replace)
- export: Export state to JSON for inspection or sharing

USE THIS FOR: State persistence, migration, disaster recovery, debugging.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: ['backup', 'restore', 'export'],
          description: 'State management operation',
        },
        includePrivateKeys: {
          type: 'boolean',
          description: 'Include private keys (INSECURE - use with caution)',
        },
        outputPath: {
          type: 'string',
          description: 'Output file path (for backup/export)',
        },
        backupPath: {
          type: 'string',
          description: 'Backup file to restore from',
        },
        merge: {
          type: 'boolean',
          description: 'Merge with existing state instead of replacing',
        },
        format: {
          type: 'string',
          enum: ['json', 'compact', 'pretty'],
          description: 'Export format (default: pretty)',
        },
      },
      required: ['operation'],
    },
  },
  {
    name: 'hcs_topic',
    description: `Hedera Consensus Service (HCS) topic management.

OPERATIONS:
- create: Create new public or private topic with configurable keys
- update: Update topic memo or auto-renew period
- subscribe: Subscribe to real-time topic messages

USE THIS FOR: Creating consensus topics, configuring topic settings, real-time message streams.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'update', 'subscribe'],
          description: 'Topic operation',
        },
        topicId: {
          type: 'string',
          description: 'Topic ID (for update/subscribe)',
        },
        memo: {
          type: 'string',
          description: 'Topic memo (max 100 bytes)',
        },
        adminKey: {
          type: 'boolean',
          description: 'Enable admin key for updates/deletion',
        },
        submitKey: {
          type: 'boolean',
          description: 'Enable submit key (makes topic private)',
        },
        autoRenewPeriod: {
          type: 'number',
          description: 'Auto-renew period in seconds',
        },
        startTime: {
          type: 'string',
          description: 'ISO 8601 timestamp to start receiving messages',
        },
      },
      required: ['operation'],
    },
  },
  {
    name: 'hcs_message',
    description: `Hedera Consensus Service (HCS) message operations.

OPERATIONS:
- submit: Submit message to topic (auto-chunks if >1KB)
- query: Query historical messages with filtering (FREE via Mirror Node)

USE THIS FOR: Publishing messages, retrieving consensus-ordered data, auditable logs.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: ['submit', 'query'],
          description: 'Message operation',
        },
        topicId: {
          type: 'string',
          description: 'Topic ID (format: 0.0.xxxxx)',
        },
        message: {
          type: 'string',
          description: 'Message content (for submit)',
        },
        limit: {
          type: 'number',
          description: 'Max messages to return (for query)',
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order (for query)',
        },
        sequenceNumber: {
          type: 'number',
          description: 'Filter by sequence number >= value',
        },
      },
      required: ['operation', 'topicId'],
    },
  },
];

// Import Hardhat and Foundry tools
import * as hardhatTools from './hardhat.js';
import * as foundryTools from './foundry.js';

/**
 * Composite Hardhat Project Management Tool
 * Consolidates project-level operations into 1 tool
 */
export async function hardhatProjectManage(args: {
  operation: 'init' | 'compile' | 'test' | 'clean' | 'flatten' | 'get_artifacts' | 'get_accounts' | 'config_network' | 'run_task' | 'list_tasks';
  // Init-specific
  directory?: string;
  networks?: Array<'mainnet' | 'testnet' | 'previewnet' | 'local'>;
  solidity?: string;
  typescript?: boolean;
  // Compile-specific
  force?: boolean;
  // Test-specific
  testFiles?: string[];
  grep?: string;
  network?: string;
  // Flatten-specific
  contractPath?: string;
  // Get artifacts-specific
  contractName?: string;
  // Run task-specific
  task?: string;
  params?: any;
}): Promise<ToolResult> {
  try {
    logger.info('Hardhat project operation', { operation: args.operation });

    switch (args.operation) {
      case 'init':
        return await hardhatTools.hardhatInit({
          directory: args.directory,
          networks: args.networks,
          solidity: args.solidity,
          typescript: args.typescript,
        });

      case 'compile':
        return await hardhatTools.hardhatCompile({ force: args.force, directory: args.directory });

      case 'test':
        return await hardhatTools.hardhatTest({
          testFiles: args.testFiles,
          grep: args.grep,
          network: args.network,
          directory: args.directory,
        });

      case 'clean':
        return await hardhatTools.hardhatClean({ directory: args.directory });

      case 'flatten':
        return await hardhatTools.hardhatFlatten({ files: args.contractPath ? [args.contractPath] : undefined, directory: args.directory });

      case 'get_artifacts':
        return await hardhatTools.hardhatGetArtifacts({ contractName: args.contractName, directory: args.directory });

      case 'get_accounts':
        return await hardhatTools.hardhatGetAccounts({ directory: args.directory });

      case 'config_network':
        // Config network generates a config snippet, doesn't require all params
        return {
          success: true,
          data: {
            network: args.network || 'testnet',
            message: 'Use hardhat_contract with operation "deploy" and network parameter for actual deployment',
          },
        };

      case 'run_task':
        return await hardhatTools.hardhatRunTask({
          task: args.task!,
          params: args.params,
          directory: args.directory,
        });

      case 'list_tasks':
        return await hardhatTools.hardhatListTasks({ directory: args.directory });

      default:
        throw new Error(`Unknown operation: ${args.operation}`);
    }
  } catch (error) {
    logger.error('Hardhat project operation failed', { operation: args.operation, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Composite Hardhat Contract Management Tool
 * Consolidates contract-level operations into 1 tool
 */
export async function hardhatContractManage(args: {
  operation: 'deploy' | 'deploy_ignition' | 'verify' | 'call' | 'execute';
  // Common
  directory?: string;
  // Deploy-specific
  script?: string;
  network?: string;
  // Deploy Ignition-specific
  module?: string;
  // Verify-specific
  address?: string;
  constructorArgs?: any[];
  // Call/Execute-specific
  contractAddress?: string;
  abi?: any[];
  method?: string;
  methodArgs?: any[];
  privateKey?: string;
  value?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Hardhat contract operation', { operation: args.operation });

    switch (args.operation) {
      case 'deploy':
        return await hardhatTools.hardhatDeploy({
          script: args.script!,
          network: args.network,
          directory: args.directory,
        });

      case 'deploy_ignition':
        return await hardhatTools.hardhatDeployIgnition({
          module: args.module!,
          network: args.network,
          directory: args.directory,
        });

      case 'verify':
        return await hardhatTools.hardhatVerify({
          address: args.address!,
          constructorArgs: args.constructorArgs,
          directory: args.directory,
        });

      case 'call':
        return await hardhatTools.hardhatCallContract({
          address: args.contractAddress!,
          abi: args.abi!,
          method: args.method!,
          args: args.methodArgs,
          directory: args.directory,
        });

      case 'execute':
        return await hardhatTools.hardhatExecuteContract({
          address: args.contractAddress!,
          abi: args.abi!,
          method: args.method!,
          args: args.methodArgs,
          value: args.value,
          directory: args.directory,
        });

      default:
        throw new Error(`Unknown operation: ${args.operation}`);
    }
  } catch (error) {
    logger.error('Hardhat contract operation failed', { operation: args.operation, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Composite Foundry Project Management Tool
 * Consolidates project-level operations into 1 tool
 */
export async function foundryProjectManage(args: {
  operation: 'init' | 'install' | 'update' | 'remove' | 'clean' | 'build' | 'fmt' | 'inspect' | 'get_artifacts' | 'snapshot';
  // Init-specific
  directory?: string;
  template?: string;
  // Install/Remove-specific
  dependency?: string;
  // Build-specific
  optimize?: boolean;
  optimizerRuns?: number;
  viaIr?: boolean;
  // Inspect-specific
  contractName?: string;
  field?: 'abi' | 'bytecode' | 'assembly' | 'storage-layout';
}): Promise<ToolResult> {
  try {
    logger.info('Foundry project operation', { operation: args.operation });

    switch (args.operation) {
      case 'init':
        return await foundryTools.foundryInit({
          directory: args.directory,
          template: args.template as 'basic' | 'advanced' | undefined,
        });

      case 'install':
        return await foundryTools.foundryInstall({ dependency: args.dependency! });

      case 'update':
        return await foundryTools.foundryUpdate();

      case 'remove':
        return await foundryTools.foundryRemove({ dependency: args.dependency! });

      case 'clean':
        return await foundryTools.foundryClean({ directory: args.directory });

      case 'build':
        return await foundryTools.foundryBuild({
          optimize: args.optimize,
          optimizerRuns: args.optimizerRuns,
          viaIr: args.viaIr,
          directory: args.directory,
        });

      case 'fmt':
        return await foundryTools.foundryFmt({ directory: args.directory });

      case 'inspect':
        return await foundryTools.foundryInspect({
          contractName: args.contractName!,
          field: args.field || 'abi',
        });

      case 'get_artifacts':
        return await foundryTools.foundryGetArtifacts({ contractName: args.contractName, directory: args.directory });

      case 'snapshot':
        return await foundryTools.foundrySnapshot({ directory: args.directory });

      default:
        throw new Error(`Unknown operation: ${args.operation}`);
    }
  } catch (error) {
    logger.error('Foundry project operation failed', { operation: args.operation, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Composite Foundry Contract Management Tool
 * Consolidates contract-level operations into 1 tool
 */
export async function foundryContractManage(args: {
  operation: 'test' | 'create' | 'script' | 'call' | 'send' | 'anvil_start' | 'anvil_stop';
  // Common
  directory?: string;
  // Test-specific
  matchTest?: string;
  matchContract?: string;
  gasReport?: boolean;
  forkUrl?: string;
  verbosity?: number;
  // Create-specific
  contractName?: string;
  constructorArgs?: any[];
  rpcUrl?: string;
  privateKey?: string;
  // Script-specific
  scriptPath?: string;
  broadcast?: boolean;
  // Call/Send-specific
  address?: string;
  signature?: string;
  callArgs?: any[];
  value?: string;
  // Anvil-specific
  port?: number;
  forkBlock?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Foundry contract operation', { operation: args.operation });

    switch (args.operation) {
      case 'test':
        return await foundryTools.foundryTest({
          matchTest: args.matchTest,
          matchContract: args.matchContract,
          gasReport: args.gasReport,
          forkUrl: args.forkUrl,
          verbosity: args.verbosity,
          directory: args.directory,
        });

      case 'create':
        return await foundryTools.foundryCreate({
          contractPath: args.contractName!, // Using contractName as path
          constructorArgs: args.constructorArgs?.map(String),
          rpcUrl: args.rpcUrl!,
          privateKey: args.privateKey!,
        });

      case 'script':
        return await foundryTools.foundryScript({
          scriptPath: args.scriptPath!,
          rpcUrl: args.rpcUrl,
          broadcast: args.broadcast,
          privateKey: args.privateKey,
        });

      case 'call':
        return await foundryTools.foundryCall({
          address: args.address!,
          signature: args.signature!,
          args: args.callArgs,
          rpcUrl: args.rpcUrl,
        });

      case 'send':
        return await foundryTools.foundrySend({
          address: args.address!,
          signature: args.signature!,
          args: args.callArgs,
          rpcUrl: args.rpcUrl!,
          privateKey: args.privateKey!,
          value: args.value,
        });

      case 'anvil_start':
        return await foundryTools.foundryAnvilStart({
          port: args.port,
          forkUrl: args.forkUrl,
          chainId: args.forkBlock, // Use forkBlock as chainId if needed
        });

      case 'anvil_stop':
        return await foundryTools.foundryAnvilStop();

      default:
        throw new Error(`Unknown operation: ${args.operation}`);
    }
  } catch (error) {
    logger.error('Foundry contract operation failed', { operation: args.operation, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Hardhat and Foundry Composite Tool Definitions
 */
export const hardhatFoundryToolDefinitions = [
  {
    name: 'hardhat_project',
    description: `Manage Hardhat project lifecycle operations.

OPERATIONS:
- init: Initialize new Hardhat project with Hedera configuration
- compile: Compile Solidity contracts (with force option)
- test: Run Mocha/Chai tests with filtering
- clean: Clean artifacts and cache
- flatten: Flatten contracts for verification
- get_artifacts: Retrieve compiled ABI and bytecode
- get_accounts: List available accounts with balances
- config_network: Generate Hedera network config snippet
- run_task: Execute custom Hardhat task
- list_tasks: List all available tasks

USE FOR: Project setup, compilation, testing, and configuration management.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: ['init', 'compile', 'test', 'clean', 'flatten', 'get_artifacts', 'get_accounts', 'config_network', 'run_task', 'list_tasks'],
          description: 'Project operation to perform',
        },
        directory: { type: 'string', description: 'Absolute path to Hardhat project directory (required for all operations except init which creates it)' },
        networks: {
          type: 'array',
          items: { type: 'string', enum: ['mainnet', 'testnet', 'previewnet', 'local'] },
          description: 'Networks to configure (for init)',
        },
        solidity: { type: 'string', description: 'Solidity version (for init)' },
        typescript: { type: 'boolean', description: 'Use TypeScript (for init)' },
        force: { type: 'boolean', description: 'Force recompilation (for compile)' },
        testFiles: { type: 'array', items: { type: 'string' }, description: 'Test files to run (for test)' },
        grep: { type: 'string', description: 'Test filter pattern (for test)' },
        network: { type: 'string', description: 'Network name' },
        contractPath: { type: 'string', description: 'Contract file path (for flatten)' },
        contractName: { type: 'string', description: 'Contract name (for get_artifacts)' },
        task: { type: 'string', description: 'Task name (for run_task)' },
        params: { type: 'object', description: 'Task parameters (for run_task)' },
      },
      required: ['operation'],
    },
  },
  {
    name: 'hardhat_contract',
    description: `Manage Hardhat contract deployment and interaction.

OPERATIONS:
- deploy: Execute deployment script on target network
- deploy_ignition: Deploy using Hardhat Ignition (declarative)
- verify: Get contract verification metadata for HashScan
- call: Call read-only contract function (FREE)
- execute: Execute state-changing contract transaction

AUTO-RESOLUTION: Deployment automatically uses MCP operator account credentials. No need to set TESTNET_PRIVATE_KEY manually.

USE FOR: Contract deployment, verification, and interaction.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: ['deploy', 'deploy_ignition', 'verify', 'call', 'execute'],
          description: 'Contract operation to perform',
        },
        directory: { type: 'string', description: 'Absolute path to Hardhat project directory' },
        script: { type: 'string', description: 'Deployment script path (for deploy)' },
        module: { type: 'string', description: 'Ignition module path (for deploy_ignition)' },
        network: { type: 'string', description: 'Target network' },
        address: { type: 'string', description: 'Contract address (for verify)' },
        constructorArgs: { type: 'array', items: {}, description: 'Constructor arguments (for verify)' },
        contractAddress: { type: 'string', description: 'Contract address (for call/execute)' },
        abi: { type: 'array', items: {}, description: 'Contract ABI (for call/execute)' },
        method: { type: 'string', description: 'Method name (for call/execute)' },
        methodArgs: { type: 'array', items: {}, description: 'Method arguments (for call/execute)' },
        privateKey: { type: 'string', description: 'Private key (for execute) - optional, auto-uses MCP operator' },
        value: { type: 'string', description: 'HBAR value in wei (for execute)' },
      },
      required: ['operation'],
    },
  },
  {
    name: 'foundry_project',
    description: `Manage Foundry project lifecycle operations.

OPERATIONS:
- init: Initialize new Foundry project with templates
- install: Install git submodule dependency (e.g., forge-std)
- update: Update all dependencies
- remove: Remove a dependency
- clean: Clean build artifacts
- build: Compile contracts with optimization options
- fmt: Format Solidity code
- inspect: Inspect contract artifacts (ABI, bytecode, storage-layout)
- get_artifacts: Retrieve compiled artifacts
- snapshot: Create gas usage snapshot for optimization

USE FOR: Project setup, dependencies, compilation, and gas optimization.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: ['init', 'install', 'update', 'remove', 'clean', 'build', 'fmt', 'inspect', 'get_artifacts', 'snapshot'],
          description: 'Project operation to perform',
        },
        directory: { type: 'string', description: 'Absolute path to Foundry project directory (required for all operations except init which creates it)' },
        template: { type: 'string', description: 'Project template (for init)' },
        dependency: { type: 'string', description: 'Dependency name (for install/remove)' },
        optimize: { type: 'boolean', description: 'Enable optimizer (for build)' },
        optimizerRuns: { type: 'number', description: 'Optimizer runs (for build)' },
        viaIr: { type: 'boolean', description: 'Use IR pipeline (for build)' },
        contractName: { type: 'string', description: 'Contract name (for inspect/get_artifacts)' },
        field: {
          type: 'string',
          enum: ['abi', 'bytecode', 'assembly', 'storage-layout'],
          description: 'Inspection field (for inspect)',
        },
      },
      required: ['operation'],
    },
  },
  {
    name: 'foundry_contract',
    description: `Manage Foundry contract testing, deployment, and interaction.

OPERATIONS:
- test: Run Forge tests with fuzzing and gas reports
- create: Deploy single contract via forge create
- script: Execute Solidity deployment script
- call: Call read-only function via cast (FREE)
- send: Send state-changing transaction via cast
- anvil_start: Start local Anvil node (can fork from network)
- anvil_stop: Stop Anvil local node

AUTO-RESOLUTION: privateKey and rpcUrl are OPTIONAL - if not provided, automatically uses MCP operator account configuration.

USE FOR: Testing, deployment, gas analysis, and local development.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: ['test', 'create', 'script', 'call', 'send', 'anvil_start', 'anvil_stop'],
          description: 'Contract operation to perform',
        },
        directory: { type: 'string', description: 'Absolute path to Foundry project directory' },
        matchTest: { type: 'string', description: 'Test name filter (for test)' },
        matchContract: { type: 'string', description: 'Contract name filter (for test)' },
        gasReport: { type: 'boolean', description: 'Generate gas report (for test)' },
        forkUrl: { type: 'string', description: 'RPC URL to fork from (for test/anvil_start)' },
        verbosity: { type: 'number', description: 'Output verbosity 1-5 (for test)' },
        contractName: { type: 'string', description: 'Contract name (for create)' },
        constructorArgs: { type: 'array', items: {}, description: 'Constructor args (for create)' },
        rpcUrl: { type: 'string', description: 'JSON-RPC URL (optional - auto-resolves from MCP network config)' },
        privateKey: { type: 'string', description: 'Private key for signing (optional - auto-uses MCP operator key)' },
        scriptPath: { type: 'string', description: 'Script path (for script)' },
        broadcast: { type: 'boolean', description: 'Broadcast transactions (for script)' },
        address: { type: 'string', description: 'Contract address (for call/send)' },
        signature: { type: 'string', description: 'Function signature (for call/send)' },
        callArgs: { type: 'array', items: {}, description: 'Function arguments (for call/send)' },
        value: { type: 'string', description: 'ETH/HBAR value (for send)' },
        port: { type: 'number', description: 'Port number (for anvil_start)' },
        forkBlock: { type: 'number', description: 'Block to fork from (for anvil_start)' },
      },
      required: ['operation'],
    },
  },
];
