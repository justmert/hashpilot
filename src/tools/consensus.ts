/**
 * Consensus (HCS) Tools
 * Hedera Consensus Service operations
 */

import {
  hederaClient,
  KEY_SPEC_SCHEMA,
  KeySpec,
  TopicMessageQueryOptions,
} from '../services/hedera-client.js';
import { addressBook } from '../services/addressbook.js';
import { advisoriesFor } from '../services/error-analyzer.js';
import { ToolResult } from '../types/index.js';
import logger from '../utils/logger.js';

export type { KeySpec, TopicMessageQueryOptions } from '../services/hedera-client.js';

/**
 * A topic key parameter: operator key (true), an explicit public key, or a
 * threshold key list for multi-signature control.
 */
export function topicKeySchema(purpose: string): Record<string, unknown> {
  return {
    ...KEY_SPEC_SCHEMA,
    description: `${purpose}. true = operator key, a public key string (DER or raw hex), or { threshold, keys } for a multi-signature key list.`,
  };
}

/**
 * Create a new HCS topic
 */
export async function createTopic(args: {
  memo?: string;
  adminKey?: KeySpec;
  submitKey?: KeySpec;
  autoRenewPeriod?: number;
  autoRenewAccountId?: string;
  signerPrivateKeys?: string[];
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
  adminKey?: KeySpec;
  submitKey?: KeySpec;
  clearAdminKey?: boolean;
  clearSubmitKey?: boolean;
  autoRenewPeriod?: number;
  autoRenewAccountId?: string;
  signerPrivateKeys?: string[];
}): Promise<ToolResult> {
  try {
    logger.info('Updating HCS topic', { topicId: args.topicId });

    if (!hederaClient.isReady()) {
      await hederaClient.initialize();
    }

    const result = await hederaClient.updateTopic(args.topicId, {
      memo: args.memo,
      adminKey: args.adminKey,
      submitKey: args.submitKey,
      clearAdminKey: args.clearAdminKey,
      clearSubmitKey: args.clearSubmitKey,
      autoRenewPeriod: args.autoRenewPeriod,
      autoRenewAccountId: args.autoRenewAccountId,
      signerPrivateKeys: args.signerPrivateKeys,
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
        advisories: advisoriesFor('hcs_message', { messageLength: args.message.length }),
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
export async function queryMessages(
  args: TopicMessageQueryOptions & { topicId: string }
): Promise<ToolResult> {
  try {
    logger.info('Querying topic messages', { topicId: args.topicId });

    // The mirror node is a free public REST API, so this works without an
    // operator. Initialise anyway to pick up a persisted network_switch, but
    // do not fail the query when there are no usable credentials.
    if (!hederaClient.isReady()) {
      try {
        await hederaClient.initialize();
      } catch (error) {
        logger.warn('Continuing without an initialised client for a mirror node query', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const result = await hederaClient.queryMessages(args.topicId, {
      sequenceNumber: args.sequenceNumber,
      sequenceNumberGt: args.sequenceNumberGt,
      sequenceNumberGte: args.sequenceNumberGte,
      sequenceNumberLt: args.sequenceNumberLt,
      sequenceNumberLte: args.sequenceNumberLte,
      timestamp: args.timestamp,
      timestampFrom: args.timestampFrom,
      timestampTo: args.timestampTo,
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
      'Create a new HCS (Hedera Consensus Service) topic. A topic with no submit key is public: anyone can submit. A topic with a submit key is private: only holders of that key can submit. Admin and submit keys each accept true (operator key), a public key string, or { threshold, keys } for multi-signature control.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        memo: {
          type: 'string',
          description: 'Optional topic memo (max 100 bytes)',
          maxLength: 100,
        },
        adminKey: { ...topicKeySchema('Admin key, allows topic updates and deletion') },
        submitKey: { ...topicKeySchema('Submit key, makes the topic private') },
        autoRenewPeriod: {
          type: 'number',
          description:
            'Auto-renew period in seconds (30-92 days, default: 90 days = 7776000 seconds)',
          minimum: 2592000,
          maximum: 8000001,
          default: 7776000,
        },
        autoRenewAccountId: {
          type: 'string',
          description: 'Account that pays the auto-renew fee (must sign; format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        signerPrivateKeys: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Extra private keys to sign with, needed when adminKey or autoRenewAccountId is not the operator',
        },
      },
    },
  },
  {
    name: 'topic_update',
    description:
      'Update an existing HCS topic. Requires the admin key set at creation. Can change the memo, the admin and submit keys, and the auto-renew settings. Use clearAdminKey or clearSubmitKey to remove a key (clearing the submit key makes a private topic public).',
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
        adminKey: { ...topicKeySchema('New admin key') },
        submitKey: { ...topicKeySchema('New submit key') },
        clearAdminKey: {
          type: 'boolean',
          description: 'Remove the admin key, making the topic immutable. Cannot be undone.',
        },
        clearSubmitKey: {
          type: 'boolean',
          description: 'Remove the submit key, making the topic public',
        },
        autoRenewPeriod: {
          type: 'number',
          description: 'New auto-renew period in seconds (30-92 days)',
          minimum: 2592000,
          maximum: 8000001,
        },
        autoRenewAccountId: {
          type: 'string',
          description: 'New auto-renew payer account (must sign; format: 0.0.xxxxx)',
          pattern: '^0\\.0\\.\\d+$',
        },
        signerPrivateKeys: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Extra private keys to sign with. A new admin key must also sign the update that sets it.',
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
      'Query historical messages from an HCS topic via the Mirror Node REST API (FREE, no operator needed). Messages are base64 decoded automatically. Filter by exact sequence number, by a sequence-number range, and by consensus timestamp. Note: sequenceNumber matches exactly; use sequenceNumberGte for "from this number onward".',
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
          description: 'Exact sequence number',
          minimum: 1,
        },
        sequenceNumberGt: {
          type: 'number',
          description: 'Sequence number greater than this value',
          minimum: 0,
        },
        sequenceNumberGte: {
          type: 'number',
          description: 'Sequence number greater than or equal to this value',
          minimum: 0,
        },
        sequenceNumberLt: {
          type: 'number',
          description: 'Sequence number less than this value',
          minimum: 1,
        },
        sequenceNumberLte: {
          type: 'number',
          description: 'Sequence number less than or equal to this value',
          minimum: 1,
        },
        timestamp: {
          type: 'string',
          description:
            'Raw consensus timestamp filter, e.g. "1700000000.000000000" or "gte:1700000000.000000000"',
        },
        timestampFrom: {
          type: 'string',
          description: 'Consensus timestamp lower bound, inclusive (seconds.nanoseconds)',
        },
        timestampTo: {
          type: 'string',
          description: 'Consensus timestamp upper bound, inclusive (seconds.nanoseconds)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return (1-100, mirror node default: 25)',
          minimum: 1,
          maximum: 100,
        },
        order: {
          type: 'string',
          description: 'Sort order (asc or desc, default: asc)',
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
