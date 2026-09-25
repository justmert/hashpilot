/**
 * Contract Verification MCP Tools
 *
 * Verifies smart contracts through Sourcify APIv2 (https://sourcify.dev/server), which
 * is what HashScan reads its verification badge from. Sourcify covers Hedera mainnet
 * (chain 295) and testnet (chain 296); previewnet is not supported.
 */

import { logger } from '../utils/logger.js';
import {
  hashScanService,
  HederaNetwork,
  UnsupportedNetworkError,
  isSourcifySupported,
  SOURCIFY_SUPPORTED_NETWORKS,
} from '../services/hashscan-service.js';

/**
 * Tool result interface
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

const VERIFY_METADATA = (command: string) => ({
  executedVia: 'sourcify',
  command,
});

/**
 * Reject unverifiable networks up front so the caller gets one clear message rather
 * than an HTTP error from Sourcify.
 */
function unsupportedNetworkResult(network: string, command: string): ToolResult | undefined {
  if (isSourcifySupported(network)) return undefined;
  return {
    success: false,
    error: new UnsupportedNetworkError(network, network === 'previewnet' ? '297' : undefined)
      .message,
    metadata: {
      ...VERIFY_METADATA(command),
      supportedNetworks: [...SOURCIFY_SUPPORTED_NETWORKS],
    },
  };
}

/**
 * Verify a single contract through Sourcify
 */
export async function verifyContract(args: {
  address: string;
  network: HederaNetwork;
  contractName: string;
  filePath?: string;
  creatorTxHash?: string;
  buildInfoPath?: string;
  artifactPath?: string;
  compilerVersion?: string;
  optimizerEnabled?: boolean;
  optimizerRuns?: number;
  evmVersion?: string;
}): Promise<ToolResult> {
  const unsupported = unsupportedNetworkResult(args.network, 'verify_contract');
  if (unsupported) return unsupported;

  try {
    if (!args.filePath && !args.buildInfoPath && !args.artifactPath) {
      return {
        success: false,
        error:
          'Provide one of: buildInfoPath (Hardhat build-info JSON), artifactPath (Foundry ' +
          'out/<Source>.sol/<Contract>.json), or filePath (a .sol file or a directory of them).',
        metadata: VERIFY_METADATA('verify_contract'),
      };
    }

    logger.info('Verifying contract via Sourcify', {
      address: args.address,
      network: args.network,
      contractName: args.contractName,
      source: args.buildInfoPath
        ? 'build-info'
        : args.artifactPath
          ? 'foundry-artifact'
          : 'sources',
    });

    const result = await hashScanService.verifyContract({
      address: args.address,
      network: args.network,
      contractName: args.contractName,
      filePath: args.filePath,
      buildInfoPath: args.buildInfoPath,
      artifactPath: args.artifactPath,
      creatorTxHash: args.creatorTxHash,
      compilerSettings: {
        compilerVersion: args.compilerVersion,
        optimizerEnabled: args.optimizerEnabled,
        optimizerRuns: args.optimizerRuns,
        evmVersion: args.evmVersion,
      },
    });

    const hashScanUrl = hashScanService.getContractUrl(args.address, args.network);

    if (!result.success) {
      return {
        success: false,
        error: result.message || 'Verification failed',
        data: {
          address: result.address,
          chainId: result.chainId,
          hashScanUrl,
          ...(result.customCode ? { sourcifyCode: result.customCode } : {}),
          ...(result.verificationId ? { verificationId: result.verificationId } : {}),
          ...(result.compilerVersion ? { compilerVersion: result.compilerVersion } : {}),
        },
        metadata: VERIFY_METADATA('verify_contract'),
      };
    }

    return {
      success: true,
      data: {
        address: result.address,
        chainId: result.chainId,
        status: result.status,
        match: result.match,
        creationMatch: result.creationMatch,
        runtimeMatch: result.runtimeMatch,
        libraryMap: result.libraryMap,
        compilerVersion: result.compilerVersion,
        verificationId: result.verificationId,
        hashScanUrl,
        sourcifyUrl: `${hashScanService.baseUrl}/v2/contract/${result.chainId}/${result.address}`,
        message:
          result.message ??
          (result.status === 'perfect'
            ? 'Contract verified with an exact match (metadata hash included)'
            : 'Contract verified with a partial match (metadata hash differs)'),
      },
      metadata: VERIFY_METADATA('verify_contract'),
    };
  } catch (error: any) {
    logger.error('Contract verification failed', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: VERIFY_METADATA('verify_contract'),
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
    filePath?: string;
    creatorTxHash?: string;
    buildInfoPath?: string;
    artifactPath?: string;
    compilerVersion?: string;
  }>;
  parallel?: boolean;
  stopOnFailure?: boolean;
}): Promise<ToolResult> {
  try {
    const parallel = args.parallel !== false; // Default true
    const stopOnFailure = args.stopOnFailure === true; // Default false

    if (!args.contracts || args.contracts.length === 0) {
      return {
        success: false,
        error: 'No contracts were supplied',
        metadata: VERIFY_METADATA('verify_batch'),
      };
    }

    logger.info('Starting batch verification', {
      count: args.contracts.length,
      parallel,
      stopOnFailure,
    });

    const results: ToolResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    if (parallel) {
      const allResults = await Promise.all(args.contracts.map((c) => verifyContract(c)));
      for (const result of allResults) {
        results.push(result);
        if (result.success) successCount++;
        else failureCount++;
      }
    } else {
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
      metadata: VERIFY_METADATA('verify_batch'),
    };
  } catch (error: any) {
    logger.error('Batch verification failed', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: VERIFY_METADATA('verify_batch'),
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
  const unsupported = unsupportedNetworkResult(args.network, 'verification_status');
  if (unsupported) return unsupported;

  try {
    const includeLibraries = args.includeLibraries !== false; // Default true

    if (args.addresses) {
      logger.info('Checking batch verification status', {
        count: args.addresses.length,
        network: args.network,
      });

      const results = await hashScanService.checkBatchVerificationStatus(
        args.addresses,
        args.network
      );

      return {
        success: true,
        data: {
          results: results.map((r) => ({
            address: r.address,
            statuses: r.chainIds.map((c) => ({
              chainId: c.chainId,
              status: c.status,
              isVerified: c.status !== 'not_verified',
              hashScanUrl: hashScanService.getContractUrl(r.address, args.network),
            })),
          })),
        },
        metadata: VERIFY_METADATA('verification_status'),
      };
    }

    if (args.address) {
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
          match: result.match,
          creationMatch: result.creationMatch,
          runtimeMatch: result.runtimeMatch,
          verifiedAt: result.verifiedAt,
          ...(includeLibraries && result.libraryMap ? { libraryMap: result.libraryMap } : {}),
          hashScanUrl,
          isVerified: result.status !== 'not_verified',
        },
        metadata: VERIFY_METADATA('verification_status'),
      };
    }

    return {
      success: false,
      error: 'Either address or addresses must be provided',
      metadata: VERIFY_METADATA('verification_status'),
    };
  } catch (error: any) {
    logger.error('Failed to check verification status', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: VERIFY_METADATA('verification_status'),
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
  const unsupported = unsupportedNetworkResult(args.network, 'get_verified_source');
  if (unsupported) return unsupported;

  try {
    const matchType = args.matchType || 'perfect';
    const includeFileTree = args.includeFileTree === true;
    const exportFormat = args.exportFormat || 'raw';

    logger.info('Fetching verified contract source', {
      address: args.address,
      network: args.network,
      matchType,
    });

    const files = await hashScanService.getContractFiles(args.address, args.network, matchType);

    if (files.length === 0) {
      return {
        success: false,
        error:
          matchType === 'perfect'
            ? 'No exact-match verified source found for this contract. Retry with matchType "any" ' +
              'to accept a partial match.'
            : 'No verified source code found for this contract on Sourcify.',
        metadata: VERIFY_METADATA('get_verified_source'),
      };
    }

    const data: any = {
      address: args.address,
      network: args.network,
      matchType,
      fileCount: files.length,
    };

    if (exportFormat === 'json') {
      data.files = files;
    } else {
      const sourceFiles = files.filter((f) => f.name.endsWith('.sol'));
      data.sourceCode = sourceFiles.map((f) => `// File: ${f.path}\n${f.content}`).join('\n\n');
      data.metadata = files.find((f) => f.name === 'metadata.json')?.content;
    }

    if (includeFileTree) {
      // Sourcify v2 has no tree endpoint; the tree is derived from the verified paths.
      data.fileTree = await hashScanService.getContractFileTree(
        args.address,
        args.network,
        matchType
      );
    }

    return {
      success: true,
      data,
      metadata: VERIFY_METADATA('get_verified_source'),
    };
  } catch (error: any) {
    logger.error('Failed to get verified source', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: VERIFY_METADATA('get_verified_source'),
    };
  }
}

/** Networks that can be verified, for tool input schemas. */
const VERIFIABLE_NETWORKS = [...SOURCIFY_SUPPORTED_NETWORKS];

/**
 * Tool definitions for MCP
 */
export const verifyTools = [
  {
    name: 'verify_contract',
    description:
      'Verify a smart contract on Sourcify, which is what HashScan reads its verified badge from. ' +
      'Supply buildInfoPath (Hardhat) or artifactPath (Foundry) when possible: they carry the exact ' +
      'compiler settings. Verifying from raw sources has to assume the settings and often fails to ' +
      'match. Hedera mainnet and testnet only; previewnet is not supported by Sourcify.',
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
          description:
            'Hedera network. Sourcify does not support previewnet (chain ID 297) — deploy to testnet (296) or mainnet (295) to verify a contract.',
          enum: VERIFIABLE_NETWORKS,
        },
        contractName: {
          type: 'string',
          description: 'Contract name (e.g., "Greeter")',
        },
        filePath: {
          type: 'string',
          description:
            'Path to a .sol file or a directory of .sol files. Used when no buildInfoPath or ' +
            'artifactPath is given.',
        },
        buildInfoPath: {
          type: 'string',
          description:
            'Preferred for Hardhat: path to artifacts/build-info/<hash>.json, which embeds the ' +
            'full standard JSON input and the exact compiler version.',
        },
        artifactPath: {
          type: 'string',
          description:
            'Preferred for Foundry: path to out/<Source>.sol/<Contract>.json. Source files are ' +
            'read from the project root inferred from this path.',
        },
        creatorTxHash: {
          type: 'string',
          description:
            'Optional: hash of the transaction that created the contract. Lets Sourcify check the ' +
            'creation bytecode as well as the runtime bytecode.',
          pattern: '^0x[a-fA-F0-9]{64}$',
        },
        compilerVersion: {
          type: 'string',
          description:
            'Optional, raw-source path only: solc version such as "0.8.28" or ' +
            '"0.8.28+commit.7893614a". Defaults to the version in the source pragma.',
        },
        optimizerEnabled: {
          type: 'boolean',
          description:
            'Optional, raw-source path only: whether the optimizer was on (default false)',
        },
        optimizerRuns: {
          type: 'number',
          description: 'Optional, raw-source path only: optimizer runs (default 200)',
        },
        evmVersion: {
          type: 'string',
          description: 'Optional, raw-source path only: EVM version, e.g. "paris", "cancun"',
        },
      },
      required: ['address', 'network', 'contractName'],
    },
  },
  {
    name: 'verify_batch',
    description:
      'Batch verify multiple contracts on Sourcify. Supports parallel or sequential verification ' +
      'with configurable failure handling.',
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
              network: { type: 'string', enum: VERIFIABLE_NETWORKS },
              contractName: { type: 'string' },
              filePath: { type: 'string' },
              creatorTxHash: { type: 'string' },
              buildInfoPath: { type: 'string' },
              artifactPath: { type: 'string' },
              compilerVersion: { type: 'string' },
            },
            required: ['address', 'network', 'contractName'],
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
      'Check Sourcify verification status for one or more contracts without re-verifying. Reports ' +
      'an exact match (perfect) or a metadata-only mismatch (partial).',
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
          description:
            'Hedera network. Sourcify does not support previewnet (chain ID 297) — deploy to testnet (296) or mainnet (295) to verify a contract.',
          enum: VERIFIABLE_NETWORKS,
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
      'Retrieve verified contract source code from Sourcify. Returns source files, metadata, and ' +
      'optionally a file tree derived from the source paths.',
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
          description:
            'Hedera network. Sourcify does not support previewnet (chain ID 297) — deploy to testnet (296) or mainnet (295) to verify a contract.',
          enum: VERIFIABLE_NETWORKS,
        },
        matchType: {
          type: 'string',
          description:
            'perfect (exact match only) or any (accept a partial match) (default: perfect)',
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
