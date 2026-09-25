/**
 * JSON-RPC Service
 * Generic service for making JSON-RPC calls to Hedera JSON-RPC Relay
 * Supports all 55+ RPC methods from OpenRPC specification
 */

import axios, { AxiosInstance } from 'axios';
import { Wallet, Interface, TransactionRequest, parseEther, formatEther } from 'ethers';
import { hederaClient } from './hedera-client.js';
import { addressBook } from './addressbook.js';
import logger from '../utils/logger.js';

/**
 * Network to Chain ID mapping
 */
const CHAIN_IDS: Record<string, number> = {
  mainnet: 295,
  testnet: 296,
  previewnet: 297,
  local: 298, // Hedera local node / Solo chain ID
};

/**
 * Transaction receipt structure
 */
interface TransactionReceipt {
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string | null;
  cumulativeGasUsed: string;
  gasUsed: string;
  contractAddress: string | null;
  logs: any[];
  logsBloom: string;
  status: string;
  effectiveGasPrice: string;
}

/**
 * JSON-RPC Service for Hedera
 */
export class JsonRpcService {
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      timeout: 30000, // 30 seconds
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Generic JSON-RPC call - supports ALL methods from OpenRPC spec
   * Returns just the result (for internal use)
   */
  async call(method: string, params: any[] = [], network?: string): Promise<any> {
    const targetNetwork = network || hederaClient.getCurrentNetwork();
    const rpcUrl = this.getRpcUrl(targetNetwork);

    const payload = {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    };

    logger.info('Making JSON-RPC call', { method, network: targetNetwork, rpcUrl });

    try {
      const response = await this.httpClient.post(rpcUrl, payload);

      if (response.data.error) {
        const error = response.data.error;
        throw new Error(`RPC Error ${error.code}: ${error.message}`);
      }

      logger.info('JSON-RPC call successful', { method, result: response.data.result });
      return response.data.result;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.data?.error) {
          const rpcError = error.response.data.error;
          throw new Error(`RPC Error ${rpcError.code}: ${rpcError.message}`);
        }
        throw new Error(`HTTP Error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Generic JSON-RPC call with full details - for MCP tool
   * Returns full RPC response with decoded human-readable values
   */
  async callWithDetails(
    method: string,
    params: any[] = [],
    network?: string
  ): Promise<{
    raw: any;
    result: any;
    decoded?: any;
  }> {
    const targetNetwork = network || hederaClient.getCurrentNetwork();
    const rpcUrl = this.getRpcUrl(targetNetwork);

    const payload = {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    };

    logger.info('Making JSON-RPC call', { method, network: targetNetwork, rpcUrl });

    try {
      const response = await this.httpClient.post(rpcUrl, payload);

      if (response.data.error) {
        const error = response.data.error;
        throw new Error(`RPC Error ${error.code}: ${error.message}`);
      }

      logger.info('JSON-RPC call successful', { method, result: response.data.result });

      // Decode hex values to human-readable format
      const decoded = this.decodeRpcResult(method, response.data.result, targetNetwork);

      return {
        raw: response.data, // Full RPC response
        result: response.data.result, // Just the result field
        decoded, // Human-readable decoded values
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.data?.error) {
          const rpcError = error.response.data.error;
          throw new Error(`RPC Error ${rpcError.code}: ${rpcError.message}`);
        }
        throw new Error(`HTTP Error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Decode RPC result to human-readable format
   */
  private decodeRpcResult(method: string, result: any, network: string): any {
    if (result === null || result === undefined) {
      return null;
    }

    const decoded: any = {};

    // Decode based on method type
    switch (method) {
      case 'eth_chainId':
        decoded.chainId = parseInt(result, 16);
        decoded.network = network;
        decoded.description = `Chain ID ${decoded.chainId} (${network})`;
        break;

      case 'eth_blockNumber':
        decoded.blockNumber = parseInt(result, 16);
        decoded.hex = result;
        decoded.description = `Block #${decoded.blockNumber}`;
        break;

      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas':
        decoded.wei = result;
        decoded.gwei = (parseInt(result, 16) / 1e9).toFixed(2);
        decoded.hbar = JsonRpcService.weiToHbar(result);
        decoded.description = `${decoded.gwei} Gwei (${decoded.hbar} HBAR)`;
        break;

      case 'eth_getBalance':
        decoded.wei = result;
        decoded.hbar = JsonRpcService.weiToHbar(result);
        decoded.description = `${decoded.hbar} HBAR`;
        break;

      case 'eth_getTransactionCount':
      case 'eth_getBlockTransactionCountByNumber':
      case 'eth_getBlockTransactionCountByHash':
        decoded.count = parseInt(result, 16);
        decoded.hex = result;
        decoded.description = `${decoded.count} transactions`;
        break;

      case 'eth_getBlockByNumber':
      case 'eth_getBlockByHash':
        if (typeof result === 'object' && result !== null) {
          decoded.blockNumber = result.number ? parseInt(result.number, 16) : null;
          decoded.timestamp = result.timestamp
            ? new Date(parseInt(result.timestamp, 16) * 1000).toISOString()
            : null;
          decoded.gasUsed = result.gasUsed ? parseInt(result.gasUsed, 16) : 0;
          decoded.gasLimit = result.gasLimit ? parseInt(result.gasLimit, 16) : 0;
          decoded.transactionCount = result.transactions ? result.transactions.length : 0;
          decoded.baseFeePerGas = result.baseFeePerGas
            ? {
                wei: result.baseFeePerGas,
                gwei: (parseInt(result.baseFeePerGas, 16) / 1e9).toFixed(2),
              }
            : null;
          decoded.description = `Block #${decoded.blockNumber} at ${decoded.timestamp} with ${decoded.transactionCount} transactions`;
        }
        break;

      case 'eth_getTransactionReceipt':
        if (typeof result === 'object' && result !== null) {
          decoded.blockNumber = result.blockNumber ? parseInt(result.blockNumber, 16) : null;
          decoded.gasUsed = result.gasUsed ? parseInt(result.gasUsed, 16) : 0;
          decoded.status = result.status === '0x1' ? 'success' : 'failed';
          decoded.transactionIndex = result.transactionIndex
            ? parseInt(result.transactionIndex, 16)
            : null;
          decoded.description = `Transaction ${decoded.status} in block #${decoded.blockNumber}, used ${decoded.gasUsed} gas`;
        }
        break;

      case 'net_version':
        decoded.networkId = result;
        decoded.description = `Network ID ${result}`;
        break;

      case 'web3_clientVersion':
        decoded.version = result;
        decoded.description = `Client: ${result}`;
        break;

      case 'eth_syncing':
        if (result === false) {
          decoded.syncing = false;
          decoded.description = 'Node is fully synced';
        } else if (typeof result === 'object') {
          decoded.syncing = true;
          decoded.currentBlock = parseInt(result.currentBlock, 16);
          decoded.highestBlock = parseInt(result.highestBlock, 16);
          decoded.description = `Syncing: ${decoded.currentBlock}/${decoded.highestBlock}`;
        }
        break;

      case 'eth_estimateGas':
        decoded.gas = parseInt(result, 16);
        decoded.hex = result;
        decoded.description = `Estimated gas: ${decoded.gas}`;
        break;

      case 'eth_mining':
      case 'net_listening':
        decoded.value = result;
        decoded.description = result ? 'Yes' : 'No';
        break;

      default:
        // For arrays, decode each element
        if (Array.isArray(result)) {
          decoded.count = result.length;
          decoded.description = `Array with ${result.length} items`;
        }
        // For hex strings, try to decode as number
        else if (typeof result === 'string' && result.startsWith('0x')) {
          try {
            const num = parseInt(result, 16);
            if (!isNaN(num)) {
              decoded.decimal = num;
              decoded.hex = result;
            }
          } catch (e) {
            // Not a number, leave as is
          }
        }
    }

    return Object.keys(decoded).length > 0 ? decoded : null;
  }

  /**
   * Deploy a smart contract
   */
  async deployContract(options: {
    bytecode: string;
    abi?: any[];
    constructorArgs?: any[];
    gasLimit?: number;
    privateKey?: string;
    fromAlias?: string;
    network?: string;
  }): Promise<{
    contractAddress: string;
    transactionHash: string;
    receipt: TransactionReceipt;
  }> {
    const targetNetwork = options.network || hederaClient.getCurrentNetwork();
    const chainId = CHAIN_IDS[targetNetwork];

    // Get private key with fallback to MCP operator
    let privateKey = options.privateKey;
    if (!privateKey && options.fromAlias) {
      const account = addressBook.get(options.fromAlias);
      if (!account || !account.privateKey) {
        throw new Error(
          `Account with alias "${options.fromAlias}" not found or has no private key`
        );
      }
      privateKey = account.privateKey;
    }

    // Fallback to MCP operator key if no key provided
    if (!privateKey) {
      try {
        const { getOperatorKeyHex } = await import('../utils/key-converter.js');
        const operatorKey = getOperatorKeyHex();
        if (operatorKey) {
          privateKey = operatorKey;
          logger.info('Using MCP operator account for deployment');
        }
      } catch {
        // Key converter not available, continue with error
      }
    }

    if (!privateKey) {
      throw new Error(
        'Private key required for contract deployment. Configure HEDERA_OPERATOR_KEY or provide privateKey parameter.'
      );
    }

    // Create wallet
    const wallet = new Wallet(privateKey);
    const fromAddress = wallet.address;

    logger.info('Deploying contract', { fromAddress, network: targetNetwork, chainId });

    // Encode constructor if needed
    let data = options.bytecode;
    if (options.constructorArgs && options.constructorArgs.length > 0 && options.abi) {
      const iface = new Interface(options.abi);
      const constructorFragment = iface.deploy;
      if (constructorFragment) {
        const encodedArgs = iface.encodeDeploy(options.constructorArgs);
        data = options.bytecode + encodedArgs.slice(2); // Remove 0x from encoded args
      }
    }

    // Get nonce
    const nonce = await this.call(
      'eth_getTransactionCount',
      [fromAddress, 'latest'],
      targetNetwork
    );

    // Estimate gas
    let gasLimit = options.gasLimit;
    if (!gasLimit) {
      try {
        const estimatedGas = await this.call(
          'eth_estimateGas',
          [
            {
              from: fromAddress,
              data,
            },
          ],
          targetNetwork
        );
        gasLimit = Math.floor(parseInt(estimatedGas, 16) * 1.2); // Add 20% buffer
      } catch (error) {
        logger.warn('Gas estimation failed, using default', { error });
        gasLimit = 1000000; // Default fallback
      }
    }

    // Get gas price
    const gasPrice = await this.call('eth_gasPrice', [], targetNetwork);

    // Create transaction
    const tx: TransactionRequest = {
      nonce: parseInt(nonce, 16),
      gasLimit,
      gasPrice,
      data,
      chainId,
      type: 0, // Legacy transaction
    };

    // Sign transaction
    const signedTx = await wallet.signTransaction(tx);

    // Submit transaction
    const txHash = await this.call('eth_sendRawTransaction', [signedTx], targetNetwork);

    logger.info('Contract deployment transaction submitted', { txHash });

    // Poll for receipt
    const receipt = await this.pollTransactionReceipt(txHash, targetNetwork);

    if (receipt.status !== '0x1') {
      throw new Error('Contract deployment failed');
    }

    if (!receipt.contractAddress) {
      throw new Error('Contract address not found in receipt');
    }

    logger.info('Contract deployed successfully', {
      contractAddress: receipt.contractAddress,
      txHash,
    });

    return {
      contractAddress: receipt.contractAddress,
      transactionHash: txHash,
      receipt,
    };
  }

  /**
   * Call a read-only contract function (via eth_call)
   */
  async callContract(options: {
    contractAddress: string;
    abi: any[];
    functionName: string;
    args?: any[];
    blockNumber?: string;
    network?: string;
  }): Promise<any> {
    const targetNetwork = options.network || hederaClient.getCurrentNetwork();

    // Create interface and encode function call
    const iface = new Interface(options.abi);
    const data = iface.encodeFunctionData(options.functionName, options.args || []);

    logger.info('Calling contract function (read-only)', {
      contractAddress: options.contractAddress,
      functionName: options.functionName,
      network: targetNetwork,
    });

    // Make eth_call
    const result = await this.call(
      'eth_call',
      [
        {
          to: options.contractAddress,
          data,
        },
        options.blockNumber || 'latest',
      ],
      targetNetwork
    );

    // Decode result
    const decoded = iface.decodeFunctionResult(options.functionName, result);

    logger.info('Contract function called successfully', {
      functionName: options.functionName,
      result: decoded,
    });

    // Return single value or array
    return decoded.length === 1 ? decoded[0] : decoded;
  }

  /**
   * Execute a state-changing contract function
   */
  async executeContract(options: {
    contractAddress: string;
    abi: any[];
    functionName: string;
    args?: any[];
    value?: string; // Value in wei
    gasLimit?: number;
    privateKey?: string;
    fromAlias?: string;
    network?: string;
  }): Promise<{
    transactionHash: string;
    receipt: TransactionReceipt;
  }> {
    const targetNetwork = options.network || hederaClient.getCurrentNetwork();
    const chainId = CHAIN_IDS[targetNetwork];

    // Get private key with fallback to MCP operator
    let privateKey = options.privateKey;
    if (!privateKey && options.fromAlias) {
      const account = addressBook.get(options.fromAlias);
      if (!account || !account.privateKey) {
        throw new Error(
          `Account with alias "${options.fromAlias}" not found or has no private key`
        );
      }
      privateKey = account.privateKey;
    }

    // Fallback to MCP operator key if no key provided
    if (!privateKey) {
      try {
        const { getOperatorKeyHex } = await import('../utils/key-converter.js');
        const operatorKey = getOperatorKeyHex();
        if (operatorKey) {
          privateKey = operatorKey;
          logger.info('Using MCP operator account for contract execution');
        }
      } catch {
        // Key converter not available, continue with error
      }
    }

    if (!privateKey) {
      throw new Error(
        'Private key required for contract execution. Configure HEDERA_OPERATOR_KEY or provide privateKey parameter.'
      );
    }

    // Create wallet and interface
    const wallet = new Wallet(privateKey);
    const fromAddress = wallet.address;
    const iface = new Interface(options.abi);

    // Encode function call
    const data = iface.encodeFunctionData(options.functionName, options.args || []);

    logger.info('Executing contract function', {
      contractAddress: options.contractAddress,
      functionName: options.functionName,
      fromAddress,
      network: targetNetwork,
    });

    // Get nonce
    const nonce = await this.call(
      'eth_getTransactionCount',
      [fromAddress, 'latest'],
      targetNetwork
    );

    // Estimate gas
    let gasLimit = options.gasLimit;
    if (!gasLimit) {
      try {
        const estimatedGas = await this.call(
          'eth_estimateGas',
          [
            {
              from: fromAddress,
              to: options.contractAddress,
              data,
              value: options.value || '0x0',
            },
          ],
          targetNetwork
        );
        gasLimit = Math.floor(parseInt(estimatedGas, 16) * 1.2); // Add 20% buffer
      } catch (error) {
        logger.warn('Gas estimation failed, using default', { error });
        gasLimit = 500000; // Default fallback
      }
    }

    // Get gas price
    const gasPrice = await this.call('eth_gasPrice', [], targetNetwork);

    // Create transaction
    const tx: TransactionRequest = {
      to: options.contractAddress,
      data,
      value: options.value || '0x0',
      nonce: parseInt(nonce, 16),
      gasLimit,
      gasPrice,
      chainId,
      type: 0, // Legacy transaction
    };

    // Sign transaction
    const signedTx = await wallet.signTransaction(tx);

    // Submit transaction
    const txHash = await this.call('eth_sendRawTransaction', [signedTx], targetNetwork);

    logger.info('Contract execution transaction submitted', { txHash });

    // Poll for receipt
    const receipt = await this.pollTransactionReceipt(txHash, targetNetwork);

    if (receipt.status !== '0x1') {
      throw new Error('Contract execution failed');
    }

    logger.info('Contract function executed successfully', {
      functionName: options.functionName,
      txHash,
    });

    return {
      transactionHash: txHash,
      receipt,
    };
  }

  /**
   * Poll for transaction receipt with timeout
   */
  private async pollTransactionReceipt(
    txHash: string,
    network: string,
    timeout = 60000
  ): Promise<TransactionReceipt> {
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds

    while (Date.now() - startTime < timeout) {
      try {
        const receipt = await this.call('eth_getTransactionReceipt', [txHash], network);

        if (receipt) {
          return receipt;
        }
      } catch (error) {
        logger.debug('Receipt not yet available', { txHash });
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Transaction receipt not found after ${timeout}ms timeout`);
  }

  /**
   * Get RPC URL for network
   */
  private getRpcUrl(network: string): string {
    // Use the existing hedera-client method
    const currentNetwork = hederaClient.getCurrentNetwork();

    // Temporarily switch if needed
    if (network !== currentNetwork) {
      // Just get the URL without switching
      switch (network) {
        case 'mainnet':
          return 'https://mainnet.hashio.io/api';
        case 'testnet':
          return 'https://testnet.hashio.io/api';
        case 'previewnet':
          return 'https://previewnet.hashio.io/api';
        case 'local':
          return 'http://localhost:7546';
        default:
          throw new Error(`Unknown network: ${network}`);
      }
    }

    return hederaClient.getJsonRpcRelayUrl();
  }

  /**
   * Convert HBAR to wei (18 decimals)
   */
  static hbarToWei(hbar: number | string): string {
    return parseEther(hbar.toString()).toString();
  }

  /**
   * Convert wei to HBAR (18 decimals)
   */
  static weiToHbar(wei: string): string {
    return formatEther(wei);
  }
}

// Export singleton instance
export const jsonRpcService = new JsonRpcService();
