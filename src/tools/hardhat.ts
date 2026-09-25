/**
 * Hardhat Tools for MCP
 *
 * Implements the operations behind the `hardhat_project` and
 * `hardhat_contract` composite tools. Hardhat itself runs as a child
 * process from the user's project; contract interaction goes through the
 * JSON-RPC relay (see services/hardhat-service.ts).
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { hardhatService, HardhatCommandError } from '../services/hardhat-service.js';
import logger from '../utils/logger.js';
import { ToolResult } from '../types/index.js';
import {
  HEDERA_NETWORKS,
  HARDHAT_SCAFFOLD_PACKAGES,
  HederaNetworkName,
  generateHederaHardhatConfig,
  generateEnvTemplate,
  generateNetworkEntry,
  generateSampleContract,
  generateSampleDeployScript,
  generateSampleIgnitionModule,
  generateSampleTest,
  generateTsConfig,
  generateGitignore,
  generateReadme,
} from '../utils/hardhat-config-generator.js';

const HARDHAT_MIN_NODE_MAJOR = 22;
const NPM_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

function metadata(command: string): ToolResult['metadata'] {
  return { executedVia: 'hardhat', command };
}

function failure(error: unknown, fallback: string, command: string): ToolResult {
  const message = error instanceof Error ? error.message : fallback;
  const data =
    error instanceof HardhatCommandError
      ? { exitCode: error.result.exitCode, command: error.result.command }
      : undefined;
  return { success: false, error: message, data, metadata: metadata(command) };
}

/**
 * Run a command with piped stdio (never inherit: the MCP transport owns stdout)
 */
function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start ${command}: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * 1. Initialize Hardhat project (Hardhat 3 scaffold for Hedera)
 */
export async function hardhatInit(args: {
  directory?: string;
  networks?: HederaNetworkName[];
  solidity?: string;
  typescript?: boolean;
  /** Skip `npm install` (default: false) */
  skipInstall?: boolean;
}): Promise<ToolResult> {
  const command = 'hardhat init';
  try {
    const directory = path.resolve(args.directory || process.cwd());
    const networks = args.networks || ['testnet', 'local'];
    const solidity = args.solidity || '0.8.20';
    const typescript = args.typescript || false;
    const ext = typescript ? 'ts' : 'js';
    const warnings: string[] = [];

    logger.info('Initializing Hardhat project', { directory, networks, solidity, typescript });

    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (nodeMajor < HARDHAT_MIN_NODE_MAJOR) {
      warnings.push(
        `Hardhat 3 requires Node.js ${HARDHAT_MIN_NODE_MAJOR}+, but this server runs on Node ${process.versions.node}. ` +
          'Hardhat commands from HashPilot will fail until the server runs on a newer Node.'
      );
    }

    for (const sub of ['contracts', 'scripts', 'test', path.join('ignition', 'modules')]) {
      await fs.mkdir(path.join(directory, sub), { recursive: true });
    }

    const configFile = `hardhat.config.${ext}`;
    const files: Array<[string, string]> = [
      [configFile, generateHederaHardhatConfig({ solidity, networks, typescript })],
      ['.env.example', generateEnvTemplate(networks)],
      ['contracts/Greeter.sol', generateSampleContract()],
      [`scripts/deploy.${ext}`, generateSampleDeployScript(typescript)],
      [`test/Greeter.test.${ext}`, generateSampleTest(typescript)],
      [`ignition/modules/Greeter.${ext}`, generateSampleIgnitionModule()],
      ['.gitignore', generateGitignore()],
      ['README.md', generateReadme()],
    ];
    if (typescript) {
      files.push(['tsconfig.json', generateTsConfig()]);
    }
    for (const [name, content] of files) {
      await fs.writeFile(path.join(directory, name), content);
    }

    // package.json: Hardhat 3 projects must be ESM
    const packageJsonPath = path.join(directory, 'package.json');
    let packageJson: Record<string, any>;
    try {
      packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      if (packageJson.type !== 'module') {
        packageJson.type = 'module';
        warnings.push('Set "type": "module" in package.json (required by Hardhat 3)');
      }
    } catch {
      packageJson = {
        name:
          path
            .basename(directory)
            .replace(/[^a-z0-9._-]/gi, '-')
            .toLowerCase() || 'hedera-hardhat',
        version: '1.0.0',
        private: true,
        type: 'module',
        description: 'Hedera Hardhat Project',
        scripts: {},
        devDependencies: {},
      };
    }
    packageJson.scripts = {
      compile: 'hardhat compile',
      test: 'hardhat test',
      deploy: `hardhat run scripts/deploy.${ext} --network testnet`,
      ...(packageJson.scripts || {}),
    };
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

    let install: { ran: boolean; ok: boolean; output?: string } = { ran: false, ok: false };
    if (!args.skipInstall) {
      const packages = [
        HARDHAT_SCAFFOLD_PACKAGES.hardhat,
        HARDHAT_SCAFFOLD_PACKAGES.toolbox,
        HARDHAT_SCAFFOLD_PACKAGES.dotenv,
        ...(typescript ? HARDHAT_SCAFFOLD_PACKAGES.typescript : []),
      ];
      logger.info('Installing Hardhat dependencies', { directory, packages });
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const result = await runCommand(
        npm,
        ['install', '--save-dev', '--no-audit', '--no-fund', ...packages],
        directory,
        NPM_INSTALL_TIMEOUT_MS
      );
      const output = `${result.stdout}\n${result.stderr}`.trim();
      logger.info('npm install finished', {
        exitCode: result.exitCode,
        output: output.slice(-2000),
      });
      install = { ran: true, ok: result.exitCode === 0, output: output.slice(-1500) };
      if (!install.ok) {
        return {
          success: false,
          error: `Project files were written to ${directory}, but npm install failed (exit ${result.exitCode}). Run it manually.\n${output.slice(-2000)}`,
          data: { directory, files: files.map(([name]) => name) },
          metadata: metadata(command),
        };
      }
    }

    logger.info('Hardhat project initialized successfully', { directory });

    return {
      success: true,
      data: {
        directory,
        networks,
        typescript,
        hardhat: 'Hardhat 3 (ESM) with @nomicfoundation/hardhat-toolbox-mocha-ethers',
        files: files.map(([name]) => name),
        installed: install.ran
          ? 'Dependencies installed'
          : 'Dependencies not installed (skipInstall); run `npm install --save-dev ' +
            `${HARDHAT_SCAFFOLD_PACKAGES.hardhat} ${HARDHAT_SCAFFOLD_PACKAGES.toolbox} ${HARDHAT_SCAFFOLD_PACKAGES.dotenv}\``,
        warnings: warnings.length > 0 ? warnings : undefined,
        nextSteps: [
          `hardhat_project compile (directory: ${directory})`,
          `hardhat_project test (directory: ${directory})`,
          'hardhat_contract deploy with contractName "Greeter" and constructorArgs ["Hello, Hedera!"] on testnet (uses the MCP operator key)',
        ],
      },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Hardhat initialization failed', { error });
    return failure(error, 'Initialization failed', command);
  }
}

/**
 * 2. Compile contracts
 */
export async function hardhatCompile(args: {
  force?: boolean;
  directory?: string;
}): Promise<ToolResult> {
  const command = 'hardhat compile';
  try {
    const result = await hardhatService.compile({ force: args.force }, args.directory);

    if (!result.success) {
      return {
        success: false,
        error: result.errors?.join('\n') || 'Compilation failed',
        data: { output: result.output },
        metadata: metadata(command),
      };
    }
    return {
      success: true,
      data: {
        artifactCount: result.artifacts?.length || 0,
        artifacts: result.artifacts,
        warnings: result.warnings,
        output: result.output,
      },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Compilation failed', { error });
    return failure(error, 'Compilation failed', command);
  }
}

/**
 * 3. Run tests
 */
export async function hardhatTest(args: {
  testFiles?: string[];
  grep?: string;
  network?: string;
  directory?: string;
}): Promise<ToolResult> {
  const command = 'hardhat test';
  try {
    const result = await hardhatService.test(
      { testFiles: args.testFiles, grep: args.grep, network: args.network },
      args.directory
    );

    return {
      success: result.success,
      error: result.success
        ? undefined
        : result.failed
          ? `${result.failed} test(s) failed`
          : 'Test run failed',
      data: {
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        durationMs: result.duration,
        failures: result.failures,
        output: result.output,
      },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Tests failed', { error });
    return failure(error, 'Tests failed', command);
  }
}

/**
 * 4. Clean artifacts
 */
export async function hardhatClean(args: { directory?: string } = {}): Promise<ToolResult> {
  const command = 'hardhat clean';
  try {
    const result = await hardhatService.clean(args.directory);
    return {
      success: true,
      data: { message: 'Artifacts and cache cleaned', output: result.output || undefined },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Clean failed', { error });
    return failure(error, 'Clean failed', command);
  }
}

/**
 * 5. Deploy a contract: from compiled artifacts through the JSON-RPC relay
 *    (contractName) or by running a Hardhat script (script)
 */
export async function hardhatDeploy(args: {
  contractName?: string;
  constructorArgs?: any[];
  script?: string;
  network?: string;
  privateKey?: string;
  gasLimit?: number;
  value?: string;
  directory?: string;
}): Promise<ToolResult> {
  const command = args.script ? `hardhat run ${args.script}` : 'deploy via JSON-RPC relay';
  try {
    logger.info('Deploying contract', {
      contractName: args.contractName,
      script: args.script,
      network: args.network,
      directory: args.directory,
    });

    const result = await hardhatService.deploy(
      {
        contractName: args.contractName,
        constructorArgs: args.constructorArgs,
        deployScript: args.script,
        network: args.network,
        privateKey: args.privateKey,
        gasLimit: args.gasLimit,
        value: args.value,
      },
      args.directory
    );

    return {
      success: true,
      data: {
        contractName: args.contractName,
        address: result.address,
        transactionHash: result.transactionHash,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
        deployer: result.deployer,
        constructorArgs: result.constructorArgs,
        network: result.network,
        method: result.method,
        output: result.output,
        message:
          result.method === 'script'
            ? result.address
              ? `Script finished; deployed address parsed from output: ${result.address}`
              : 'Script finished (no address found in output)'
            : `Deployed ${args.contractName} at ${result.address} on ${result.network}`,
      },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Deployment failed', { error });
    return failure(error, 'Deployment failed', command);
  }
}

/**
 * 6. Verify contract: locate the build-info and explain the Sourcify route
 */
export async function hardhatVerify(args: {
  address: string;
  constructorArgs?: any[];
  directory?: string;
}): Promise<ToolResult> {
  const command = 'hardhat verify';
  try {
    logger.info('Getting verification file', { address: args.address, directory: args.directory });

    const verificationFile = await hardhatService.getVerificationFile(args.directory);

    if (!verificationFile) {
      return {
        success: false,
        error: 'No verification file found. Run hardhat compile first.',
        metadata: metadata(command),
      };
    }

    return {
      success: true,
      data: {
        message: 'Verification metadata ready',
        verificationFile,
        address: args.address,
        constructorArgs: args.constructorArgs,
        instructions: [
          'HashScan reads verification status from Sourcify (https://sourcify.dev). Either:',
          `a) Run: npx hardhat verify --network <network> ${args.address}${args.constructorArgs?.length ? ' <constructor args>' : ''} (requires @nomicfoundation/hardhat-verify 3.x with sourcify enabled; the HashPilot scaffold enables it)`,
          `b) Upload ${verificationFile} at https://verify.sourcify.dev/ for chain 296 (testnet) or 295 (mainnet)`,
          'c) Use the verify_contract tool once it targets the Sourcify v2 API',
          'Previewnet (297) is not supported by Sourcify.',
        ],
      },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Verification preparation failed', { error });
    return failure(error, 'Verification failed', command);
  }
}

/**
 * 7. Flatten contracts
 */
export async function hardhatFlatten(args: {
  files?: string[];
  directory?: string;
}): Promise<ToolResult> {
  const command = 'hardhat flatten';
  try {
    const flattened = await hardhatService.flatten(args.files, args.directory);
    return {
      success: true,
      data: { flattened, fileCount: args.files?.length || 0 },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Flatten failed', { error });
    return failure(error, 'Flatten failed', command);
  }
}

/**
 * 8. Configure/Add network: returns a Hardhat 3 network entry to paste
 */
export async function hardhatConfigAddNetwork(args: {
  network: HederaNetworkName | string;
  rpcUrl?: string;
  chainId?: number;
  privateKey?: string;
}): Promise<ToolResult> {
  const command = 'config add network';
  try {
    const known = HEDERA_NETWORKS[args.network as HederaNetworkName];
    const rpcUrl = args.rpcUrl || known?.rpcUrl;
    const chainId = args.chainId || known?.chainId;
    if (!rpcUrl || !chainId) {
      return {
        success: false,
        error: `Unknown network "${args.network}": pass rpcUrl and chainId, or use one of ${Object.keys(HEDERA_NETWORKS).join(', ')}`,
        metadata: metadata(command),
      };
    }
    const envPrefix = args.network.toUpperCase().replace(/[^A-Z0-9]/g, '_');

    return {
      success: true,
      data: {
        message: `Add this entry under "networks" in your hardhat.config (Hardhat 3 syntax):`,
        config: generateNetworkEntry({ name: args.network, rpcUrl, chainId }),
        envVars: [
          `${envPrefix}_RPC_URL=${rpcUrl}`,
          `${envPrefix}_PRIVATE_KEY=${args.privateKey || '0x<your ECDSA private key>'}`,
        ],
        note: 'When commands run through HashPilot these variables are injected from the MCP operator configuration.',
      },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Network configuration failed', { error });
    return failure(error, 'Configuration failed', command);
  }
}

/**
 * 9. Get compiled artifacts
 */
export async function hardhatGetArtifacts(args: {
  contractName?: string;
  directory?: string;
}): Promise<ToolResult> {
  const command = 'get artifacts';
  try {
    const artifacts = await hardhatService.getArtifacts(args.contractName, args.directory);
    return {
      success: true,
      data: { artifacts, count: artifacts.length },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Failed to get artifacts', { error });
    return failure(error, 'Failed to get artifacts', command);
  }
}

/**
 * 10. Call contract function (read-only, via eth_call)
 */
export async function hardhatCallContract(args: {
  address: string;
  abi?: any[];
  contractName?: string;
  method: string;
  args?: any[];
  network?: string;
  directory?: string;
}): Promise<ToolResult> {
  const command = 'contract call';
  try {
    const result = await hardhatService.callContract({
      address: args.address,
      abi: args.abi,
      contractName: args.contractName,
      functionName: args.method,
      args: args.args,
      network: args.network,
      directory: args.directory,
    });

    return {
      success: true,
      data: { method: args.method, result },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Contract call failed', { error });
    return failure(error, 'Contract call failed', command);
  }
}

/**
 * 11. Execute contract transaction (state-changing, signed with the operator or given key)
 */
export async function hardhatExecuteContract(args: {
  address: string;
  abi?: any[];
  contractName?: string;
  method: string;
  args?: any[];
  value?: string;
  gasLimit?: number;
  network?: string;
  privateKey?: string;
  directory?: string;
}): Promise<ToolResult> {
  const command = 'contract execute';
  try {
    const result = await hardhatService.executeContract({
      address: args.address,
      abi: args.abi,
      contractName: args.contractName,
      functionName: args.method,
      args: args.args,
      value: args.value,
      gasLimit: args.gasLimit,
      network: args.network,
      privateKey: args.privateKey,
      directory: args.directory,
    });

    return {
      success: true,
      data: {
        method: args.method,
        transactionHash: result.transactionHash,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
        status: result.status,
        from: result.from,
      },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Contract execution failed', { error });
    return failure(error, 'Contract execution failed', command);
  }
}

/**
 * 12. Get available accounts (the MCP operator, with its relay balance)
 */
export async function hardhatGetAccounts(
  args: { directory?: string; network?: string } = {}
): Promise<ToolResult> {
  const command = 'get accounts';
  try {
    const result = await hardhatService.getAccounts(args.directory, args.network);
    return {
      success: true,
      data: {
        accounts: result.accounts,
        count: result.accounts.length,
        network: result.network,
        message: result.message,
      },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Failed to get accounts', { error });
    return failure(error, 'Failed to get accounts', command);
  }
}

/**
 * 13. Deploy via Ignition
 */
export async function hardhatDeployIgnition(args: {
  module: string;
  parameters?: Record<string, unknown> | string;
  network?: string;
  deploymentId?: string;
  reset?: boolean;
  directory?: string;
}): Promise<ToolResult> {
  const command = 'ignition deploy';
  try {
    const result = await hardhatService.deployIgnition(
      {
        module: args.module,
        parameters: args.parameters,
        network: args.network,
        deploymentId: args.deploymentId,
        reset: args.reset,
      },
      args.directory
    );

    return {
      success: true,
      data: {
        message: 'Ignition deployment finished',
        module: args.module,
        network: result.network,
        deploymentId: result.deploymentId,
        addresses: result.addresses,
        output: result.output,
      },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Ignition deployment failed', { error });
    return failure(error, 'Ignition deployment failed', command);
  }
}

/**
 * 14. Run any Hardhat task
 */
export async function hardhatRunTask(args: {
  task: string;
  params?: Record<string, unknown> | unknown[];
  directory?: string;
}): Promise<ToolResult> {
  const command = `hardhat ${args.task}`;
  try {
    const result = await hardhatService.runTask(args.task, args.params, args.directory);
    return {
      success: true,
      data: {
        task: args.task,
        command: result.command,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(-8000),
        stderr: result.stderr.slice(-4000),
        durationMs: result.durationMs,
      },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Task execution failed', { error });
    return failure(error, 'Task execution failed', command);
  }
}

/**
 * 15. List available tasks
 */
export async function hardhatListTasks(args: { directory?: string } = {}): Promise<ToolResult> {
  const command = 'hardhat --help';
  try {
    const tasks = await hardhatService.listTasks(args.directory);
    return {
      success: true,
      data: { tasks, count: tasks.length },
      metadata: metadata(command),
    };
  } catch (error) {
    logger.error('Failed to list tasks', { error });
    return failure(error, 'Failed to list tasks', command);
  }
}
