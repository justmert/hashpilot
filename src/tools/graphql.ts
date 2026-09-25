/**
 * GraphQL over indexed Hedera Mirror Node data, through Hgraph.
 *
 * Covers writing, checking and running GraphQL queries: list what can be
 * queried, generate a query from the schema, validate a hand-written one, and
 * execute it. Read-only; mutations and subscriptions are refused.
 */

import { mirrorNodeService } from '../services/mirror-node-service.js';
import {
  describeEntity,
  executeQuery,
  generateQuery,
  GraphQLUsageError,
  listEntities,
  loadSchema,
  validateQuery,
} from '../services/hgraph-service.js';
import logger from '../utils/logger.js';
import { ToolResult } from '../types/index.js';

export const graphqlTool = {
  name: 'graphql',
  description: `Query indexed Hedera Mirror Node data with GraphQL, through Hgraph (mainnet and testnet). Read-only.

REQUIRES: HGRAPH_API_KEY (free at https://app.hgraph.com).

OPERATIONS:
- schema: list queryable entities (filter with "search"), or the fields and filters of one "entity"
- generate: build a query from "entity", "fields", "where", "orderBy", "limit" and "offset", validated against the schema; add "execute": true to run it
- validate: check a hand-written "query" against the schema without running it
- execute: run a read-only "query" with optional "variables"

Filters use Hasura syntax, e.g. where: {"entity_id": {"_eq": 98}}, orderBy: {"consensus_timestamp": "desc"}.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['schema', 'generate', 'validate', 'execute'],
        description: 'What to do',
      },
      query: { type: 'string', description: 'GraphQL query (validate, execute)' },
      variables: { type: 'object', description: 'Query variables (execute)' },
      entity: {
        type: 'string',
        description:
          'Entity to describe (schema) or query (generate), e.g. "transaction", "token", "nft"',
      },
      search: { type: 'string', description: 'Filter the entity list by name (schema)' },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Fields to select (generate). Defaults to the first 12 value fields',
      },
      where: { type: 'object', description: 'Hasura filter (generate)' },
      orderBy: {
        type: 'object',
        description: 'Sort, e.g. {"consensus_timestamp": "desc"} (generate)',
      },
      limit: { type: 'integer', description: 'Maximum rows (generate, default 10)' },
      offset: { type: 'integer', description: 'Rows to skip (generate)' },
      execute: { type: 'boolean', description: 'Run the generated query (generate)' },
      network: {
        type: 'string',
        enum: ['mainnet', 'testnet'],
        description: 'Network to query. Defaults to the current network',
      },
      refreshSchema: {
        type: 'boolean',
        description: 'Re-fetch the schema instead of using the cached copy',
      },
    },
    required: ['operation'],
  },
};

export async function graphqlManage(args: {
  operation: 'schema' | 'generate' | 'validate' | 'execute';
  query?: string;
  variables?: Record<string, unknown>;
  entity?: string;
  search?: string;
  fields?: string[];
  where?: Record<string, unknown>;
  orderBy?: Record<string, string>;
  limit?: number;
  offset?: number;
  execute?: boolean;
  network?: 'mainnet' | 'testnet';
  refreshSchema?: boolean;
}): Promise<ToolResult> {
  const network = args.network || mirrorNodeService.getCurrentNetwork();
  const metadata = { network, executedVia: 'hgraph_graphql' };

  try {
    switch (args.operation) {
      case 'schema': {
        const { schema, cachedAt, stale } = await loadSchema(network, {
          refresh: args.refreshSchema,
        });
        const data = args.entity
          ? describeEntity(schema, args.entity)
          : { entities: listEntities(schema, args.search) };
        return {
          success: true,
          data: { ...data, schemaCachedAt: cachedAt, ...(stale ? { staleSchema: true } : {}) },
          metadata,
        };
      }

      case 'validate': {
        if (!args.query) throw new GraphQLUsageError('operation "validate" requires query');
        const { schema } = await loadSchema(network, { refresh: args.refreshSchema });
        const problems = validateQuery(schema, args.query);
        return {
          success: true,
          data: problems.length ? { valid: false, problems } : { valid: true },
          metadata,
        };
      }

      case 'generate': {
        if (!args.entity) throw new GraphQLUsageError('operation "generate" requires entity');
        const { schema } = await loadSchema(network, { refresh: args.refreshSchema });
        const generated = generateQuery(schema, {
          entity: args.entity,
          fields: args.fields,
          where: args.where,
          orderBy: args.orderBy,
          limit: args.limit,
          offset: args.offset,
        });
        if (!args.execute) {
          return { success: true, data: generated, metadata };
        }
        const result = await executeQuery(network, generated.query, generated.variables);
        return { success: !result.errors?.length, data: { ...generated, result }, metadata };
      }

      case 'execute': {
        if (!args.query) throw new GraphQLUsageError('operation "execute" requires query');
        const result = await executeQuery(network, args.query, args.variables);
        return {
          success: !result.errors?.length,
          data: result,
          ...(result.errors?.length
            ? { error: result.errors.map((e) => e.message).join('; ') }
            : {}),
          metadata,
        };
      }

      default:
        throw new GraphQLUsageError(`Unknown operation: ${String(args.operation)}`);
    }
  } catch (error) {
    if (!(error instanceof GraphQLUsageError)) {
      logger.error('graphql failed', { operation: args.operation, error });
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata,
    };
  }
}
