/**
 * GraphQL access to indexed Hedera data through Hgraph.
 *
 * Hedera's public Mirror Nodes expose only the REST API; the GraphQL API over
 * the same Mirror Node data is Hgraph's (hedera.hgraph.com), which needs an API
 * key with a free tier. The schema is standard Hasura: every entity takes
 * `where`, `order_by`, `limit`, `offset` and `distinct_on`, which is what makes
 * generating queries from the schema dependable.
 *
 * The introspected schema is cached per network in the data directory, in the
 * same `{ timestamp, schema }` shape the file has always used.
 */

import fs from 'fs/promises';
import path from 'path';
import {
  buildClientSchema,
  getIntrospectionQuery,
  getNamedType,
  isEnumType,
  isObjectType,
  isScalarType,
  parse,
  validate,
  GraphQLField,
  GraphQLSchema,
  IntrospectionQuery,
} from 'graphql';
import logger from '../utils/logger.js';
import { getDataDir } from '../utils/data-dir.js';

export const HGRAPH_ENDPOINTS: Record<string, string> = {
  mainnet: 'https://hedera.hgraph.com/v1/graphql',
  testnet: 'https://hedera-testnet.hgraph.com/v1/graphql',
};

const SCHEMA_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Largest result handed back to an MCP client in one response */
export const MAX_RESULT_CHARS = 50_000;
const DEFAULT_FIELD_COUNT = 12;

const KEY_HELP =
  'Set HGRAPH_API_KEY in the MCP server configuration. Hgraph provides a free key at https://app.hgraph.com';

/** A problem the caller can fix: missing key, unsupported network, bad input */
export class GraphQLUsageError extends Error {}

/** Endpoint for a network, or GRAPHQL_ENDPOINT when set */
export function resolveEndpoint(network: string): string {
  const override = process.env.GRAPHQL_ENDPOINT;
  if (override) return override;

  const endpoint = HGRAPH_ENDPOINTS[network];
  if (!endpoint) {
    throw new GraphQLUsageError(
      `GraphQL is available for mainnet and testnet only; the current network is ${network}. ` +
        'Pass network: "testnet" or "mainnet", or set GRAPHQL_ENDPOINT to your own endpoint.'
    );
  }
  return endpoint;
}

function requireApiKey(): string {
  const key = process.env.HGRAPH_API_KEY;
  if (!key) {
    throw new GraphQLUsageError(`No GraphQL API key is configured. ${KEY_HELP}`);
  }
  return key;
}

/**
 * JSON.parse that keeps integers too large for a JavaScript number exact.
 *
 * Hgraph returns nanosecond timestamps and large IDs as bare JSON numbers
 * (1790254349306634009); JSON.parse rounds anything beyond 2^53, so that came
 * back as 1790254349306634000, a different transaction. Such integers are
 * quoted before parsing and arrive as exact decimal strings. The scan tracks
 * string state, so digits inside strings such as memos are never touched.
 */
export function parseJsonPreservingIntegers(text: string): any {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1;
      while (j < text.length && /[0-9.eE+-]/.test(text[j])) j++;
      const token = text.slice(i, j);
      const isInteger = /^-?\d+$/.test(token);
      out += isInteger && !Number.isSafeInteger(Number(token)) ? `"${token}"` : token;
      i = j - 1;
      continue;
    }

    out += ch;
  }

  return JSON.parse(out);
}

/**
 * POST a GraphQL request, waiting out the rate limit.
 *
 * Hgraph's free plan allows one request per second, and an MCP client often
 * issues several calls at once: in a burst of six, four were refused, and
 * retrying them in parallel only collided again. Requests are therefore sent
 * one at a time, and a rate-limited one is retried after a short wait.
 */
let requestQueue: Promise<unknown> = Promise.resolve();

function post(endpoint: string, body: object): Promise<any> {
  const run = requestQueue.then(() => postWithRetry(endpoint, body));
  requestQueue = run.catch(() => undefined);
  return run;
}

async function postWithRetry(endpoint: string, body: object): Promise<any> {
  const waits = [1100, 2200, 3300];
  for (let attempt = 0; ; attempt++) {
    try {
      return await postOnce(endpoint, body);
    } catch (error) {
      if (!(error instanceof RateLimitError) || attempt >= waits.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, waits[attempt]));
    }
  }
}

class RateLimitError extends GraphQLUsageError {}

/** POST a GraphQL request once and return the parsed body */
async function postOnce(endpoint: string, body: object): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': requireApiKey(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new GraphQLUsageError(
        `Hgraph rejected the API key (HTTP ${response.status}). ${KEY_HELP}`
      );
    }
    if (response.status === 429) {
      throw new RateLimitError(
        'Hgraph rate limit reached (the free plan allows 1 request per second). Wait a moment and retry.'
      );
    }

    const text = await response.text();
    let json: any;
    try {
      json = parseJsonPreservingIntegers(text);
    } catch {
      throw new Error(`Hgraph returned HTTP ${response.status} with a non-JSON body`);
    }
    if (!response.ok && !json?.errors) {
      throw new Error(`Hgraph returned HTTP ${response.status}`);
    }
    return json;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Hgraph did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ==================== Schema ====================

function schemaCachePath(network: string): string {
  return path.join(getDataDir(), `${network}-graphql-schema.json`);
}

async function readCachedIntrospection(
  network: string
): Promise<{ introspection: IntrospectionQuery; timestamp: number } | null> {
  try {
    const cached = JSON.parse(await fs.readFile(schemaCachePath(network), 'utf-8'));
    if (cached?.schema?.__schema && typeof cached.timestamp === 'number') {
      return { introspection: cached.schema, timestamp: cached.timestamp };
    }
  } catch {
    // no cache yet
  }
  return null;
}

/**
 * The GraphQL schema for a network. A fresh cache is used as is; otherwise the
 * schema is introspected, and a stale cache is used only if that fails.
 */
export async function loadSchema(
  network: string,
  options: { refresh?: boolean } = {}
): Promise<{ schema: GraphQLSchema; cachedAt: string; stale: boolean }> {
  const cached = await readCachedIntrospection(network);
  const fresh = cached && Date.now() - cached.timestamp < SCHEMA_TTL_MS;

  if (cached && fresh && !options.refresh) {
    return {
      schema: buildClientSchema(cached.introspection),
      cachedAt: new Date(cached.timestamp).toISOString(),
      stale: false,
    };
  }

  try {
    const result = await post(resolveEndpoint(network), { query: getIntrospectionQuery() });
    if (!result?.data?.__schema) {
      throw new Error(result?.errors?.[0]?.message || 'Introspection returned no schema');
    }

    const timestamp = Date.now();
    await fs.mkdir(getDataDir(), { recursive: true });
    await fs.writeFile(
      schemaCachePath(network),
      JSON.stringify({ timestamp, schema: result.data })
    );

    return {
      schema: buildClientSchema(result.data),
      cachedAt: new Date(timestamp).toISOString(),
      stale: false,
    };
  } catch (error) {
    if (cached) {
      logger.warn('Using a stale GraphQL schema cache', {
        network,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        schema: buildClientSchema(cached.introspection),
        cachedAt: new Date(cached.timestamp).toISOString(),
        stale: true,
      };
    }
    throw error;
  }
}

/** Root query fields, without Hasura's `_aggregate` and `_by_pk` variants unless asked */
function rootFields(schema: GraphQLSchema): Record<string, GraphQLField<any, any>> {
  return schema.getQueryType()?.getFields() ?? {};
}

function typeLabel(field: GraphQLField<any, any>): string {
  return String(field.type);
}

/** List queryable entities, optionally filtered by a search term */
export function listEntities(
  schema: GraphQLSchema,
  search?: string
): Array<{ entity: string; description?: string }> {
  const term = search?.toLowerCase();
  return Object.values(rootFields(schema))
    .filter((field) => !/_aggregate$|_by_pk$/.test(field.name))
    .filter((field) => !term || field.name.toLowerCase().includes(term))
    .map((field) => ({
      entity: field.name,
      ...(field.description ? { description: field.description } : {}),
    }));
}

/** The fields and filter arguments of one entity */
export function describeEntity(schema: GraphQLSchema, entity: string) {
  const root = rootFields(schema)[entity];
  if (!root) {
    throw new GraphQLUsageError(unknownEntityMessage(schema, entity));
  }

  const returnType = getNamedType(root.type);
  const fields = isObjectType(returnType)
    ? Object.values(returnType.getFields()).map((field) => ({
        name: field.name,
        type: typeLabel(field),
        ...(field.description ? { description: field.description } : {}),
      }))
    : [];

  return {
    entity,
    returns: String(root.type),
    arguments: root.args.map((arg) => ({ name: arg.name, type: String(arg.type) })),
    fields,
  };
}

function unknownEntityMessage(schema: GraphQLSchema, entity: string): string {
  const needle = entity.toLowerCase().replace(/s$/, '');
  // Closest names first: an exact match on the singular, then the shortest
  // names containing it ("transaction" before "child_transactions")
  const suggestions = listEntities(schema)
    .map(({ entity: name }) => name)
    .filter((name) => name.includes(needle) || needle.includes(name))
    .sort((a, b) => Number(b === needle) - Number(a === needle) || a.length - b.length)
    .slice(0, 8);
  return (
    `Unknown entity "${entity}".` +
    (suggestions.length ? ` Similar entities: ${suggestions.join(', ')}.` : '') +
    ' Use operation "schema" to list them.'
  );
}

// ==================== Validation ====================

export interface QueryProblem {
  message: string;
  line?: number;
  column?: number;
}

/** Reject anything that is not a query: HashPilot's GraphQL access is read-only */
export function readOnlyProblem(query: string): QueryProblem | null {
  let document;
  try {
    document = parse(query);
  } catch {
    return null; // syntax errors are reported by validateQuery
  }
  for (const definition of document.definitions) {
    if (definition.kind === 'OperationDefinition' && definition.operation !== 'query') {
      return {
        message: `Only read-only queries are supported; this document contains a ${definition.operation}.`,
      };
    }
  }
  return null;
}

/** Syntax and schema errors in a query, with their positions */
export function validateQuery(schema: GraphQLSchema, query: string): QueryProblem[] {
  let document;
  try {
    document = parse(query);
  } catch (error: any) {
    const location = error?.locations?.[0];
    return [{ message: error.message, line: location?.line, column: location?.column }];
  }

  const readOnly = readOnlyProblem(query);
  const problems: QueryProblem[] = readOnly ? [readOnly] : [];

  for (const error of validate(schema, document)) {
    const location = error.locations?.[0];
    problems.push({ message: error.message, line: location?.line, column: location?.column });
  }
  return problems;
}

// ==================== Generation ====================

export interface GenerateOptions {
  entity: string;
  fields?: string[];
  where?: Record<string, unknown>;
  orderBy?: Record<string, string> | Array<Record<string, string>>;
  limit?: number;
  offset?: number;
}

/**
 * Build a query for one entity from the schema.
 *
 * Filters and sorting are passed as variables typed from the schema itself,
 * so there is no hand-serialised GraphQL literal to get wrong, and the result
 * is validated before it is returned.
 */
export function generateQuery(
  schema: GraphQLSchema,
  options: GenerateOptions
): { query: string; variables: Record<string, unknown> } {
  const root = rootFields(schema)[options.entity];
  if (!root) {
    throw new GraphQLUsageError(unknownEntityMessage(schema, options.entity));
  }

  const returnType = getNamedType(root.type);
  if (!isObjectType(returnType)) {
    throw new GraphQLUsageError(`Entity "${options.entity}" does not return an object type.`);
  }

  const available = returnType.getFields();
  const isLeaf = (name: string) => {
    const type = getNamedType(available[name].type);
    return isScalarType(type) || isEnumType(type);
  };

  let selection: string[];
  if (options.fields?.length) {
    const unknown = options.fields.filter((name) => !available[name]);
    if (unknown.length) {
      throw new GraphQLUsageError(
        `Unknown field(s) on ${options.entity}: ${unknown.join(', ')}. ` +
          `Available: ${Object.keys(available).slice(0, 40).join(', ')}`
      );
    }
    const nested = options.fields.filter((name) => !isLeaf(name));
    if (nested.length) {
      throw new GraphQLUsageError(
        `Field(s) ${nested.join(', ')} are relationships, not values. ` +
          'Write the query by hand for nested selections and check it with operation "validate".'
      );
    }
    selection = options.fields;
  } else {
    selection = Object.keys(available).filter(isLeaf).slice(0, DEFAULT_FIELD_COUNT);
  }

  const argTypes = Object.fromEntries(root.args.map((arg) => [arg.name, String(arg.type)]));
  const variables: Record<string, unknown> = {};
  const declared: string[] = [];
  const passed: string[] = [];
  const use = (name: string, value: unknown) => {
    if (value === undefined) return;
    if (!argTypes[name]) {
      throw new GraphQLUsageError(`Entity "${options.entity}" does not accept "${name}".`);
    }
    variables[name] = value;
    declared.push(`$${name}: ${argTypes[name]}`);
    passed.push(`${name}: $${name}`);
  };

  use('where', options.where);
  use(
    'order_by',
    options.orderBy === undefined || Array.isArray(options.orderBy)
      ? options.orderBy
      : [options.orderBy]
  );
  use('limit', options.limit ?? (argTypes.limit ? 10 : undefined));
  use('offset', options.offset);

  const query = [
    `query HashPilotQuery${declared.length ? `(${declared.join(', ')})` : ''} {`,
    `  ${options.entity}${passed.length ? `(${passed.join(', ')})` : ''} {`,
    ...selection.map((name) => `    ${name}`),
    '  }',
    '}',
  ].join('\n');

  const problems = validateQuery(schema, query);
  if (problems.length) {
    throw new GraphQLUsageError(
      `The generated query does not validate: ${problems.map((p) => p.message).join('; ')}`
    );
  }

  return { query, variables };
}

// ==================== Execution ====================

/**
 * Shrink the result to fit an MCP response by trimming the rows of each
 * top-level list, reporting how many were dropped.
 */
export function fitResult(data: Record<string, unknown>): {
  data: Record<string, unknown>;
  truncated?: string;
} {
  if (JSON.stringify(data).length <= MAX_RESULT_CHARS) {
    return { data };
  }

  const trimmed: Record<string, unknown> = { ...data };
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(trimmed)) {
    if (!Array.isArray(value)) continue;
    let rows = value;
    while (
      rows.length > 1 &&
      JSON.stringify({ ...trimmed, [key]: rows }).length > MAX_RESULT_CHARS
    ) {
      rows = rows.slice(0, Math.ceil(rows.length / 2));
    }
    trimmed[key] = rows;
    if (rows.length < value.length) {
      dropped.push(`${key}: showing ${rows.length} of ${value.length} rows`);
    }
  }

  return dropped.length
    ? { data: trimmed, truncated: `${dropped.join('; ')}. Use limit or offset to page.` }
    : {
        data: trimmed,
        truncated: 'Result exceeds the response size limit; use limit or offset to page.',
      };
}

/** Run a read-only query */
export async function executeQuery(
  network: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data: Record<string, unknown> | null; errors?: QueryProblem[]; truncated?: string }> {
  const readOnly = readOnlyProblem(query);
  if (readOnly) {
    throw new GraphQLUsageError(readOnly.message);
  }

  const result = await post(resolveEndpoint(network), { query, variables });
  const errors: QueryProblem[] | undefined = result.errors?.map((error: any) => ({
    message: error.message,
    line: error.locations?.[0]?.line,
    column: error.locations?.[0]?.column,
  }));

  if (!result.data) {
    return { data: null, errors };
  }

  const fitted = fitResult(result.data);
  return { ...fitted, ...(errors?.length ? { errors } : {}) };
}
