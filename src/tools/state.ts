/**
 * State Tools
 * Server state management operations
 */

import { stateService } from '../services/state.js';
import { ToolResult } from '../types/index.js';
import logger from '../utils/logger.js';

/**
 * Backup server state
 */
export async function backupState(args: {
  outputPath?: string;
  includePrivateKeys?: boolean;
  filename?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Creating state backup', {
      includePrivateKeys: args.includePrivateKeys,
    });

    // Warning for including private keys
    if (args.includePrivateKeys) {
      logger.warn('⚠️  WARNING: Backup includes UNENCRYPTED private keys!');
      logger.warn('⚠️  Store this backup securely and never share it.');
    }

    const result = await stateService.backup(
      args.includePrivateKeys || false,
      args.outputPath,
      args.filename
    );

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'state_service',
        command: 'state backup',
      },
    };
  } catch (error) {
    logger.error('Failed to backup state', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Restore server state from backup
 */
export async function restoreState(args: {
  backupPath: string;
  merge?: boolean;
}): Promise<ToolResult> {
  try {
    logger.info('Restoring state from backup', {
      backupPath: args.backupPath,
      merge: args.merge,
    });

    const result = await stateService.restore(args.backupPath, args.merge || false);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'state_service',
        command: 'state restore',
      },
    };
  } catch (error) {
    logger.error('Failed to restore state', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Export server state
 */
export async function exportState(args: {
  outputPath?: string;
  format?: 'json' | 'compact' | 'pretty';
  includePrivateKeys?: boolean;
}): Promise<ToolResult> {
  try {
    logger.info('Exporting state', {
      outputPath: args.outputPath,
      format: args.format,
    });

    // Warning for including private keys
    if (args.includePrivateKeys) {
      logger.warn('⚠️  WARNING: Export includes UNENCRYPTED private keys!');
      logger.warn('⚠️  Store this export securely and never share it.');
    }

    const result = await stateService.export(
      args.outputPath,
      args.format || 'pretty',
      args.includePrivateKeys || false
    );

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'state_service',
        command: 'state export',
      },
    };
  } catch (error) {
    logger.error('Failed to export state', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get tool definitions for MCP server
 */
export const stateTools = [
  {
    name: 'state_backup',
    description:
      'Backup MCP server state including address book and network configuration. By default, excludes private keys for security. Creates timestamped backup file in backups/ directory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        outputPath: {
          type: 'string',
          description: 'Directory path to save backup file (default: ./backups/)',
        },
        includePrivateKeys: {
          type: 'boolean',
          description:
            'Include private keys in backup (WARNING: insecure, use with caution, default: false)',
          default: false,
        },
        filename: {
          type: 'string',
          description: 'Custom filename (default: auto-generated with timestamp)',
        },
      },
    },
  },
  {
    name: 'state_restore',
    description:
      'Restore MCP server state from a backup file. This will overwrite current address book and network settings unless merge mode is enabled.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        backupPath: {
          type: 'string',
          description: 'Path to backup file to restore from (absolute or relative)',
        },
        merge: {
          type: 'boolean',
          description:
            'Merge with existing state instead of replacing (default: false - replaces current state)',
          default: false,
        },
      },
      required: ['backupPath'],
    },
  },
  {
    name: 'state_export',
    description:
      'Export current server state to JSON format for inspection or external use. Similar to backup but optimized for readability and sharing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        outputPath: {
          type: 'string',
          description: 'Path to export file (absolute or relative)',
        },
        format: {
          type: 'string',
          enum: ['json', 'compact', 'pretty'],
          description:
            'Output format: json (standard), compact (minified), pretty (formatted, default)',
          default: 'pretty',
        },
        includePrivateKeys: {
          type: 'boolean',
          description: 'Include private keys in export (WARNING: insecure, default: false)',
          default: false,
        },
      },
      required: ['outputPath'],
    },
  },
];
