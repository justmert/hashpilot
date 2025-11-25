/**
 * Hedera CLI Wrapper Service
 * Executes Hedera CLI commands and falls back to SDK operations
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../utils/logger.js';
import { hederaClient } from './hedera-client.js';
import { ToolResult } from '../types/index.js';

const execAsync = promisify(exec);

export interface CLICommandOptions {
  command: string;
  args?: Record<string, string | number | boolean>;
  useSdk?: boolean; // Force SDK usage instead of CLI
}

export class HederaCLIService {
  private cliAvailable: boolean | null = null;
  private cliCommand = 'hedera'; // or 'hiero' for new CLI

  /**
   * Check if Hedera CLI is installed and available
   */
  async checkCLIAvailability(): Promise<boolean> {
    if (this.cliAvailable !== null) {
      return this.cliAvailable;
    }

    try {
      await execAsync(`${this.cliCommand} --version`);
      this.cliAvailable = true;
      logger.info('Hedera CLI is available');
      return true;
    } catch (error) {
      // Try hiero CLI
      try {
        this.cliCommand = 'hiero';
        await execAsync(`${this.cliCommand} --version`);
        this.cliAvailable = true;
        logger.info('Hiero CLI is available');
        return true;
      } catch {
        this.cliAvailable = false;
        logger.warn('Neither Hedera nor Hiero CLI is available, will use SDK fallbacks');
        return false;
      }
    }
  }

  /**
   * Execute a CLI command or fallback to SDK
   */
  async executeCommand(options: CLICommandOptions): Promise<ToolResult> {
    try {
      // Check if we should use SDK directly
      if (options.useSdk || !(await this.checkCLIAvailability())) {
        return await this.executeSdkFallback(options);
      }

      // Build CLI command string
      const cmdString = this.buildCommandString(options);
      logger.info('Executing CLI command', { command: cmdString });

      // Execute CLI command
      const { stdout, stderr } = await execAsync(cmdString, {
        timeout: 30000, // 30 second timeout
      });

      if (stderr && !stderr.includes('warn')) {
        logger.warn('CLI command stderr', { stderr });
      }

      // Parse output
      const result = this.parseCliOutput(stdout);

      return {
        success: true,
        data: result,
        metadata: {
          executedVia: 'cli',
          command: cmdString,
        },
      };
    } catch (error) {
      logger.error('CLI command failed, attempting SDK fallback', { error });
      // Fallback to SDK if CLI fails
      return await this.executeSdkFallback(options);
    }
  }

  /**
   * Build CLI command string from options
   */
  private buildCommandString(options: CLICommandOptions): string {
    let cmd = `${this.cliCommand} ${options.command}`;

    if (options.args) {
      for (const [key, value] of Object.entries(options.args)) {
        if (value !== undefined && value !== null) {
          // Convert camelCase to kebab-case
          const argName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
          cmd += ` --${argName} ${value}`;
        }
      }
    }

    // Add JSON output format
    cmd += ' --json';

    return cmd;
  }

  /**
   * Parse CLI JSON output
   */
  private parseCliOutput(output: string): unknown {
    try {
      // CLI outputs JSON by default with --json flag
      return JSON.parse(output);
    } catch {
      // If not JSON, return raw output
      return { output: output.trim() };
    }
  }

  /**
   * Execute operation using SDK as fallback
   */
  private async executeSdkFallback(options: CLICommandOptions): Promise<ToolResult> {
    logger.info('Executing SDK fallback', { command: options.command });

    try {
      // Ensure Hedera client is initialized
      if (!hederaClient.isReady()) {
        await hederaClient.initialize();
      }

      // Route to appropriate SDK method based on command
      const result = await this.routeToSdkMethod(options);

      return {
        success: true,
        data: result,
        metadata: {
          executedVia: 'sdk',
          command: options.command,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          executedVia: 'sdk_failed',
          command: options.command,
        },
      };
    }
  }

  /**
   * Route command to appropriate SDK method
   */
  private async routeToSdkMethod(options: CLICommandOptions): Promise<unknown> {
    const { command, args = {} } = options;

    // Account commands
    if (command.startsWith('account')) {
      return this.handleAccountCommand(command, args);
    }

    // Transfer commands (HBAR transfers)
    if (command.startsWith('transfer')) {
      return this.handleAccountCommand(command, args);
    }

    // Token commands
    if (command.startsWith('token')) {
      return this.handleTokenCommand(command, args);
    }

    // Topic/HCS commands
    if (command.startsWith('topic') || command.startsWith('message')) {
      return this.handleTopicCommand(command, args);
    }

    // Network commands
    if (command.startsWith('network')) {
      return this.handleNetworkCommand(command, args);
    }

    throw new Error(`Unsupported command: ${command}`);
  }

  /**
   * Handle account-related commands
   */
  private async handleAccountCommand(
    command: string,
    args: Record<string, string | number | boolean>
  ): Promise<unknown> {
    switch (command) {
      case 'account balance': {
        if (!args.accountId || typeof args.accountId !== 'string') {
          throw new Error('accountId is required');
        }
        return await hederaClient.getAccountBalance(args.accountId);
      }

      case 'account info': {
        if (!args.accountId || typeof args.accountId !== 'string') {
          throw new Error('accountId is required');
        }
        return await hederaClient.getAccountInfo(args.accountId);
      }

      case 'transfer hbar': {
        if (!args.from || typeof args.from !== 'string') {
          throw new Error('from account is required');
        }
        if (!args.to || typeof args.to !== 'string') {
          throw new Error('to account is required');
        }
        if (args.amount === undefined || typeof args.amount !== 'number') {
          throw new Error('amount is required');
        }
        return await hederaClient.transferHbar(args.from, args.to, args.amount);
      }

      case 'account create': {
        const initialBalance = typeof args.initialBalance === 'number' ? args.initialBalance : 1;
        const memo = typeof args.memo === 'string' ? args.memo : undefined;
        const publicKey = typeof args.publicKey === 'string' ? args.publicKey : undefined;
        return await hederaClient.createAccount({ initialBalance, memo, publicKey });
      }

      default:
        throw new Error(`Unsupported account command: ${command}`);
    }
  }

  /**
   * Handle token-related commands
   */
  private async handleTokenCommand(
    command: string,
    _args: Record<string, string | number | boolean>
  ): Promise<unknown> {
    // Token operations will be implemented in Phase 1.3
    throw new Error(`Token command not yet implemented: ${command}`);
  }

  /**
   * Handle topic/HCS-related commands
   */
  private async handleTopicCommand(
    command: string,
    _args: Record<string, string | number | boolean>
  ): Promise<unknown> {
    // HCS operations will be implemented in Phase 1.4
    throw new Error(`Topic command not yet implemented: ${command}`);
  }

  /**
   * Handle network-related commands
   */
  private async handleNetworkCommand(
    command: string,
    args: Record<string, string | number | boolean>
  ): Promise<unknown> {
    switch (command) {
      case 'network current':
        return {
          network: hederaClient.getCurrentNetwork(),
          mirrorNode: hederaClient.getMirrorNodeUrl(),
          jsonRpcRelay: hederaClient.getJsonRpcRelayUrl(),
        };

      case 'network use': {
        if (!args.network || typeof args.network !== 'string') {
          throw new Error('network is required');
        }
        const network = args.network as 'mainnet' | 'testnet' | 'previewnet' | 'local';
        await hederaClient.switchNetwork(network);
        return {
          network,
          message: `Switched to ${network}`,
        };
      }

      default:
        throw new Error(`Unsupported network command: ${command}`);
    }
  }
}

// Export singleton instance
export const hederaCLI = new HederaCLIService();
