/**
 * Key Converter Utility
 * Converts between different key formats and provides network URL mappings
 */

import { PrivateKey } from '@hashgraph/sdk';
import { getHederaConfig } from './config.js';

/**
 * Network RPC URL mappings
 */
export const NETWORK_RPC_URLS: Record<string, string> = {
  mainnet: 'https://mainnet.hashio.io/api',
  testnet: 'https://testnet.hashio.io/api',
  previewnet: 'https://previewnet.hashio.io/api',
  local: 'http://localhost:7546',
};

/**
 * Network chain IDs
 */
export const NETWORK_CHAIN_IDS: Record<string, number> = {
  mainnet: 295,
  testnet: 296,
  previewnet: 297,
  local: 298,
};

/**
 * Convert DER-encoded private key to hex format (with 0x prefix)
 * @param derKey - DER encoded private key string
 * @returns Hex encoded private key with 0x prefix
 */
export function derToHex(derKey: string): string {
  try {
    const privateKey = PrivateKey.fromStringDer(derKey);
    const rawHex = privateKey.toStringRaw();
    // Ensure 0x prefix
    return rawHex.startsWith('0x') ? rawHex : `0x${rawHex}`;
  } catch (error) {
    throw new Error(`Failed to convert DER key to hex: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Convert hex-encoded private key to DER format
 * @param hexKey - Hex encoded private key (with or without 0x prefix)
 * @returns DER encoded private key string
 */
export function hexToDer(hexKey: string): string {
  try {
    const cleanHex = hexKey.startsWith('0x') ? hexKey.slice(2) : hexKey;
    const privateKey = PrivateKey.fromStringECDSA(cleanHex);
    return privateKey.toStringDer();
  } catch (error) {
    throw new Error(`Failed to convert hex key to DER: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get RPC URL for a network
 * @param network - Network name (mainnet, testnet, previewnet, local)
 * @returns RPC URL
 */
export function getRpcUrl(network?: string): string {
  const net = network || getHederaConfig().network || 'testnet';
  const url = NETWORK_RPC_URLS[net.toLowerCase()];
  if (!url) {
    throw new Error(`Unknown network: ${net}. Valid networks: ${Object.keys(NETWORK_RPC_URLS).join(', ')}`);
  }
  return url;
}

/**
 * Get chain ID for a network
 * @param network - Network name
 * @returns Chain ID
 */
export function getChainId(network?: string): number {
  const net = network || getHederaConfig().network || 'testnet';
  const chainId = NETWORK_CHAIN_IDS[net.toLowerCase()];
  if (!chainId) {
    throw new Error(`Unknown network: ${net}. Valid networks: ${Object.keys(NETWORK_CHAIN_IDS).join(', ')}`);
  }
  return chainId;
}

/**
 * Get MCP operator private key in hex format
 * @returns Hex encoded operator private key with 0x prefix, or undefined if not configured
 */
export function getOperatorKeyHex(): string | undefined {
  const config = getHederaConfig();
  if (!config.operatorKey) {
    return undefined;
  }

  try {
    return derToHex(config.operatorKey);
  } catch (error) {
    // Key might already be in hex format
    if (config.operatorKey.startsWith('0x') || config.operatorKey.length === 64) {
      return config.operatorKey.startsWith('0x') ? config.operatorKey : `0x${config.operatorKey}`;
    }
    throw error;
  }
}

/**
 * Get MCP operator account ID
 * @returns Operator account ID or undefined if not configured
 */
export function getOperatorId(): string | undefined {
  const config = getHederaConfig();
  return config.operatorId;
}

/**
 * Get current network from MCP config
 * @returns Network name (defaults to 'testnet')
 */
export function getCurrentNetwork(): string {
  const config = getHederaConfig();
  return config.network || 'testnet';
}

/**
 * Get complete operator credentials for EVM deployment
 * @returns Object with privateKey (hex), rpcUrl, and chainId
 */
export function getOperatorCredentials(): {
  privateKey: string | undefined;
  rpcUrl: string;
  chainId: number;
  network: string;
  operatorId: string | undefined;
} {
  const network = getCurrentNetwork();
  return {
    privateKey: getOperatorKeyHex(),
    rpcUrl: getRpcUrl(network),
    chainId: getChainId(network),
    network,
    operatorId: getOperatorId(),
  };
}

/**
 * Resolve private key from multiple sources
 * Priority: explicit key > address book alias > MCP operator config
 * @param explicitKey - Explicitly provided private key
 * @param _alias - Address book alias (not implemented yet, placeholder)
 * @returns Hex encoded private key with 0x prefix
 * @throws Error if no key is available
 */
export function resolvePrivateKey(explicitKey?: string, _alias?: string): string {
  // 1. Use explicit key if provided
  if (explicitKey) {
    return explicitKey.startsWith('0x') ? explicitKey : `0x${explicitKey}`;
  }

  // 2. TODO: Check address book for alias
  // This would require importing addressBook service
  // For now, skip this step

  // 3. Fall back to MCP operator key
  const operatorKey = getOperatorKeyHex();
  if (operatorKey) {
    return operatorKey;
  }

  throw new Error(
    'No private key available. Either provide a privateKey parameter, use an address book alias, or configure HEDERA_OPERATOR_KEY in MCP settings.'
  );
}

/**
 * Generate environment variable name for network
 * @param network - Network name
 * @param suffix - Variable suffix (e.g., 'PRIVATE_KEY', 'RPC_URL')
 * @returns Environment variable name
 */
export function getNetworkEnvVarName(network: string, suffix: string): string {
  return `${network.toUpperCase()}_${suffix}`;
}

/**
 * Get environment variables for Hardhat/Foundry projects
 * Uses MCP operator key and auto-generates for all networks
 * @returns Object with environment variables
 */
export function getDeploymentEnvVars(): Record<string, string> {
  const config = getHederaConfig();
  const envVars: Record<string, string> = {};

  // Get operator key in hex format
  const operatorKeyHex = getOperatorKeyHex();

  if (operatorKeyHex) {
    // Set for all networks - user's configured operator
    const networks = ['mainnet', 'testnet', 'previewnet', 'local'];
    for (const network of networks) {
      envVars[getNetworkEnvVarName(network, 'PRIVATE_KEY')] = operatorKeyHex;
      envVars[getNetworkEnvVarName(network, 'RPC_URL')] = NETWORK_RPC_URLS[network];
    }
  }

  // Also set the generic HEDERA_ prefixed vars
  if (config.operatorId) {
    envVars['HEDERA_OPERATOR_ID'] = config.operatorId;
  }
  if (config.operatorKey) {
    envVars['HEDERA_OPERATOR_KEY'] = config.operatorKey;
  }
  if (operatorKeyHex) {
    envVars['HEDERA_PRIVATE_KEY'] = operatorKeyHex;
  }

  return envVars;
}
