/**
 * Token (HTS) Tools
 * Hedera Token Service operations
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  hederaClient,
  CUSTOM_FEES_SCHEMA,
  KEY_SPEC_SCHEMA,
  TokenCreateOptions,
} from '../services/hedera-client.js';
import { addressBook } from '../services/addressbook.js';
import { advisoriesFor } from '../services/error-analyzer.js';
import { ToolResult } from '../types/index.js';
import logger from '../utils/logger.js';

export type { CustomFeeSpec, KeySpec, TokenCreateOptions } from '../services/hedera-client.js';
export { CUSTOM_FEES_SCHEMA, KEY_SPEC_SCHEMA } from '../services/hedera-client.js';

/**
 * Fields a token JSON configuration file (or an inline `config` object) may
 * carry. They mirror the arguments of a token create call exactly.
 */
export const TOKEN_CONFIG_FIELDS = [
  'name',
  'symbol',
  'decimals',
  'initialSupply',
  'treasuryAccountId',
  'treasuryPrivateKey',
  'tokenType',
  'supplyType',
  'maxSupply',
  'adminKey',
  'kycKey',
  'freezeKey',
  'wipeKey',
  'supplyKey',
  'pauseKey',
  'feeScheduleKey',
  'freezeDefault',
  'customFees',
  'memo',
  'signerPrivateKeys',
] as const;

export type TokenConfigField = (typeof TOKEN_CONFIG_FIELDS)[number];

/**
 * Merge token configuration sources into one options object.
 *
 * Later configs win over earlier ones, and explicit tool arguments win over
 * every config. Configs are validated strictly so a typo in a file is
 * reported rather than silently ignored; `explicit` is filtered instead,
 * because it also carries routing fields such as `operation`.
 */
export function mergeTokenConfig(
  explicit: Record<string, unknown>,
  ...configs: Array<Record<string, unknown> | undefined | null>
): TokenCreateOptions {
  const merged: Record<string, unknown> = {};

  for (const config of configs) {
    if (config === undefined || config === null) continue;
    if (typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('Token configuration must be a JSON object');
    }
    const unknown = Object.keys(config).filter(
      (key) => !(TOKEN_CONFIG_FIELDS as readonly string[]).includes(key)
    );
    if (unknown.length > 0) {
      throw new Error(
        `Unknown field(s) in token configuration: ${unknown.join(', ')}. ` +
          `Valid fields: ${TOKEN_CONFIG_FIELDS.join(', ')}`
      );
    }
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) merged[key] = value;
    }
  }

  for (const field of TOKEN_CONFIG_FIELDS) {
    const value = explicit?.[field];
    if (value !== undefined) merged[field] = value;
  }

  return merged as unknown as TokenCreateOptions;
}

/**
 * Read a token configuration JSON file from disk.
 */
export async function loadTokenConfigFile(configPath: string): Promise<Record<string, unknown>> {
  const resolved = path.resolve(configPath);

  let raw: string;
  try {
    raw = await fs.readFile(resolved, 'utf-8');
  } catch (error) {
    throw new Error(
      `Could not read token config file ${resolved}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Token config file ${resolved} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Token config file ${resolved} must contain a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

/**
 * Create a new token (fungible or non-fungible)
 */
export async function createToken(
  args: Partial<TokenCreateOptions> & {
    configPath?: string;
    config?: Record<string, unknown>;
  }
): Promise<ToolResult> {
  try {
    const fileConfig = args.configPath ? await loadTokenConfigFile(args.configPath) : undefined;
    const options = mergeTokenConfig(args as Record<string, unknown>, fileConfig, args.config);

    logger.info('Creating token', {
      name: options.name,
      symbol: options.symbol,
      tokenType: options.tokenType,
      configPath: args.configPath,
    });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.createToken(options);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'token create',
        // Report the keys as actually resolved, so advice to enable a key
        // only appears when the token really was created without it.
        advisories: advisoriesFor('token_create', {
          adminKey: options.adminKey,
          freezeKey: options.freezeKey,
          wipeKey: options.wipeKey,
          supplyKey: options.supplyKey ?? true,
          kycKey: options.kycKey,
          pauseKey: options.pauseKey,
        }),
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
        advisories: advisoriesFor('token_transfer', {}),
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
export async function mintToken(args: {
  tokenId: string;
  amount?: number;
  metadata?: string[];
  metadataEncoding?: 'utf8' | 'base64' | 'hex';
}): Promise<ToolResult> {
  try {
    logger.info('Minting tokens', {
      tokenId: args.tokenId,
      amount: args.amount,
      metadataCount: args.metadata?.length ?? 0,
    });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.mintToken(args.tokenId, args.amount, {
      metadata: args.metadata,
      metadataEncoding: args.metadataEncoding,
    });

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
export async function burnToken(args: {
  tokenId: string;
  amount?: number;
  serialNumbers?: number[];
}): Promise<ToolResult> {
  try {
    logger.info('Burning tokens', {
      tokenId: args.tokenId,
      amount: args.amount,
      serialNumbers: args.serialNumbers,
    });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.burnToken(args.tokenId, args.amount, {
      serialNumbers: args.serialNumbers,
    });

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
export async function grantKyc(args: { tokenId: string; accountId: string }): Promise<ToolResult> {
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
export async function revokeKyc(args: { tokenId: string; accountId: string }): Promise<ToolResult> {
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
  amount?: number;
  serialNumbers?: number[];
}): Promise<ToolResult> {
  try {
    logger.info('Wiping tokens', {
      tokenId: args.tokenId,
      accountId: args.accountId,
      amount: args.amount,
      serialNumbers: args.serialNumbers,
    });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.wipeToken(args.tokenId, args.accountId, args.amount, {
      serialNumbers: args.serialNumbers,
    });

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
export async function pauseToken(args: { tokenId: string }): Promise<ToolResult> {
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
export async function unpauseToken(args: { tokenId: string }): Promise<ToolResult> {
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
 * A key parameter: operator key (true), an explicit public key, or a
 * threshold key list for multi-signature control.
 */
export function keyParameterSchema(purpose: string): Record<string, unknown> {
  return {
    ...KEY_SPEC_SCHEMA,
    description: `${purpose}. true = operator key, a public key string (DER or raw hex), or { threshold, keys } for a multi-signature key list.`,
  };
}

/** Documented example of the token JSON configuration file */
export const TOKEN_CONFIG_EXAMPLE = `{
  "name": "Acme Points",
  "symbol": "ACME",
  "tokenType": "fungible",
  "decimals": 2,
  "initialSupply": 100000,
  "supplyType": "finite",
  "maxSupply": 1000000,
  "adminKey": true,
  "supplyKey": { "threshold": 2, "keys": ["302a300506032b6570...", "302d300706052b8104..."] },
  "customFees": [
    { "type": "fixed", "amount": 100, "feeCollectorAccountId": "0.0.1234" },
    { "type": "fractional", "numerator": 1, "denominator": 100, "minimumAmount": 1,
      "maximumAmount": 500, "assessmentMethod": "inclusive", "feeCollectorAccountId": "0.0.1234" }
  ],
  "memo": "created by HashPilot"
}`;

/**
 * Get tool definitions for MCP server
 */
export const tokenTools = [
  {
    name: 'token_create',
    description: `Create a new token on Hedera - fungible or non-fungible - with custom fees, multi-signature keys and supply controls. Treasury defaults to the operator account. IMPORTANT: token keys cannot be added later if not set during creation.

Every key (adminKey, supplyKey, freezeKey, wipeKey, kycKey, pauseKey, feeScheduleKey) accepts true (operator key), a public key string, or { threshold, keys } for a multi-signature key list.

Fields may also come from a JSON file via configPath, or an inline config object. Explicit arguments win over config, and config wins over the file. Example file:
${TOKEN_CONFIG_EXAMPLE}`,
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
        tokenType: {
          type: 'string',
          enum: ['fungible', 'nft'],
          description:
            'fungible (default) or nft. An nft must have decimals 0 and initialSupply 0; mint serials afterwards with metadata.',
        },
        decimals: {
          type: 'number',
          description: 'Number of decimal places (default: 0, must be 0 for nft)',
          minimum: 0,
          maximum: 18,
          default: 0,
        },
        initialSupply: {
          type: 'number',
          description: 'Initial token supply (default: 1000 for fungible, must be 0 for nft)',
          minimum: 0,
        },
        supplyType: {
          type: 'string',
          enum: ['finite', 'infinite'],
          description:
            'infinite (default) or finite. finite requires maxSupply; maxSupply implies finite.',
        },
        maxSupply: {
          type: 'number',
          description: 'Maximum supply, only with supplyType finite (NFT: maximum serials)',
          minimum: 1,
        },
        treasuryAccountId: {
          type: 'string',
          description: 'Treasury account ID (defaults to operator account)',
          pattern: '^0\\.0\\.\\d+$',
        },
        treasuryPrivateKey: {
          type: 'string',
          description:
            'Private key of treasuryAccountId, required when the treasury is not the operator because that account must sign the create. DER or raw hex.',
        },
        adminKey: { ...keyParameterSchema('Admin key, allows later token updates') },
        kycKey: { ...keyParameterSchema('KYC key, requires a KYC grant before transfers') },
        freezeKey: { ...keyParameterSchema('Freeze key, allows freezing accounts') },
        wipeKey: { ...keyParameterSchema('Wipe key, allows wiping tokens from accounts') },
        supplyKey: {
          ...keyParameterSchema('Supply key, allows minting and burning (default: operator)'),
        },
        pauseKey: { ...keyParameterSchema('Pause key, allows pausing all token operations') },
        feeScheduleKey: {
          ...keyParameterSchema('Fee schedule key, allows updating the custom fees'),
        },
        freezeDefault: {
          type: 'boolean',
          description: 'Freeze new associations by default (requires freezeKey)',
        },
        customFees: { ...CUSTOM_FEES_SCHEMA },
        memo: {
          type: 'string',
          description: 'Optional token memo (max 100 characters)',
          maxLength: 100,
        },
        signerPrivateKeys: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Extra private keys to sign the create with, needed when adminKey is a key you hold rather than the operator key',
        },
        configPath: {
          type: 'string',
          description: 'Path to a JSON file holding any of the fields above',
        },
        config: {
          type: 'object',
          description: 'Inline object holding any of the fields above',
        },
      },
      required: [],
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
      'Mint tokens into the treasury account. Fungible tokens: pass amount. Non-fungible tokens: pass metadata, one entry per serial (max 10 per call), and the new serial numbers are returned. Requires the supply key.',
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
          description: 'Fungible token: amount to mint (in smallest unit based on token decimals)',
          minimum: 1,
        },
        metadata: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Non-fungible token: metadata for each serial to mint, commonly an IPFS CID (max 100 bytes each)',
        },
        metadataEncoding: {
          type: 'string',
          enum: ['utf8', 'base64', 'hex'],
          description: 'How to read the metadata strings into bytes (default: utf8)',
        },
      },
      required: ['tokenId'],
    },
  },
  {
    name: 'token_burn',
    description:
      'Burn tokens from the treasury account, reducing total supply. Fungible tokens: pass amount. Non-fungible tokens: pass serialNumbers. Requires the supply key.',
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
          description: 'Fungible token: amount to burn (in smallest unit based on token decimals)',
          minimum: 1,
        },
        serialNumbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Non-fungible token: serial numbers to burn from the treasury',
        },
      },
      required: ['tokenId'],
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
          description: 'Fungible token: amount to wipe (in smallest unit based on token decimals)',
          minimum: 1,
        },
        serialNumbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Non-fungible token: serial numbers to wipe from the account',
        },
      },
      required: ['tokenId', 'accountId'],
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
