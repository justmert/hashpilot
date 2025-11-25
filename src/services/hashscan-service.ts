/**
 * HashScan Contract Verification Service
 *
 * Provides integration with HashScan's Sourcify-based verification API
 * for verifying smart contracts on Hedera networks.
 *
 * Base URL: https://server-verify.hashscan.io
 * API Docs: https://server-verify.hashscan.io/api-docs/
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Hedera network chain IDs for HashScan
 */
export const HEDERA_CHAIN_IDS = {
  mainnet: '295',
  testnet: '296',
  previewnet: '297',
} as const;

export type HederaNetwork = keyof typeof HEDERA_CHAIN_IDS;

/**
 * Verification match types
 */
export type MatchType = 'perfect' | 'partial';

/**
 * Verification status result
 */
export interface VerificationStatus {
  address: string;
  chainId: string;
  status: MatchType | 'not_verified';
  libraryMap?: Record<string, string>;
}

/**
 * Verification result
 */
export interface VerificationResult {
  success: boolean;
  address: string;
  chainId: string;
  status: MatchType | 'failed';
  message?: string;
  libraryMap?: Record<string, string>;
}

/**
 * Contract file information
 */
export interface ContractFile {
  name: string;
  path: string;
  content: string;
}

/**
 * Batch verification status
 */
export interface BatchVerificationStatus {
  address: string;
  chainIds: Array<{
    chainId: string;
    status: MatchType | 'not_verified';
  }>;
}

/**
 * HashScan Service for contract verification
 */
export class HashScanService {
  private client: AxiosInstance;
  private baseUrl: string = 'https://server-verify.hashscan.io';

  constructor() {
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 60000, // 60 second timeout for verification requests
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('HashScan API error', {
          url: error.config?.url,
          status: error.response?.status,
          data: error.response?.data,
        });
        return Promise.reject(error);
      },
    );
  }

  /**
   * Get chain ID for Hedera network
   */
  private getChainId(network: HederaNetwork): string {
    return HEDERA_CHAIN_IDS[network];
  }

  /**
   * Verify contract with direct file upload
   *
   * @param address - Contract address (0x... format)
   * @param network - Hedera network (mainnet, testnet, previewnet)
   * @param files - Source files and metadata { 'Contract.sol': '...', 'metadata.json': '...' }
   * @param creatorTxHash - Optional transaction hash that created the contract
   * @param chosenContract - Optional contract name if multiple contracts in files
   */
  async verifyContract(
    address: string,
    network: HederaNetwork,
    files: Record<string, string>,
    creatorTxHash?: string,
    chosenContract?: string,
  ): Promise<VerificationResult> {
    try {
      const chainId = this.getChainId(network);

      logger.info('Verifying contract on HashScan', {
        address,
        network,
        chainId,
        fileCount: Object.keys(files).length,
      });

      const response = await this.client.post('/verify', {
        address,
        chain: chainId,
        files,
        creatorTxHash,
        chosenContract,
      });

      const result = response.data.result?.[0];
      if (!result) {
        throw new Error('No verification result returned');
      }

      logger.info('Contract verification successful', {
        address,
        status: result.status,
        chainId: result.chainId,
      });

      return {
        success: true,
        address: result.address,
        chainId: result.chainId,
        status: result.status,
        libraryMap: result.libraryMap,
      };
    } catch (error: any) {
      logger.error('Contract verification failed', {
        error: error.message,
        response: error.response?.data,
      });

      return {
        success: false,
        address,
        chainId: this.getChainId(network),
        status: 'failed',
        message: error.response?.data?.error || error.message,
      };
    }
  }

  /**
   * Verify contract using solc-json compilation artifacts
   *
   * @param address - Contract address (0x... format)
   * @param network - Hedera network
   * @param solcJsonInput - Solidity compiler JSON input
   * @param compilerVersion - Compiler version (e.g., "0.8.20+commit.a1b79de6")
   * @param contractName - Contract name (e.g., "Greeter")
   * @param creatorTxHash - Optional transaction hash
   */
  async verifyWithSolcJson(
    address: string,
    network: HederaNetwork,
    solcJsonInput: string,
    compilerVersion: string,
    contractName: string,
    creatorTxHash?: string,
  ): Promise<VerificationResult> {
    try {
      const chainId = this.getChainId(network);

      logger.info('Verifying contract with solc-json', {
        address,
        network,
        chainId,
        compilerVersion,
        contractName,
      });

      const response = await this.client.post('/verify/solc-json', {
        address,
        chain: chainId,
        files: {
          'solc-json-input.json': solcJsonInput,
        },
        compilerVersion,
        contractName,
        creatorTxHash,
      });

      const result = response.data.result?.[0];
      if (!result) {
        throw new Error('No verification result returned');
      }

      logger.info('Contract verification with solc-json successful', {
        address,
        status: result.status,
      });

      return {
        success: true,
        address: result.address,
        chainId: result.chainId,
        status: result.status,
        libraryMap: result.libraryMap,
      };
    } catch (error: any) {
      logger.error('Contract verification with solc-json failed', {
        error: error.message,
        response: error.response?.data,
      });

      return {
        success: false,
        address,
        chainId: this.getChainId(network),
        status: 'failed',
        message: error.response?.data?.error || error.message,
      };
    }
  }

  /**
   * Check verification status for a single contract
   *
   * @param address - Contract address (0x... format)
   * @param network - Hedera network
   * @returns Verification status (perfect, partial, or not_verified)
   */
  async checkVerificationStatus(address: string, network: HederaNetwork): Promise<VerificationStatus> {
    try {
      const chainId = this.getChainId(network);

      logger.debug('Checking verification status', { address, network, chainId });

      const response = await this.client.get('/check-all-by-addresses', {
        params: {
          addresses: address,
          chainIds: chainId,
        },
      });

      const result = response.data?.[0];
      if (!result || !result.chainIds || result.chainIds.length === 0) {
        return {
          address,
          chainId,
          status: 'not_verified',
        };
      }

      const chainResult = result.chainIds.find((c: any) => c.chainId === chainId);
      if (!chainResult) {
        return {
          address,
          chainId,
          status: 'not_verified',
        };
      }

      return {
        address,
        chainId,
        status: chainResult.status,
        libraryMap: chainResult.libraryMap,
      };
    } catch (error: any) {
      logger.error('Failed to check verification status', { error: error.message });
      return {
        address,
        chainId: this.getChainId(network),
        status: 'not_verified',
      };
    }
  }

  /**
   * Check verification status for multiple contracts
   *
   * @param addresses - Array of contract addresses
   * @param network - Hedera network
   * @returns Array of verification status results
   */
  async checkBatchVerificationStatus(
    addresses: string[],
    network: HederaNetwork,
  ): Promise<BatchVerificationStatus[]> {
    try {
      const chainId = this.getChainId(network);

      logger.debug('Checking batch verification status', {
        count: addresses.length,
        network,
        chainId,
      });

      const response = await this.client.get('/check-all-by-addresses', {
        params: {
          addresses: addresses.join(','),
          chainIds: chainId,
        },
      });

      return response.data.map((result: any) => ({
        address: result.address,
        chainIds: result.chainIds.map((c: any) => ({
          chainId: c.chainId,
          status: c.status,
        })),
      }));
    } catch (error: any) {
      logger.error('Failed to check batch verification status', { error: error.message });
      return addresses.map((address) => ({
        address,
        chainIds: [
          {
            chainId: this.getChainId(network),
            status: 'not_verified' as const,
          },
        ],
      }));
    }
  }

  /**
   * Get verified contract files
   *
   * @param address - Contract address (0x... format)
   * @param network - Hedera network
   * @param matchType - Match type (perfect or partial), defaults to perfect
   * @returns Array of contract files
   */
  async getContractFiles(
    address: string,
    network: HederaNetwork,
    matchType: 'perfect' | 'any' = 'perfect',
  ): Promise<ContractFile[]> {
    try {
      const chainId = this.getChainId(network);
      const endpoint = matchType === 'any' ? `/files/any/${chainId}/${address}` : `/files/${chainId}/${address}`;

      logger.debug('Fetching verified contract files', {
        address,
        network,
        chainId,
        matchType,
      });

      const response = await this.client.get(endpoint);
      return response.data;
    } catch (error: any) {
      logger.error('Failed to get contract files', { error: error.message });
      throw new Error(`Failed to retrieve contract files: ${error.message}`);
    }
  }

  /**
   * Get contract file tree structure
   *
   * @param address - Contract address (0x... format)
   * @param network - Hedera network
   * @param matchType - Match type (perfect or partial)
   * @returns File tree structure
   */
  async getContractFileTree(
    address: string,
    network: HederaNetwork,
    matchType: 'perfect' | 'any' = 'perfect',
  ): Promise<any> {
    try {
      const chainId = this.getChainId(network);
      const endpoint =
        matchType === 'any' ? `/files/tree/any/${chainId}/${address}` : `/files/tree/${chainId}/${address}`;

      logger.debug('Fetching contract file tree', {
        address,
        network,
        chainId,
        matchType,
      });

      const response = await this.client.get(endpoint);
      return response.data;
    } catch (error: any) {
      logger.error('Failed to get contract file tree', { error: error.message });
      throw new Error(`Failed to retrieve contract file tree: ${error.message}`);
    }
  }

  /**
   * Get HashScan contract page URL
   *
   * @param address - Contract address (0x... format)
   * @param network - Hedera network
   * @returns HashScan URL for the contract
   */
  getContractUrl(address: string, network: HederaNetwork): string {
    const networkPath = network === 'mainnet' ? 'mainnet' : network;
    return `https://hashscan.io/${networkPath}/contract/${address}`;
  }

  /**
   * Read Hardhat build-info file for verification
   *
   * @param buildInfoPath - Path to build-info JSON file
   * @returns Solc JSON input string
   */
  async readHardhatBuildInfo(buildInfoPath: string): Promise<{ input: string; compilerVersion: string }> {
    try {
      const content = await fs.readFile(buildInfoPath, 'utf-8');
      const buildInfo = JSON.parse(content);

      return {
        input: JSON.stringify(buildInfo.input),
        compilerVersion: buildInfo.solcLongVersion,
      };
    } catch (error: any) {
      logger.error('Failed to read Hardhat build-info', { error: error.message });
      throw new Error(`Failed to read build-info file: ${error.message}`);
    }
  }

  /**
   * Read Foundry artifact file for verification
   *
   * @param artifactPath - Path to Foundry artifact JSON file (out/{ContractName}.sol/{ContractName}.json)
   * @returns Compiler version and metadata
   */
  async readFoundryArtifact(artifactPath: string): Promise<{
    compilerVersion: string;
    metadata: string;
    contractName: string;
  }> {
    try {
      const content = await fs.readFile(artifactPath, 'utf-8');
      const artifact = JSON.parse(content);

      // Extract contract name from path: out/Greeter.sol/Greeter.json -> Greeter
      const contractName = path.basename(artifactPath, '.json');

      return {
        compilerVersion: artifact.metadata?.compiler?.version || 'unknown',
        metadata: JSON.stringify(artifact.metadata),
        contractName,
      };
    } catch (error: any) {
      logger.error('Failed to read Foundry artifact', { error: error.message });
      throw new Error(`Failed to read artifact file: ${error.message}`);
    }
  }

  /**
   * List all verified contracts on a specific chain
   *
   * @param network - Hedera network
   * @returns Array of verified contract addresses
   */
  async listVerifiedContracts(network: HederaNetwork): Promise<string[]> {
    try {
      const chainId = this.getChainId(network);

      logger.debug('Listing verified contracts', { network, chainId });

      const response = await this.client.get(`/files/contracts/${chainId}`);
      return response.data;
    } catch (error: any) {
      logger.error('Failed to list verified contracts', { error: error.message });
      throw new Error(`Failed to list verified contracts: ${error.message}`);
    }
  }
}

// Export singleton instance
export const hashScanService = new HashScanService();
