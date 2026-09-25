/**
 * State Service
 * Manages server state including network configuration and backup/restore
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { addressBook, AddressBookEntry } from './addressbook.js';
import { getDataDir, migrateLegacyFile } from '../utils/data-dir.js';
import { getPackageVersion } from '../utils/version.js';
import { SUPPORTED_NETWORKS, isSupportedNetwork } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerState {
  network: 'mainnet' | 'testnet' | 'previewnet' | 'local';
  lastUpdated: string;
}

export interface StateBackup {
  version: string;
  timestamp: string;
  serverVersion: string;
  backup: {
    addressBook: Array<Omit<AddressBookEntry, 'privateKey'> & { hasPrivateKey: boolean }>;
    network: {
      current: string;
      mirrorNodeUrl?: string;
      jsonRpcRelayUrl?: string;
    };
    settings: {
      logLevel: string;
    };
  };
}

export interface StateBackupWithKeys extends StateBackup {
  backup: StateBackup['backup'] & {
    addressBook: AddressBookEntry[];
  };
}

export class StateService {
  private statePath: string;
  private backupDir: string;
  private currentState: ServerState | null = null;

  constructor() {
    // State lives under ~/.hedera-mcp (or HASHPILOT_DATA_DIR), never inside the
    // installed package, which is ephemeral under npx.
    this.statePath = path.join(getDataDir(), 'state.json');
    this.backupDir = path.join(getDataDir(), 'backups');
  }

  /**
   * Initialize and load state from disk
   */
  async initialize(): Promise<void> {
    try {
      await migrateLegacyFile(path.join(__dirname, '../../state.json'), this.statePath);
      const data = await fs.readFile(this.statePath, 'utf-8');
      this.currentState = JSON.parse(data);
      logger.info('State loaded', { network: this.currentState?.network });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('State file does not exist, will create on first save');
        this.currentState = null;
      } else {
        logger.error('Failed to load state', { error });
        throw error;
      }
    }
  }

  /**
   * Save current state to disk
   */
  async save(state: ServerState): Promise<void> {
    try {
      const data = JSON.stringify(state, null, 2);
      await fs.mkdir(path.dirname(this.statePath), { recursive: true });
      await fs.writeFile(this.statePath, data, 'utf-8');
      this.currentState = state;
      logger.info('State saved', { network: state.network });
    } catch (error) {
      logger.error('Failed to save state', { error });
      throw error;
    }
  }

  /**
   * Get current state
   */
  getState(): ServerState | null {
    return this.currentState;
  }

  /**
   * Save network configuration
   */
  async saveNetworkState(network: 'mainnet' | 'testnet' | 'previewnet' | 'local'): Promise<void> {
    // Never write a network name the server cannot load again
    if (!isSupportedNetwork(network)) {
      throw new Error(
        `Unknown network: ${String(network)}. Supported networks: ${SUPPORTED_NETWORKS.join(', ')}`
      );
    }

    const state: ServerState = {
      network,
      lastUpdated: new Date().toISOString(),
    };
    await this.save(state);
  }

  /**
   * Load network configuration
   */
  async loadNetworkState(): Promise<'mainnet' | 'testnet' | 'previewnet' | 'local' | null> {
    if (!this.currentState) {
      await this.initialize();
    }
    return this.currentState?.network || null;
  }

  /**
   * Create a backup of current state
   */
  async backup(
    includePrivateKeys: boolean = false,
    outputPath?: string,
    filename?: string
  ): Promise<{ filePath: string; itemCount: number; warning?: string }> {
    try {
      // Ensure backup directory exists
      await fs.mkdir(this.backupDir, { recursive: true });

      // Get address book entries
      const entries = addressBook.list();

      // Prepare address book data
      const addressBookData = entries.map((entry) => {
        if (includePrivateKeys) {
          return entry;
        } else {
          const { privateKey, ...rest } = entry;
          return {
            ...rest,
            hasPrivateKey: !!privateKey,
          };
        }
      });

      // Create backup object
      const backup: StateBackup | StateBackupWithKeys = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        serverVersion: getPackageVersion(),
        backup: {
          addressBook: addressBookData as any,
          network: {
            current: this.currentState?.network || 'testnet',
          },
          settings: {
            logLevel: process.env.LOG_LEVEL || 'info',
          },
        },
      };

      // Generate filename (an explicit `filename` wins, then outputPath)
      const timestamp = new Date()
        .toISOString()
        .replace(/:/g, '-')
        .replace(/\..+/, '')
        .replace('T', '-');
      const chosenName = filename?.trim()
        ? filename.trim().endsWith('.json')
          ? filename.trim()
          : `${filename.trim()}.json`
        : `hashpilot-state-backup-${timestamp}.json`;
      const outputDir = outputPath || this.backupDir;
      const filePath = path.join(outputDir, chosenName);

      // Write backup file
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const data = JSON.stringify(backup, null, 2);
      await fs.writeFile(filePath, data, 'utf-8');

      logger.info('Backup created', { filePath, includePrivateKeys });

      let warning: string | undefined;
      if (!includePrivateKeys && entries.some((e) => e.privateKey)) {
        warning =
          'Private keys were excluded from backup for security. Re-import accounts with private keys after restore.';
      }

      return {
        filePath,
        itemCount: entries.length,
        warning,
      };
    } catch (error) {
      logger.error('Failed to create backup', { error });
      throw error;
    }
  }

  /**
   * Restore state from a backup file
   */
  async restore(
    backupPath: string,
    merge: boolean = false
  ): Promise<{ restoredItems: number; warnings: string[] }> {
    try {
      // Read backup file
      const data = await fs.readFile(backupPath, 'utf-8');
      const backup: StateBackup | StateBackupWithKeys = JSON.parse(data);

      // Validate backup format
      if (!backup.version || !backup.backup) {
        throw new Error('Invalid backup format: missing required fields');
      }

      // Check version compatibility
      if (backup.version !== '1.0.0') {
        throw new Error(`Incompatible backup version: ${backup.version}`);
      }

      const warnings: string[] = [];

      // Restore address book
      if (backup.backup.addressBook) {
        if (merge) {
          // Initialize address book if needed
          if (addressBook.count() === 0) {
            await addressBook.initialize();
          }

          // Merge entries
          for (const entry of backup.backup.addressBook) {
            const fullEntry: AddressBookEntry = {
              accountId: entry.accountId,
              alias: entry.alias,
              nickname: entry.nickname,
              publicKey: entry.publicKey,
              memo: entry.memo,
              createdAt: entry.createdAt,
              updatedAt: new Date().toISOString(),
              privateKey: 'privateKey' in entry ? entry.privateKey : undefined,
            };

            await addressBook.add(fullEntry);
          }
        } else {
          // Replace the entire address book through the service, so it writes
          // to the configured data directory and resets what is in memory.
          const entries: AddressBookEntry[] = backup.backup.addressBook.map((entry) => ({
            accountId: entry.accountId,
            alias: entry.alias,
            nickname: entry.nickname,
            publicKey: entry.publicKey as string | undefined,
            memo: entry.memo,
            createdAt: entry.createdAt,
            updatedAt: new Date().toISOString(),
            privateKey: ('privateKey' in entry ? entry.privateKey : undefined) as
              string | undefined,
          }));

          await addressBook.replaceAll(entries);
        }

        // Check for missing private keys
        const missingKeys = backup.backup.addressBook.filter(
          (e: any) => e.hasPrivateKey && !('privateKey' in e)
        );
        if (missingKeys.length > 0) {
          warnings.push(
            `${missingKeys.length} account(s) had private keys in original backup but were excluded for security. Re-import these accounts with private keys if needed.`
          );
        }
      }

      // Restore network configuration. The backup file is arbitrary JSON from
      // disk, so an unrecognised network is skipped with a warning rather than
      // written through or failing the whole restore.
      if (backup.backup.network?.current) {
        const network = backup.backup.network.current;
        if (isSupportedNetwork(network)) {
          await this.saveNetworkState(network);
        } else {
          logger.warn('Skipping unsupported network in backup', { network });
        }
      }

      logger.info('State restored from backup', {
        backupPath,
        itemCount: backup.backup.addressBook?.length || 0,
      });

      return {
        restoredItems: backup.backup.addressBook?.length || 0,
        warnings,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Backup file not found: ${backupPath}`);
      }

      if (error instanceof SyntaxError) {
        throw new Error('Corrupted backup file: invalid JSON');
      }

      logger.error('Failed to restore state', { error });
      throw error;
    }
  }

  /**
   * Export current state to JSON
   */
  async export(
    outputPath?: string,
    format: 'json' | 'compact' | 'pretty' = 'pretty',
    includePrivateKeys: boolean = false
  ): Promise<{ filePath: string; size: number }> {
    try {
      if (!outputPath) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        outputPath = path.join(getDataDir(), 'exports', `state-export-${stamp}.json`);
      }
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      // Get address book entries
      const entries = addressBook.list();

      // Prepare address book data
      const addressBookData = entries.map((entry) => {
        if (includePrivateKeys) {
          return entry;
        } else {
          const { privateKey, ...rest } = entry;
          return {
            ...rest,
            hasPrivateKey: !!privateKey,
          };
        }
      });

      // Create export object
      const exportData = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        serverVersion: getPackageVersion(),
        data: {
          addressBook: addressBookData,
          network: {
            current: this.currentState?.network || 'testnet',
          },
          settings: {
            logLevel: process.env.LOG_LEVEL || 'info',
          },
        },
      };

      // Format based on option
      let data: string;
      switch (format) {
        case 'compact':
          data = JSON.stringify(exportData);
          break;
        case 'json':
          data = JSON.stringify(exportData, null, 0);
          break;
        case 'pretty':
        default:
          data = JSON.stringify(exportData, null, 2);
          break;
      }

      // Write export file
      await fs.writeFile(outputPath, data, 'utf-8');

      logger.info('State exported', { outputPath, format });

      return {
        filePath: outputPath,
        size: Buffer.byteLength(data, 'utf-8'),
      };
    } catch (error) {
      logger.error('Failed to export state', { error });
      throw error;
    }
  }
}

// Export singleton instance
export const stateService = new StateService();
