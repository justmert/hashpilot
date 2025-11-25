/**
 * Hedera Stablecoin Studio MCP Tool
 * Composite tool for compliant stablecoin operations
 */

import { stablecoinStudio } from '../services/stablecoin-studio.js';
import { logger } from '../utils/logger.js';

// Tool result type
interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    executedVia: string;
    command: string;
  };
}

/**
 * Stablecoin management composite tool
 * Handles all stablecoin operations through a single interface
 */
export async function stablecoinManage(args: {
  operation:
    | 'create'
    | 'info'
    | 'balance'
    | 'cashin'
    | 'burn'
    | 'wipe'
    | 'rescue'
    | 'rescue_hbar'
    | 'freeze'
    | 'unfreeze'
    | 'pause'
    | 'unpause'
    | 'kyc_grant'
    | 'kyc_revoke'
    | 'role_grant'
    | 'role_revoke'
    | 'role_check'
    | 'delete';
  // Common parameters
  stablecoinId?: string;
  targetAccount?: string;
  amount?: string;
  // Create-specific
  name?: string;
  symbol?: string;
  decimals?: number;
  initialSupply?: string;
  maxSupply?: string;
  memo?: string;
  freezeDefault?: boolean;
  supplyType?: 'INFINITE' | 'FINITE';
  // Role accounts
  cashInRoleAccount?: string;
  burnRoleAccount?: string;
  wipeRoleAccount?: string;
  rescueRoleAccount?: string;
  pauseRoleAccount?: string;
  freezeRoleAccount?: string;
  kycRoleAccount?: string;
  deleteRoleAccount?: string;
  // Cash-in limits
  cashInAllowance?: string;
  // Reserve
  createReserve?: boolean;
  reserveInitialAmount?: string;
  reserveAddress?: string;
  // Proxy
  proxyAdminOwnerAccount?: string;
  // Role operations
  role?: 'CASHIN' | 'BURN' | 'WIPE' | 'RESCUE' | 'PAUSE' | 'FREEZE' | 'KYC' | 'DELETE';
  // Network (for initialization)
  network?: 'mainnet' | 'testnet' | 'previewnet';
}): Promise<ToolResult> {
  try {
    logger.info('Stablecoin operation', { operation: args.operation });

    // Initialize SDK if needed (will use network from config or args)
    if (args.network) {
      await stablecoinStudio.initialize(args.network);
    }

    switch (args.operation) {
      case 'create': {
        if (!args.name || !args.symbol) {
          throw new Error('Name and symbol are required for stablecoin creation');
        }

        const result = await stablecoinStudio.createStablecoin({
          name: args.name,
          symbol: args.symbol,
          decimals: args.decimals,
          initialSupply: args.initialSupply,
          maxSupply: args.maxSupply,
          memo: args.memo,
          freezeDefault: args.freezeDefault,
          supplyType: args.supplyType,
          cashInRoleAccount: args.cashInRoleAccount,
          burnRoleAccount: args.burnRoleAccount,
          wipeRoleAccount: args.wipeRoleAccount,
          rescueRoleAccount: args.rescueRoleAccount,
          pauseRoleAccount: args.pauseRoleAccount,
          freezeRoleAccount: args.freezeRoleAccount,
          kycRoleAccount: args.kycRoleAccount,
          deleteRoleAccount: args.deleteRoleAccount,
          cashInAllowance: args.cashInAllowance,
          createReserve: args.createReserve,
          reserveInitialAmount: args.reserveInitialAmount,
          reserveAddress: args.reserveAddress,
          proxyAdminOwnerAccount: args.proxyAdminOwnerAccount,
        });

        // Get current network for HashScan links
        const currentNetwork = stablecoinStudio.getCurrentNetwork();
        const hashScanBase = `https://hashscan.io/${currentNetwork}`;

        return {
          success: result.success,
          data: result.success
            ? {
                message: 'Stablecoin created successfully',
                tokenId: result.tokenId,
                proxyAddress: result.proxyAddress,
                ...result.data,
                verification: {
                  tokenUrl: `${hashScanBase}/token/${result.tokenId}`,
                  proxyContractUrl: result.proxyAddress ? `${hashScanBase}/contract/${result.proxyAddress}` : undefined,
                  message: `You can verify your stablecoin at: ${hashScanBase}/token/${result.tokenId}`,
                },
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'create',
          },
        };
      }

      case 'info': {
        if (!args.stablecoinId) {
          throw new Error('stablecoinId is required');
        }

        const result = await stablecoinStudio.getInfo(args.stablecoinId);

        return {
          success: result.success,
          data: result.data,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'info',
          },
        };
      }

      case 'balance': {
        if (!args.stablecoinId || !args.targetAccount) {
          throw new Error('stablecoinId and targetAccount are required');
        }

        const result = await stablecoinStudio.getBalance(args.stablecoinId, args.targetAccount);

        return {
          success: result.success,
          data: result.data,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'balance',
          },
        };
      }

      case 'cashin': {
        if (!args.stablecoinId || !args.targetAccount || !args.amount) {
          throw new Error('stablecoinId, targetAccount, and amount are required');
        }

        const result = await stablecoinStudio.cashIn(args.stablecoinId, args.targetAccount, args.amount);

        return {
          success: result.success,
          data: result.success
            ? {
                message: `Minted ${args.amount} tokens to ${args.targetAccount}`,
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'cashin',
          },
        };
      }

      case 'burn': {
        if (!args.stablecoinId || !args.amount) {
          throw new Error('stablecoinId and amount are required');
        }

        const result = await stablecoinStudio.burn(args.stablecoinId, args.amount);

        return {
          success: result.success,
          data: result.success
            ? {
                message: `Burned ${args.amount} tokens from treasury`,
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'burn',
          },
        };
      }

      case 'wipe': {
        if (!args.stablecoinId || !args.targetAccount || !args.amount) {
          throw new Error('stablecoinId, targetAccount, and amount are required');
        }

        const result = await stablecoinStudio.wipe(args.stablecoinId, args.targetAccount, args.amount);

        return {
          success: result.success,
          data: result.success
            ? {
                message: `Wiped ${args.amount} tokens from ${args.targetAccount}`,
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'wipe',
          },
        };
      }

      case 'rescue': {
        if (!args.stablecoinId || !args.amount) {
          throw new Error('stablecoinId and amount are required');
        }

        const result = await stablecoinStudio.rescue(args.stablecoinId, args.amount);

        return {
          success: result.success,
          data: result.success
            ? {
                message: `Rescued ${args.amount} tokens from contract`,
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'rescue',
          },
        };
      }

      case 'rescue_hbar': {
        if (!args.stablecoinId || !args.amount) {
          throw new Error('stablecoinId and amount are required');
        }

        const result = await stablecoinStudio.rescueHbar(args.stablecoinId, args.amount);

        return {
          success: result.success,
          data: result.success
            ? {
                message: `Rescued ${args.amount} HBAR from contract`,
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'rescue_hbar',
          },
        };
      }

      case 'freeze': {
        if (!args.stablecoinId || !args.targetAccount) {
          throw new Error('stablecoinId and targetAccount are required');
        }

        const result = await stablecoinStudio.freeze(args.stablecoinId, args.targetAccount);

        return {
          success: result.success,
          data: result.success
            ? {
                message: `Froze account ${args.targetAccount}`,
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'freeze',
          },
        };
      }

      case 'unfreeze': {
        if (!args.stablecoinId || !args.targetAccount) {
          throw new Error('stablecoinId and targetAccount are required');
        }

        const result = await stablecoinStudio.unfreeze(args.stablecoinId, args.targetAccount);

        return {
          success: result.success,
          data: result.success
            ? {
                message: `Unfroze account ${args.targetAccount}`,
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'unfreeze',
          },
        };
      }

      case 'pause': {
        if (!args.stablecoinId) {
          throw new Error('stablecoinId is required');
        }

        const result = await stablecoinStudio.pause(args.stablecoinId);

        return {
          success: result.success,
          data: result.success
            ? {
                message: 'Token operations paused',
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'pause',
          },
        };
      }

      case 'unpause': {
        if (!args.stablecoinId) {
          throw new Error('stablecoinId is required');
        }

        const result = await stablecoinStudio.unpause(args.stablecoinId);

        return {
          success: result.success,
          data: result.success
            ? {
                message: 'Token operations resumed',
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'unpause',
          },
        };
      }

      case 'kyc_grant': {
        if (!args.stablecoinId || !args.targetAccount) {
          throw new Error('stablecoinId and targetAccount are required');
        }

        const result = await stablecoinStudio.grantKyc(args.stablecoinId, args.targetAccount);

        return {
          success: result.success,
          data: result.success
            ? {
                message: `Granted KYC to ${args.targetAccount}`,
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'kyc_grant',
          },
        };
      }

      case 'kyc_revoke': {
        if (!args.stablecoinId || !args.targetAccount) {
          throw new Error('stablecoinId and targetAccount are required');
        }

        const result = await stablecoinStudio.revokeKyc(args.stablecoinId, args.targetAccount);

        return {
          success: result.success,
          data: result.success
            ? {
                message: `Revoked KYC from ${args.targetAccount}`,
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'kyc_revoke',
          },
        };
      }

      case 'role_grant': {
        if (!args.stablecoinId || !args.targetAccount || !args.role) {
          throw new Error('stablecoinId, targetAccount, and role are required');
        }

        const result = await stablecoinStudio.grantRole(args.stablecoinId, args.role, args.targetAccount);

        return {
          success: result.success,
          data: result.success
            ? {
                message: `Granted ${args.role} role to ${args.targetAccount}`,
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'role_grant',
          },
        };
      }

      case 'role_revoke': {
        if (!args.stablecoinId || !args.targetAccount || !args.role) {
          throw new Error('stablecoinId, targetAccount, and role are required');
        }

        const result = await stablecoinStudio.revokeRole(args.stablecoinId, args.role, args.targetAccount);

        return {
          success: result.success,
          data: result.success
            ? {
                message: `Revoked ${args.role} role from ${args.targetAccount}`,
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'role_revoke',
          },
        };
      }

      case 'role_check': {
        if (!args.stablecoinId || !args.targetAccount || !args.role) {
          throw new Error('stablecoinId, targetAccount, and role are required');
        }

        const result = await stablecoinStudio.checkRole(args.stablecoinId, args.role, args.targetAccount);

        return {
          success: result.success,
          data: result.data,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'role_check',
          },
        };
      }

      case 'delete': {
        if (!args.stablecoinId) {
          throw new Error('stablecoinId is required');
        }

        const result = await stablecoinStudio.delete(args.stablecoinId);

        return {
          success: result.success,
          data: result.success
            ? {
                message: 'Stablecoin deleted',
                ...result.data,
              }
            : undefined,
          error: result.error,
          metadata: {
            executedVia: 'stablecoin_studio',
            command: 'delete',
          },
        };
      }

      default:
        throw new Error(`Unknown operation: ${args.operation}`);
    }
  } catch (error) {
    logger.error('Stablecoin operation failed', { operation: args.operation, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        executedVia: 'stablecoin_studio',
        command: args.operation || 'unknown',
      },
    };
  }
}

/**
 * Stablecoin tool definition for MCP server
 */
export const stablecoinToolDefinition = {
  name: 'stablecoin_manage',
  description: `Enterprise-grade stablecoin management via Hedera Stablecoin Studio.

OPERATIONS:
- create: Create compliant stablecoin with role-based controls
- info: Get stablecoin details (supply, treasury, pause status)
- balance: Check account balance for stablecoin
- cashin: Mint tokens to account (controlled by CASHIN role)
- burn: Burn tokens from treasury (controlled by BURN role)
- wipe: Remove tokens from any account (controlled by WIPE role)
- rescue: Rescue tokens from proxy contract treasury
- rescue_hbar: Rescue HBAR from proxy contract
- freeze/unfreeze: Control account transfer ability
- pause/unpause: Halt/resume all token operations globally
- kyc_grant/kyc_revoke: Manage KYC compliance status
- role_grant/role_revoke/role_check: Manage role assignments
- delete: Permanently delete stablecoin (DANGER)

FEATURES:
- Role-based access control (CASHIN, BURN, WIPE, RESCUE, PAUSE, FREEZE, KYC, DELETE)
- Native KYC/AML compliance
- Proof-of-Reserve support
- Proxy contract architecture (upgradable)
- Cash-in allowances for controlled minting

AUTO-CONFIG: Uses MCP operator account for SDK authentication.

USE FOR: Institutional stablecoin issuance, compliance workflows, token lifecycle management.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: [
          'create',
          'info',
          'balance',
          'cashin',
          'burn',
          'wipe',
          'rescue',
          'rescue_hbar',
          'freeze',
          'unfreeze',
          'pause',
          'unpause',
          'kyc_grant',
          'kyc_revoke',
          'role_grant',
          'role_revoke',
          'role_check',
          'delete',
        ],
        description: 'Stablecoin operation to perform',
      },
      stablecoinId: { type: 'string', description: 'Stablecoin token ID (0.0.xxxxx) - required for most operations' },
      targetAccount: { type: 'string', description: 'Target account ID for cashin/wipe/freeze/kyc/role operations' },
      amount: { type: 'string', description: 'Token amount as string (for precise decimals)' },
      // Create parameters
      name: { type: 'string', description: 'Stablecoin name (for create)' },
      symbol: { type: 'string', description: 'Token symbol (for create)' },
      decimals: { type: 'number', description: 'Decimal places (default: 6)' },
      initialSupply: { type: 'string', description: 'Initial supply (default: 0)' },
      maxSupply: { type: 'string', description: 'Maximum supply (optional, for FINITE supply type)' },
      memo: { type: 'string', description: 'Token memo' },
      freezeDefault: { type: 'boolean', description: 'Freeze accounts by default (default: false)' },
      supplyType: { type: 'string', enum: ['INFINITE', 'FINITE'], description: 'Supply type (default: INFINITE)' },
      // Role accounts
      cashInRoleAccount: { type: 'string', description: 'Account with CASHIN role (default: operator)' },
      burnRoleAccount: { type: 'string', description: 'Account with BURN role (default: operator)' },
      wipeRoleAccount: { type: 'string', description: 'Account with WIPE role (default: operator)' },
      rescueRoleAccount: { type: 'string', description: 'Account with RESCUE role (default: operator)' },
      pauseRoleAccount: { type: 'string', description: 'Account with PAUSE role (default: operator)' },
      freezeRoleAccount: { type: 'string', description: 'Account with FREEZE role (default: operator)' },
      kycRoleAccount: { type: 'string', description: 'Account with KYC role (default: operator)' },
      deleteRoleAccount: { type: 'string', description: 'Account with DELETE role (default: operator)' },
      // Cash-in limits
      cashInAllowance: { type: 'string', description: 'Cash-in allowance limit (default: unlimited)' },
      // Reserve
      createReserve: { type: 'boolean', description: 'Create proof-of-reserve contract' },
      reserveInitialAmount: { type: 'string', description: 'Initial reserve amount' },
      reserveAddress: { type: 'string', description: 'Existing reserve contract address' },
      // Proxy
      proxyAdminOwnerAccount: { type: 'string', description: 'Proxy admin owner (default: operator)' },
      // Role operations
      role: {
        type: 'string',
        enum: ['CASHIN', 'BURN', 'WIPE', 'RESCUE', 'PAUSE', 'FREEZE', 'KYC', 'DELETE'],
        description: 'Role for grant/revoke/check operations',
      },
      // Network
      network: { type: 'string', enum: ['mainnet', 'testnet', 'previewnet'], description: 'Network (auto-detected from config)' },
    },
    required: ['operation'],
  },
};
