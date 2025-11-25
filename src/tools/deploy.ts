/**
 * Contract Deployment MCP Tools
 *
 * Tools for unified smart contract deployment to Hedera Network with support for
 * Hardhat, Foundry, and direct RPC deployment methods. Includes deployment history
 * tracking, multi-contract deployment with dependency resolution, and reporting.
 */

import { logger } from '../utils/logger.js';
import { deploymentService, DeploymentRecord } from '../services/deployment-service.js';
import { hashScanService, HederaNetwork } from '../services/hashscan-service.js';

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
 * Deploy a single contract with unified interface
 */
export async function deployContract(args: {
  contractName: string;
  network: HederaNetwork;
  constructorArgs?: any[];
  framework?: 'hardhat' | 'foundry' | 'direct';
  fromAlias?: string;
  privateKey?: string;
  gasLimit?: number;
  verify?: boolean;
  metadata?: Record<string, any>;
}): Promise<ToolResult> {
  try {
    logger.info('Starting contract deployment', {
      contractName: args.contractName,
      network: args.network,
      framework: args.framework || 'auto-detect',
      verify: args.verify || false,
    });

    const result = await deploymentService.deployContract({
      contractName: args.contractName,
      network: args.network,
      constructorArgs: args.constructorArgs,
      framework: args.framework,
      fromAlias: args.fromAlias,
      privateKey: args.privateKey,
      gasLimit: args.gasLimit,
      verify: args.verify,
    });

    if (result.success && result.record) {
      return {
        success: true,
        data: {
          deploymentId: result.record.id,
          contractName: result.record.contractName,
          contractAddress: result.record.contractAddress,
          network: result.record.network,
          framework: result.record.framework,
          transactionHash: result.record.transactionHash,
          gasUsed: result.record.gasUsed,
          constructorArgs: result.record.constructorArgs,
          status: result.record.status,
          verificationStatus: result.record.verificationStatus,
          hashScanUrl: result.record.hashScanUrl,
          deployedAt: result.record.deployedAt,
        },
        metadata: {
          executedVia: result.record.framework,
          command: 'deploy_contract',
        },
      };
    } else {
      return {
        success: false,
        error: result.error || 'Deployment failed',
        metadata: {
          executedVia: 'deployment-service',
          command: 'deploy_contract',
        },
      };
    }
  } catch (error: any) {
    logger.error('Contract deployment failed', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: {
        executedVia: 'deployment-service',
        command: 'deploy_contract',
      },
    };
  }
}

/**
 * Deploy multiple contracts with dependency resolution
 */
export async function deployMultiContract(args: {
  contracts: Array<{
    name: string;
    constructorArgs?: any[];
    dependsOn?: string[];
  }>;
  network: HederaNetwork;
  framework?: 'hardhat' | 'foundry' | 'direct';
  fromAlias?: string;
  privateKey?: string;
  verify?: boolean;
  continueOnFailure?: boolean;
}): Promise<ToolResult> {
  try {
    logger.info('Starting multi-contract deployment', {
      contractCount: args.contracts.length,
      network: args.network,
      framework: args.framework || 'auto-detect',
      verify: args.verify || false,
    });

    const results = await deploymentService.deployMultiContract({
      contracts: args.contracts,
      network: args.network,
      privateKey: args.privateKey,
      fromAlias: args.fromAlias,
      verify: args.verify,
    });

    const deployments: any[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (const [contractName, result] of results.entries()) {
      if (result.success && result.record) {
        deployments.push({
          contractName: result.record.contractName,
          contractAddress: result.record.contractAddress,
          transactionHash: result.record.transactionHash,
          gasUsed: result.record.gasUsed,
          status: result.record.status,
          verificationStatus: result.record.verificationStatus,
          hashScanUrl: result.record.hashScanUrl,
        });
        successCount++;
      } else {
        deployments.push({
          contractName,
          error: result.error,
          status: 'failed',
        });
        failureCount++;

        if (!args.continueOnFailure) {
          break; // Stop on first failure
        }
      }
    }

    return {
      success: failureCount === 0,
      data: {
        deployments,
        summary: {
          total: args.contracts.length,
          successful: successCount,
          failed: failureCount,
          successRate: `${((successCount / args.contracts.length) * 100).toFixed(1)}%`,
        },
        network: args.network,
      },
      metadata: {
        executedVia: args.framework || 'auto-detect',
        command: 'deploy_multi_contract',
      },
    };
  } catch (error: any) {
    logger.error('Multi-contract deployment failed', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: {
        executedVia: 'deployment-service',
        command: 'deploy_multi_contract',
      },
    };
  }
}

/**
 * Get deployment history with filtering
 */
export async function deploymentHistory(args: {
  network?: HederaNetwork;
  contractName?: string;
  status?: 'pending' | 'deploying' | 'deployed' | 'failed' | 'verified';
  limit?: number;
  offset?: number;
  exportFormat?: 'json' | 'csv' | 'markdown';
}): Promise<ToolResult> {
  try {
    const limit = args.limit || 20;
    const offset = args.offset || 0;
    const exportFormat = args.exportFormat || 'json';

    logger.info('Fetching deployment history', {
      network: args.network,
      contractName: args.contractName,
      status: args.status,
      limit,
      offset,
    });

    const records = deploymentService.getDeploymentHistory({
      network: args.network,
      contractName: args.contractName,
      status: args.status,
      limit: limit + offset, // Get limit + offset to handle pagination
    });

    // Apply offset
    const paginatedRecords = records.slice(offset, offset + limit);
    const totalCount = records.length;
    const hasMore = totalCount > offset + limit;

    let data: any = {
      deployments: paginatedRecords,
      pagination: {
        offset,
        limit,
        total: totalCount,
        returned: paginatedRecords.length,
        hasMore,
      },
    };

    // Format output
    if (exportFormat === 'csv') {
      const csv = convertToCSV(paginatedRecords);
      data = { csv, ...data.pagination };
    } else if (exportFormat === 'markdown') {
      const markdown = convertToMarkdown(paginatedRecords);
      data = { markdown, ...data.pagination };
    }

    return {
      success: true,
      data,
      metadata: {
        executedVia: 'deployment-service',
        command: 'deployment_history',
      },
    };
  } catch (error: any) {
    logger.error('Failed to fetch deployment history', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: {
        executedVia: 'deployment-service',
        command: 'deployment_history',
      },
    };
  }
}

/**
 * Get detailed status of a specific deployment
 */
export async function deploymentStatus(args: {
  deploymentId?: string;
  address?: string;
  network?: HederaNetwork;
  includeHashScanData?: boolean;
}): Promise<ToolResult> {
  try {
    let record: DeploymentRecord | null = null;

    if (args.deploymentId) {
      logger.info('Fetching deployment status by ID', { deploymentId: args.deploymentId });
      record = deploymentService.getDeploymentById(args.deploymentId);
    } else if (args.address && args.network) {
      logger.info('Fetching deployment status by address', {
        address: args.address,
        network: args.network,
      });
      record = deploymentService.getDeploymentByAddress(args.address, args.network);
    } else {
      return {
        success: false,
        error: 'Either deploymentId or (address + network) must be provided',
        metadata: {
          executedVia: 'deployment-service',
          command: 'deployment_status',
        },
      };
    }

    if (!record) {
      return {
        success: false,
        error: 'Deployment not found',
        metadata: {
          executedVia: 'deployment-service',
          command: 'deployment_status',
        },
      };
    }

    const data: any = {
      deployment: record,
    };

    // Optionally fetch fresh data from HashScan
    if (args.includeHashScanData && record.contractAddress) {
      try {
        const verificationStatus = await hashScanService.checkVerificationStatus(
          record.contractAddress,
          record.network,
        );
        data.currentVerificationStatus = verificationStatus;
        data.hashScanUrl = hashScanService.getContractUrl(record.contractAddress, record.network);
      } catch (error) {
        logger.warn('Failed to fetch HashScan data', { error });
      }
    }

    return {
      success: true,
      data,
      metadata: {
        executedVia: 'deployment-service',
        command: 'deployment_status',
      },
    };
  } catch (error: any) {
    logger.error('Failed to fetch deployment status', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: {
        executedVia: 'deployment-service',
        command: 'deployment_status',
      },
    };
  }
}

/**
 * Generate deployment documentation/summary
 */
export async function deploymentReport(args: {
  deploymentIds?: string[];
  network?: HederaNetwork;
  contractName?: string;
  format?: 'markdown' | 'json' | 'html';
  includeSourceCode?: boolean;
  outputPath?: string;
}): Promise<ToolResult> {
  try {
    const format = args.format || 'markdown';

    let deploymentIds: string[];

    if (args.deploymentIds) {
      deploymentIds = args.deploymentIds;
    } else {
      // Get deployments based on filters
      const records = deploymentService.getDeploymentHistory({
        network: args.network,
        contractName: args.contractName,
        limit: 100,
      });
      deploymentIds = records.map((r) => r.id);
    }

    logger.info('Generating deployment report', {
      count: deploymentIds.length,
      format,
    });

    const report = deploymentService.generateDeploymentReport(deploymentIds);

    const data: any = {
      report,
      format,
      deploymentCount: deploymentIds.length,
    };

    // TODO: If includeSourceCode, fetch from HashScan and append
    // TODO: If outputPath, write to file

    if (format === 'json') {
      const records = deploymentIds.map((id) => deploymentService.getDeploymentById(id)).filter((r) => r !== null);
      data.deployments = records;
    } else if (format === 'html') {
      data.html = convertMarkdownToHtml(report);
    }

    return {
      success: true,
      data,
      metadata: {
        executedVia: 'deployment-service',
        command: 'deployment_report',
      },
    };
  } catch (error: any) {
    logger.error('Failed to generate deployment report', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: {
        executedVia: 'deployment-service',
        command: 'deployment_report',
      },
    };
  }
}

/**
 * Get comprehensive contract information
 */
export async function contractInfo(args: {
  address: string;
  network: HederaNetwork;
  includeDeploymentHistory?: boolean;
  includeAbi?: boolean;
}): Promise<ToolResult> {
  try {
    logger.info('Fetching contract information', {
      address: args.address,
      network: args.network,
    });

    const data: any = {
      address: args.address,
      network: args.network,
      hashScanUrl: hashScanService.getContractUrl(args.address, args.network),
    };

    // Get verification status
    try {
      const verificationStatus = await hashScanService.checkVerificationStatus(args.address, args.network);
      data.verification = {
        status: verificationStatus.status,
        isVerified: verificationStatus.status === 'perfect' || verificationStatus.status === 'partial',
        libraryMap: verificationStatus.libraryMap,
      };
    } catch (error) {
      logger.warn('Failed to fetch verification status', { error });
      data.verification = { status: 'unknown', isVerified: false };
    }

    // Get deployment history
    if (args.includeDeploymentHistory) {
      const deployment = deploymentService.getDeploymentByAddress(args.address, args.network);
      if (deployment) {
        data.deployment = {
          deploymentId: deployment.id,
          contractName: deployment.contractName,
          deployer: deployment.deployer,
          deployedAt: deployment.deployedAt,
          transactionHash: deployment.transactionHash,
          gasUsed: deployment.gasUsed,
          framework: deployment.framework,
          constructorArgs: deployment.constructorArgs,
        };
      }
    }

    // Get ABI if available and verified
    if (args.includeAbi && data.verification.isVerified) {
      try {
        const files = await hashScanService.getContractFiles(args.address, args.network, 'perfect');
        const metadataFile = files.find((f) => f.name === 'metadata.json');
        if (metadataFile) {
          const metadata = JSON.parse(metadataFile.content);
          data.abi = metadata.output?.abi || [];
        }
      } catch (error) {
        logger.warn('Failed to fetch ABI', { error });
      }
    }

    return {
      success: true,
      data,
      metadata: {
        executedVia: 'deployment-service',
        command: 'contract_info',
      },
    };
  } catch (error: any) {
    logger.error('Failed to fetch contract information', { error: error.message });
    return {
      success: false,
      error: error.message,
      metadata: {
        executedVia: 'deployment-service',
        command: 'contract_info',
      },
    };
  }
}

/**
 * Helper: Convert deployment records to CSV
 */
function convertToCSV(records: DeploymentRecord[]): string {
  const headers = [
    'ID',
    'Contract Name',
    'Address',
    'Network',
    'Framework',
    'Status',
    'Transaction Hash',
    'Gas Used',
    'Deployed At',
  ];
  const rows = records.map((r) => [
    r.id,
    r.contractName,
    r.contractAddress,
    r.network,
    r.framework,
    r.status,
    r.transactionHash,
    r.gasUsed.toString(),
    r.deployedAt,
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * Helper: Convert deployment records to Markdown table
 */
function convertToMarkdown(records: DeploymentRecord[]): string {
  let md = '# Deployment History\n\n';
  md += '| Contract | Address | Network | Status | Gas Used | Deployed At |\n';
  md += '|----------|---------|---------|--------|----------|-------------|\n';

  for (const r of records) {
    md += `| ${r.contractName} | ${r.contractAddress.substring(0, 10)}... | ${r.network} | ${r.status} | ${r.gasUsed} | ${new Date(r.deployedAt).toLocaleString()} |\n`;
  }

  return md;
}

/**
 * Helper: Convert markdown to basic HTML
 */
function convertMarkdownToHtml(markdown: string): string {
  // Basic markdown to HTML conversion
  let html = markdown
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Deployment Report</title></head><body><p>${html}</p></body></html>`;
}

/**
 * Tool definitions for MCP
 */
export const deployTools = [
  {
    name: 'deploy_contract',
    description:
      'Deploy a smart contract to Hedera Network with unified interface. Auto-detects Hardhat/Foundry framework. Supports auto-verification on HashScan and deployment history tracking.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractName: {
          type: 'string',
          description: 'Contract name (e.g., "Greeter")',
        },
        network: {
          type: 'string',
          description: 'Hedera network to deploy to',
          enum: ['mainnet', 'testnet', 'previewnet'],
        },
        constructorArgs: {
          type: 'array',
          description: 'Constructor arguments (default: [])',
          items: {},
        },
        framework: {
          type: 'string',
          description: 'Deployment framework (auto-detected if not specified)',
          enum: ['hardhat', 'foundry', 'direct'],
        },
        fromAlias: {
          type: 'string',
          description: 'Address book alias for deployer account',
        },
        privateKey: {
          type: 'string',
          description: 'Private key for deployment (DER-encoded)',
        },
        gasLimit: {
          type: 'number',
          description: 'Gas limit override',
        },
        verify: {
          type: 'boolean',
          description: 'Auto-verify contract on HashScan after deployment (default: false)',
          default: false,
        },
        metadata: {
          type: 'object',
          description: 'Custom deployment metadata',
        },
      },
      required: ['contractName', 'network'],
    },
  },
  {
    name: 'deploy_multi_contract',
    description:
      'Deploy multiple contracts with automatic dependency resolution. Supports $ContractName placeholders in constructor args for deployed contract addresses. Deploys in topological order based on dependencies.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contracts: {
          type: 'array',
          description: 'Contracts to deploy with optional dependencies',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Contract name' },
              constructorArgs: {
                type: 'array',
                description: 'Constructor args (use $ContractName for dependencies)',
                items: {},
              },
              dependsOn: {
                type: 'array',
                description: 'Names of contracts that must be deployed first',
                items: { type: 'string' },
              },
            },
            required: ['name'],
          },
        },
        network: {
          type: 'string',
          description: 'Hedera network',
          enum: ['mainnet', 'testnet', 'previewnet'],
        },
        framework: {
          type: 'string',
          description: 'Deployment framework (auto-detected if not specified)',
          enum: ['hardhat', 'foundry', 'direct'],
        },
        fromAlias: {
          type: 'string',
          description: 'Address book alias for deployer',
        },
        privateKey: {
          type: 'string',
          description: 'Private key for deployment',
        },
        verify: {
          type: 'boolean',
          description: 'Auto-verify all contracts (default: false)',
          default: false,
        },
        continueOnFailure: {
          type: 'boolean',
          description: 'Continue deploying remaining contracts on failure (default: false)',
          default: false,
        },
      },
      required: ['contracts', 'network'],
    },
  },
  {
    name: 'deployment_history',
    description:
      'View deployment history with filtering and pagination. Query by network, contract name, or status. Export to JSON, CSV, or Markdown.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: {
          type: 'string',
          description: 'Filter by network',
          enum: ['mainnet', 'testnet', 'previewnet'],
        },
        contractName: {
          type: 'string',
          description: 'Filter by contract name',
        },
        status: {
          type: 'string',
          description: 'Filter by deployment status',
          enum: ['pending', 'deploying', 'deployed', 'failed', 'verified'],
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 20)',
          default: 20,
          minimum: 1,
          maximum: 100,
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
          default: 0,
          minimum: 0,
        },
        exportFormat: {
          type: 'string',
          description: 'Export format (default: json)',
          enum: ['json', 'csv', 'markdown'],
          default: 'json',
        },
      },
    },
  },
  {
    name: 'deployment_status',
    description:
      'Get detailed status of a specific deployment by ID or contract address. Optionally fetch fresh verification data from HashScan.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        deploymentId: {
          type: 'string',
          description: 'Deployment ID from history',
        },
        address: {
          type: 'string',
          description: 'Contract address (0x... format)',
          pattern: '^0x[a-fA-F0-9]{40}$',
        },
        network: {
          type: 'string',
          description: 'Network (required when using address)',
          enum: ['mainnet', 'testnet', 'previewnet'],
        },
        includeHashScanData: {
          type: 'boolean',
          description: 'Fetch fresh verification data from HashScan (default: false)',
          default: false,
        },
      },
    },
  },
  {
    name: 'deployment_report',
    description:
      'Generate deployment documentation/summary in Markdown, JSON, or HTML. Include specific deployments or filter by network/contract.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        deploymentIds: {
          type: 'array',
          description: 'Specific deployment IDs to include',
          items: { type: 'string' },
        },
        network: {
          type: 'string',
          description: 'Filter by network',
          enum: ['mainnet', 'testnet', 'previewnet'],
        },
        contractName: {
          type: 'string',
          description: 'Filter by contract name',
        },
        format: {
          type: 'string',
          description: 'Report format (default: markdown)',
          enum: ['markdown', 'json', 'html'],
          default: 'markdown',
        },
        includeSourceCode: {
          type: 'boolean',
          description: 'Include contract source code in report (default: false)',
          default: false,
        },
        outputPath: {
          type: 'string',
          description: 'File path to save report',
        },
      },
    },
  },
  {
    name: 'contract_info',
    description:
      'Get comprehensive contract information including verification status, deployment details, ABI, and HashScan URL. Combines data from deployment history and HashScan verification.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Contract address (0x... format)',
          pattern: '^0x[a-fA-F0-9]{40}$',
        },
        network: {
          type: 'string',
          description: 'Hedera network',
          enum: ['mainnet', 'testnet', 'previewnet'],
        },
        includeDeploymentHistory: {
          type: 'boolean',
          description: 'Include deployment details from history (default: false)',
          default: false,
        },
        includeAbi: {
          type: 'boolean',
          description: 'Include contract ABI if verified (default: false)',
          default: false,
        },
      },
      required: ['address', 'network'],
    },
  },
];
