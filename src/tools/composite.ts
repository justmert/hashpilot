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
import * as mirrorNodeTools from './mirror-node.js';

/**
 * Composite Token Management Tool
 * Consolidates 12 token operations into 1 tool
 */
export async function tokenManage(args: {
  operation:
    | 'create'
    | 'associate'
    | 'transfer'
    | 'mint'
    | 'burn'
    | 'freeze'
    | 'unfreeze'
    | 'kyc_grant'
    | 'kyc_revoke'
    | 'wipe'
    | 'pause'
    | 'unpause';
  // Common parameters
  tokenId?: string;
  accountId?: string;
  amount?: number;
  // Create-specific
  name?: string;
  symbol?: string;
  tokenType?: string;
  decimals?: number;
  initialSupply?: number;
  supplyType?: string;
  maxSupply?: number;
  treasuryAccountId?: string;
  treasuryPrivateKey?: string;
  adminKey?: tokenTools.KeySpec;
  kycKey?: tokenTools.KeySpec;
  freezeKey?: tokenTools.KeySpec;
  wipeKey?: tokenTools.KeySpec;
  supplyKey?: tokenTools.KeySpec;
  pauseKey?: tokenTools.KeySpec;
  feeScheduleKey?: tokenTools.KeySpec;
  freezeDefault?: boolean;
  memo?: string;
  customFees?: tokenTools.CustomFeeSpec[];
  signerPrivateKeys?: string[];
  configPath?: string;
  config?: Record<string, unknown>;
  // Mint/burn/wipe (non-fungible)
  metadata?: string[];
  metadataEncoding?: 'utf8' | 'base64' | 'hex';
  serialNumbers?: number[];
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
          // name and symbol may instead come from configPath or config
          name: args.name,
          symbol: args.symbol,
          tokenType: args.tokenType,
          decimals: args.decimals,
          initialSupply: args.initialSupply,
          supplyType: args.supplyType,
          maxSupply: args.maxSupply,
          treasuryAccountId: args.treasuryAccountId,
          treasuryPrivateKey: args.treasuryPrivateKey,
          adminKey: args.adminKey,
          kycKey: args.kycKey,
          freezeKey: args.freezeKey,
          wipeKey: args.wipeKey,
          supplyKey: args.supplyKey,
          pauseKey: args.pauseKey,
          feeScheduleKey: args.feeScheduleKey,
          freezeDefault: args.freezeDefault,
          memo: args.memo,
          customFees: args.customFees,
          signerPrivateKeys: args.signerPrivateKeys,
          configPath: args.configPath,
          config: args.config,
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
          amount: args.amount,
          metadata: args.metadata,
          metadataEncoding: args.metadataEncoding,
        });

      case 'burn':
        return await tokenTools.burnToken({
          tokenId: args.tokenId!,
          amount: args.amount,
          serialNumbers: args.serialNumbers,
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
          amount: args.amount,
          serialNumbers: args.serialNumbers,
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
          outputPath: args.outputPath,
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
  adminKey?: consensusTools.KeySpec;
  submitKey?: consensusTools.KeySpec;
  autoRenewPeriod?: number;
  autoRenewAccountId?: string;
  signerPrivateKeys?: string[];
  // Update specific
  clearAdminKey?: boolean;
  clearSubmitKey?: boolean;
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
          autoRenewAccountId: args.autoRenewAccountId,
          signerPrivateKeys: args.signerPrivateKeys,
        });

      case 'update':
        return await consensusTools.updateTopic({
          topicId: args.topicId!,
          memo: args.memo,
          adminKey: args.adminKey,
          submitKey: args.submitKey,
          clearAdminKey: args.clearAdminKey,
          clearSubmitKey: args.clearSubmitKey,
          autoRenewPeriod: args.autoRenewPeriod,
          autoRenewAccountId: args.autoRenewAccountId,
          signerPrivateKeys: args.signerPrivateKeys,
        });

      case 'subscribe':
        return await consensusTools.subscribeToTopic({
          topicId: args.topicId!,
          startTime: args.startTime,
        });

      case 'info':
        return await mirrorNodeTools.mirrorGetTopicInfo({ topicId: args.topicId! });

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
  sequenceNumberGt?: number;
  sequenceNumberGte?: number;
  sequenceNumberLt?: number;
  sequenceNumberLte?: number;
  timestamp?: string;
  timestampFrom?: string;
  timestampTo?: string;
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
          sequenceNumberGt: args.sequenceNumberGt,
          sequenceNumberGte: args.sequenceNumberGte,
          sequenceNumberLt: args.sequenceNumberLt,
          sequenceNumberLte: args.sequenceNumberLte,
          timestamp: args.timestamp,
          timestampFrom: args.timestampFrom,
          timestampTo: args.timestampTo,
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
- create: Create a fungible token or an NFT collection, with custom fees, multi-signature keys and supply controls
- associate: Associate token with account (required before receiving tokens)
- transfer: Transfer tokens between accounts
- mint: Mint fungible amount, or NFT serials from a metadata array (requires supply key)
- burn: Burn a fungible amount, or NFT serials, from the treasury
- freeze/unfreeze: Control account's ability to transfer specific token
- kyc_grant/kyc_revoke: Manage KYC status for regulated tokens
- wipe: Remove tokens or NFT serials from an account (requires wipe key)
- pause/unpause: Halt/resume all token operations globally

KEYS (create): adminKey, kycKey, freezeKey, wipeKey, supplyKey, pauseKey and feeScheduleKey each accept true (use the operator key), a public key string in DER or raw hex, or { threshold, keys: [...] } for a multi-signature key list. supplyKey defaults to the operator key; the others are unset unless given.

SUPPLY CONTROLS (create): supplyType "finite" with maxSupply, or "infinite" (default). Passing maxSupply implies finite.

CUSTOM FEES (create): customFees takes fixed, fractional and royalty fee objects. Fractional fees are for fungible tokens, royalty fees for NFTs.

JSON CONFIGURATION (create): pass configPath (a path to a JSON file) and/or an inline config object holding the same fields. Precedence: explicit arguments beat config, which beats configPath. Example file:
${tokenTools.TOKEN_CONFIG_EXAMPLE}

USE THIS FOR: All token lifecycle management, compliance operations, supply control, and transfer operations.

REQUIRES: Operator account with appropriate keys (admin/supply/freeze/kyc/wipe/pause) based on operation.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: [
            'create',
            'associate',
            'transfer',
            'mint',
            'burn',
            'freeze',
            'unfreeze',
            'kyc_grant',
            'kyc_revoke',
            'wipe',
            'pause',
            'unpause',
          ],
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
          description: 'Amount for transfer/mint/burn/wipe of a fungible token',
        },
        name: {
          type: 'string',
          description: 'Token name (for create)',
        },
        symbol: {
          type: 'string',
          description: 'Token symbol (for create)',
        },
        tokenType: {
          type: 'string',
          enum: ['fungible', 'nft'],
          description:
            'fungible (default) or nft (for create). An nft needs decimals 0 and initialSupply 0; mint serials afterwards with metadata.',
        },
        decimals: {
          type: 'number',
          description: 'Decimal places (for create, default: 0)',
        },
        initialSupply: {
          type: 'number',
          description: 'Initial token supply (for create, default 1000 for fungible)',
        },
        supplyType: {
          type: 'string',
          enum: ['finite', 'infinite'],
          description: 'Supply control (for create): infinite (default) or finite with maxSupply',
        },
        maxSupply: {
          type: 'number',
          description: 'Maximum supply, requires supplyType finite (for create)',
        },
        treasuryAccountId: {
          type: 'string',
          description: 'Treasury account that holds the initial supply (defaults to the operator)',
        },
        treasuryPrivateKey: {
          type: 'string',
          description:
            'Private key of treasuryAccountId, required when the treasury is not the operator because that account must sign the create',
        },
        adminKey: {
          ...tokenTools.keyParameterSchema('Admin key, allows later token updates (for create)'),
        },
        supplyKey: {
          ...tokenTools.keyParameterSchema(
            'Supply key, allows mint and burn (for create, defaults to the operator key)'
          ),
        },
        freezeKey: { ...tokenTools.keyParameterSchema('Freeze key (for create)') },
        kycKey: { ...tokenTools.keyParameterSchema('KYC key (for create)') },
        wipeKey: { ...tokenTools.keyParameterSchema('Wipe key (for create)') },
        pauseKey: { ...tokenTools.keyParameterSchema('Pause key (for create)') },
        feeScheduleKey: {
          ...tokenTools.keyParameterSchema(
            'Fee schedule key, allows updating the custom fees (for create)'
          ),
        },
        freezeDefault: {
          type: 'boolean',
          description: 'Freeze new associations by default (for create, requires freezeKey)',
        },
        customFees: { ...tokenTools.CUSTOM_FEES_SCHEMA },
        memo: {
          type: 'string',
          description: 'Token memo (for create)',
        },
        signerPrivateKeys: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Extra private keys to sign the create with, needed when adminKey is a key you hold rather than the operator key',
        },
        configPath: {
          type: 'string',
          description: 'Path to a JSON file holding any of the create fields (for create)',
        },
        config: {
          type: 'object',
          description: 'Inline object holding any of the create fields (for create)',
        },
        metadata: {
          type: 'array',
          items: { type: 'string' },
          description:
            'NFT metadata, one entry per serial to mint, commonly an IPFS CID (for mint, max 100 bytes each)',
        },
        metadataEncoding: {
          type: 'string',
          enum: ['utf8', 'base64', 'hex'],
          description: 'How to read the metadata strings into bytes (for mint, default: utf8)',
        },
        serialNumbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'NFT serial numbers (for burn/wipe)',
        },
        from: {
          type: 'string',
          description: 'Source account (for transfer)',
        },
        to: {
          type: 'string',
          description: 'Destination account (for transfer)',
        },
        senderPrivateKey: {
          type: 'string',
          description:
            'Private key of the sending account (for transfer). Falls back to the address book, then the operator.',
        },
        privateKey: {
          type: 'string',
          description:
            'Private key of the account being associated (for associate). Falls back to the address book, then the operator.',
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
          description:
            'Output directory (backup) or file path (export). Defaults to ~/.hedera-mcp/backups or ~/.hedera-mcp/exports',
        },
        filename: {
          type: 'string',
          description: 'Custom backup filename (default: timestamped). Backup only',
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
- create: Create a public or private topic with configurable submit and admin keys
- update: Change the memo, the admin or submit key, or the auto-renew settings
- subscribe: Subscribe to real-time topic messages
- info: Read topic details from the Mirror Node (FREE)

PUBLIC vs PRIVATE: a topic with no submit key is public, so anyone can submit. Setting a submit key makes it private: only holders of that key can submit. Clearing the submit key on update makes a private topic public again.

KEYS: adminKey and submitKey each accept true (use the operator key), a public key string in DER or raw hex, or { threshold, keys: [...] } for a multi-signature key list.

USE THIS FOR: Creating consensus topics, configuring topic settings, real-time message streams.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'update', 'subscribe', 'info'],
          description: 'Topic operation',
        },
        topicId: {
          type: 'string',
          description: 'Topic ID (for update/subscribe/info)',
        },
        memo: {
          type: 'string',
          description: 'Topic memo (max 100 bytes)',
        },
        adminKey: {
          ...consensusTools.topicKeySchema('Admin key, allows topic updates and deletion'),
        },
        submitKey: { ...consensusTools.topicKeySchema('Submit key, makes the topic private') },
        clearAdminKey: {
          type: 'boolean',
          description:
            'Remove the admin key (for update), making the topic immutable. Cannot be undone.',
        },
        clearSubmitKey: {
          type: 'boolean',
          description: 'Remove the submit key (for update), making the topic public',
        },
        autoRenewPeriod: {
          type: 'number',
          description: 'Auto-renew period in seconds (30-92 days, default 7776000)',
        },
        autoRenewAccountId: {
          type: 'string',
          description: 'Account that pays the auto-renew fee (must sign; format: 0.0.xxxxx)',
        },
        signerPrivateKeys: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Extra private keys to sign with, needed when the admin key or auto-renew account is not the operator',
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
- query: Query historical messages with advanced filtering (FREE via Mirror Node, no operator needed)

QUERY FILTERS: sequenceNumber matches one exact message. sequenceNumberGt, sequenceNumberGte, sequenceNumberLt and sequenceNumberLte select a range and can be combined, e.g. sequenceNumberGte 10 with sequenceNumberLte 20. timestampFrom and timestampTo bound the consensus timestamp (seconds.nanoseconds), or pass a raw mirror node filter in timestamp. limit and order page the result.

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
        submitKey: {
          type: 'string',
          description:
            'Submit key of a private topic (for submit, DER or raw hex). Falls back to the address book entry for the operator.',
        },
        limit: {
          type: 'number',
          description: 'Max messages to return, 1-100 (for query)',
          minimum: 1,
          maximum: 100,
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order (for query)',
        },
        sequenceNumber: {
          type: 'number',
          description: 'Exact sequence number (for query)',
        },
        sequenceNumberGt: {
          type: 'number',
          description: 'Sequence number greater than this value (for query)',
        },
        sequenceNumberGte: {
          type: 'number',
          description: 'Sequence number greater than or equal to this value (for query)',
        },
        sequenceNumberLt: {
          type: 'number',
          description: 'Sequence number less than this value (for query)',
        },
        sequenceNumberLte: {
          type: 'number',
          description: 'Sequence number less than or equal to this value (for query)',
        },
        timestamp: {
          type: 'string',
          description:
            'Raw consensus timestamp filter (for query), e.g. "1700000000.000000000" or "gte:1700000000.000000000"',
        },
        timestampFrom: {
          type: 'string',
          description: 'Consensus timestamp lower bound, inclusive (for query)',
        },
        timestampTo: {
          type: 'string',
          description: 'Consensus timestamp upper bound, inclusive (for query)',
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
  operation:
    | 'init'
    | 'compile'
    | 'test'
    | 'clean'
    | 'flatten'
    | 'get_artifacts'
    | 'get_accounts'
    | 'config_network'
    | 'run_task'
    | 'list_tasks';
  // Init-specific
  directory?: string;
  networks?: Array<'mainnet' | 'testnet' | 'previewnet' | 'local'>;
  solidity?: string;
  typescript?: boolean;
  skipInstall?: boolean;
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
  // Config network-specific
  rpcUrl?: string;
  chainId?: number;
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
          skipInstall: args.skipInstall,
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
        return await hardhatTools.hardhatFlatten({
          files: args.contractPath ? [args.contractPath] : undefined,
          directory: args.directory,
        });

      case 'get_artifacts':
        return await hardhatTools.hardhatGetArtifacts({
          contractName: args.contractName,
          directory: args.directory,
        });

      case 'get_accounts':
        return await hardhatTools.hardhatGetAccounts({
          directory: args.directory,
          network: args.network,
        });

      case 'config_network':
        return await hardhatTools.hardhatConfigAddNetwork({
          network: args.network || 'testnet',
          rpcUrl: args.rpcUrl,
          chainId: args.chainId,
        });

      case 'run_task':
        if (!args.task) {
          throw new Error('task is required for run_task');
        }
        return await hardhatTools.hardhatRunTask({
          task: args.task,
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
  network?: string;
  privateKey?: string;
  // Deploy-specific
  contractName?: string;
  constructorArgs?: any[];
  script?: string;
  gasLimit?: number;
  value?: string;
  // Deploy Ignition-specific
  module?: string;
  parameters?: Record<string, unknown> | string;
  // Verify-specific
  address?: string;
  // Call/Execute-specific
  contractAddress?: string;
  abi?: any[];
  method?: string;
  methodArgs?: any[];
  /** Alias of `method`, matching rpc_call_contract / foundry_contract naming */
  functionName?: string;
  /** Alias of `methodArgs`, matching rpc_call_contract naming */
  args?: any[];
}): Promise<ToolResult> {
  try {
    logger.info('Hardhat contract operation', { operation: args.operation });

    // The EVM tools disagreed on parameter names (rpc_call_contract uses
    // functionName/args). Accept both so a client cannot pick the wrong one.
    const method = args.method ?? args.functionName;
    const methodArgs = args.methodArgs ?? args.args;

    switch (args.operation) {
      case 'deploy':
        return await hardhatTools.hardhatDeploy({
          contractName: args.contractName,
          constructorArgs: args.constructorArgs,
          script: args.script,
          network: args.network,
          privateKey: args.privateKey,
          gasLimit: args.gasLimit,
          value: args.value,
          directory: args.directory,
        });

      case 'deploy_ignition':
        if (!args.module) {
          throw new Error('module is required for deploy_ignition');
        }
        return await hardhatTools.hardhatDeployIgnition({
          module: args.module,
          parameters: args.parameters,
          network: args.network,
          directory: args.directory,
        });

      case 'verify':
        if (!args.address && !args.contractAddress) {
          throw new Error('address is required for verify');
        }
        return await hardhatTools.hardhatVerify({
          address: (args.address || args.contractAddress) as string,
          constructorArgs: args.constructorArgs,
          directory: args.directory,
        });

      case 'call':
        if (!args.contractAddress || !method) {
          throw new Error('contractAddress and method (or functionName) are required for call');
        }
        return await hardhatTools.hardhatCallContract({
          address: args.contractAddress,
          abi: args.abi,
          contractName: args.contractName,
          method,
          args: methodArgs,
          network: args.network,
          directory: args.directory,
        });

      case 'execute':
        if (!args.contractAddress || !method) {
          throw new Error('contractAddress and method (or functionName) are required for execute');
        }
        return await hardhatTools.hardhatExecuteContract({
          address: args.contractAddress,
          abi: args.abi,
          contractName: args.contractName,
          method,
          args: methodArgs,
          value: args.value,
          gasLimit: args.gasLimit,
          network: args.network,
          privateKey: args.privateKey,
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
  operation:
    | 'init'
    | 'install'
    | 'update'
    | 'remove'
    | 'clean'
    | 'build'
    | 'fmt'
    | 'inspect'
    | 'get_artifacts'
    | 'snapshot';
  // Init-specific
  directory?: string;
  template?: string;
  networks?: Array<'mainnet' | 'testnet' | 'previewnet' | 'local'>;
  solidity?: string;
  // Install/Remove-specific
  dependency?: string;
  // Build-specific
  optimize?: boolean;
  optimizerRuns?: number;
  viaIr?: boolean;
  force?: boolean;
  // Inspect-specific
  contractName?: string;
  field?: 'abi' | 'bytecode' | 'deployedBytecode' | 'assembly' | 'storage-layout' | 'methods';
}): Promise<ToolResult> {
  try {
    logger.info('Foundry project operation', { operation: args.operation });

    switch (args.operation) {
      case 'init':
        return await foundryTools.foundryInit({
          directory: args.directory,
          networks: args.networks,
          solidity: args.solidity,
          template: args.template as 'basic' | 'advanced' | undefined,
        });

      case 'install':
        return await foundryTools.foundryInstall({
          dependency: args.dependency!,
          directory: args.directory,
        });

      case 'update':
        return await foundryTools.foundryUpdate({ directory: args.directory });

      case 'remove':
        return await foundryTools.foundryRemove({
          dependency: args.dependency!,
          directory: args.directory,
        });

      case 'clean':
        return await foundryTools.foundryClean({ directory: args.directory });

      case 'build':
        return await foundryTools.foundryBuild({
          optimize: args.optimize,
          optimizerRuns: args.optimizerRuns,
          viaIr: args.viaIr,
          force: args.force,
          directory: args.directory,
        });

      case 'fmt':
        return await foundryTools.foundryFmt({ directory: args.directory });

      case 'inspect':
        return await foundryTools.foundryInspect({
          contractName: args.contractName!,
          field: args.field || 'abi',
          directory: args.directory,
        });

      case 'get_artifacts':
        return await foundryTools.foundryGetArtifacts({
          contractName: args.contractName,
          directory: args.directory,
        });

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
  verify?: boolean;
  // Call/Send-specific
  address?: string;
  signature?: string;
  callArgs?: any[];
  value?: string;
  blockNumber?: string;
  // Anvil-specific
  port?: number;
  forkBlock?: number;
  chainId?: number;
  // Deploy-specific
  contractPath?: string;
  gasLimit?: number;
  network?: string;
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
          // forge create needs src/File.sol:Contract; accept either that or a
          // bare contract name plus contractPath.
          contractPath: args.contractPath || args.contractName!,
          constructorArgs: args.constructorArgs?.map(String),
          rpcUrl: args.rpcUrl,
          privateKey: args.privateKey,
          gasLimit: args.gasLimit,
        });

      case 'script':
        return await foundryTools.foundryScript({
          scriptPath: args.scriptPath!,
          rpcUrl: args.rpcUrl,
          broadcast: args.broadcast,
          privateKey: args.privateKey,
          verify: args.verify,
        });

      case 'call':
        return await foundryTools.foundryCall({
          address: args.address!,
          signature: args.signature!,
          args: args.callArgs,
          rpcUrl: args.rpcUrl,
          blockNumber: args.blockNumber,
        });

      case 'send':
        return await foundryTools.foundrySend({
          address: args.address!,
          signature: args.signature!,
          args: args.callArgs,
          rpcUrl: args.rpcUrl,
          privateKey: args.privateKey,
          network: args.network,
          value: args.value,
          gasLimit: args.gasLimit,
        });

      case 'anvil_start':
        return await foundryTools.foundryAnvilStart({
          port: args.port,
          forkUrl: args.forkUrl,
          chainId: args.chainId,
          forkBlock: args.forkBlock,
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
    description: `Manage a Hardhat project (Hardhat 2 or 3). Commands run with the Hardhat installed in the project directory, never with a bundled copy.

OPERATIONS:
- init: Scaffold a Hardhat 3 project for Hedera (ESM, toolbox-mocha-ethers, Sourcify verification, sample Greeter contract/test/script/Ignition module) and run npm install
- compile: hardhat compile (force option); lists artifact files
- test: hardhat test with optional testFiles, grep, network; reports passing/failing counts
- clean: hardhat clean
- flatten: hardhat flatten (contractPath)
- get_artifacts: Read compiled ABI and bytecode from artifacts/ (all contracts, or contractName)
- get_accounts: The MCP operator's EVM address and HBAR balance on the network (empty list with a message when no ECDSA operator key is configured)
- config_network: Hardhat 3 network entry for a Hedera network (network, optional rpcUrl/chainId for custom networks)
- run_task: hardhat <task> with params as --flags
- list_tasks: Parse hardhat --help into a task list

USE FOR: Project setup, compilation, testing, and configuration management.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: [
            'init',
            'compile',
            'test',
            'clean',
            'flatten',
            'get_artifacts',
            'get_accounts',
            'config_network',
            'run_task',
            'list_tasks',
          ],
          description: 'Project operation to perform',
        },
        directory: {
          type: 'string',
          description:
            'Absolute path to the Hardhat project directory (required for all operations except init, which creates it)',
        },
        networks: {
          type: 'array',
          items: { type: 'string', enum: ['mainnet', 'testnet', 'previewnet', 'local'] },
          description: 'Networks to configure (for init; default testnet and local)',
        },
        solidity: { type: 'string', description: 'Solidity version (for init; default 0.8.20)' },
        typescript: { type: 'boolean', description: 'Use TypeScript (for init)' },
        skipInstall: {
          type: 'boolean',
          description: 'Do not run npm install after scaffolding (for init)',
        },
        force: { type: 'boolean', description: 'Force recompilation (for compile)' },
        testFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Test files to run (for test)',
        },
        grep: { type: 'string', description: 'Only run tests matching this pattern (for test)' },
        network: {
          type: 'string',
          description:
            'Network name: for test, passed to hardhat --network; for get_accounts/config_network, a Hedera network (mainnet, testnet, previewnet, local; default: configured HEDERA_NETWORK)',
        },
        contractPath: { type: 'string', description: 'Contract file path (for flatten)' },
        contractName: {
          type: 'string',
          description: 'Contract name or "path/File.sol:Name" (for get_artifacts)',
        },
        rpcUrl: {
          type: 'string',
          description: 'RPC URL for a custom network (for config_network)',
        },
        chainId: {
          type: 'number',
          description: 'Chain ID for a custom network (for config_network)',
        },
        task: {
          type: 'string',
          description: 'Task name, e.g. "compile" or "ignition deployments" (for run_task)',
        },
        params: {
          type: 'object',
          description:
            'Task parameters (for run_task): keys become --kebab-case flags, true becomes a bare flag, "_" holds positional arguments',
        },
      },
      required: ['operation'],
    },
  },
  {
    name: 'hardhat_contract',
    description: `Deploy and interact with contracts compiled by a Hardhat project.

OPERATIONS:
- deploy: Deploy a compiled contract (contractName + constructorArgs) through the Hedera JSON-RPC relay, signed with the MCP operator key or privateKey. Alternatively run a deployment script with the project's Hardhat (script, e.g. "scripts/deploy.js")
- deploy_ignition: hardhat ignition deploy <module> --network <network> (parameters as object or JSON file path)
- verify: Locate the build-info file and explain Sourcify verification (what HashScan reads)
- call: Read-only function call via eth_call (FREE); abi or contractName
- execute: State-changing transaction signed with the operator or privateKey; abi or contractName

NETWORK: defaults to the configured HEDERA_NETWORK. Deploy/call/execute accept mainnet, testnet, previewnet, local; script and Ignition deployments accept any network name from hardhat.config.
ACCOUNTS: The operator key (ECDSA) is injected as <NETWORK>_PRIVATE_KEY for scripts and Ignition, so no .env is needed.

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
        network: { type: 'string', description: 'Target network (default: configured network)' },
        contractName: {
          type: 'string',
          description:
            'Compiled contract name (for deploy; for call/execute as an alternative to abi)',
        },
        constructorArgs: {
          type: 'array',
          items: {},
          description: 'Constructor arguments (for deploy and verify)',
        },
        script: {
          type: 'string',
          description:
            'Deployment script path relative to the project (for deploy via hardhat run)',
        },
        module: { type: 'string', description: 'Ignition module path (for deploy_ignition)' },
        parameters: {
          type: 'object',
          description: 'Ignition module parameters (for deploy_ignition)',
        },
        address: { type: 'string', description: 'Contract address (for verify)' },
        contractAddress: {
          type: 'string',
          description: 'Contract address, 0x or 0.0.x (for call/execute)',
        },
        abi: { type: 'array', items: {}, description: 'Contract ABI (for call/execute)' },
        method: {
          type: 'string',
          description: 'Function name (for call/execute). Alias: functionName',
        },
        functionName: {
          type: 'string',
          description: 'Alias of method, matching rpc_call_contract naming',
        },
        args: {
          type: 'array',
          items: {},
          description: 'Alias of methodArgs, matching rpc_call_contract naming',
        },
        methodArgs: {
          type: 'array',
          items: {},
          description: 'Function arguments (for call/execute)',
        },
        privateKey: {
          type: 'string',
          description:
            'Signing key (for deploy/execute); optional, defaults to the MCP operator key',
        },
        gasLimit: { type: 'number', description: 'Gas limit (for deploy/execute)' },
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
          enum: [
            'init',
            'install',
            'update',
            'remove',
            'clean',
            'build',
            'fmt',
            'inspect',
            'get_artifacts',
            'snapshot',
          ],
          description: 'Project operation to perform',
        },
        directory: {
          type: 'string',
          description:
            'Absolute path to Foundry project directory (required for all operations except init which creates it)',
        },
        template: { type: 'string', description: 'Project template (for init)' },
        networks: {
          type: 'array',
          items: { type: 'string', enum: ['mainnet', 'testnet', 'previewnet', 'local'] },
          description: 'Networks to configure in foundry.toml (for init, default: testnet + local)',
        },
        solidity: {
          type: 'string',
          description:
            'Solidity compiler version for the generated project (for init, default: 0.8.20)',
        },
        dependency: { type: 'string', description: 'Dependency name (for install/remove)' },
        optimize: { type: 'boolean', description: 'Enable optimizer (for build)' },
        optimizerRuns: { type: 'number', description: 'Optimizer runs (for build)' },
        viaIr: { type: 'boolean', description: 'Use IR pipeline (for build)' },
        force: { type: 'boolean', description: 'Force a full rebuild (for build)' },
        contractName: { type: 'string', description: 'Contract name (for inspect/get_artifacts)' },
        field: {
          type: 'string',
          enum: ['abi', 'bytecode', 'deployedBytecode', 'assembly', 'storage-layout', 'methods'],
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
        contractName: {
          type: 'string',
          description:
            'Contract name (for create). forge create needs src/File.sol:Contract; pass that here or use contractPath',
        },
        contractPath: {
          type: 'string',
          description: 'Fully qualified contract path for create, e.g. src/Greeter.sol:Greeter',
        },
        constructorArgs: { type: 'array', items: {}, description: 'Constructor args (for create)' },
        rpcUrl: {
          type: 'string',
          description: 'JSON-RPC URL (optional - auto-resolves from MCP network config)',
        },
        privateKey: {
          type: 'string',
          description: 'Private key for signing (optional - auto-uses MCP operator key)',
        },
        scriptPath: { type: 'string', description: 'Script path (for script)' },
        broadcast: { type: 'boolean', description: 'Broadcast transactions (for script)' },
        address: { type: 'string', description: 'Contract address (for call/send)' },
        signature: { type: 'string', description: 'Function signature (for call/send)' },
        callArgs: { type: 'array', items: {}, description: 'Function arguments (for call/send)' },
        value: { type: 'string', description: 'ETH/HBAR value (for send)' },
        blockNumber: {
          type: 'string',
          description: 'Block to read at (for call): a number, "latest" or "earliest"',
        },
        gasLimit: { type: 'number', description: 'Gas limit (for create/send)' },
        verify: { type: 'boolean', description: 'Verify after deploying (for script)' },
        network: {
          type: 'string',
          enum: ['mainnet', 'testnet', 'previewnet', 'local'],
          description: 'Network whose RPC URL to use when rpcUrl is omitted',
        },
        port: { type: 'number', description: 'Port number (for anvil_start)' },
        chainId: { type: 'number', description: 'Chain ID for the local node (for anvil_start)' },
        forkBlock: { type: 'number', description: 'Block to fork from (for anvil_start)' },
      },
      required: ['operation'],
    },
  },
];
