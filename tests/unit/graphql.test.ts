/**
 * GraphQL access through Hgraph.
 *
 * The schema below is a small stand-in written in Hgraph's (Hasura's) shape:
 * every entity takes where/order_by/limit/offset, with `<entity>_bool_exp` and
 * `<entity>_order_by` input types. Generated queries were also checked against
 * Hgraph's real testnet schema while this was built.
 */

import { jest } from '@jest/globals';
import { buildSchema } from 'graphql';
import {
  describeEntity,
  executeQuery,
  fitResult,
  generateQuery,
  listEntities,
  MAX_RESULT_CHARS,
  parseJsonPreservingIntegers,
  readOnlyProblem,
  resolveEndpoint,
  validateQuery,
} from '../../src/services/hgraph-service';

const schema = buildSchema(`
  scalar bigint
  enum order_by { asc desc }
  enum token_type { FUNGIBLE_COMMON NON_FUNGIBLE_UNIQUE }

  input bigint_comparison_exp { _eq: bigint _gt: bigint _lt: bigint }
  input String_comparison_exp { _eq: String _like: String }

  type token {
    token_id: bigint
    name: String
    symbol: String
    total_supply: bigint
    type: token_type
    treasury: entity
  }
  input token_bool_exp { token_id: bigint_comparison_exp name: String_comparison_exp }
  input token_order_by { token_id: order_by name: order_by }

  type entity { id: bigint memo: String }

  type transaction { consensus_timestamp: bigint payer_account_id: bigint result: Int }
  input transaction_bool_exp { payer_account_id: bigint_comparison_exp }
  input transaction_order_by { consensus_timestamp: order_by }

  type query_root {
    token(where: token_bool_exp, order_by: [token_order_by!], limit: Int, offset: Int): [token!]!
    token_aggregate(where: token_bool_exp): Int
    transaction(where: transaction_bool_exp, order_by: [transaction_order_by!], limit: Int, offset: Int): [transaction!]!
    child_transactions(limit: Int): [transaction!]!
  }
  schema { query: query_root }
`);

const originalFetch = global.fetch;
const originalKey = process.env.HGRAPH_API_KEY;
const originalEndpoint = process.env.GRAPHQL_ENDPOINT;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.HGRAPH_API_KEY;
  else process.env.HGRAPH_API_KEY = originalKey;
  if (originalEndpoint === undefined) delete process.env.GRAPHQL_ENDPOINT;
  else process.env.GRAPHQL_ENDPOINT = originalEndpoint;
});

describe('resolveEndpoint', () => {
  it('maps mainnet and testnet to Hgraph', () => {
    delete process.env.GRAPHQL_ENDPOINT;
    expect(resolveEndpoint('mainnet')).toBe('https://hedera.hgraph.com/v1/graphql');
    expect(resolveEndpoint('testnet')).toBe('https://hedera-testnet.hgraph.com/v1/graphql');
  });

  it('explains that previewnet and local have no GraphQL endpoint', () => {
    delete process.env.GRAPHQL_ENDPOINT;
    expect(() => resolveEndpoint('previewnet')).toThrow(/mainnet and testnet only/);
  });

  it('honours GRAPHQL_ENDPOINT', () => {
    process.env.GRAPHQL_ENDPOINT = 'https://example.test/graphql';
    expect(resolveEndpoint('local')).toBe('https://example.test/graphql');
  });
});

describe('schema exploration', () => {
  it('lists entities without Hasura aggregate variants', () => {
    const names = listEntities(schema).map((e) => e.entity);
    expect(names).toEqual(['token', 'transaction', 'child_transactions']);
    expect(listEntities(schema, 'TOK').map((e) => e.entity)).toEqual(['token']);
  });

  it('describes an entity with its fields and filter arguments', () => {
    const token = describeEntity(schema, 'token');
    expect(token.arguments.map((a) => a.name)).toEqual(['where', 'order_by', 'limit', 'offset']);
    expect(token.fields.map((f) => f.name)).toContain('total_supply');
  });

  it('suggests the closest entity first for a near miss', () => {
    expect(() => describeEntity(schema, 'transactions')).toThrow(
      /Similar entities: transaction, child_transactions/
    );
  });
});

describe('generateQuery', () => {
  it('builds a typed, validated query with filters as variables', () => {
    const { query, variables } = generateQuery(schema, {
      entity: 'transaction',
      where: { payer_account_id: { _eq: 98 } },
      orderBy: { consensus_timestamp: 'desc' },
      limit: 5,
    });

    expect(query).toContain(
      'query HashPilotQuery($where: transaction_bool_exp, $order_by: [transaction_order_by!], $limit: Int)'
    );
    expect(variables).toEqual({
      where: { payer_account_id: { _eq: 98 } },
      order_by: [{ consensus_timestamp: 'desc' }],
      limit: 5,
    });
    expect(validateQuery(schema, query)).toEqual([]);
  });

  it('selects value fields by default and applies a default limit', () => {
    const { query, variables } = generateQuery(schema, { entity: 'token' });
    expect(query).toContain('token_id');
    expect(query).not.toContain('treasury'); // a relationship, not a value
    expect(variables.limit).toBe(10);
  });

  it('rejects unknown fields and relationship fields with guidance', () => {
    expect(() => generateQuery(schema, { entity: 'token', fields: ['nope'] })).toThrow(
      /Unknown field\(s\) on token: nope/
    );
    expect(() => generateQuery(schema, { entity: 'token', fields: ['treasury'] })).toThrow(
      /relationships, not values/
    );
  });

  it('rejects an argument the entity does not take', () => {
    expect(() => generateQuery(schema, { entity: 'child_transactions', where: {} })).toThrow(
      /does not accept "where"/
    );
  });
});

describe('validateQuery', () => {
  it('accepts a valid hand-written query', () => {
    expect(validateQuery(schema, '{ token(limit: 1) { token_id symbol } }')).toEqual([]);
  });

  it('reports an unknown field with its position', () => {
    const [problem] = validateQuery(schema, '{ token(limit: 1) { token_id nope } }');
    expect(problem.message).toMatch(/Cannot query field "nope" on type "token"/);
    expect(problem).toMatchObject({ line: 1, column: 30 });
  });

  it('reports a syntax error', () => {
    expect(validateQuery(schema, '{ token { token_id ')[0].message).toMatch(/Syntax Error/);
  });

  it('refuses mutations and subscriptions', () => {
    expect(readOnlyProblem('mutation { x }')?.message).toMatch(/read-only/);
    expect(readOnlyProblem('subscription { x }')?.message).toMatch(/subscription/);
    expect(readOnlyProblem('{ token { token_id } }')).toBeNull();
  });
});

describe('executeQuery', () => {
  it('sends the key in the X-API-KEY header', async () => {
    process.env.HGRAPH_API_KEY = 'pk_test';
    const fetchMock = jest.fn(async (_url: string, init: any) => {
      expect(init.headers['X-API-KEY']).toBe('pk_test');
      return { ok: true, status: 200, text: async () => '{"data":{"token":[{"token_id":1}]}}' };
    });
    global.fetch = fetchMock as any;

    await expect(executeQuery('testnet', '{ token { token_id } }')).resolves.toEqual({
      data: { token: [{ token_id: 1 }] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('explains how to get a key when none is configured', async () => {
    delete process.env.HGRAPH_API_KEY;
    await expect(executeQuery('testnet', '{ token { token_id } }')).rejects.toThrow(
      /HGRAPH_API_KEY.*app\.hgraph\.com/
    );
  });

  it('turns a rejected key into guidance', async () => {
    process.env.HGRAPH_API_KEY = 'bad';
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => '<html/>',
    })) as any;
    await expect(executeQuery('testnet', '{ token { token_id } }')).rejects.toThrow(
      /rejected the API key \(HTTP 401\)/
    );
  });

  it('retries a rate-limited request and returns the eventual result', async () => {
    jest.useFakeTimers();
    process.env.HGRAPH_API_KEY = 'pk_test';
    const responses = [
      { ok: false, status: 429, text: async () => '' },
      { ok: true, status: 200, text: async () => '{"data":{"token":[]}}' },
    ];
    const fetchMock = jest.fn(async () => responses.shift());
    global.fetch = fetchMock as any;

    const pending = executeQuery('testnet', '{ token { token_id } }');
    await jest.advanceTimersByTimeAsync(1200);
    await expect(pending).resolves.toEqual({ data: { token: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('explains the free-plan rate limit once retries are exhausted', async () => {
    jest.useFakeTimers();
    process.env.HGRAPH_API_KEY = 'pk_test';
    const fetchMock = jest.fn(async () => ({ ok: false, status: 429, text: async () => '' }));
    global.fetch = fetchMock as any;

    const pending = executeQuery('testnet', '{ token { token_id } }');
    const outcome = expect(pending).rejects.toThrow(/1 request per second/);
    await jest.advanceTimersByTimeAsync(7000);
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(4); // first try plus three retries
    jest.useRealTimers();
  });

  it('sends concurrent queries one at a time', async () => {
    process.env.HGRAPH_API_KEY = 'pk_test';
    let inFlight = 0;
    let maxInFlight = 0;
    global.fetch = jest.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { ok: true, status: 200, text: async () => '{"data":{"token":[]}}' };
    }) as any;

    await Promise.all([1, 2, 3].map(() => executeQuery('testnet', '{ token { token_id } }')));
    expect(maxInFlight).toBe(1);
  });

  it('returns GraphQL errors alongside any data', async () => {
    process.env.HGRAPH_API_KEY = 'pk_test';
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        '{"errors":[{"message":"field not found","locations":[{"line":1,"column":3}]}]}',
    })) as any;
    await expect(executeQuery('testnet', '{ x }')).resolves.toEqual({
      data: null,
      errors: [{ message: 'field not found', line: 1, column: 3 }],
    });
  });

  it('refuses a mutation before sending anything', async () => {
    process.env.HGRAPH_API_KEY = 'pk_test';
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    await expect(executeQuery('testnet', 'mutation { x }')).rejects.toThrow(/read-only/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fitResult', () => {
  it('leaves a small result alone', () => {
    expect(fitResult({ token: [{ id: 1 }] })).toEqual({ data: { token: [{ id: 1 }] } });
  });

  it('trims rows of a large result and says how many were dropped', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: i, memo: 'x'.repeat(60) }));
    const { data, truncated } = fitResult({ token: rows });
    expect(JSON.stringify(data).length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(truncated).toMatch(/token: showing \d+ of 2000 rows/);
  });
});

describe('parseJsonPreservingIntegers', () => {
  // Hgraph returns nanosecond timestamps as bare numbers; JSON.parse turned
  // 1790254349306634009 into 1790254349306634000, a different transaction.
  it('keeps a nanosecond timestamp exact', () => {
    const parsed = parseJsonPreservingIntegers('{"consensus_timestamp":1790254349306634009}');
    expect(parsed.consensus_timestamp).toBe('1790254349306634009');
  });

  it('leaves safe integers, decimals and exponents as numbers', () => {
    expect(
      parseJsonPreservingIntegers('{"a":42,"b":1.5,"c":9007199254740991,"d":1e21,"e":-7}')
    ).toEqual({ a: 42, b: 1.5, c: 9007199254740991, d: 1e21, e: -7 });
  });

  it('quotes unsafe integers anywhere, including negatives and array items', () => {
    expect(
      parseJsonPreservingIntegers('{"a":-9223372036854775808,"b":[1,9007199254740993]}')
    ).toEqual({ a: '-9223372036854775808', b: [1, '9007199254740993'] });
  });

  it('never alters digits inside strings', () => {
    const text = '{"memo":"ts 1790254349306634009 \\"quoted\\" ok"}';
    expect(parseJsonPreservingIntegers(text).memo).toBe('ts 1790254349306634009 "quoted" ok');
  });
});
