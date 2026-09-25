/**
 * Hedera Stablecoin Studio Service
 * Wrapper for @hashgraph/stablecoin-npm-sdk
 * Provides compliant stablecoin creation and management
 */

// NOTE: console.log is redirected to stderr in src/index.ts to prevent
// SDK console output from corrupting MCP's JSON-RPC protocol on stdout

import { logger } from '../utils/logger.js';
import { getHederaConfig } from '../utils/config.js';

import { parseOperatorKey } from '../utils/key-converter.js';

/**
 * Stablecoin Studio contract set for a network.
 *
 * Only testnet addresses are published by the project
 * (documentation/FACTORY_VERSION.md and RESOLVER_VERSION.md in
 * hashgraph/stablecoin-studio). The v2.1.6 pair below matches the 2.x SDK
 * this package depends on; the current v4.0.0 pair (factory 0.0.7353542,
 * resolver 0.0.7353500) requires SDK 4.x. Mainnet and previewnet have no
 * published addresses and must be supplied through environment variables.
 */
interface StablecoinContracts {
  factoryAddress: string;
  resolverAddress: string;
  configId: string;
  configVersion: number;
}

const KNOWN_CONTRACTS: Record<string, StablecoinContracts> = {
  testnet: {
    factoryAddress: '0.0.6431833', // v2.1.6, verified on testnet Mirror Node
    resolverAddress: '0.0.6431794', // v2.1.6, verified on testnet Mirror Node
    configId: '0x0000000000000000000000000000000000000000000000000000000000000002',
    configVersion: 0,
  },
};

/**
 * Resolve the contract set for a network. Environment variables win so that
 * operators can point at a factory the project has not published (mainnet,
 * previewnet after a reset, or a newer testnet deployment).
 */
function resolveStablecoinContracts(network: string): StablecoinContracts {
  const env = process.env;
  const known = KNOWN_CONTRACTS[network];

  const factoryAddress = env.STABLECOIN_FACTORY_ADDRESS || known?.factoryAddress;
  const resolverAddress = env.STABLECOIN_RESOLVER_ADDRESS || known?.resolverAddress;

  if (!factoryAddress || !resolverAddress) {
    throw new Error(
      `Stablecoin Studio has no published factory/resolver contracts for ${network}. ` +
        'Set STABLECOIN_FACTORY_ADDRESS and STABLECOIN_RESOLVER_ADDRESS (and optionally ' +
        'STABLECOIN_CONFIG_ID / STABLECOIN_CONFIG_VERSION) in the MCP environment. See ' +
        'https://github.com/hashgraph/stablecoin-studio/blob/main/documentation/FACTORY_VERSION.md'
    );
  }

  return {
    factoryAddress,
    resolverAddress,
    configId: env.STABLECOIN_CONFIG_ID || known?.configId || KNOWN_CONTRACTS.testnet.configId,
    configVersion:
      env.STABLECOIN_CONFIG_VERSION !== undefined
        ? parseInt(env.STABLECOIN_CONFIG_VERSION, 10)
        : (known?.configVersion ?? KNOWN_CONTRACTS.testnet.configVersion),
  };
}

/**
 * Stablecoin creation parameters
 */
export interface CreateStablecoinParams {
  name: string;
  symbol: string;
  decimals?: number;
  initialSupply?: string;
  maxSupply?: string;
  memo?: string;
  freezeDefault?: boolean;
  // Keys
  supplyType?: 'INFINITE' | 'FINITE';
  // Role accounts (default to operator)
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
  cashInAllowanceType?: 'UNLIMITED' | 'LIMITED';
  // Reserve
  createReserve?: boolean;
  reserveInitialAmount?: string;
  reserveAddress?: string;
  // Proxy
  proxyAdminOwnerAccount?: string;
}

/**
 * Stablecoin operation result
 */
export interface StablecoinResult {
  success: boolean;
  tokenId?: string;
  proxyAddress?: string;
  transactionId?: string;
  data?: any;
  error?: string;
}

/**
 * Stablecoin Studio Service
 * Manages compliant stablecoin operations
 */
class StablecoinStudioService {
  private initialized = false;
  private network: string = 'testnet';
  private SDK: any = null;
  private contracts: StablecoinContracts | null = null;

  /**
   * Initialize the SDK with MCP operator account
   */
  async initialize(network?: string): Promise<void> {
    if (this.initialized && this.network === (network || this.network)) {
      return;
    }

    try {
      // Dynamically import SDK
      // Note: Using require() for CJS compatibility as ESM version has import path issues
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const sdkModule = require('@hashgraph/stablecoin-npm-sdk');
      this.SDK = sdkModule;

      const config = getHederaConfig();
      this.network = network || config.network || 'testnet';

      const contracts = resolveStablecoinContracts(this.network);
      this.contracts = contracts;
      const { factoryAddress, resolverAddress } = contracts;

      // Initialize network with configuration included
      // Both factoryAddress and resolverAddress are required by SDK v2.1.5
      // Including configuration in InitializationRequest ensures atomic setup
      const initRequest = new this.SDK.InitializationRequest({
        network: this.network,
        mirrorNode: {
          name: 'hedera-mirror-node',
          baseUrl: `https://${this.network}.mirrornode.hedera.com/api/v1/`,
        },
        rpcNode: {
          name: 'hedera-rpc',
          baseUrl: `https://${this.network}.hashio.io/api`,
        },
        configuration: {
          factoryAddress: factoryAddress,
          resolverAddress: resolverAddress,
        },
      });

      await this.SDK.Network.init(initRequest);

      // Connect with operator account
      if (!config.operatorId || !config.operatorKey) {
        throw new Error('MCP operator account not configured');
      }

      // The SDK selects the curve from `type` and parses `key` as raw hex,
      // so normalise whatever format the operator supplied (DER or hex).
      const operatorKey = parseOperatorKey(config.operatorKey).key;
      const connectRequest = new this.SDK.ConnectRequest({
        account: {
          accountId: config.operatorId,
          privateKey: {
            key: operatorKey.toStringRaw(),
            type: operatorKey.type === 'ED25519' ? 'ED25519' : 'ECDSA',
          },
        },
        network: this.network,
        wallet: this.SDK.SupportedWallets.CLIENT,
        mirrorNode: {
          name: 'hedera-mirror-node',
          baseUrl: `https://${this.network}.mirrornode.hedera.com/api/v1/`,
        },
        rpcNode: {
          name: 'hedera-rpc',
          baseUrl: `https://${this.network}.hashio.io/api`,
        },
      });

      await this.SDK.Network.connect(connectRequest);

      // Explicitly set configuration after connect to ensure it persists
      // The SDK's Network.init() may not properly store config in all cases
      const setConfigRequest = new this.SDK.SetConfigurationRequest({
        factoryAddress: factoryAddress,
        resolverAddress: resolverAddress,
      });
      await this.SDK.Network.setConfig(setConfigRequest);

      // Verify configuration was stored correctly
      const storedFactory = this.SDK.Network.getFactoryAddress();
      if (!storedFactory) {
        throw new Error(
          `Failed to store factory configuration. Factory: ${factoryAddress}, Resolver: ${resolverAddress}`
        );
      }
      logger.info('Stablecoin Studio configuration set', {
        factoryAddress: storedFactory,
        resolverAddress: this.SDK.Network.getResolverAddress(),
      });

      this.initialized = true;
      logger.info('Stablecoin Studio SDK initialized', { network: this.network });
    } catch (error) {
      logger.error('Failed to initialize Stablecoin Studio SDK', { error });
      throw error;
    }
  }

  /**
   * Ensure SDK is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Create a new compliant stablecoin
   */
  async createStablecoin(params: CreateStablecoinParams): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      // Verify factory configuration before attempting creation
      const factoryAddress = this.SDK.Network.getFactoryAddress();
      if (!factoryAddress) {
        throw new Error('Factory address not configured. SDK may not be properly initialized.');
      }
      logger.info('Creating stablecoin with factory', { factoryAddress });

      const config = getHederaConfig();
      const operatorId = config.operatorId!;

      const createRequest = new this.SDK.CreateRequest({
        name: params.name,
        symbol: params.symbol,
        decimals: params.decimals || 6,
        initialSupply: params.initialSupply || '0',
        maxSupply: params.maxSupply,
        memo: params.memo || `Created via HashPilot MCP`,
        freezeDefault: params.freezeDefault || false,
        supplyType:
          params.supplyType === 'FINITE'
            ? this.SDK.TokenSupplyType.FINITE
            : this.SDK.TokenSupplyType.INFINITE,
        // Use operator account for all roles by default
        cashInRoleAccount: params.cashInRoleAccount || operatorId,
        burnRoleAccount: params.burnRoleAccount || operatorId,
        wipeRoleAccount: params.wipeRoleAccount || operatorId,
        rescueRoleAccount: params.rescueRoleAccount || operatorId,
        pauseRoleAccount: params.pauseRoleAccount || operatorId,
        freezeRoleAccount: params.freezeRoleAccount || operatorId,
        kycRoleAccount: params.kycRoleAccount || operatorId,
        deleteRoleAccount: params.deleteRoleAccount || operatorId,
        // Cash-in allowance
        cashInRoleAllowance: params.cashInAllowance || '0',
        // Reserve
        createReserve: params.createReserve || false,
        reserveInitialAmount: params.reserveInitialAmount,
        reserveAddress: params.reserveAddress,
        // Proxy admin owner (SDK uses proxyOwnerAccount)
        proxyOwnerAccount: params.proxyAdminOwnerAccount || operatorId,
        // Factory configuration (required by SDK)
        configId: this.contracts?.configId,
        configVersion: this.contracts?.configVersion,
        // Stablecoin factory address
        stableCoinFactory: this.contracts?.factoryAddress,
      });

      const result = await this.SDK.StableCoin.create(createRequest);

      return {
        success: true,
        tokenId: result.coin?.tokenId?.toString(),
        proxyAddress: result.coin?.proxyAddress?.toString(),
        data: {
          name: params.name,
          symbol: params.symbol,
          decimals: params.decimals || 6,
          initialSupply: params.initialSupply || '0',
        },
      };
    } catch (error) {
      logger.error('Failed to create stablecoin', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create stablecoin',
      };
    }
  }

  /**
   * Get stablecoin info
   */
  async getInfo(tokenId: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const request = new this.SDK.GetStableCoinDetailsRequest({
        id: tokenId,
      });

      const info = await this.SDK.StableCoin.getInfo(request);

      return {
        success: true,
        tokenId,
        data: {
          name: info.name,
          symbol: info.symbol,
          decimals: info.decimals,
          totalSupply: info.totalSupply?.toString(),
          maxSupply: info.maxSupply?.toString(),
          treasury: info.treasury?.toString(),
          paused: info.paused,
          deleted: info.deleted,
          freezeDefault: info.freezeDefault,
          proxyAddress: info.proxyAddress?.toString(),
        },
      };
    } catch (error) {
      logger.error('Failed to get stablecoin info', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get info',
      };
    }
  }

  /**
   * Cash-in (mint) tokens to an account
   */
  async cashIn(tokenId: string, targetAccount: string, amount: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const request = new this.SDK.CashInRequest({
        tokenId,
        targetId: targetAccount,
        amount,
      });

      const result = await this.SDK.StableCoin.cashIn(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'cashin',
          targetAccount,
          amount,
        },
      };
    } catch (error) {
      logger.error('Cash-in failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Cash-in failed',
      };
    }
  }

  /**
   * Burn tokens from treasury
   */
  async burn(tokenId: string, amount: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const request = new this.SDK.BurnRequest({
        tokenId,
        amount,
      });

      const result = await this.SDK.StableCoin.burn(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'burn',
          amount,
        },
      };
    } catch (error) {
      logger.error('Burn failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Burn failed',
      };
    }
  }

  /**
   * Wipe tokens from an account
   */
  async wipe(tokenId: string, targetAccount: string, amount: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const request = new this.SDK.WipeRequest({
        tokenId,
        targetId: targetAccount,
        amount,
      });

      const result = await this.SDK.StableCoin.wipe(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'wipe',
          targetAccount,
          amount,
        },
      };
    } catch (error) {
      logger.error('Wipe failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Wipe failed',
      };
    }
  }

  /**
   * Rescue tokens from contract treasury
   */
  async rescue(tokenId: string, amount: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const request = new this.SDK.RescueRequest({
        tokenId,
        amount,
      });

      const result = await this.SDK.StableCoin.rescue(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'rescue',
          amount,
        },
      };
    } catch (error) {
      logger.error('Rescue failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Rescue failed',
      };
    }
  }

  /**
   * Rescue HBAR from contract
   */
  async rescueHbar(tokenId: string, amount: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const request = new this.SDK.RescueHBARRequest({
        tokenId,
        amount,
      });

      const result = await this.SDK.StableCoin.rescueHBAR(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'rescue_hbar',
          amount,
        },
      };
    } catch (error) {
      logger.error('Rescue HBAR failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Rescue HBAR failed',
      };
    }
  }

  /**
   * Freeze an account
   */
  async freeze(tokenId: string, targetAccount: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const request = new this.SDK.FreezeAccountRequest({
        tokenId,
        targetId: targetAccount,
      });

      const result = await this.SDK.StableCoin.freeze(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'freeze',
          targetAccount,
        },
      };
    } catch (error) {
      logger.error('Freeze failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Freeze failed',
      };
    }
  }

  /**
   * Unfreeze an account
   */
  async unfreeze(tokenId: string, targetAccount: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      // The SDK has no UnFreezeAccountRequest; unfreeze reuses FreezeAccountRequest
      const request = new this.SDK.FreezeAccountRequest({
        tokenId,
        targetId: targetAccount,
      });

      const result = await this.SDK.StableCoin.unFreeze(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'unfreeze',
          targetAccount,
        },
      };
    } catch (error) {
      logger.error('Unfreeze failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unfreeze failed',
      };
    }
  }

  /**
   * Pause all token operations
   */
  async pause(tokenId: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const request = new this.SDK.PauseRequest({
        tokenId,
      });

      const result = await this.SDK.StableCoin.pause(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'pause',
        },
      };
    } catch (error) {
      logger.error('Pause failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Pause failed',
      };
    }
  }

  /**
   * Unpause token operations
   */
  async unpause(tokenId: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      // The SDK has no UnPauseRequest; unpause reuses PauseRequest
      const request = new this.SDK.PauseRequest({
        tokenId,
      });

      const result = await this.SDK.StableCoin.unPause(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'unpause',
        },
      };
    } catch (error) {
      logger.error('Unpause failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unpause failed',
      };
    }
  }

  /**
   * Grant KYC to an account
   */
  async grantKyc(tokenId: string, targetAccount: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const request = new this.SDK.KYCRequest({
        tokenId,
        targetId: targetAccount,
      });

      const result = await this.SDK.StableCoin.grantKyc(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'kyc_grant',
          targetAccount,
        },
      };
    } catch (error) {
      logger.error('Grant KYC failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Grant KYC failed',
      };
    }
  }

  /**
   * Revoke KYC from an account
   */
  async revokeKyc(tokenId: string, targetAccount: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const request = new this.SDK.KYCRequest({
        tokenId,
        targetId: targetAccount,
      });

      const result = await this.SDK.StableCoin.revokeKyc(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'kyc_revoke',
          targetAccount,
        },
      };
    } catch (error) {
      logger.error('Revoke KYC failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Revoke KYC failed',
      };
    }
  }

  /**
   * Grant a role to an account
   */
  async grantRole(tokenId: string, role: string, targetAccount: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const roleEnum = this.mapRole(role);
      const request = new this.SDK.GrantRoleRequest({
        tokenId,
        targetId: targetAccount,
        role: roleEnum,
      });

      const result = await this.SDK.Role.grantRole(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'role_grant',
          role,
          targetAccount,
        },
      };
    } catch (error) {
      logger.error('Grant role failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Grant role failed',
      };
    }
  }

  /**
   * Revoke a role from an account
   */
  async revokeRole(
    tokenId: string,
    role: string,
    targetAccount: string
  ): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const roleEnum = this.mapRole(role);
      const request = new this.SDK.RevokeRoleRequest({
        tokenId,
        targetId: targetAccount,
        role: roleEnum,
      });

      const result = await this.SDK.Role.revokeRole(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'role_revoke',
          role,
          targetAccount,
        },
      };
    } catch (error) {
      logger.error('Revoke role failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Revoke role failed',
      };
    }
  }

  /**
   * Check if account has a role
   */
  async checkRole(tokenId: string, role: string, targetAccount: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const roleEnum = this.mapRole(role);
      const request = new this.SDK.HasRoleRequest({
        tokenId,
        targetId: targetAccount,
        role: roleEnum,
      });

      const hasRole = await this.SDK.Role.hasRole(request);

      return {
        success: true,
        tokenId,
        data: {
          operation: 'role_check',
          role,
          targetAccount,
          hasRole,
        },
      };
    } catch (error) {
      logger.error('Check role failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Check role failed',
      };
    }
  }

  /**
   * Get account balance for stablecoin
   */
  async getBalance(tokenId: string, targetAccount: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const request = new this.SDK.GetAccountBalanceRequest({
        tokenId,
        targetId: targetAccount,
      });

      const balance = await this.SDK.StableCoin.getBalanceOf(request);

      return {
        success: true,
        tokenId,
        data: {
          operation: 'balance',
          targetAccount,
          balance: balance?.toString(),
        },
      };
    } catch (error) {
      logger.error('Get balance failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Get balance failed',
      };
    }
  }

  /**
   * Delete a stablecoin
   */
  async delete(tokenId: string): Promise<StablecoinResult> {
    await this.ensureInitialized();

    try {
      const request = new this.SDK.DeleteRequest({
        tokenId,
      });

      const result = await this.SDK.StableCoin.delete(request);

      return {
        success: true,
        tokenId,
        transactionId: result?.transactionId?.toString(),
        data: {
          operation: 'delete',
        },
      };
    } catch (error) {
      logger.error('Delete failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Delete failed',
      };
    }
  }

  /**
   * Map role string to SDK enum
   */
  private mapRole(role: string): any {
    const roleMap: Record<string, string> = {
      CASHIN: 'Cash in Role',
      BURN: 'Burn Role',
      WIPE: 'Wipe Role',
      RESCUE: 'Rescue Role',
      PAUSE: 'Pause Role',
      FREEZE: 'Freeze Role',
      KYC: 'KYC Role',
      DELETE: 'Delete Role',
    };

    const sdkRole = roleMap[role.toUpperCase()];
    if (!sdkRole) {
      throw new Error(`Unknown role: ${role}. Valid roles: ${Object.keys(roleMap).join(', ')}`);
    }

    return sdkRole;
  }

  /**
   * Get current network
   */
  getCurrentNetwork(): string {
    return this.network;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
export const stablecoinStudio = new StablecoinStudioService();
