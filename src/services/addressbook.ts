/**
 * Address Book Service
 * Manages stored accounts with aliases and metadata
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { getDataDir, migrateLegacyFile } from '../utils/data-dir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AddressBookEntry {
  accountId: string;
  alias: string;
  nickname?: string;
  privateKey?: string; // DER-encoded, stored only if explicitly saved
  publicKey?: string;
  memo?: string;
  createdAt: string;
  updatedAt: string;
}

export class AddressBookService {
  private addressBookPath: string;
  private entries: Map<string, AddressBookEntry> = new Map();

  constructor() {
    // Address book lives under ~/.hedera-mcp (or HASHPILOT_DATA_DIR), never
    // inside the installed package, which is ephemeral under npx.
    this.addressBookPath = path.join(getDataDir(), 'addressbook.json');
  }

  /**
   * Initialize and load address book from disk
   */
  async initialize(): Promise<void> {
    try {
      await migrateLegacyFile(path.join(__dirname, '../../addressbook.json'), this.addressBookPath);
      const data = await fs.readFile(this.addressBookPath, 'utf-8');
      const entries: AddressBookEntry[] = JSON.parse(data);

      // Reload replaces what is in memory; without this a restore would merge
      // the restored entries into the ones already loaded.
      this.entries.clear();
      entries.forEach((entry) => {
        this.entries.set(entry.alias, entry);
      });

      logger.info('Address book loaded', { count: this.entries.size });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('Address book does not exist, creating new one');
        await this.save();
      } else {
        logger.error('Failed to load address book', { error });
        throw error;
      }
    }
  }

  /**
   * Save address book to disk
   */
  private async save(): Promise<void> {
    try {
      const entries = Array.from(this.entries.values());
      await fs.mkdir(path.dirname(this.addressBookPath), { recursive: true });
      await fs.writeFile(this.addressBookPath, JSON.stringify(entries, null, 2), 'utf-8');
      logger.info('Address book saved', { count: entries.length });
    } catch (error) {
      logger.error('Failed to save address book', { error });
      throw error;
    }
  }

  /**
   * Add account to address book
   */
  async add(entry: Omit<AddressBookEntry, 'createdAt' | 'updatedAt'>): Promise<void> {
    // Check if alias already exists
    if (this.entries.has(entry.alias)) {
      throw new Error(`Alias "${entry.alias}" already exists in address book`);
    }

    // Check if account ID already exists
    for (const existing of this.entries.values()) {
      if (existing.accountId === entry.accountId) {
        throw new Error(`Account ${entry.accountId} already exists with alias "${existing.alias}"`);
      }
    }

    const now = new Date().toISOString();
    const fullEntry: AddressBookEntry = {
      ...entry,
      createdAt: now,
      updatedAt: now,
    };

    this.entries.set(entry.alias, fullEntry);
    await this.save();

    logger.info('Account added to address book', {
      alias: entry.alias,
      accountId: entry.accountId,
    });
  }

  /**
   * Get account by alias
   */
  get(alias: string): AddressBookEntry | undefined {
    return this.entries.get(alias);
  }

  /**
   * Get account by account ID
   */
  getByAccountId(accountId: string): AddressBookEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.accountId === accountId) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * List all accounts
   */
  list(): AddressBookEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Replace the entire address book, in memory and on disk.
   *
   * Used by state restore in replace mode. Restoring must not merge with what
   * is already loaded, and must write to the configured data directory rather
   * than any legacy in-package path.
   */
  async replaceAll(entries: AddressBookEntry[]): Promise<void> {
    this.entries.clear();
    for (const entry of entries) {
      this.entries.set(entry.alias, entry);
    }
    await this.save();
    logger.info('Address book replaced', { count: this.entries.size, path: this.addressBookPath });
  }

  /**
   * Absolute path of the address book file (for diagnostics and backups)
   */
  getPath(): string {
    return this.addressBookPath;
  }

  /**
   * Remove account by alias
   */
  async remove(alias: string): Promise<void> {
    if (!this.entries.has(alias)) {
      throw new Error(`Alias "${alias}" not found in address book`);
    }

    this.entries.delete(alias);
    await this.save();

    logger.info('Account removed from address book', { alias });
  }

  /**
   * Update account entry
   */
  async update(
    alias: string,
    updates: Partial<Omit<AddressBookEntry, 'alias' | 'accountId' | 'createdAt' | 'updatedAt'>>
  ): Promise<void> {
    const entry = this.entries.get(alias);
    if (!entry) {
      throw new Error(`Alias "${alias}" not found in address book`);
    }

    const updatedEntry: AddressBookEntry = {
      ...entry,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.entries.set(alias, updatedEntry);
    await this.save();

    logger.info('Account updated in address book', { alias });
  }

  /**
   * Check if alias exists
   */
  has(alias: string): boolean {
    return this.entries.has(alias);
  }

  /**
   * Get total count
   */
  count(): number {
    return this.entries.size;
  }
}

// Export singleton instance
export const addressBook = new AddressBookService();
