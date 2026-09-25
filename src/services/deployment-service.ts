/**
 * Deployment Service for Unified Contract Deployment
 *
 * Provides a unified interface for deploying smart contracts to Hedera Network
 * with support for Hardhat, Foundry, and direct RPC deployment methods.
 * Includes deployment history tracking, rollback capabilities, and multi-contract support.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { hardhatService } from './hardhat-service.js';
import { foundryService } from './foundry-service.js';
// import { jsonRpcService } from './json-rpc-service.js'; // TODO: Uncomment when direct RPC deployment is implemented
import { hashScanService, HederaNetwork, isSourcifySupported } from './hashscan-service.js';
import { getDataDir } from '../utils/data-dir.js';

/**
 * Supported deployment frameworks
 */
export type DeploymentFramework = 'hardhat' | 'foundry' | 'direct';

/**
 * Deployment status
 */
export type DeploymentStatus = 'pending' | 'deploying' | 'deployed' | 'failed' | 'verified';

/**
 * Deployment record
 */
export interface DeploymentRecord {
  id: string;
  contractName: string;
  contractAddress: string;
  network: HederaNetwork;
  framework: DeploymentFramework;
  deployer: string; // Account ID or address
  deployedAt: string; // ISO timestamp
  transactionHash: string;
  gasUsed: number;
  constructorArgs: any[];
  sourcePath?: string;
  compilerVersion?: string;
  status: DeploymentStatus;
  verificationStatus?: 'not_verified' | 'pending' | 'verified' | 'failed';
  hashScanUrl?: string;
  metadata?: Record<string, any>;
}

/**
 * Deployment options
 */
export interface DeploymentOptions {
  contractName: string;
  network: HederaNetwork;
  constructorArgs?: any[];
  privateKey?: string; // For direct deployment
  fromAlias?: string; // Address book alias
  gasLimit?: number;
  value?: string; // HBAR to send with deployment (in wei)
  verify?: boolean; // Auto-verify on HashScan after deployment
  framework?: DeploymentFramework; // Override auto-detection
}

/**
 * Multi-contract deployment plan
 */
export interface DeploymentPlan {
  contracts: Array<{
    name: string;
    constructorArgs?: any[];
    dependsOn?: string[]; // Names of contracts that must be deployed first
  }>;
  network: HederaNetwork;
  privateKey?: string;
  fromAlias?: string;
  verify?: boolean;
}

/**
 * Deployment result
 */
export interface DeploymentResult {
  success: boolean;
  record?: DeploymentRecord;
  error?: string;
}

/**
 * Deployment Service
 */
export class DeploymentService {
  private deploymentHistoryFile: string;
  private deploymentHistory: DeploymentRecord[] = [];

  constructor() {
    // Shared data directory (~/.hedera-mcp or HASHPILOT_DATA_DIR)
    this.deploymentHistoryFile = path.join(getDataDir(), 'deployments.json');
    this.loadDeploymentHistory();
  }

  /**
   * Load deployment history from file
   */
  private async loadDeploymentHistory(): Promise<void> {
    try {
      const data = await fs.readFile(this.deploymentHistoryFile, 'utf-8');
      this.deploymentHistory = JSON.parse(data);
      logger.debug('Deployment history loaded', { count: this.deploymentHistory.length });
    } catch (error) {
      // File doesn't exist yet, start with empty history
      this.deploymentHistory = [];
      logger.debug('No deployment history found, starting fresh');
    }
  }

  /**
   * Save deployment history to file
   */
  private async saveDeploymentHistory(): Promise<void> {
    try {
      await fs.writeFile(
        this.deploymentHistoryFile,
        JSON.stringify(this.deploymentHistory, null, 2),
        'utf-8'
      );
      logger.debug('Deployment history saved', { count: this.deploymentHistory.length });
    } catch (error: any) {
      logger.error('Failed to save deployment history', { error: error.message });
    }
  }

  /**
   * Detect deployment framework based on current directory
   */
  async detectFramework(): Promise<DeploymentFramework | null> {
    try {
      // Check for Hardhat
      const hardhatProject = await hardhatService.detectHardhatProject();
      if (hardhatProject) {
        logger.info('Detected Hardhat project');
        return 'hardhat';
      }

      // Check for Foundry
      const foundryProject = await foundryService.detectFoundryProject();
      if (foundryProject) {
        logger.info('Detected Foundry project');
        return 'foundry';
      }

      logger.info('No framework detected, will use direct deployment');
      return 'direct';
    } catch (error: any) {
      logger.error('Framework detection failed', { error: error.message });
      return null;
    }
  }

  /**
   * Deploy a single contract with unified interface
   */
  async deployContract(options: DeploymentOptions): Promise<DeploymentResult> {
    try {
      logger.info('Starting contract deployment', {
        contractName: options.contractName,
        network: options.network,
        framework: options.framework || 'auto-detect',
      });

      // Detect framework if not specified
      const framework = options.framework || (await this.detectFramework());
      if (!framework) {
        return {
          success: false,
          error: 'Could not detect deployment framework',
        };
      }

      // Generate deployment ID
      const deploymentId = this.generateDeploymentId(options.contractName, options.network);

      // Create pending deployment record
      const record: DeploymentRecord = {
        id: deploymentId,
        contractName: options.contractName,
        contractAddress: '', // Will be filled after deployment
        network: options.network,
        framework,
        deployer: options.fromAlias || 'unknown',
        deployedAt: new Date().toISOString(),
        transactionHash: '',
        gasUsed: 0,
        constructorArgs: options.constructorArgs || [],
        status: 'deploying',
        verificationStatus: 'not_verified',
      };

      // Deploy based on framework
      let deploymentData: any;
      switch (framework) {
        case 'hardhat':
          deploymentData = await this.deployWithHardhat(options);
          break;
        case 'foundry':
          deploymentData = await this.deployWithFoundry(options);
          break;
        case 'direct':
          deploymentData = await this.deployWithRPC(options);
          break;
      }

      if (!deploymentData.success) {
        record.status = 'failed';
        this.deploymentHistory.push(record);
        await this.saveDeploymentHistory();

        return {
          success: false,
          error: deploymentData.error,
          record,
        };
      }

      // Update record with deployment data
      record.contractAddress = deploymentData.address;
      record.transactionHash = deploymentData.transactionHash;
      record.gasUsed = deploymentData.gasUsed || 0;
      record.status = 'deployed';
      record.hashScanUrl = hashScanService.getContractUrl(deploymentData.address, options.network);
      record.compilerVersion = deploymentData.compilerVersion;

      // Auto-verify if requested
      if (options.verify) {
        logger.info('Auto-verifying contract on HashScan', {
          address: record.contractAddress,
          network: options.network,
        });

        record.verificationStatus = 'pending';
        const verifyResult = await this.verifyDeployment(record, framework);
        if (verifyResult) {
          record.verificationStatus = 'verified';
          record.status = 'verified';
        } else {
          record.verificationStatus = 'failed';
        }
      }

      // Save to history
      this.deploymentHistory.push(record);
      await this.saveDeploymentHistory();

      logger.info('Contract deployment successful', {
        contractName: record.contractName,
        address: record.contractAddress,
        network: record.network,
        transactionHash: record.transactionHash,
        verified: record.verificationStatus === 'verified',
      });

      return {
        success: true,
        record,
      };
    } catch (error: any) {
      logger.error('Contract deployment failed', { error: error.message });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Deploy contract using Hardhat
   */
  private async deployWithHardhat(options: DeploymentOptions): Promise<any> {
    try {
      // Artifacts come from the project's artifacts/ directory; the
      // transaction goes through the JSON-RPC relay (no Hardhat runtime).
      const privateKey =
        options.privateKey || (await this.getPrivateKeyForAlias(options.fromAlias)) || undefined;

      const result = await hardhatService.deploy({
        contractName: options.contractName,
        constructorArgs: options.constructorArgs || [],
        network: options.network,
        privateKey,
        gasLimit: options.gasLimit,
        value: options.value,
      });

      return {
        success: true,
        address: result.address,
        transactionHash: result.transactionHash,
        gasUsed: result.gasUsed ? parseInt(result.gasUsed, 10) : 0,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Deploy contract using Foundry
   */
  private async deployWithFoundry(options: DeploymentOptions): Promise<any> {
    try {
      // Get RPC URL for network
      const rpcUrl = this.getRpcUrlForNetwork(options.network);

      // Get private key
      const privateKey =
        options.privateKey || (await this.getPrivateKeyForAlias(options.fromAlias));
      if (!privateKey) {
        throw new Error('Private key or fromAlias required for deployment');
      }

      // Deploy with forge create
      const result = await foundryService.create({
        contractPath: `src/${options.contractName}.sol:${options.contractName}`,
        rpcUrl,
        privateKey,
        constructorArgs: options.constructorArgs || [],
        gasLimit: options.gasLimit,
      });

      return {
        success: true,
        address: result.address,
        transactionHash: result.transactionHash,
        gasUsed: result.gasUsed ? parseInt(result.gasUsed) : 0,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Deploy contract using direct RPC
   */
  private async deployWithRPC(_options: DeploymentOptions): Promise<any> {
    try {
      // TODO: Implement direct RPC deployment via json-rpc-service
      // For now, return placeholder
      throw new Error('Direct RPC deployment not yet implemented');
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify a deployment on Sourcify, which is what HashScan reads its badge from.
   *
   * Uses the build output rather than raw sources so the exact compiler settings are
   * submitted: the Foundry artifact for `forge` projects, the newest Hardhat build-info
   * for `hardhat` projects.
   */
  private async verifyDeployment(
    record: DeploymentRecord,
    framework: DeploymentFramework
  ): Promise<boolean> {
    try {
      if (!isSourcifySupported(record.network)) {
        logger.warn('Skipping verification: Sourcify does not support this network', {
          network: record.network,
          address: record.contractAddress,
        });
        return false;
      }

      let artifactPath: string | undefined;
      let buildInfoPath: string | undefined;

      if (framework === 'foundry') {
        artifactPath = path.join(
          'out',
          `${record.contractName}.sol`,
          `${record.contractName}.json`
        );
      } else if (framework === 'hardhat') {
        buildInfoPath = await this.findLatestBuildInfo();
        if (!buildInfoPath) {
          logger.warn('Skipping verification: no Hardhat build-info found', {
            contractName: record.contractName,
          });
          return false;
        }
      } else {
        logger.warn('Skipping verification: no build output for this framework', { framework });
        return false;
      }

      const result = await hashScanService.verifyContract({
        address: record.contractAddress,
        network: record.network,
        contractName: record.contractName,
        artifactPath,
        buildInfoPath,
        creatorTxHash: record.transactionHash,
      });

      if (!result.success) {
        logger.warn('Contract verification did not succeed', {
          address: record.contractAddress,
          reason: result.message,
          sourcifyCode: result.customCode,
        });
        return false;
      }

      logger.info('Contract verified on Sourcify', {
        address: record.contractAddress,
        status: result.status,
      });

      // A partial match still counts as verified; only the metadata hash differs.
      return true;
    } catch (error: any) {
      logger.error('Verification failed', { error: error.message });
      return false;
    }
  }

  /**
   * Newest file under artifacts/build-info, which is where Hardhat writes the full
   * standard JSON input for the last compilation.
   */
  private async findLatestBuildInfo(): Promise<string | undefined> {
    const buildInfoDir = path.join('artifacts', 'build-info');
    try {
      const entries = await fs.readdir(buildInfoDir);
      const candidates = entries.filter((name) => name.endsWith('.json'));
      if (candidates.length === 0) return undefined;

      const stats = await Promise.all(
        candidates.map(async (name) => {
          const full = path.join(buildInfoDir, name);
          return { full, mtime: (await fs.stat(full)).mtimeMs };
        })
      );
      stats.sort((a, b) => b.mtime - a.mtime);
      return stats[0].full;
    } catch {
      return undefined;
    }
  }

  /**
   * Deploy multiple contracts with dependency resolution
   */
  async deployMultiContract(plan: DeploymentPlan): Promise<Map<string, DeploymentResult>> {
    const results = new Map<string, DeploymentResult>();
    const deployedAddresses = new Map<string, string>();

    try {
      // Build dependency graph
      const graph = this.buildDependencyGraph(plan.contracts);

      // Deploy in dependency order
      for (const contractConfig of graph) {
        const { name, constructorArgs, dependsOn } = contractConfig;

        // Replace dependency placeholders in constructor args
        const resolvedArgs = this.resolveDependencies(
          constructorArgs || [],
          dependsOn || [],
          deployedAddresses
        );

        // Deploy contract
        const result = await this.deployContract({
          contractName: name,
          network: plan.network,
          constructorArgs: resolvedArgs,
          privateKey: plan.privateKey,
          fromAlias: plan.fromAlias,
          verify: plan.verify,
        });

        results.set(name, result);

        if (result.success && result.record) {
          deployedAddresses.set(name, result.record.contractAddress);
        } else {
          logger.error('Multi-contract deployment failed at contract', { name });
          break; // Stop deployment on first failure
        }
      }

      return results;
    } catch (error: any) {
      logger.error('Multi-contract deployment failed', { error: error.message });
      return results;
    }
  }

  /**
   * Build dependency graph (topological sort)
   */
  private buildDependencyGraph(
    contracts: DeploymentPlan['contracts']
  ): DeploymentPlan['contracts'] {
    // Simple topological sort based on dependsOn
    const sorted: typeof contracts = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected involving ${name}`);
      }

      visiting.add(name);

      const contract = contracts.find((c) => c.name === name);
      if (!contract) {
        throw new Error(`Contract ${name} not found in deployment plan`);
      }

      // Visit dependencies first
      if (contract.dependsOn) {
        for (const dep of contract.dependsOn) {
          visit(dep);
        }
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(contract);
    };

    // Visit all contracts
    for (const contract of contracts) {
      visit(contract.name);
    }

    return sorted;
  }

  /**
   * Resolve dependency placeholders in constructor args
   */
  private resolveDependencies(
    args: any[],
    _dependsOn: string[],
    deployedAddresses: Map<string, string>
  ): any[] {
    return args.map((arg) => {
      if (typeof arg === 'string' && arg.startsWith('$')) {
        const depName = arg.substring(1); // Remove '$' prefix
        const address = deployedAddresses.get(depName);
        if (!address) {
          throw new Error(`Dependency ${depName} not yet deployed`);
        }
        return address;
      }
      return arg;
    });
  }

  /**
   * Get deployment history
   */
  getDeploymentHistory(filters?: {
    network?: HederaNetwork;
    contractName?: string;
    status?: DeploymentStatus;
    limit?: number;
  }): DeploymentRecord[] {
    let filtered = [...this.deploymentHistory];

    if (filters?.network) {
      filtered = filtered.filter((r) => r.network === filters.network);
    }

    if (filters?.contractName) {
      filtered = filtered.filter((r) => r.contractName === filters.contractName);
    }

    if (filters?.status) {
      filtered = filtered.filter((r) => r.status === filters.status);
    }

    // Sort by most recent first
    filtered.sort((a, b) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime());

    if (filters?.limit) {
      filtered = filtered.slice(0, filters.limit);
    }

    return filtered;
  }

  /**
   * Get deployment by ID
   */
  getDeploymentById(id: string): DeploymentRecord | null {
    return this.deploymentHistory.find((r) => r.id === id) || null;
  }

  /**
   * Get deployment by contract address
   */
  getDeploymentByAddress(address: string, network: HederaNetwork): DeploymentRecord | null {
    return (
      this.deploymentHistory.find(
        (r) => r.contractAddress.toLowerCase() === address.toLowerCase() && r.network === network
      ) || null
    );
  }

  /**
   * Generate deployment ID
   */
  private generateDeploymentId(contractName: string, network: HederaNetwork): string {
    const timestamp = Date.now();
    return `${network}-${contractName}-${timestamp}`;
  }

  /**
   * Get RPC URL for network
   */
  private getRpcUrlForNetwork(network: HederaNetwork): string {
    const urls = {
      mainnet: 'https://mainnet.hashio.io/api',
      testnet: 'https://testnet.hashio.io/api',
      previewnet: 'https://previewnet.hashio.io/api',
    };
    return urls[network];
  }

  /**
   * Get private key for address book alias
   */
  private async getPrivateKeyForAlias(alias?: string): Promise<string | null> {
    if (!alias) return null;
    // TODO: Integrate with address book service
    return null;
  }

  /**
   * Generate deployment report
   */
  generateDeploymentReport(deploymentIds: string[]): string {
    const deployments = deploymentIds
      .map((id) => this.getDeploymentById(id))
      .filter((d) => d !== null);

    if (deployments.length === 0) {
      return 'No deployments found';
    }

    let report = '# Deployment Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n`;
    report += `Total Deployments: ${deployments.length}\n\n`;

    for (const deployment of deployments) {
      report += `## ${deployment.contractName}\n\n`;
      report += `- **Network:** ${deployment.network}\n`;
      report += `- **Address:** ${deployment.contractAddress}\n`;
      report += `- **Status:** ${deployment.status}\n`;
      report += `- **Transaction:** ${deployment.transactionHash}\n`;
      report += `- **Gas Used:** ${deployment.gasUsed}\n`;
      report += `- **Deployed At:** ${deployment.deployedAt}\n`;
      report += `- **Verification:** ${deployment.verificationStatus}\n`;
      if (deployment.hashScanUrl) {
        report += `- **HashScan:** ${deployment.hashScanUrl}\n`;
      }
      report += '\n';
    }

    return report;
  }
}

// Export singleton instance
export const deploymentService = new DeploymentService();
