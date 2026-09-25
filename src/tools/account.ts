/**
 * Account Management Tools
 * MCP tools for Hedera account operations
 */

import { hederaCLI } from '../services/hedera-cli.js';
import { hederaClient } from '../services/hedera-client.js';
import { addressBook } from '../services/addressbook.js';
import { advisoriesFor } from '../services/error-analyzer.js';
import { ToolResult } from '../types/index.js';
import logger from '../utils/logger.js';

/**
 * Get account balance (HBAR and tokens)
 */
export async function getAccountBalance(args: { accountId: string }): Promise<ToolResult> {
  try {
    logger.info('Getting account balance', { accountId: args.accountId });

    const result = await hederaCLI.executeCommand({
      command: 'account balance',
      args: {
        accountId: args.accountId,
      },
    });

    return result;
  } catch (error) {
    logger.error('Failed to get account balance', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get comprehensive account information
 */
export async function getAccountInfo(args: { accountId: string }): Promise<ToolResult> {
  try {
    logger.info('Getting account info', { accountId: args.accountId });

    const result = await hederaCLI.executeCommand({
      command: 'account info',
      args: {
        accountId: args.accountId,
      },
    });

    return result;
  } catch (error) {
    logger.error('Failed to get account info', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Transfer HBAR between accounts
 */
export async function transferHbar(args: {
  from: string;
  to: string;
  amount: number;
}): Promise<ToolResult> {
  try {
    logger.info('Transferring HBAR', { from: args.from, to: args.to, amount: args.amount });

    const result = await hederaCLI.executeCommand({
      command: 'transfer hbar',
      args: {
        from: args.from,
        to: args.to,
        amount: args.amount,
      },
    });

    if (!result.success) {
      return result;
    }

    // Keep whatever metadata the execution path already reported
    return {
      ...result,
      metadata: {
        ...result.metadata,
        advisories: advisoriesFor('transfer_hbar', {}),
      },
    };
  } catch (error) {
    logger.error('Failed to transfer HBAR', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create a new Hedera account
 */
export async function createAccount(args: {
  initialBalance?: number;
  publicKey?: string;
  memo?: string;
  keyType?: 'ecdsa' | 'ed25519';
  maxAutomaticTokenAssociations?: number;
  stakedAccountId?: string;
  stakedNodeId?: number;
  declineStakingReward?: boolean;
}): Promise<ToolResult> {
  try {
    logger.info('Creating account', {
      initialBalance: args.initialBalance,
      memo: args.memo,
      keyType: args.keyType || 'ecdsa',
    });

    // Ensure client is initialized
    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.createAccount({
      initialBalance: args.initialBalance,
      publicKey: args.publicKey,
      memo: args.memo,
      keyType: args.keyType,
      maxAutomaticTokenAssociations: args.maxAutomaticTokenAssociations,
      stakedAccountId: args.stakedAccountId,
      stakedNodeId: args.stakedNodeId,
      declineStakingReward: args.declineStakingReward,
    });

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'account create',
        advisories: advisoriesFor('account_create', {}),
      },
    };
  } catch (error) {
    logger.error('Failed to create account', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Import an existing account into the address book
 */
export async function importAccount(args: {
  accountId: string;
  privateKey: string;
  alias: string;
  nickname?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Importing account', { accountId: args.accountId, alias: args.alias });

    // Initialize address book if not already done
    if (addressBook.count() === 0) {
      await addressBook.initialize();
    }

    // Verify the account exists on Hedera
    const accountInfo = await hederaClient.getAccountInfo(args.accountId);

    // Add to address book
    await addressBook.add({
      accountId: args.accountId,
      alias: args.alias,
      nickname: args.nickname,
      privateKey: args.privateKey,
      publicKey: accountInfo.key,
      memo: accountInfo.memo,
    });

    return {
      success: true,
      data: {
        accountId: args.accountId,
        alias: args.alias,
        nickname: args.nickname,
        addedToAddressBook: true,
      },
      metadata: {
        executedVia: 'addressbook',
        command: 'account import',
      },
    };
  } catch (error) {
    logger.error('Failed to import account', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Add account to address book
 */
export async function addToAddressBook(args: {
  accountId: string;
  alias: string;
  nickname?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Adding to address book', { accountId: args.accountId, alias: args.alias });

    if (addressBook.count() === 0) {
      await addressBook.initialize();
    }

    // Verify the account exists
    const accountInfo = await hederaClient.getAccountInfo(args.accountId);

    await addressBook.add({
      accountId: args.accountId,
      alias: args.alias,
      nickname: args.nickname,
      publicKey: accountInfo.key,
      memo: accountInfo.memo,
    });

    return {
      success: true,
      data: {
        accountId: args.accountId,
        alias: args.alias,
        addedToAddressBook: true,
      },
    };
  } catch (error) {
    logger.error('Failed to add to address book', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * List all accounts in address book
 */
export async function listAddressBook(): Promise<ToolResult> {
  try {
    if (addressBook.count() === 0) {
      await addressBook.initialize();
    }

    const entries = addressBook.list();

    // Remove private keys from the response
    const safeEntries = entries.map((entry) => ({
      accountId: entry.accountId,
      alias: entry.alias,
      nickname: entry.nickname,
      publicKey: entry.publicKey,
      memo: entry.memo,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      hasPrivateKey: !!entry.privateKey,
    }));

    return {
      success: true,
      data: {
        count: entries.length,
        accounts: safeEntries,
      },
    };
  } catch (error) {
    logger.error('Failed to list address book', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Remove account from address book
 */
export async function removeFromAddressBook(args: { alias: string }): Promise<ToolResult> {
  try {
    if (addressBook.count() === 0) {
      await addressBook.initialize();
    }

    await addressBook.remove(args.alias);

    return {
      success: true,
      data: {
        alias: args.alias,
        removed: true,
      },
    };
  } catch (error) {
    logger.error('Failed to remove from address book', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Update account in address book
 */
export async function updateAddressBook(args: {
  alias: string;
  nickname?: string;
}): Promise<ToolResult> {
  try {
    if (addressBook.count() === 0) {
      await addressBook.initialize();
    }

    await addressBook.update(args.alias, {
      nickname: args.nickname,
    });

    return {
      success: true,
      data: {
        alias: args.alias,
        updated: true,
      },
    };
  } catch (error) {
    logger.error('Failed to update address book', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get tool definitions for MCP server
 */
export const accountTools = [
  {
    name: 'account_create',
    description:
      'Create a new Hedera account with customizable parameters: balance allocation, key type (ECDSA or ED25519), automatic token associations and staking. Generates a new key pair unless a public key is provided. Requires the operator account to hold enough HBAR for the initial balance and the creation fee.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        initialBalance: {
          type: 'number',
          description: 'Initial HBAR balance for the new account (default: 1 HBAR)',
          minimum: 0,
          default: 1,
        },
        keyType: {
          type: 'string',
          enum: ['ecdsa', 'ed25519'],
          description:
            'Curve for the generated key pair (default: ecdsa). ECDSA also yields an EVM address; ED25519 is native Hedera only. Ignored when publicKey is given.',
          default: 'ecdsa',
        },
        publicKey: {
          type: 'string',
          description:
            'Optional: Provide a public key (DER or raw hex). If not provided, a new key pair is generated using keyType.',
        },
        memo: {
          type: 'string',
          description: 'Optional: Account memo (max 100 characters)',
          maxLength: 100,
        },
        maxAutomaticTokenAssociations: {
          type: 'number',
          description:
            'Tokens the account may auto-associate with, so it can receive them without a prior associate call. -1 means unlimited.',
          minimum: -1,
        },
        stakedAccountId: {
          type: 'string',
          description: 'Stake this account to another account (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        stakedNodeId: {
          type: 'number',
          description: 'Stake this account to a node ID. Mutually exclusive with stakedAccountId.',
          minimum: 0,
        },
        declineStakingReward: {
          type: 'boolean',
          description: 'Decline staking rewards (default: false)',
        },
      },
    },
  },
  {
    name: 'account_balance',
    description:
      'Get the HBAR balance and token balances for a Hedera account. Returns the account balance in HBAR and a list of all associated token balances.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: {
          type: 'string',
          description: 'Hedera account ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
      },
      required: ['accountId'],
    },
  },
  {
    name: 'account_info',
    description:
      'Get comprehensive information about a Hedera account including balance, EVM address, keys, memo, and expiration details.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: {
          type: 'string',
          description: 'Hedera account ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
      },
      required: ['accountId'],
    },
  },
  {
    name: 'transfer_hbar',
    description:
      'Transfer HBAR from one Hedera account to another. The transaction will be signed by the operator account.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: {
          type: 'string',
          description: 'Source account ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        to: {
          type: 'string',
          description: 'Destination account ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        amount: {
          type: 'number',
          description: 'Amount of HBAR to transfer',
          minimum: 0,
        },
      },
      required: ['from', 'to', 'amount'],
    },
  },
  {
    name: 'account_import',
    description:
      'Import an existing Hedera account into the address book by providing account ID, private key, and alias. This allows you to manage and reference the account easily.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: {
          type: 'string',
          description: 'Hedera account ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        privateKey: {
          type: 'string',
          description: 'Private key in DER-encoded format',
        },
        alias: {
          type: 'string',
          description: 'Unique alias for this account (used for quick reference)',
          pattern: '^[a-zA-Z0-9_-]+$',
        },
        nickname: {
          type: 'string',
          description: 'Optional: Human-readable nickname for the account',
        },
      },
      required: ['accountId', 'privateKey', 'alias'],
    },
  },
  {
    name: 'addressbook_add',
    description:
      'Add an existing Hedera account to the address book without storing private key. Useful for accounts you want to reference but not manage.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: {
          type: 'string',
          description: 'Hedera account ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        alias: {
          type: 'string',
          description: 'Unique alias for this account',
          pattern: '^[a-zA-Z0-9_-]+$',
        },
        nickname: {
          type: 'string',
          description: 'Optional: Human-readable nickname',
        },
      },
      required: ['accountId', 'alias'],
    },
  },
  {
    name: 'addressbook_list',
    description:
      'List all accounts stored in the address book. Returns account IDs, aliases, nicknames, and metadata (but not private keys).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'addressbook_remove',
    description: 'Remove an account from the address book by its alias.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        alias: {
          type: 'string',
          description: 'Alias of the account to remove',
        },
      },
      required: ['alias'],
    },
  },
  {
    name: 'addressbook_update',
    description: 'Update the nickname of an account in the address book.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        alias: {
          type: 'string',
          description: 'Alias of the account to update',
        },
        nickname: {
          type: 'string',
          description: 'New nickname for the account',
        },
      },
      required: ['alias'],
    },
  },
];
