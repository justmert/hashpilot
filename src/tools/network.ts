/**
 * Network Management Tools
 * MCP tools for managing Hedera network connections
 */

import { hederaCLI } from '../services/hedera-cli.js';
import { ToolResult } from '../types/index.js';
import logger from '../utils/logger.js';
import { SUPPORTED_NETWORKS, isSupportedNetwork } from '../types/index.js';

/**
 * Get current network information
 */
export async function getCurrentNetwork(): Promise<ToolResult> {
  try {
    logger.info('Getting current network info');

    const result = await hederaCLI.executeCommand({
      command: 'network current',
      args: {},
    });

    return result;
  } catch (error) {
    logger.error('Failed to get current network', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Switch to a different Hedera network
 */
export async function switchNetwork(args: {
  network: 'mainnet' | 'testnet' | 'previewnet' | 'local';
}): Promise<ToolResult> {
  try {
    // Reject an unknown network at the boundary so the client gets a usable
    // message naming the valid options, instead of an SDK-level failure.
    if (!isSupportedNetwork(args.network)) {
      return {
        success: false,
        error: `Unknown network: ${String(args.network)}. Supported networks: ${SUPPORTED_NETWORKS.join(', ')}`,
      };
    }

    logger.info('Switching network', { network: args.network });

    const result = await hederaCLI.executeCommand({
      command: 'network use',
      args: {
        network: args.network,
      },
    });

    return result;
  } catch (error) {
    logger.error('Failed to switch network', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get tool definitions for MCP server
 */
export const networkTools = [
  {
    name: 'network_info',
    description:
      'Get information about the currently active Hedera network including network name, Mirror Node URL, and JSON-RPC Relay endpoint.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'network_switch',
    description:
      'Switch to a different Hedera network. Available networks: mainnet (production), testnet (testing), previewnet (preview features), local (local development).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: {
          type: 'string',
          description: 'Network to switch to',
          enum: ['mainnet', 'testnet', 'previewnet', 'local'],
        },
      },
      required: ['network'],
    },
  },
];
