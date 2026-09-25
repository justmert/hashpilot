/**
 * Schema parity: every parameter a tool implementation reads must be
 * advertised in its MCP `inputSchema`.
 *
 * An AI client can only send what the schema declares, so a parameter that
 * exists in the code but not in the schema is dead: the feature is
 * unreachable no matter how well it is implemented. A 2026-09 audit found
 * about twenty of these (custom fees, gas limits, network overrides, address
 * book aliases, verification build-info paths). This test reads the source and
 * fails if a new one appears.
 */

import fs from 'fs';
import path from 'path';

// Jest runs from the package root; `__dirname` does not exist under the ESM runner.
const root = process.cwd();
const compositeSrc = fs.readFileSync(path.join(root, 'src/tools/composite.ts'), 'utf-8');
const indexSrc = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf-8');

/** Parameters read by the code but deliberately not exposed to clients. */
const INTERNAL: Record<string, string[]> = {
  // `operation` is the composite discriminator and is always declared
};

/**
 * Collect `args.foo` reads inside a function body.
 */
function paramsReadBy(source: string, functionName: string): string[] {
  const start = source.indexOf(`export async function ${functionName}(`);
  if (start === -1) throw new Error(`function ${functionName} not found`);

  // Body ends at the next top-level `export ` declaration
  const after = source.slice(start + 10);
  const nextExport = after.indexOf('\nexport ');
  const body = nextExport === -1 ? after : after.slice(0, nextExport);

  return [...new Set([...body.matchAll(/\bargs\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
}

/**
 * Collect the property names of a tool's inputSchema, located by tool name.
 */
function schemaPropertiesOf(source: string, toolName: string): string[] {
  const nameIndex = source.indexOf(`name: '${toolName}'`);
  if (nameIndex === -1) throw new Error(`tool ${toolName} not found`);

  const propsIndex = source.indexOf('properties: {', nameIndex);
  if (propsIndex === -1) throw new Error(`tool ${toolName} has no properties block`);

  // Walk braces from `properties: {` to its matching close
  let depth = 0;
  let end = propsIndex;
  for (let i = source.indexOf('{', propsIndex); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = source.slice(propsIndex, end);

  // Top-level keys of the properties object. Accept every form a schema entry
  // is written in, not just an object literal, so a property assembled by a
  // helper is not falsely reported as missing:
  //   name: { type: 'string' }              literal
  //   name: { ...keyParameterSchema('..') } spread of a helper result
  //   name: CUSTOM_FEES_SCHEMA              a shared constant
  //   name: keyParameterSchema('..')        a direct call
  const keys: string[] = [];
  let nesting = 0;
  for (const line of block.split('\n').slice(1)) {
    const trimmed = line.trim();
    if (nesting === 0) {
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^,\s]/);
      if (match) keys.push(match[1]);
    }
    nesting += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (nesting < 0) nesting = 0;
  }
  return [...new Set(keys)];
}

/** Composite tools: implementation function -> tool name (both in composite.ts) */
const COMPOSITE: Array<[string, string]> = [
  ['tokenManage', 'token_manage'],
  ['addressBookManage', 'addressbook_manage'],
  ['stateManage', 'state_manage'],
  ['hcsTopicManage', 'hcs_topic'],
  ['hcsMessageManage', 'hcs_message'],
  ['hardhatProjectManage', 'hardhat_project'],
  ['hardhatContractManage', 'hardhat_contract'],
  ['foundryProjectManage', 'foundry_project'],
  ['foundryContractManage', 'foundry_contract'],
];

describe('composite tool schema parity', () => {
  it.each(COMPOSITE)('%s reads only parameters that %s advertises', (fn, tool) => {
    const read = paramsReadBy(compositeSrc, fn);
    const advertised = new Set([
      ...schemaPropertiesOf(compositeSrc, tool),
      ...(INTERNAL[tool] || []),
    ]);
    const missing = read.filter((p) => !advertised.has(p));

    expect({ tool, missing }).toEqual({ tool, missing: [] });
  });
});

/** Tools whose implementation lives elsewhere but whose schema is in index.ts */
const INDEX_TOOLS: Array<[string, string, string]> = [
  ['src/tools/rpc.ts', 'rpcCall', 'rpc_call'],
  ['src/tools/rpc.ts', 'rpcCallContract', 'rpc_call_contract'],
  ['src/tools/rpc.ts', 'rpcDeployContract', 'rpc_deploy_contract'],
  ['src/tools/rpc.ts', 'rpcExecuteContract', 'rpc_execute_contract'],
  ['src/tools/deploy.ts', 'deployContract', 'deploy_contract'],
  ['src/tools/deploy.ts', 'deploymentHistory', 'deployment_history'],
  ['src/tools/verify.ts', 'verifyContract', 'verify_contract'],
  ['src/tools/account.ts', 'createAccount', 'account_create'],
  ['src/tools/mirror-node.ts', 'mirrorQueryAccount', 'mirror_query_account'],
];

describe('index.ts tool schema parity', () => {
  it.each(INDEX_TOOLS)('%s:%s matches the %s schema', (file, fn, tool) => {
    const source = fs.readFileSync(path.join(root, file), 'utf-8');
    const read = paramsReadBy(source, fn);
    const advertised = new Set([...schemaPropertiesOf(indexSrc, tool), ...(INTERNAL[tool] || [])]);
    const missing = read.filter((p) => !advertised.has(p));

    expect({ tool, missing }).toEqual({ tool, missing: [] });
  });
});

describe('RAG tool schema parity', () => {
  // These implementations live in rag.ts; their schemas are in index.ts
  it.each([
    ['docsSearch', 'docs_search'],
    ['docsAsk', 'docs_ask'],
    ['docsGetExample', 'docs_get_example'],
    ['codeGenerate', 'code_generate'],
  ])('%s matches the %s schema', (fn, tool) => {
    const source = fs.readFileSync(path.join(root, 'src/tools/rag.ts'), 'utf-8');
    const read = paramsReadBy(source, fn);
    const advertised = new Set(schemaPropertiesOf(indexSrc, tool));
    const missing = read.filter((p) => !advertised.has(p));

    expect({ tool, missing }).toEqual({ tool, missing: [] });
  });
});

describe('schema extraction sanity', () => {
  it('finds the properties it is meant to find', () => {
    expect(schemaPropertiesOf(indexSrc, 'account_balance')).toEqual(['accountId']);
    expect(schemaPropertiesOf(indexSrc, 'rpc_call')).toEqual(
      expect.arrayContaining(['method', 'params', 'network'])
    );
    expect(paramsReadBy(compositeSrc, 'stateManage')).toEqual(
      expect.arrayContaining(['operation', 'outputPath', 'filename'])
    );
  });

  it('sees properties however they are written, not just object literals', () => {
    // token_manage builds its key entries by spreading a helper result and
    // reuses a shared constant for custom fees; both must be visible.
    const tokenProps = schemaPropertiesOf(compositeSrc, 'token_manage');
    expect(tokenProps).toEqual(
      expect.arrayContaining(['adminKey', 'freezeKey', 'kycKey', 'customFees'])
    );
    // and it must not mistake a nested property for a top-level one
    expect(tokenProps).not.toContain('type');
    expect(tokenProps).not.toContain('description');
  });
});
