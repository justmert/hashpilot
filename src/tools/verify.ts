/**
 * Contract Verification MCP Tools
 *
 * Tools for verifying smart contracts on HashScan (Hedera's block explorer)
 * using the Sourcify-based verification API.
 */

import { logger } from '../utils/logger.js';
import { hashScanService, HederaNetwork } from '../services/hashscan-service.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Tool result interface
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Verify a single contract on HashScan
 */
export async function verifyContract(args: {
  address: string;
  network: HederaNetwork;
  contractName: string;
  filePath: string;
  creatorTxHash?: string;
  buildInfoPath?: string;
  artifactPath?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Verifying contract on HashScan', {
      address: args.address,
      network: args.network,
      contractName: args.contractName,
    });

    let result;

    // If buildInfoPath or artifactPath provided, use solc-json verification
    if (args.buildInfoPath) {
      // Hardhat build-info verification
      const buildInfo = await hashScanService.readHardhatBuildInfo(args.buildInfoPath);
      result = await hashScanService.verifyWithSolcJson(
        args.address,
        args.network,
        buildInfo.input,
        buildInfo.compilerVersion,
        args.contractName,
        args.creatorTxHash,
      );
    } else if (args.artifactPath) {
      // Foundry artifact verification
      const artifact = await hashScanService.readFoundryArtifact(args.artifactPath);

      // Read source file
      const sourceCode = await fs.readFile(args.filePath, 'utf-8');

      result = await hashScanService.verifyContract(
        args.address,
        args.network,
        {
          [`${args.contractName}.sol`]: sourceCode,
          'metadata.json': artifact.metadata,
        },
        args.creatorTxHash,
        args.contractName,
      );
    } else {
      // Direct file verification - read source files from directory or single file
      const stats = await fs.stat(args.filePath);
      const files: Record<string, string> = {};

      if (stats.isDirectory()) {
        // Read all .sol files from directory
        const entries = await fs.readdir(args.filePath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.sol')) {
            const fullPath = path.join(args.filePath, entry.name);
            const content = await fs.readFile(fullPath, 'utf-8');
            files[entry.name] = content;
          }
        }
      } else {
        // Single file
        const content = await fs.readFile(args.filePath, 'utf-8');
        files[path.basename(args.filePath)] = content;
      }

      result = await hashScanService.verifyContract(
        args.address,
        args.network,
        files,
        args.creatorTxHash,
        args.contractName,
      );
    }

    if (result.success) {
      const hashScanUrl = hashScanService.getContractUrl(args.address, args.network);

      return {
        success: true,
        data: {
          address: result.address,
          chainId: result.chainId,
          status: result.status,
          libraryMap: result.libraryMap,
          hashScanUrl,
          message:
            result.status === 'perfect'
              ? 'Contract verified successfully with perfect match'
              : 'Contract verified with partial match',
        },
        metadata: {
          executedVia: 'hashscan',
          command: 'verify_contract',
        },
      };
    } else {
      return {
        success: false,
        error: result.message || 'Verification failed',
        metadata: {
          executedVia: 'hashscan',
          command: 'verify_contract',
        },
      };
    }
  } catch (error: any) {
    logger.error('Contract verification failed', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: {
        executedVia: 'hashscan',
        command: 'verify_contract',
      },
    };
  }
}

/**
 * Batch verify multiple contracts
 */
export async function verifyBatch(args: {
  contracts: Array<{
    address: string;
    network: HederaNetwork;
    contractName: string;
    filePath: string;
    creatorTxHash?: string;
    buildInfoPath?: string;
    artifactPath?: string;
  }>;
  parallel?: boolean;
  stopOnFailure?: boolean;
}): Promise<ToolResult> {
  try {
    const parallel = args.parallel !== false; // Default true
    const stopOnFailure = args.stopOnFailure === true; // Default false

    logger.info('Starting batch verification', {
      count: args.contracts.length,
      parallel,
      stopOnFailure,
    });

    const results: any[] = [];
    let successCount = 0;
    let failureCount = 0;

    if (parallel) {
      // Verify all contracts in parallel
      const promises = args.contracts.map((contract) => verifyContract(contract));
      const allResults = await Promise.all(promises);

      for (const result of allResults) {
        results.push(result);
        if (result.success) successCount++;
        else failureCount++;
      }
    } else {
      // Verify contracts sequentially
      for (const contract of args.contracts) {
        const result = await verifyContract(contract);
        results.push(result);

        if (result.success) {
          successCount++;
        } else {
          failureCount++;
          if (stopOnFailure) {
            logger.warn('Stopping batch verification due to failure', {
              failedContract: contract.address,
            });
            break;
          }
        }
      }
    }

    return {
      success: failureCount === 0,
      data: {
        results,
        summary: {
          total: args.contracts.length,
          successful: successCount,
          failed: failureCount,
          successRate: `${((successCount / args.contracts.length) * 100).toFixed(1)}%`,
        },
      },
      metadata: {
        executedVia: 'hashscan',
        command: 'verify_batch',
      },
    };
  } catch (error: any) {
    logger.error('Batch verification failed', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: {
        executedVia: 'hashscan',
        command: 'verify_batch',
      },
    };
  }
}

/**
 * Check verification status for contract(s)
 */
export async function verificationStatus(args: {
  address?: string;
  addresses?: string[];
  network: HederaNetwork;
  includeLibraries?: boolean;
}): Promise<ToolResult> {
  try {
    const includeLibraries = args.includeLibraries !== false; // Default true

    if (args.addresses) {
      // Batch status check
      logger.info('Checking batch verification status', {
        count: args.addresses.length,
        network: args.network,
      });

      const results = await hashScanService.checkBatchVerificationStatus(args.addresses, args.network);

      return {
        success: true,
        data: {
          results: results.map((r) => ({
            address: r.address,
            statuses: r.chainIds.map((c) => ({
              chainId: c.chainId,
              status: c.status,
              hashScanUrl: hashScanService.getContractUrl(r.address, args.network),
            })),
          })),
        },
        metadata: {
          executedVia: 'hashscan',
          command: 'verification_status',
        },
      };
    } else if (args.address) {
      // Single status check
      logger.info('Checking verification status', {
        address: args.address,
        network: args.network,
      });

      const result = await hashScanService.checkVerificationStatus(args.address, args.network);
      const hashScanUrl = hashScanService.getContractUrl(args.address, args.network);

      return {
        success: true,
        data: {
          address: result.address,
          chainId: result.chainId,
          status: result.status,
          ...(includeLibraries && result.libraryMap ? { libraryMap: result.libraryMap } : {}),
          hashScanUrl,
          isVerified: result.status === 'perfect' || result.status === 'partial',
        },
        metadata: {
          executedVia: 'hashscan',
          command: 'verification_status',
        },
      };
    } else {
      return {
        success: false,
        error: 'Either address or addresses must be provided',
        metadata: {
          executedVia: 'hashscan',
          command: 'verification_status',
        },
      };
    }
  } catch (error: any) {
    logger.error('Failed to check verification status', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: {
        executedVia: 'hashscan',
        command: 'verification_status',
      },
    };
  }
}

/**
 * Get verified contract source code
 */
export async function getVerifiedSource(args: {
  address: string;
  network: HederaNetwork;
  matchType?: 'perfect' | 'any';
  includeFileTree?: boolean;
  exportFormat?: 'raw' | 'json';
}): Promise<ToolResult> {
  try {
    const matchType = args.matchType || 'perfect';
    const includeFileTree = args.includeFileTree === true;
    const exportFormat = args.exportFormat || 'raw';

    logger.info('Fetching verified contract source', {
      address: args.address,
      network: args.network,
      matchType,
    });

    // Get contract files
    const files = await hashScanService.getContractFiles(args.address, args.network, matchType);

    if (files.length === 0) {
      return {
        success: false,
        error: 'No verified source code found for this contract',
        metadata: {
          executedVia: 'hashscan',
          command: 'get_verified_source',
        },
      };
    }

    const data: any = {
      address: args.address,
      network: args.network,
      matchType,
      fileCount: files.length,
    };

    if (exportFormat === 'json') {
      // Return structured JSON format
      data.files = files;
    } else {
      // Return concatenated source code
      const sourceFiles = files.filter((f) => f.name.endsWith('.sol'));
      data.sourceCode = sourceFiles.map((f) => `// File: ${f.name}\n${f.content}`).join('\n\n');
      data.metadata = files.find((f) => f.name === 'metadata.json')?.content;
    }

    // Optionally include file tree
    if (includeFileTree) {
      const fileTree = await hashScanService.getContractFileTree(args.address, args.network, matchType);
      data.fileTree = fileTree;
    }

    return {
      success: true,
      data,
      metadata: {
        executedVia: 'hashscan',
        command: 'get_verified_source',
      },
    };
  } catch (error: any) {
    logger.error('Failed to get verified source', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: {
        executedVia: 'hashscan',
        command: 'get_verified_source',
      },
    };
  }
}

/**
 * Tool definitions for MCP
 */
export const verifyTools = [
  {
    name: 'verify_contract',
    description:
      'Verify a smart contract on HashScan (Hedera block explorer). Supports direct file upload, Hardhat build-info, and Foundry artifacts. Returns verification status and HashScan URL.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Contract address in 0x... format',
          pattern: '^0x[a-fA-F0-9]{40}$',
        },
        network: {
          type: 'string',
          description: 'Hedera network',
          enum: ['mainnet', 'testnet', 'previewnet'],
        },
        contractName: {
          type: 'string',
          description: 'Contract name (e.g., "Greeter")',
        },
        filePath: {
          type: 'string',
          description: 'Path to source file or directory containing .sol files',
        },
        creatorTxHash: {
          type: 'string',
          description: 'Optional: Transaction hash that created the contract',
        },
        buildInfoPath: {
          type: 'string',
          description: 'Optional: Path to Hardhat build-info JSON file for easier verification',
        },
        artifactPath: {
          type: 'string',
          description: 'Optional: Path to Foundry artifact JSON file (out/Contract.sol/Contract.json)',
        },
      },
      required: ['address', 'network', 'contractName', 'filePath'],
    },
  },
  {
    name: 'verify_batch',
    description:
      'Batch verify multiple contracts on HashScan. Supports parallel or sequential verification with configurable failure handling.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contracts: {
          type: 'array',
          description: 'Array of contracts to verify',
          items: {
            type: 'object',
            properties: {
              address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
              network: { type: 'string', enum: ['mainnet', 'testnet', 'previewnet'] },
              contractName: { type: 'string' },
              filePath: { type: 'string' },
              creatorTxHash: { type: 'string' },
              buildInfoPath: { type: 'string' },
              artifactPath: { type: 'string' },
            },
            required: ['address', 'network', 'contractName', 'filePath'],
          },
        },
        parallel: {
          type: 'boolean',
          description: 'Verify in parallel (default: true)',
          default: true,
        },
        stopOnFailure: {
          type: 'boolean',
          description: 'Stop verification on first failure in sequential mode (default: false)',
          default: false,
        },
      },
      required: ['contracts'],
    },
  },
  {
    name: 'verification_status',
    description:
      'Check verification status for one or more contracts on HashScan without re-verifying. Returns verification status and library mappings.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Single contract address to check',
          pattern: '^0x[a-fA-F0-9]{40}$',
        },
        addresses: {
          type: 'array',
          description: 'Multiple contract addresses to check',
          items: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{40}$',
          },
        },
        network: {
          type: 'string',
          description: 'Hedera network',
          enum: ['mainnet', 'testnet', 'previewnet'],
        },
        includeLibraries: {
          type: 'boolean',
          description: 'Include library mappings in response (default: true)',
          default: true,
        },
      },
      required: ['network'],
    },
  },
  {
    name: 'get_verified_source',
    description:
      'Retrieve verified contract source code from HashScan. Returns source files, metadata, and optionally the file tree structure.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Contract address in 0x... format',
          pattern: '^0x[a-fA-F0-9]{40}$',
        },
        network: {
          type: 'string',
          description: 'Hedera network',
          enum: ['mainnet', 'testnet', 'previewnet'],
        },
        matchType: {
          type: 'string',
          description: 'Match type: perfect (exact) or any (perfect + partial) (default: perfect)',
          enum: ['perfect', 'any'],
          default: 'perfect',
        },
        includeFileTree: {
          type: 'boolean',
          description: 'Include file tree structure (default: false)',
          default: false,
        },
        exportFormat: {
          type: 'string',
          description: 'Export format: raw (concatenated) or json (structured) (default: raw)',
          enum: ['raw', 'json'],
          default: 'raw',
        },
      },
      required: ['address', 'network'],
    },
  },
];
