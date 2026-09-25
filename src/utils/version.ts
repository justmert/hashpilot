/**
 * Single source of truth for the server version.
 *
 * Read from package.json so the MCP handshake, health_check, state backups
 * and exports can never disagree with what npm installed.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let cached: string | null = null;

export function getPackageVersion(): string {
  if (cached) return cached;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/utils/version.js and src/utils/version.ts are both two levels deep
    const pkg = JSON.parse(readFileSync(path.join(here, '..', '..', 'package.json'), 'utf-8')) as {
      version?: string;
    };
    cached = pkg.version || '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}
