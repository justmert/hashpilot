/**
 * Hardhat service: the parts that do not need a Hardhat project or a
 * network. Output parsers are fed captured Hardhat 2 / Hardhat 3 output;
 * the artifact reader runs against a fixture tree written to a temp dir.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// The service constructs singletons that resolve the data directory at import
// time; tests/setup-env.ts points that at a scratch dir before this loads.
import {
  parseTestOutput,
  parseTaskList,
  parseDeployedAddresses,
  readArtifactsFromDir,
  listArtifactFiles,
  toEvmAddress,
  toPlainValue,
  toHexQuantity,
  paramsToArgs,
  stripAnsi,
  tail,
} from '../../src/services/hardhat-service';

const HARDHAT3_TEST_OUTPUT = `
Compiled 1 Solidity file with solc 0.8.20 (evm target: shanghai)

Running Solidity tests


Running Mocha tests


  Greeter
    ✔ Should return the greeting
    ✔ Should update the greeting
    1) Should emit GreetingChanged event


  2 passing (25ms)
  1 failing

  1) Greeter
       Should emit GreetingChanged event:

      AssertionError: expected 'Hola, Hedera!' to equal 'Nope'
      + expected - actual

      -Hola, Hedera!
      +Nope

      at Context.<anonymous> (file:///tmp/hh/test/Greeter.test.js:22:39)



2 passing, 1 failing (3 mocha)
`;

const HARDHAT3_HELP = `Hardhat version 3.16.0

Usage: hardhat [GLOBAL OPTIONS] <TASK> [SUBTASK] [TASK OPTIONS] [--] [TASK ARGUMENTS]

AVAILABLE TASKS:

  build                         Build project
  clean                         Clear the cache and delete all artifacts
  compile                       Build project (alias for build)
  test                          Run all tests
  verify                        Verify a contract on all supported explorers

AVAILABLE SUBTASKS:

  ignition deploy               Deploy a module to the specified network
  test mocha                    Runs tests using the Mocha test runner
  verify sourcify               Verify a contract on Sourcify

GLOBAL OPTIONS:

  --config                      A Hardhat config file
  --network                     The network to connect to

To get help for a specific task run: npx hardhat <TASK> [SUBTASK] --help
`;

const HARDHAT2_HELP = `Hardhat version 2.22.16

Usage: hardhat [GLOBAL OPTIONS] [SCOPE] <TASK> [TASK OPTIONS]

GLOBAL OPTIONS:

  --config              A Hardhat config file.
  --network             The network to connect to.

AVAILABLE TASKS:

  check                 Check whatever you need
  clean                 Clears the cache and deletes all artifacts
  compile               Compiles the entire project, building all artifacts
  test                  Runs mocha tests

AVAILABLE TASK SCOPES:

  ignition              Deploy your smart contracts using Hardhat Ignition
  vars                  Manage your configuration variables

To get help for a specific task run: npx hardhat help [SCOPE] <TASK>
`;

describe('parseTestOutput', () => {
  it('reads mocha counts, duration and failure blocks from Hardhat 3 output', () => {
    const parsed = parseTestOutput(HARDHAT3_TEST_OUTPUT);
    expect(parsed.found).toBe(true);
    expect(parsed.passed).toBe(2);
    expect(parsed.failed).toBe(1);
    expect(parsed.skipped).toBe(0);
    expect(parsed.duration).toBe(25);
    expect(parsed.failures).toHaveLength(1);
    expect(parsed.failures[0].test).toBe('Greeter Should emit GreetingChanged event');
    expect(parsed.failures[0].error).toContain("expected 'Hola, Hedera!' to equal 'Nope'");
    expect(parsed.failures[0].error).not.toContain('at Context');
  });

  it('handles an all-green mocha run with seconds and pending tests', () => {
    const parsed = parseTestOutput('\n  3 passing (2s)\n  1 pending\n');
    expect(parsed).toMatchObject({ passed: 3, failed: 0, skipped: 1, duration: 2000, found: true });
    expect(parsed.failures).toEqual([]);
  });

  it('adds Solidity test runner totals', () => {
    const output = [
      'Ran 1 test suite in 12ms: 2 tests passed, 1 failed, 1 skipped (4 total tests)',
      '',
      '  5 passing (40ms)',
    ].join('\n');
    const parsed = parseTestOutput(output);
    expect(parsed).toMatchObject({ passed: 7, failed: 1, skipped: 1 });
  });

  it('reports nothing found when no summary is present', () => {
    const parsed = parseTestOutput('Error HHE404: Task "test" not found');
    expect(parsed.found).toBe(false);
    expect(parsed.failures).toEqual([]);
  });

  it('ignores ANSI colour codes', () => {
    const parsed = parseTestOutput('[32m  4 passing[0m (10ms)\n[31m  2 failing[0m\n');
    expect(parsed).toMatchObject({ passed: 4, failed: 2, duration: 10 });
  });
});

describe('parseTaskList', () => {
  it('parses Hardhat 3 tasks and subtasks', () => {
    const tasks = parseTaskList(HARDHAT3_HELP);
    expect(tasks.map((t) => t.name)).toEqual([
      'build',
      'clean',
      'compile',
      'test',
      'verify',
      'ignition deploy',
      'test mocha',
      'verify sourcify',
    ]);
    expect(tasks.find((t) => t.name === 'compile')).toEqual({
      name: 'compile',
      description: 'Build project (alias for build)',
      kind: 'task',
    });
    expect(tasks.find((t) => t.name === 'ignition deploy')?.kind).toBe('subtask');
    // Global options must not leak into the task list
    expect(tasks.some((t) => t.name.startsWith('--'))).toBe(false);
  });

  it('parses Hardhat 2 tasks and scopes', () => {
    const tasks = parseTaskList(HARDHAT2_HELP);
    expect(tasks.filter((t) => t.kind === 'task').map((t) => t.name)).toEqual([
      'check',
      'clean',
      'compile',
      'test',
    ]);
    expect(tasks.filter((t) => t.kind === 'scope').map((t) => t.name)).toEqual([
      'ignition',
      'vars',
    ]);
  });

  it('returns an empty list for unrelated text', () => {
    expect(parseTaskList('Error: could not load config')).toEqual([]);
  });
});

describe('parseDeployedAddresses', () => {
  it('prefers a "deployed to" line and collects Ignition futures', () => {
    const output = `
Deploying contracts with account: 0x1111111111111111111111111111111111111111
Greeter deployed to: 0x2222222222222222222222222222222222222222
`;
    const parsed = parseDeployedAddresses(output);
    expect(parsed.primary).toBe('0x2222222222222222222222222222222222222222');
    expect(parsed.addresses).toHaveLength(2);

    const ignition = parseDeployedAddresses(`
[ GreeterModule ] successfully deployed 🚀

Deployed Addresses

GreeterModule#Greeter - 0x3333333333333333333333333333333333333333
`);
    expect(ignition.named).toEqual({
      'GreeterModule#Greeter': '0x3333333333333333333333333333333333333333',
    });
    expect(ignition.primary).toBe('0x3333333333333333333333333333333333333333');
  });

  it('returns no primary when nothing looks like an address', () => {
    expect(parseDeployedAddresses('nothing here').primary).toBeUndefined();
  });
});

describe('artifact reader', () => {
  let artifactsDir: string;

  beforeAll(async () => {
    artifactsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hashpilot-artifacts-'));
    const greeterDir = path.join(artifactsDir, 'contracts', 'Greeter.sol');
    const libDir = path.join(artifactsDir, 'contracts', 'lib', 'Math.sol');
    const buildInfo = path.join(artifactsDir, 'build-info');
    await fs.mkdir(greeterDir, { recursive: true });
    await fs.mkdir(libDir, { recursive: true });
    await fs.mkdir(buildInfo, { recursive: true });

    const artifact = (contractName: string, sourceName: string) =>
      JSON.stringify({
        _format: 'hh-sol-artifact-1',
        contractName,
        sourceName,
        abi: [
          { type: 'function', name: 'greet', inputs: [], outputs: [], stateMutability: 'view' },
        ],
        bytecode: '0x6080',
        deployedBytecode: '0x6080',
        linkReferences: {},
        deployedLinkReferences: {},
      });

    await fs.writeFile(
      path.join(greeterDir, 'Greeter.json'),
      artifact('Greeter', 'contracts/Greeter.sol')
    );
    await fs.writeFile(
      path.join(greeterDir, 'Greeter.dbg.json'),
      JSON.stringify({ _format: 'hh-sol-dbg-1', buildInfo: '../../build-info/abc.json' })
    );
    await fs.writeFile(path.join(libDir, 'Math.json'), artifact('Math', 'contracts/lib/Math.sol'));
    // Same contract name in a second source: only reachable by fully qualified name
    await fs.writeFile(
      path.join(libDir, 'Greeter.json'),
      artifact('Greeter', 'contracts/lib/Math.sol')
    );
    await fs.writeFile(
      path.join(buildInfo, 'abc.json'),
      JSON.stringify({ _format: 'hh3-sol-build-info-1' })
    );
    await fs.writeFile(path.join(buildInfo, 'abc.output.json'), JSON.stringify({ output: {} }));
    // Not an artifact: Hardhat 3 typechain index and a stray file
    await fs.writeFile(path.join(artifactsDir, 'artifacts.d.ts'), 'export {};');
    await fs.writeFile(path.join(artifactsDir, 'notes.json'), JSON.stringify({ hello: 'world' }));
  });

  afterAll(async () => {
    await fs.rm(artifactsDir, { recursive: true, force: true });
  });

  it('lists only contract artifact files', async () => {
    const files = await listArtifactFiles(artifactsDir);
    const relative = files.map((f) => path.relative(artifactsDir, f)).sort();
    expect(relative).toEqual([
      'contracts/Greeter.sol/Greeter.json',
      'contracts/lib/Math.sol/Greeter.json',
      'contracts/lib/Math.sol/Math.json',
      'notes.json',
    ]);
  });

  it('reads every artifact when no name is given and skips non-artifacts', async () => {
    const artifacts = await readArtifactsFromDir(artifactsDir);
    expect(artifacts.map((a) => `${a.sourceName}:${a.contractName}`)).toEqual([
      'contracts/Greeter.sol:Greeter',
      'contracts/lib/Math.sol:Greeter',
      'contracts/lib/Math.sol:Math',
    ]);
    expect(artifacts[0].abi[0].name).toBe('greet');
    expect(artifacts[0].bytecode).toBe('0x6080');
  });

  it('filters by bare and fully qualified contract name', async () => {
    expect(await readArtifactsFromDir(artifactsDir, 'Math')).toHaveLength(1);
    expect(await readArtifactsFromDir(artifactsDir, 'Greeter')).toHaveLength(2);
    const qualified = await readArtifactsFromDir(artifactsDir, 'contracts/Greeter.sol:Greeter');
    expect(qualified).toHaveLength(1);
    expect(qualified[0].sourceName).toBe('contracts/Greeter.sol');
    expect(await readArtifactsFromDir(artifactsDir, 'Missing')).toEqual([]);
  });

  it('returns nothing for a missing directory', async () => {
    expect(await listArtifactFiles(path.join(artifactsDir, 'nope'))).toEqual([]);
  });
});

describe('value helpers', () => {
  it('converts Hedera entity IDs to long-zero addresses', () => {
    expect(toEvmAddress('0.0.2')).toBe('0x0000000000000000000000000000000000000002');
    expect(toEvmAddress('0.0.1234567')).toBe('0x000000000000000000000000000000000012d687');
    expect(toEvmAddress('0xAbC0000000000000000000000000000000000001')).toBe(
      '0xAbC0000000000000000000000000000000000001'
    );
    expect(toEvmAddress('abc0000000000000000000000000000000000001')).toBe(
      '0xabc0000000000000000000000000000000000001'
    );
    expect(() => toEvmAddress('not-an-address')).toThrow(/Invalid contract address/);
  });

  it('makes bigint results serialisable', () => {
    expect(toPlainValue(42n)).toBe('42');
    expect(toPlainValue([1n, 'x', [2n]])).toEqual(['1', 'x', ['2']]);
    expect(toPlainValue({ a: 1n, b: { c: 2n } })).toEqual({ a: '1', b: { c: '2' } });
    expect(JSON.stringify(toPlainValue({ n: 7n }))).toBe('{"n":"7"}');
  });

  it('formats wei quantities as hex', () => {
    expect(toHexQuantity('1000')).toBe('0x3e8');
    expect(toHexQuantity('0x10')).toBe('0x10');
    expect(toHexQuantity(0)).toBe('0x0');
    expect(() => toHexQuantity('-1')).toThrow(/negative/);
  });

  it('turns task params into CLI flags', () => {
    expect(paramsToArgs({ force: true, quiet: false, network: 'testnet', _: ['a.js'] })).toEqual([
      '--force',
      '--network',
      'testnet',
      'a.js',
    ]);
    expect(paramsToArgs({ noCompile: true, deploymentId: 'x' })).toEqual([
      '--no-compile',
      '--deployment-id',
      'x',
    ]);
    expect(paramsToArgs(['one', 2])).toEqual(['one', '2']);
    expect(paramsToArgs(undefined)).toEqual([]);
  });

  it('strips ANSI and tails long output', () => {
    expect(stripAnsi('[31mred[0m')).toBe('red');
    const long = 'x'.repeat(50) + 'END';
    expect(tail(long, 10)).toMatch(/omitted\]\nxxxxxxxEND$/);
    expect(tail('short', 10)).toBe('short');
  });
});
