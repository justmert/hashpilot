/**
 * The combined mirror_query tool.
 *
 * 32 Mirror Node query functions existed with schemas, but only
 * mirror_query_account was registered, so the rest were unreachable from any
 * MCP client. mirror_query exposes them as resources of one tool. These tests
 * pin it to the definitions it wraps so neither can drift from the other.
 */

import {
  mirrorNodeTools,
  mirrorQuery,
  mirrorQueryTool,
  MIRROR_RESOURCE_NAMES,
} from '../../src/tools/mirror-node';

describe('mirror_query', () => {
  const schema = mirrorQueryTool.inputSchema;

  it('exposes every Mirror Node query definition as a resource', () => {
    expect(MIRROR_RESOURCE_NAMES).toHaveLength(mirrorNodeTools.length);
    expect(schema.properties.resource.enum).toEqual(MIRROR_RESOURCE_NAMES);
  });

  it('advertises every parameter of every wrapped definition', () => {
    for (const definition of mirrorNodeTools) {
      for (const name of Object.keys(definition.inputSchema.properties || {})) {
        expect(schema.properties).toHaveProperty(name);
      }
    }
  });

  it('keeps one type per shared parameter', () => {
    for (const definition of mirrorNodeTools) {
      for (const [name, property] of Object.entries<any>(definition.inputSchema.properties || {})) {
        expect((schema.properties as any)[name].type).toBe(property.type);
      }
    }
  });

  it('requires only the resource at the schema level', () => {
    expect(schema.required).toEqual(['resource']);
  });

  it('names the missing field of the chosen resource', async () => {
    await expect(mirrorQuery({ resource: 'nft', tokenId: '0.0.1' })).resolves.toEqual({
      success: false,
      error: 'resource "nft" requires serialNumber',
    });
  });

  it('treats an empty string as missing', async () => {
    const result = await mirrorQuery({ resource: 'transaction', transactionId: '' });
    expect(result.error).toBe('resource "transaction" requires transactionId');
  });

  it('rejects an unknown resource with the valid list', async () => {
    const result = await mirrorQuery({ resource: 'nope' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown resource: nope\. Valid resources: account, accounts/);
  });

  it('lists each resource and its required fields in the description', () => {
    expect(mirrorQueryTool.description).toMatch(/- nft: .*\(requires tokenId, serialNumber\)/);
    expect(mirrorQueryTool.description).toMatch(/- network_info: /);
  });
});
