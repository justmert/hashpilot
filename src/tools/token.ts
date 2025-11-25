/**
 * Token (HTS) Tools
 * Hedera Token Service operations
 */

import { hederaClient } from '../services/hedera-client.js';
import { addressBook } from '../services/addressbook.js';
import { ToolResult } from '../types/index.js';
import logger from '../utils/logger.js';

/**
 * Custom fee type for token creation
 */
interface CustomFee {
  feeType: 'fixed' | 'fractional' | 'royalty';
  feeCollectorAccountId: string;
  amount?: number;
  denominatingTokenId?: string;
  denominator?: number;
  min?: number;
  max?: number;
  fallbackFee?: number;
}

/**
 * Create a new fungible token
 */
export async function createToken(args: {
  name: string;
  symbol: string;
  decimals?: number;
  initialSupply?: number;
  treasuryAccountId?: string;
  adminKey?: boolean;
  kycKey?: boolean;
  freezeKey?: boolean;
  wipeKey?: boolean;
  supplyKey?: boolean;
  pauseKey?: boolean;
  customFees?: CustomFee[];
  memo?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Creating token', { name: args.name, symbol: args.symbol });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.createToken(args);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token create',
      },
    };
  } catch (error) {
    logger.error('Failed to create token', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Associate a token with an account
 */
export async function associateToken(args: {
  accountId: string;
  tokenId: string;
  privateKey?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Associating token', { accountId: args.accountId, tokenId: args.tokenId });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    // Try to get private key from address book if not provided
    let privateKey = args.privateKey;
    if (!privateKey) {
      if (addressBook.count() === 0) {
        await addressBook.initialize();
      }

      const entries = addressBook.list();
      const entry = entries.find((e) => e.accountId === args.accountId);
      if (entry?.privateKey) {
        privateKey = entry.privateKey;
        logger.info('Using private key from address book');
      }
    }

    const result = await hederaClient.associateToken(args.accountId, args.tokenId, privateKey);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token associate',
      },
    };
  } catch (error) {
    logger.error('Failed to associate token', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Transfer tokens between accounts
 */
export async function transferToken(args: {
  tokenId: string;
  from: string;
  to: string;
  amount: number;
  senderPrivateKey?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Transferring tokens', {
      tokenId: args.tokenId,
      from: args.from,
      to: args.to,
      amount: args.amount,
    });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    // Try to get sender's private key from address book if not provided
    let senderPrivateKey = args.senderPrivateKey;
    if (!senderPrivateKey) {
      if (addressBook.count() === 0) {
        await addressBook.initialize();
      }

      const entries = addressBook.list();
      const entry = entries.find((e) => e.accountId === args.from);
      if (entry?.privateKey) {
        senderPrivateKey = entry.privateKey;
        logger.info('Using sender private key from address book');
      }
    }

    const result = await hederaClient.transferToken(
      args.tokenId,
      args.from,
      args.to,
      args.amount,
      senderPrivateKey
    );

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token transfer',
      },
    };
  } catch (error) {
    logger.error('Failed to transfer tokens', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Mint additional token supply
 */
export async function mintToken(args: { tokenId: string; amount: number }): Promise<ToolResult> {
  try {
    logger.info('Minting tokens', { tokenId: args.tokenId, amount: args.amount });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.mintToken(args.tokenId, args.amount);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token mint',
      },
    };
  } catch (error) {
    logger.error('Failed to mint tokens', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Burn token supply
 */
export async function burnToken(args: { tokenId: string; amount: number }): Promise<ToolResult> {
  try {
    logger.info('Burning tokens', { tokenId: args.tokenId, amount: args.amount });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.burnToken(args.tokenId, args.amount);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token burn',
      },
    };
  } catch (error) {
    logger.error('Failed to burn tokens', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Freeze token for an account
 */
export async function freezeToken(args: {
  tokenId: string;
  accountId: string;
}): Promise<ToolResult> {
  try {
    logger.info('Freezing token', { tokenId: args.tokenId, accountId: args.accountId });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.freezeToken(args.tokenId, args.accountId);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token freeze',
      },
    };
  } catch (error) {
    logger.error('Failed to freeze token', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Unfreeze token for an account
 */
export async function unfreezeToken(args: {
  tokenId: string;
  accountId: string;
}): Promise<ToolResult> {
  try {
    logger.info('Unfreezing token', { tokenId: args.tokenId, accountId: args.accountId });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.unfreezeToken(args.tokenId, args.accountId);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token unfreeze',
      },
    };
  } catch (error) {
    logger.error('Failed to unfreeze token', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Grant KYC status to an account for a token
 */
export async function grantKyc(args: {
  tokenId: string;
  accountId: string;
}): Promise<ToolResult> {
  try {
    logger.info('Granting KYC', { tokenId: args.tokenId, accountId: args.accountId });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.grantKyc(args.tokenId, args.accountId);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token kyc grant',
      },
    };
  } catch (error) {
    logger.error('Failed to grant KYC', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Revoke KYC status from an account for a token
 */
export async function revokeKyc(args: {
  tokenId: string;
  accountId: string;
}): Promise<ToolResult> {
  try {
    logger.info('Revoking KYC', { tokenId: args.tokenId, accountId: args.accountId });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.revokeKyc(args.tokenId, args.accountId);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token kyc revoke',
      },
    };
  } catch (error) {
    logger.error('Failed to revoke KYC', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Wipe tokens from an account
 */
export async function wipeToken(args: {
  tokenId: string;
  accountId: string;
  amount: number;
}): Promise<ToolResult> {
  try {
    logger.info('Wiping tokens', { tokenId: args.tokenId, accountId: args.accountId, amount: args.amount });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.wipeToken(args.tokenId, args.accountId, args.amount);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token wipe',
      },
    };
  } catch (error) {
    logger.error('Failed to wipe tokens', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Pause a token
 */
export async function pauseToken(args: {
  tokenId: string;
}): Promise<ToolResult> {
  try {
    logger.info('Pausing token', { tokenId: args.tokenId });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.pauseToken(args.tokenId);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token pause',
      },
    };
  } catch (error) {
    logger.error('Failed to pause token', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Unpause a token
 */
export async function unpauseToken(args: {
  tokenId: string;
}): Promise<ToolResult> {
  try {
    logger.info('Unpausing token', { tokenId: args.tokenId });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.unpauseToken(args.tokenId);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token unpause',
      },
    };
  } catch (error) {
    logger.error('Failed to unpause token', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get tool definitions for MCP server
 */
export const tokenTools = [
  {
    name: 'token_create',
    description:
      'Create a new fungible token on Hedera with customizable properties. Treasury defaults to operator account. IMPORTANT: Token keys cannot be added later if not set during creation - this is a permanent decision.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Token name (max 100 characters)',
          maxLength: 100,
        },
        symbol: {
          type: 'string',
          description: 'Token symbol (max 100 characters, typically 3-5)',
          maxLength: 100,
        },
        decimals: {
          type: 'number',
          description: 'Number of decimal places (default: 0)',
          minimum: 0,
          maximum: 18,
          default: 0,
        },
        initialSupply: {
          type: 'number',
          description: 'Initial token supply (default: 1000)',
          minimum: 0,
          default: 1000,
        },
        treasuryAccountId: {
          type: 'string',
          description: 'Treasury account ID (defaults to operator account)',
          pattern: '^0\\.0\\.\\d+$',
        },
        adminKey: {
          type: 'boolean',
          description: 'Enable admin key for token updates (default: true)',
          default: true,
        },
        kycKey: {
          type: 'boolean',
          description: 'Enable KYC key - requires KYC grant before transfers (default: false)',
          default: false,
        },
        freezeKey: {
          type: 'boolean',
          description: 'Enable freeze key - allows freezing accounts (default: false)',
          default: false,
        },
        wipeKey: {
          type: 'boolean',
          description: 'Enable wipe key - allows wiping tokens from accounts (default: false)',
          default: false,
        },
        supplyKey: {
          type: 'boolean',
          description: 'Enable supply key - allows minting/burning (default: true)',
          default: true,
        },
        pauseKey: {
          type: 'boolean',
          description: 'Enable pause key - allows pausing all token operations (default: false)',
          default: false,
        },
        customFees: {
          type: 'array',
          description: 'Custom fees for the token (royalties, fixed fees, fractional fees)',
          items: {
            type: 'object',
            properties: {
              feeType: {
                type: 'string',
                enum: ['fixed', 'fractional', 'royalty'],
                description: 'Type of custom fee',
              },
              feeCollectorAccountId: {
                type: 'string',
                description: 'Account ID to collect fees (format: 0.0.xxxxx)',
                pattern: '^0\\.0\\.\\d+$',
              },
              amount: {
                type: 'number',
                description: 'For fixed fees: amount in tinybars or token units. For fractional: numerator.',
              },
              denominatingTokenId: {
                type: 'string',
                description: 'Token ID for fee denomination (for fixed fees in tokens)',
                pattern: '^0\\.0\\.\\d+$',
              },
              denominator: {
                type: 'number',
                description: 'For fractional fees: denominator (e.g., 100 for percentage)',
              },
              min: {
                type: 'number',
                description: 'For fractional fees: minimum fee amount',
              },
              max: {
                type: 'number',
                description: 'For fractional fees: maximum fee amount',
              },
              fallbackFee: {
                type: 'number',
                description: 'For royalty fees: fallback fee in HBAR if no exchange value',
              },
            },
            required: ['feeType', 'feeCollectorAccountId'],
          },
        },
        memo: {
          type: 'string',
          description: 'Optional token memo (max 100 characters)',
          maxLength: 100,
        },
      },
      required: ['name', 'symbol'],
    },
  },
  {
    name: 'token_associate',
    description:
      'Associate a token with an account to enable receiving/holding tokens. Required before an account can receive tokens. The account must sign the transaction - provide privateKey or ensure account is in address book with private key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: {
          type: 'string',
          description: 'Account ID to associate with token (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        tokenId: {
          type: 'string',
          description: 'Token ID to associate (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        privateKey: {
          type: 'string',
          description:
            'Optional: Private key of the account (DER-encoded). If not provided, will try to use from address book.',
        },
      },
      required: ['accountId', 'tokenId'],
    },
  },
  {
    name: 'token_transfer',
    description:
      'Transfer tokens from one account to another. Both accounts must be associated with the token first. The sender must sign the transaction - provide senderPrivateKey or ensure sender is in address book with private key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: {
          type: 'string',
          description: 'Token ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
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
          description: 'Amount of tokens to transfer (in smallest unit based on decimals)',
          minimum: 1,
        },
        senderPrivateKey: {
          type: 'string',
          description:
            'Optional: Private key of sender account (DER-encoded). If not provided, will try to use from address book.',
        },
      },
      required: ['tokenId', 'from', 'to', 'amount'],
    },
  },
  {
    name: 'token_mint',
    description:
      'Mint additional tokens and add them to the treasury account. Requires supply key to be enabled on the token. Operator must have the supply key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: {
          type: 'string',
          description: 'Token ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        amount: {
          type: 'number',
          description: 'Amount to mint (in smallest unit based on token decimals)',
          minimum: 1,
        },
      },
      required: ['tokenId', 'amount'],
    },
  },
  {
    name: 'token_burn',
    description:
      'Burn tokens from the treasury account, reducing total supply. Requires supply key to be enabled on the token. Operator must have the supply key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: {
          type: 'string',
          description: 'Token ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        amount: {
          type: 'number',
          description: 'Amount to burn (in smallest unit based on token decimals)',
          minimum: 1,
        },
      },
      required: ['tokenId', 'amount'],
    },
  },
  {
    name: 'token_freeze',
    description:
      'Freeze a token for a specific account, preventing transfers. Requires freeze key to be enabled on the token. Operator must have the freeze key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: {
          type: 'string',
          description: 'Token ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        accountId: {
          type: 'string',
          description: 'Account ID to freeze (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
      },
      required: ['tokenId', 'accountId'],
    },
  },
  {
    name: 'token_unfreeze',
    description:
      'Unfreeze a token for a specific account, allowing transfers again. Requires freeze key to be enabled on the token. Operator must have the freeze key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: {
          type: 'string',
          description: 'Token ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        accountId: {
          type: 'string',
          description: 'Account ID to unfreeze (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
      },
      required: ['tokenId', 'accountId'],
    },
  },
  {
    name: 'token_kyc_grant',
    description:
      'Grant KYC (Know Your Customer) status to an account for a token. Required when KYC key is enabled on token to allow transfers. Operator must have the KYC key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: {
          type: 'string',
          description: 'Token ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        accountId: {
          type: 'string',
          description: 'Account ID to grant KYC (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
      },
      required: ['tokenId', 'accountId'],
    },
  },
  {
    name: 'token_kyc_revoke',
    description:
      'Revoke KYC (Know Your Customer) status from an account for a token. Prevents further transfers. Operator must have the KYC key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: {
          type: 'string',
          description: 'Token ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        accountId: {
          type: 'string',
          description: 'Account ID to revoke KYC (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
      },
      required: ['tokenId', 'accountId'],
    },
  },
  {
    name: 'token_wipe',
    description:
      'Wipe tokens from an account, removing them from circulation. Requires wipe key to be enabled on the token. Does NOT affect total supply like burn does. Operator must have the wipe key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: {
          type: 'string',
          description: 'Token ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        accountId: {
          type: 'string',
          description: 'Account ID to wipe tokens from (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        amount: {
          type: 'number',
          description: 'Amount to wipe (in smallest unit based on token decimals)',
          minimum: 1,
        },
      },
      required: ['tokenId', 'accountId', 'amount'],
    },
  },
  {
    name: 'token_pause',
    description:
      'Pause all operations for a token. No transfers, mints, or burns can occur while paused. Requires pause key to be enabled on the token. Operator must have the pause key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: {
          type: 'string',
          description: 'Token ID to pause (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
      },
      required: ['tokenId'],
    },
  },
  {
    name: 'token_unpause',
    description:
      'Unpause a token, resuming all operations. Requires pause key to be enabled on the token. Operator must have the pause key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: {
          type: 'string',
          description: 'Token ID to unpause (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
      },
      required: ['tokenId'],
    },
  },
];
