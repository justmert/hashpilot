/**
 * Tool argument validation.
 *
 * The MCP `Server` class does not validate `tools/call` arguments against the
 * schema a tool advertises, and the dispatcher casts them straight through. A
 * client that omitted a required parameter got whatever internal failure came
 * first: `docs_search` with no `query` answered "Cannot read properties of
 * undefined (reading 'length')" rather than saying what was missing.
 */

import { validateToolArguments, ToolDefinition } from '../../src/utils/validate-args';

const tools: ToolDefinition[] = [
  {
    name: 'docs_search',
    inputSchema: {
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
        hasCode: { type: 'boolean' },
        language: { type: 'string', enum: ['javascript', 'go', 'rust'] },
      },
    },
  },
  {
    name: 'network_switch',
    inputSchema: {
      required: ['network'],
      properties: {
        network: { type: 'string', enum: ['mainnet', 'testnet', 'previewnet', 'local'] },
      },
    },
  },
  {
    name: 'token_manage',
    inputSchema: {
      required: ['action'],
      properties: {
        action: { type: 'string' },
        customFees: { type: 'array' },
        config: { type: 'object' },
        decimals: { type: 'integer' },
      },
    },
  },
  { name: 'health_check', inputSchema: { properties: { verbose: { type: 'boolean' } } } },
];

const check = (name: string, args: unknown) => validateToolArguments(tools, name, args);

describe('validateToolArguments', () => {
  it('accepts a valid call', () => {
    expect(check('docs_search', { query: 'how do I create a token' })).toBeNull();
  });

  it('names a missing required parameter', () => {
    expect(check('docs_search', {})).toBe('Missing required parameter: query');
  });

  it('treats undefined arguments as an empty object', () => {
    expect(check('docs_search', undefined)).toBe('Missing required parameter: query');
  });

  it('rejects an empty string for a required parameter', () => {
    expect(check('docs_search', { query: '' })).toBe('Missing required parameter: query');
  });

  it('lists every missing parameter at once', () => {
    const many: ToolDefinition[] = [
      { name: 't', inputSchema: { required: ['a', 'b'], properties: {} } },
    ];
    expect(validateToolArguments(many, 't', {})).toBe('Missing required parameters: a, b');
  });

  it('reports a wrong primitive type', () => {
    expect(check('docs_search', { query: 'x', limit: 'five' })).toBe(
      'Parameter "limit" must be of type number, received string'
    );
    expect(check('docs_search', { query: 'x', hasCode: 'true' })).toBe(
      'Parameter "hasCode" must be of type boolean, received string'
    );
  });

  it('distinguishes arrays from objects', () => {
    expect(check('token_manage', { action: 'create', customFees: {} })).toBe(
      'Parameter "customFees" must be of type array, received object'
    );
    expect(check('token_manage', { action: 'create', config: [] })).toBe(
      'Parameter "config" must be of type object, received array'
    );
    expect(check('token_manage', { action: 'create', customFees: [], config: {} })).toBeNull();
  });

  it('requires an integer to be whole', () => {
    expect(check('token_manage', { action: 'create', decimals: 2 })).toBeNull();
    expect(check('token_manage', { action: 'create', decimals: 2.5 })).toBe(
      'Parameter "decimals" must be of type integer, received number'
    );
  });

  it('rejects a value outside an enum and names the valid ones', () => {
    // The real defect this guards: network_switch used to accept any string,
    // persist it, and leave every later call failing with "Unknown network".
    expect(check('network_switch', { network: 'fakenet' })).toBe(
      'Invalid value for "network": "fakenet". Valid values: mainnet, testnet, previewnet, local'
    );
    expect(check('network_switch', { network: 'testnet' })).toBeNull();
  });

  it('ignores parameters the schema does not describe', () => {
    expect(check('docs_search', { query: 'x', somethingElse: 1 })).toBeNull();
  });

  it('accepts a tool with no required list and no arguments', () => {
    expect(check('health_check', {})).toBeNull();
    expect(check('health_check', undefined)).toBeNull();
  });

  it('passes through a tool it does not know, leaving dispatch to handle it', () => {
    expect(check('no_such_tool', {})).toBeNull();
  });
});
