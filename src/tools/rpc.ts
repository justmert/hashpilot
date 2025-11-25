/**
 * RPC Tools for Hedera JSON-RPC Relay
 * Provides 4 tools: generic rpc_call + 3 high-level contract tools
 * Covers all 55+ RPC methods from OpenRPC specification
 */

import { jsonRpcService } from '../services/json-rpc-service.js';
import logger from '../utils/logger.js';
import { ToolResult } from '../types/index.js';

/**
 * Generic JSON-RPC call - supports ALL methods from OpenRPC spec
 * Returns full RPC response with decoded human-readable values
 */
export async function rpcCall(args: {
  method: string;
  params?: any[];
  network?: 'mainnet' | 'testnet' | 'previewnet' | 'local';
}): Promise<ToolResult> {
  try {
    logger.info('Executing generic RPC call', { method: args.method, network: args.network });

    const response = await jsonRpcService.callWithDetails(
      args.method,
      args.params || [],
      args.network
    );

    // Build output with full details
    const data: any = {
      method: args.method,
      result: response.result, // Raw result from RPC
    };

    // Add decoded values if available
    if (response.decoded) {
      data.decoded = response.decoded;
    }

    // Add full RPC response
    data.rpc_response = response.raw;

    return {
      success: true,
      data,
      metadata: {
        executedVia: 'json_rpc_relay',
        command: `rpc ${args.method}`,
        network: args.network || 'current',
      },
    };
  } catch (error) {
    logger.error('Generic RPC call failed', { error, method: args.method });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      metadata: {
        executedVia: 'json_rpc_relay',
        command: `rpc ${args.method}`,
      },
    };
  }
}

/**
 * Deploy a smart contract via RPC
 */
export async function rpcDeployContract(args: {
  bytecode: string;
  abi?: any[];
  constructorArgs?: any[];
  gasLimit?: number;
  privateKey?: string;
  fromAlias?: string;
  network?: 'mainnet' | 'testnet' | 'previewnet' | 'local';
}): Promise<ToolResult> {
  try {
    logger.info('Deploying contract via RPC', {
      hasConstructorArgs: !!args.constructorArgs?.length,
      network: args.network,
    });

    // Validate bytecode
    if (!args.bytecode.startsWith('0x')) {
      throw new Error('Bytecode must start with 0x');
    }

    const result = await jsonRpcService.deployContract({
      bytecode: args.bytecode,
      abi: args.abi,
      constructorArgs: args.constructorArgs,
      gasLimit: args.gasLimit,
      privateKey: args.privateKey,
      fromAlias: args.fromAlias,
      network: args.network,
    });

    return {
      success: true,
      data: {
        contractAddress: result.contractAddress,
        transactionHash: result.transactionHash,
        blockNumber: result.receipt.blockNumber,
        gasUsed: result.receipt.gasUsed,
        status: result.receipt.status === '0x1' ? 'success' : 'failed',
      },
      metadata: {
        executedVia: 'json_rpc_relay',
        command: 'contract deploy',
      },
    };
  } catch (error) {
    logger.error('Contract deployment failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      metadata: {
        executedVia: 'json_rpc_relay',
        command: 'contract deploy',
      },
    };
  }
}

/**
 * Call a read-only contract function (FREE - no gas cost)
 */
export async function rpcCallContract(args: {
  contractAddress: string;
  abi: any[];
  functionName: string;
  args?: any[];
  blockNumber?: string;
  network?: 'mainnet' | 'testnet' | 'previewnet' | 'local';
}): Promise<ToolResult> {
  try {
    logger.info('Calling contract function (read-only)', {
      contractAddress: args.contractAddress,
      functionName: args.functionName,
      network: args.network,
    });

    // Validate address
    if (!args.contractAddress.startsWith('0x') || args.contractAddress.length !== 42) {
      throw new Error('Invalid contract address format');
    }

    const result = await jsonRpcService.callContract({
      contractAddress: args.contractAddress,
      abi: args.abi,
      functionName: args.functionName,
      args: args.args,
      blockNumber: args.blockNumber,
      network: args.network,
    });

    return {
      success: true,
      data: {
        functionName: args.functionName,
        result,
      },
      metadata: {
        executedVia: 'json_rpc_relay',
        command: 'contract call (read-only)',
      },
    };
  } catch (error) {
    logger.error('Contract call failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      metadata: {
        executedVia: 'json_rpc_relay',
        command: 'contract call (read-only)',
      },
    };
  }
}

/**
 * Execute a state-changing contract function
 */
export async function rpcExecuteContract(args: {
  contractAddress: string;
  abi: any[];
  functionName: string;
  args?: any[];
  value?: string;
  gasLimit?: number;
  privateKey?: string;
  fromAlias?: string;
  network?: 'mainnet' | 'testnet' | 'previewnet' | 'local';
}): Promise<ToolResult> {
  try {
    logger.info('Executing contract function (state-changing)', {
      contractAddress: args.contractAddress,
      functionName: args.functionName,
      network: args.network,
    });

    // Validate address
    if (!args.contractAddress.startsWith('0x') || args.contractAddress.length !== 42) {
      throw new Error('Invalid contract address format');
    }

    const result = await jsonRpcService.executeContract({
      contractAddress: args.contractAddress,
      abi: args.abi,
      functionName: args.functionName,
      args: args.args,
      value: args.value,
      gasLimit: args.gasLimit,
      privateKey: args.privateKey,
      fromAlias: args.fromAlias,
      network: args.network,
    });

    return {
      success: true,
      data: {
        functionName: args.functionName,
        transactionHash: result.transactionHash,
        blockNumber: result.receipt.blockNumber,
        gasUsed: result.receipt.gasUsed,
        status: result.receipt.status === '0x1' ? 'success' : 'failed',
        logs: result.receipt.logs,
      },
      metadata: {
        executedVia: 'json_rpc_relay',
        command: 'contract execute',
      },
    };
  } catch (error) {
    logger.error('Contract execution failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      metadata: {
        executedVia: 'json_rpc_relay',
        command: 'contract execute',
      },
    };
  }
}

/**
 * Export tool definitions for MCP
 */
export const rpcTools = [
  {
    name: 'rpc_call',
    description:
      'Execute any JSON-RPC method on Hedera. Supports all 55+ methods from OpenRPC spec including eth_*, web3_*, net_*, debug_*. Examples: eth_blockNumber, eth_getBalance, eth_call, eth_sendRawTransaction, eth_getLogs, debug_traceTransaction, etc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        method: {
          type: 'string',
          description:
            'RPC method name (e.g., "eth_blockNumber", "eth_getBalance", "eth_call", "eth_getLogs")',
        },
        params: {
          type: 'array',
          description: 'Method-specific parameters as array',
          items: {},
        },
        network: {
          type: 'string',
          enum: ['mainnet', 'testnet', 'previewnet', 'local'],
          description: 'Target network (default: current network)',
        },
      },
      required: ['method'],
    },
  },
  {
    name: 'rpc_deploy_contract',
    description:
      'Deploy smart contract to Hedera via JSON-RPC. Handles bytecode deployment, constructor arguments encoding, gas estimation, transaction signing, submission, and receipt polling. Returns contract address and transaction details.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bytecode: {
          type: 'string',
          description: 'Contract bytecode in hex format (must start with 0x)',
        },
        abi: {
          type: 'array',
          description: 'Optional: Contract ABI for constructor encoding',
          items: {},
        },
        constructorArgs: {
          type: 'array',
          description: 'Optional: Constructor arguments',
          items: {},
        },
        gasLimit: {
          type: 'number',
          description: 'Optional: Gas limit override (auto-estimated if not provided)',
        },
        privateKey: {
          type: 'string',
          description: 'Optional: Private key in DER format (or use fromAlias)',
        },
        fromAlias: {
          type: 'string',
          description: 'Optional: Address book alias to use for deployment',
        },
        network: {
          type: 'string',
          enum: ['mainnet', 'testnet', 'previewnet', 'local'],
          description: 'Target network (default: current network)',
        },
      },
      required: ['bytecode'],
    },
  },
  {
    name: 'rpc_call_contract',
    description:
      'Call read-only contract function via eth_call. FREE - no gas cost. Perfect for view/pure functions that query contract state without modifying it. Returns decoded function result.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractAddress: {
          type: 'string',
          description: 'Contract address (0x... format)',
        },
        abi: {
          type: 'array',
          description: 'Contract ABI',
          items: {},
        },
        functionName: {
          type: 'string',
          description: 'Function name to call',
        },
        args: {
          type: 'array',
          description: 'Optional: Function arguments',
          items: {},
        },
        blockNumber: {
          type: 'string',
          description: 'Optional: Block number ("latest", "earliest", or hex number)',
        },
        network: {
          type: 'string',
          enum: ['mainnet', 'testnet', 'previewnet', 'local'],
          description: 'Target network (default: current network)',
        },
      },
      required: ['contractAddress', 'abi', 'functionName'],
    },
  },
  {
    name: 'rpc_execute_contract',
    description:
      'Execute state-changing contract function via eth_sendRawTransaction. Handles function encoding, transaction signing, gas estimation, submission, and receipt polling. Requires private key. Returns transaction hash and logs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractAddress: {
          type: 'string',
          description: 'Contract address (0x... format)',
        },
        abi: {
          type: 'array',
          description: 'Contract ABI',
          items: {},
        },
        functionName: {
          type: 'string',
          description: 'Function name to execute',
        },
        args: {
          type: 'array',
          description: 'Optional: Function arguments',
          items: {},
        },
        value: {
          type: 'string',
          description: 'Optional: HBAR value to send in wei (18 decimals)',
        },
        gasLimit: {
          type: 'number',
          description: 'Optional: Gas limit override (auto-estimated if not provided)',
        },
        privateKey: {
          type: 'string',
          description: 'Optional: Private key in DER format (or use fromAlias)',
        },
        fromAlias: {
          type: 'string',
          description: 'Optional: Address book alias to use for execution',
        },
        network: {
          type: 'string',
          enum: ['mainnet', 'testnet', 'previewnet', 'local'],
          description: 'Target network (default: current network)',
        },
      },
      required: ['contractAddress', 'abi', 'functionName'],
    },
  },
];
