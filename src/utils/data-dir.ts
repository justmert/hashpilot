/**
 * Data directory for HashPilot's persistent files
 *
 * Address book, network state, backups, exports and deployment history all
 * live under one directory outside the installed package, so they survive
 * npx reinstalls and version upgrades.
 *
 * Default: ~/.hedera-mcp
 * Override: HASHPILOT_DATA_DIR
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import logger from './logger.js';

export function getDataDir(): string {
  const override = process.env.HASHPILOT_DATA_DIR;
  if (override && override.trim()) {
    return path.resolve(override.trim());
  }
  return path.join(os.homedir(), '.hedera-mcp');
}

/**
 * Copy a file from the legacy in-package location to the data directory,
 * once. Silently does nothing when there is no legacy file or the target
 * already exists.
 */
export async function migrateLegacyFile(legacyPath: string, targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return false; // already migrated (or freshly created)
  } catch {
    // target missing, continue
  }

  try {
    await fs.access(legacyPath);
  } catch {
    return false; // nothing to migrate
  }

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(legacyPath, targetPath);
    logger.info('Migrated legacy data file', { from: legacyPath, to: targetPath });
    return true;
  } catch (error) {
    logger.warn('Could not migrate legacy data file', {
      from: legacyPath,
      to: targetPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
