/**
 * Consensus (HCS) Tools
 * Hedera Consensus Service operations
 */

import { hederaClient } from '../services/hedera-client.js';
import { addressBook } from '../services/addressbook.js';
import { ToolResult } from '../types/index.js';
import logger from '../utils/logger.js';

/**
 * Create a new HCS topic
 */
export async function createTopic(args: {
  memo?: string;
  adminKey?: boolean;
  submitKey?: boolean;
  autoRenewPeriod?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Creating HCS topic', { memo: args.memo });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.createTopic(args);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'topic create',
      },
    };
  } catch (error) {
    logger.error('Failed to create topic', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Update an existing HCS topic
 */
export async function updateTopic(args: {
  topicId: string;
  memo?: string;
  autoRenewPeriod?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Updating HCS topic', { topicId: args.topicId });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.updateTopic(args.topicId, {
      memo: args.memo,
      autoRenewPeriod: args.autoRenewPeriod,
    });

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'topic update',
      },
    };
  } catch (error) {
    logger.error('Failed to update topic', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Submit a message to an HCS topic
 */
export async function submitMessage(args: {
  topicId: string;
  message: string;
  submitKey?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Submitting message to topic', {
      topicId: args.topicId,
      messageLength: args.message.length,
    });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    // Try to get submit key from address book if not provided
    let submitKey = args.submitKey;
    if (!submitKey && addressBook.count() > 0) {
      // Check if operator account has a submit key in address book
      const client = hederaClient.getClient();
      const operatorId = client.operatorAccountId?.toString();
      if (operatorId) {
        const entries = addressBook.list();
        const entry = entries.find((e) => e.accountId === operatorId);
        if (entry?.privateKey) {
          submitKey = entry.privateKey;
          logger.info('Using submit key from address book');
        }
      }
    }

    const result = await hederaClient.submitMessage(args.topicId, args.message, submitKey);

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'message submit',
      },
    };
  } catch (error) {
    logger.error('Failed to submit message', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query messages from an HCS topic via Mirror Node
 */
export async function queryMessages(args: {
  topicId: string;
  sequenceNumber?: number;
  limit?: number;
  order?: 'asc' | 'desc';
}): Promise<ToolResult> {
  try {
    logger.info('Querying topic messages', { topicId: args.topicId });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.queryMessages(args.topicId, {
      sequenceNumber: args.sequenceNumber,
      limit: args.limit,
      order: args.order,
    });

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'mirror_node',
        command: 'message query',
      },
    };
  } catch (error) {
    logger.error('Failed to query messages', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Subscribe to topic messages (returns subscription acknowledgment)
 */
export async function subscribeToTopic(args: {
  topicId: string;
  startTime?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Subscribing to topic', { topicId: args.topicId });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const startTime = args.startTime ? new Date(args.startTime) : undefined;

    const result = await hederaClient.subscribeToTopic(args.topicId, {
      startTime,
    });

    return {
      success: true,
      data: result,
      metadata: {
        executedVia: 'sdk',
        command: 'topic subscribe',
      },
    };
  } catch (error) {
    logger.error('Failed to subscribe to topic', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get tool definitions for MCP server
 */
export const consensusTools = [
  {
    name: 'topic_create',
    description:
      'Create a new HCS (Hedera Consensus Service) topic for publishing messages. Topics can be public (anyone can submit) or private (requires submit key). Admin and submit keys use operator key when enabled.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        memo: {
          type: 'string',
          description: 'Optional topic memo (max 100 bytes)',
          maxLength: 100,
        },
        adminKey: {
          type: 'boolean',
          description: 'Enable admin key for topic updates/deletion (default: false)',
          default: false,
        },
        submitKey: {
          type: 'boolean',
          description:
            'Enable submit key for private topic - only key holders can submit messages (default: false)',
          default: false,
        },
        autoRenewPeriod: {
          type: 'number',
          description:
            'Auto-renew period in seconds (30-92 days, default: 90 days = 7776000 seconds)',
          minimum: 2592000,
          maximum: 8000001,
          default: 7776000,
        },
      },
    },
  },
  {
    name: 'topic_update',
    description:
      'Update an existing HCS topic. Requires admin key to be set on the topic during creation. Can update memo and auto-renew period.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        topicId: {
          type: 'string',
          description: 'Topic ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        memo: {
          type: 'string',
          description: 'New topic memo (max 100 bytes)',
          maxLength: 100,
        },
        autoRenewPeriod: {
          type: 'number',
          description: 'New auto-renew period in seconds (30-92 days)',
          minimum: 2592000,
          maximum: 8000001,
        },
      },
      required: ['topicId'],
    },
  },
  {
    name: 'message_submit',
    description:
      'Submit a message to an HCS topic. Messages up to 1KB are sent as single chunk. Larger messages automatically split into chunks (max 20). For private topics, provide submitKey or ensure operator key is in address book.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        topicId: {
          type: 'string',
          description: 'Topic ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        message: {
          type: 'string',
          description: 'Message content (automatically chunked if > 1KB)',
        },
        submitKey: {
          type: 'string',
          description:
            'Optional: Submit key for private topics (DER-encoded). If not provided, will try address book.',
        },
      },
      required: ['topicId', 'message'],
    },
  },
  {
    name: 'message_query',
    description:
      'Query historical messages from an HCS topic via Mirror Node REST API (FREE). Messages are base64 decoded automatically. Returns messages with timestamps and sequence numbers.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        topicId: {
          type: 'string',
          description: 'Topic ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        sequenceNumber: {
          type: 'number',
          description: 'Optional: Filter messages with sequence number >= this value',
          minimum: 1,
        },
        limit: {
          type: 'number',
          description: 'Optional: Maximum number of messages to return (default: 10)',
          minimum: 1,
          maximum: 100,
          default: 10,
        },
        order: {
          type: 'string',
          description: 'Optional: Sort order (asc or desc, default: asc)',
          enum: ['asc', 'desc'],
          default: 'asc',
        },
      },
      required: ['topicId'],
    },
  },
  {
    name: 'topic_subscribe',
    description:
      'Subscribe to real-time messages from an HCS topic. Returns a subscription acknowledgment. For actual message retrieval, use message_query tool to fetch historical messages.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        topicId: {
          type: 'string',
          description: 'Topic ID (format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        startTime: {
          type: 'string',
          description: 'Optional: ISO 8601 timestamp to start receiving messages from',
        },
      },
      required: ['topicId'],
    },
  },
];
