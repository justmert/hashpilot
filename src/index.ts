#!/usr/bin/env node
/**
 * HashPilot MCP Server
 * Production-ready MCP server for Hedera development
 * Composite tools following MCP best practices (count reported by health_check)
 */

// CRITICAL: Redirect console.log to stderr BEFORE any imports
// Some SDKs (e.g., Stablecoin Studio) have hardcoded console.log statements
// that corrupt MCP's JSON-RPC protocol on stdout
console.log = (...args: unknown[]) => {
  console.error('[LOG]', ...args);
};

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import logger from './utils/logger.js';
import { getHederaConfig } from './utils/config.js';
import { createRAGConfig } from './config/rag.js';
import { getPackageVersion } from './utils/version.js';
import { validateToolArguments } from './utils/validate-args.js';

const SERVER_VERSION: string = getPackageVersion();

// Core Hedera Operations (kept as individual tools for clarity)
import { getAccountBalance, getAccountInfo, createAccount, transferHbar } from './tools/account.js';
import { getCurrentNetwork, switchNetwork } from './tools/network.js';

// Composite Tools (consolidated operations)
import {
  tokenManage,
  addressBookManage,
  stateManage,
  hcsTopicManage,
  hcsMessageManage,
  compositeToolDefinitions,
  hardhatProjectManage,
  hardhatContractManage,
  foundryProjectManage,
  foundryContractManage,
  hardhatFoundryToolDefinitions,
} from './tools/composite.js';

// RPC Operations
import { rpcCall, rpcCallContract, rpcDeployContract, rpcExecuteContract } from './tools/rpc.js';

// RAG & Code Generation
import { docsSearch, docsAsk, docsGetExample, codeGenerate } from './tools/rag.js';

// Deployment & Verification
import { deployContract, deploymentHistory } from './tools/deploy.js';
import { verifyContract } from './tools/verify.js';

// Stablecoin Studio
import { stablecoinManage, stablecoinToolDefinition } from './tools/stablecoin.js';

// Mirror Node (keeping essential query tools - consider converting to Resources in future)
import { mirrorQueryAccount, mirrorQuery, mirrorQueryTool } from './tools/mirror-node.js';
import { graphqlManage, graphqlTool } from './tools/graphql.js';
import { hederaClient } from './services/hedera-client.js';

// Error Analysis
import { errorExplain, errorAnalysisToolDefinition } from './tools/error-analysis.js';

const server = new Server(
  {
    name: 'hashpilot',
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

/**
 * Probe a URL with a short timeout; returns a status string for health output
 */
async function probe(url: string, timeoutMs = 4000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok ? 'reachable' : `http ${response.status}`;
  } catch (error) {
    return `unreachable (${error instanceof Error ? error.message : String(error)})`;
  } finally {
    clearTimeout(timer);
  }
}

// Health check
async function healthCheck(
  args: { verbose?: boolean } = {}
): Promise<{ success: boolean; data: any }> {
  const hedera = getHederaConfig();
  const data: Record<string, unknown> = {
    status: 'healthy',
    version: SERVER_VERSION,
    toolCount: optimizedToolDefinitions.length,
    network: hedera.network,
    operatorConfigured: Boolean(hedera.operatorId && hedera.operatorKey),
    operatorId: hedera.operatorId || null,
  };

  if (args.verbose) {
    const rag = createRAGConfig();
    const mirrorUrl = hederaClient.getMirrorNodeUrl();
    const [mirrorNode, chroma] = await Promise.all([
      probe(`${mirrorUrl}/api/v1/network/nodes?limit=1`),
      probe(`${rag.chromaUrl.replace(/\/+$/, '')}/api/v2/heartbeat`),
    ]);
    data.services = {
      mirrorNode: { url: mirrorUrl, status: mirrorNode },
      jsonRpcRelay: { url: hederaClient.getJsonRpcRelayUrl() },
      chromadb: { url: rag.chromaUrl, status: chroma, ragEnabled: Boolean(rag.openaiApiKey) },
    };
    data.system = { node: process.version, platform: process.platform, arch: process.arch };
  }

  return { success: true, data };
}

/**
 * OPTIMIZED TOOL DEFINITIONS
 * Consolidated from ~120 granular tools into composite ones
 * Following MCP best practices:
 * - Composite patterns for related operations
 * - Clear, intent-based descriptions
 * - Focused, atomic operations
 */
const optimizedToolDefinitions = [
  // Health Check (1 tool)
  {
    name: 'health_check',
    description:
      'Check HashPilot MCP server health and status. Returns version, tool count, network, and whether an operator is configured. With verbose=true also probes the Mirror Node and the ChromaDB host behind the docs tools.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        verbose: {
          type: 'boolean',
          description: 'Include service reachability and runtime details',
        },
      },
    },
  },

  // Account Operations (4 tools - essential, kept separate for clarity)
  {
    name: 'account_create',
    description: `Create a new Hedera account with customizable parameters: balance allocation, key type, automatic token associations and staking.

CREATES: New account with an auto-generated ECDSA or ED25519 key pair (or use a provided public key)
FUNDS: Initial HBAR balance from operator account
RETURNS: Account ID, private key (DER and raw hex), key type, public key, transaction ID

KEY TYPES: ecdsa (default) also gives the account an EVM address and works with Hardhat, Foundry and JSON-RPC. ed25519 is native Hedera only.

USE FOR: Creating new accounts for testing, development, or production workflows.
COSTS: Network fee + initial balance (minimum 1 HBAR recommended)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        initialBalance: { type: 'number', description: 'Initial HBAR balance (default: 1)' },
        keyType: {
          type: 'string',
          enum: ['ecdsa', 'ed25519'],
          description:
            'Curve for the generated key pair (default: ecdsa). Ignored when publicKey is given.',
        },
        memo: { type: 'string', description: 'Account memo (max 100 chars)' },
        publicKey: {
          type: 'string',
          description: 'Optional: Provide an existing public key (DER or raw hex)',
        },
        maxAutomaticTokenAssociations: {
          type: 'number',
          description:
            'Tokens the account may auto-associate with, so it can receive them without a prior associate call. -1 means unlimited.',
          minimum: -1,
        },
        stakedAccountId: {
          type: 'string',
          description: 'Stake this account to another account (format: 0.0.xxxxx)',
        },
        stakedNodeId: {
          type: 'number',
          description: 'Stake this account to a node ID. Mutually exclusive with stakedAccountId.',
          minimum: 0,
        },
        declineStakingReward: {
          type: 'boolean',
          description: 'Decline staking rewards (default: false)',
        },
      },
    },
  },
  {
    name: 'account_balance',
    description: `Query HBAR and token balances for any Hedera account.

RETURNS: HBAR balance in ℏ format, list of all associated token balances (raw units, apply token decimals)
FREE: No transaction fee (Mirror Node REST query, no operator required)

USE FOR: Checking account balances, monitoring funds, verifying token holdings.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: { type: 'string', description: 'Account ID (format: 0.0.xxxxx)' },
      },
      required: ['accountId'],
    },
  },
  {
    name: 'account_info',
    description: `Get comprehensive Hedera account information.

RETURNS: Balance, EVM address, public key and key type, memo, auto-renew period, expiration, staking info
FREE: No transaction fee (Mirror Node REST query, no operator required)

USE FOR: Account inspection, EVM address lookup, key verification, expiration monitoring.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: { type: 'string', description: 'Account ID (format: 0.0.xxxxx)' },
      },
      required: ['accountId'],
    },
  },
  {
    name: 'transfer_hbar',
    description: `Transfer HBAR between Hedera accounts.

EXECUTES: CryptoTransfer transaction from source to destination
REQUIRES: Operator account must be source OR have signing authority
COSTS: Standard network transaction fee

USE FOR: Funding accounts, payments, moving HBAR between wallets.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Source account ID' },
        to: { type: 'string', description: 'Destination account ID' },
        amount: { type: 'number', description: 'HBAR amount to transfer' },
      },
      required: ['from', 'to', 'amount'],
    },
  },

  // Network Operations (2 tools)
  {
    name: 'network_info',
    description: `Get current Hedera network configuration.

RETURNS: Network name, Mirror Node URL, JSON-RPC Relay endpoint
USE FOR: Verifying active network, getting endpoint URLs, network status.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'network_switch',
    description: `Switch between Hedera networks seamlessly.

NETWORKS: mainnet (production), testnet (testing), previewnet (preview), local (development)
UPDATES: All SDK connections, Mirror Node URLs, RPC endpoints automatically

USE FOR: Multi-network development, testing across environments, production deployment.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: {
          type: 'string',
          enum: ['mainnet', 'testnet', 'previewnet', 'local'],
          description: 'Target network',
        },
      },
      required: ['network'],
    },
  },

  // Composite Tools (5 tools - consolidated from 24)
  ...compositeToolDefinitions,

  // RPC Operations (4 tools)
  {
    name: 'rpc_call',
    description: `Execute ANY JSON-RPC method on Hedera's JSON-RPC Relay.

SUPPORTS: 55+ methods including eth_*, web3_*, net_*, debug_*
EXAMPLES: eth_blockNumber, eth_getBalance, eth_call, eth_getLogs, eth_sendRawTransaction
DECODES: Results automatically converted to human-readable format

USE FOR: EVM-compatible operations, blockchain state queries, transaction submission.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        method: { type: 'string', description: 'RPC method name (e.g., "eth_blockNumber")' },
        params: {
          type: 'array',
          items: {},
          description: 'Method parameters as array',
        },
        network: {
          type: 'string',
          enum: ['mainnet', 'testnet', 'previewnet', 'local'],
          description: 'Target network (default: current)',
        },
      },
      required: ['method'],
    },
  },
  {
    name: 'rpc_call_contract',
    description: `Call read-only smart contract function via eth_call (FREE - no gas cost).

EXECUTES: View/pure function on deployed contract
DECODES: Return values using provided ABI
FREE: No transaction fee, no state changes

USE FOR: Reading contract state, querying balances, checking conditions.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractAddress: { type: 'string', description: 'Contract address (0x...)' },
        abi: { type: 'array', items: {}, description: 'Contract ABI' },
        functionName: { type: 'string', description: 'Function to call' },
        args: { type: 'array', items: {}, description: 'Function arguments' },
        blockNumber: {
          type: 'string',
          description: 'Block to read at: a hex block number, "latest" (default), or "earliest"',
        },
        network: {
          type: 'string',
          enum: ['mainnet', 'testnet', 'previewnet', 'local'],
          description: 'Target network (default: current)',
        },
      },
      required: ['contractAddress', 'abi', 'functionName'],
    },
  },
  {
    name: 'rpc_deploy_contract',
    description: `Deploy smart contract to Hedera via JSON-RPC.

HANDLES: Bytecode deployment, constructor encoding, gas estimation, receipt polling
RETURNS: Contract address, transaction hash, deployment details
COSTS: Gas fees for contract creation
AUTO-KEY: privateKey is OPTIONAL - automatically uses MCP operator account if not provided

USE FOR: Deploying Solidity contracts to Hedera EVM.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        bytecode: { type: 'string', description: 'Contract bytecode (0x...)' },
        abi: { type: 'array', items: {}, description: 'Contract ABI' },
        constructorArgs: { type: 'array', items: {}, description: 'Constructor arguments' },
        privateKey: {
          type: 'string',
          description: 'Deployer private key (optional - uses MCP operator)',
        },
        fromAlias: {
          type: 'string',
          description: 'Address book alias whose stored key signs the transaction',
        },
        gasLimit: { type: 'number', description: 'Gas limit (default: estimated + 20%)' },
        network: {
          type: 'string',
          enum: ['mainnet', 'testnet', 'previewnet', 'local'],
          description: 'Target network (default: current)',
        },
      },
      required: ['bytecode'],
    },
  },
  {
    name: 'rpc_execute_contract',
    description: `Execute state-changing contract function via eth_sendRawTransaction.

EXECUTES: Transaction that modifies contract state
HANDLES: Function encoding, signing, gas estimation, receipt polling
COSTS: Gas fees for execution
RETURNS: Transaction hash, receipt, decoded logs
AUTO-KEY: privateKey is OPTIONAL - automatically uses MCP operator account if not provided

USE FOR: Token transfers, contract interactions, state modifications.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractAddress: { type: 'string', description: 'Contract address (0x...)' },
        abi: { type: 'array', items: {}, description: 'Contract ABI' },
        functionName: { type: 'string', description: 'Function to execute' },
        args: { type: 'array', items: {}, description: 'Function arguments' },
        privateKey: {
          type: 'string',
          description: 'Sender private key (optional - uses MCP operator)',
        },
        value: { type: 'string', description: 'HBAR value to send (in wei)' },
        fromAlias: {
          type: 'string',
          description: 'Address book alias whose stored key signs the transaction',
        },
        gasLimit: { type: 'number', description: 'Gas limit (default: estimated + 20%)' },
        network: {
          type: 'string',
          enum: ['mainnet', 'testnet', 'previewnet', 'local'],
          description: 'Target network (default: current)',
        },
      },
      required: ['contractAddress', 'abi', 'functionName'],
    },
  },

  // RAG & Code Generation (4 tools)
  {
    name: 'docs_search',
    description: `Semantic search across complete Hedera documentation.

INDEXED: Official docs, SDK references (JS/Java/Go/Rust/Python), tutorials, HIPs, service specs
RETURNS: Ranked results with titles, URLs, excerpts, relevance scores
FILTERS: By content type (tutorial/api/concept/example), language, code presence

USE FOR: Finding specific documentation, discovering relevant tutorials, locating API references.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query in natural language' },
        limit: { type: 'number', description: 'Max results (default: 5, max: 20)' },
        contentType: {
          type: 'string',
          enum: ['tutorial', 'api', 'concept', 'example', 'guide', 'reference'],
        },
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'java', 'python', 'go', 'solidity'],
        },
        hasCode: { type: 'boolean', description: 'Only return chunks that contain code' },
        queryType: {
          type: 'string',
          enum: [
            'conceptual',
            'how_to',
            'comparison',
            'troubleshooting',
            'best_practices',
            'use_case',
            'general',
          ],
          description: 'Optimise ranking for this kind of question',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'docs_ask',
    description: `Answer ANY knowledge question about Hedera using RAG.

HANDLES: Conceptual (what is X?), how-to (how do I?), comparison (X vs Y), troubleshooting, best practices, architecture, security
RETURNS: Comprehensive answer with code examples and source citations
EXPERTISE: Adjustable for beginner/intermediate/advanced levels

USE FOR: Learning Hedera concepts, getting implementation guidance, understanding best practices.
THIS IS YOUR PRIMARY TOOL FOR HEDERA KNOWLEDGE QUESTIONS.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        question: { type: 'string', description: 'Question about Hedera' },
        expertiseLevel: {
          type: 'string',
          enum: ['beginner', 'intermediate', 'advanced'],
          description: 'User expertise level',
        },
        includeCodeExamples: { type: 'boolean', description: 'Include code in answer' },
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'java', 'python', 'go', 'solidity'],
          description: 'Preferred language for examples',
        },
        contentType: {
          type: 'string',
          enum: ['tutorial', 'api', 'concept', 'example', 'guide', 'reference'],
          description: 'Restrict the retrieved context to one kind of document',
        },
        queryIntent: {
          type: 'string',
          enum: [
            'conceptual',
            'how_to',
            'comparison',
            'troubleshooting',
            'best_practices',
            'use_case',
            'architecture',
            'migration',
            'security',
            'general',
          ],
          description: 'Shape the answer for this kind of question',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'docs_get_example',
    description: `Find working code examples for Hedera functionality.

SEARCHES: SDK examples, tutorials, implementation patterns
RETURNS: Annotated code with explanations and source references
LANGUAGES: JavaScript, TypeScript, Java, Python, Go, Rust, Solidity

USE FOR: Getting implementation code, learning patterns, finding SDK usage.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        description: { type: 'string', description: 'What code you need' },
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'java', 'python', 'go', 'rust', 'solidity'],
        },
        complexity: {
          type: 'string',
          enum: ['simple', 'intermediate', 'advanced'],
        },
        limit: { type: 'number', description: 'Max examples (default: 5)' },
      },
      required: ['description'],
    },
  },
  {
    name: 'code_generate',
    description: `Generate context-aware Hedera SDK code from natural language.

CREATES: Complete, runnable code with imports, error handling, best practices
LANGUAGES: JavaScript, TypeScript, Java, Python, Go, Solidity
STYLES: minimal (core logic), complete (with setup), production (full best practices)

USE FOR: Creating new implementations, generating boilerplate, scaffolding projects.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        description: { type: 'string', description: 'What code to generate' },
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'java', 'python', 'go', 'solidity'],
          description: 'Target language (default: javascript)',
        },
        style: {
          type: 'string',
          enum: ['minimal', 'complete', 'production'],
          description: 'Code style (default: complete)',
        },
        includeImports: { type: 'boolean', description: 'Include imports (default: true)' },
        includeErrorHandling: { type: 'boolean', description: 'Include try-catch (default: true)' },
      },
      required: ['description'],
    },
  },

  // Deployment & Verification (4 tools)
  {
    name: 'deploy_contract',
    description: `Deploy smart contract to Hedera with unified interface.

AUTO-DETECTS: Hardhat or Foundry project framework
SUPPORTS: Constructor arguments, gas limits, auto-verification
TRACKS: Deployment history with metadata

USE FOR: Production contract deployment, automated workflows, verified deployments.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractName: { type: 'string', description: 'Contract name' },
        network: {
          type: 'string',
          enum: ['mainnet', 'testnet', 'previewnet'],
          description: 'Target network',
        },
        constructorArgs: { type: 'array', items: {}, description: 'Constructor arguments' },
        verify: { type: 'boolean', description: 'Auto-verify on HashScan' },
        framework: {
          type: 'string',
          enum: ['hardhat', 'foundry', 'direct'],
          description: 'Framework (auto-detected if not specified)',
        },
        privateKey: {
          type: 'string',
          description: 'Deployer private key (optional - uses MCP operator)',
        },
        fromAlias: {
          type: 'string',
          description: 'Address book alias whose stored key deploys the contract',
        },
        gasLimit: { type: 'number', description: 'Gas limit for the deployment' },
        metadata: {
          type: 'object',
          description: 'Free-form metadata stored with the deployment record',
        },
      },
      required: ['contractName', 'network'],
    },
  },
  {
    name: 'verify_contract',
    description: `Verify smart contract source on Sourcify, which HashScan reads its verified badge from.

METHODS (best first): Hardhat build-info, Foundry artifact, raw source upload
RETURNS: Match quality (perfect = exact, partial = metadata differs), HashScan URL

NETWORKS: mainnet (chain 295) and testnet (chain 296) only. Sourcify does not support previewnet.

Prefer buildInfoPath or artifactPath: they carry the exact compiler version and settings.
Raw source upload has to assume them and usually fails to match unless they are supplied.

USE FOR: Contract transparency, code verification, public auditability.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Contract address (0x...)',
          pattern: '^0x[a-fA-F0-9]{40}$',
        },
        network: {
          type: 'string',
          description: 'Hedera network. Sourcify does not verify previewnet.',
          enum: ['mainnet', 'testnet'],
        },
        contractName: { type: 'string', description: 'Contract name, e.g. "Greeter"' },
        filePath: {
          type: 'string',
          description:
            'Path to a .sol file or a directory of .sol files. Used when no buildInfoPath or artifactPath is given.',
        },
        buildInfoPath: {
          type: 'string',
          description:
            'Preferred for Hardhat: path to artifacts/build-info/<hash>.json, which embeds the full standard JSON input and the exact compiler version.',
        },
        artifactPath: {
          type: 'string',
          description:
            'Preferred for Foundry: path to out/<Source>.sol/<Contract>.json. Sources are read from the project root inferred from this path.',
        },
        creatorTxHash: {
          type: 'string',
          description:
            'Optional: hash of the contract creation transaction, so Sourcify can also match the creation bytecode.',
          pattern: '^0x[a-fA-F0-9]{64}$',
        },
        compilerVersion: {
          type: 'string',
          description:
            'Optional, raw-source path only: solc version such as "0.8.28" or "0.8.28+commit.7893614a". Defaults to the source pragma.',
        },
        optimizerEnabled: {
          type: 'boolean',
          description:
            'Optional, raw-source path only: whether the optimizer was on (default false)',
        },
        optimizerRuns: {
          type: 'number',
          description: 'Optional, raw-source path only: optimizer runs (default 200)',
        },
        evmVersion: {
          type: 'string',
          description: 'Optional, raw-source path only: EVM version, e.g. "paris", "cancun"',
        },
      },
      required: ['address', 'network', 'contractName'],
    },
  },
  {
    name: 'deployment_history',
    description: `View deployment history with filtering and export.

FILTERS: By network, contract name, status
EXPORTS: JSON, CSV, or Markdown format

USE FOR: Tracking deployments, auditing, documentation.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: {
          type: 'string',
          enum: ['mainnet', 'testnet', 'previewnet'],
        },
        contractName: { type: 'string', description: 'Filter by name' },
        status: {
          type: 'string',
          enum: ['pending', 'deploying', 'deployed', 'failed', 'verified'],
          description: 'Filter by deployment status',
        },
        limit: { type: 'number', description: 'Max results (default: 20)' },
        offset: { type: 'number', description: 'Skip this many records (paging)' },
        exportFormat: {
          type: 'string',
          enum: ['json', 'csv', 'markdown'],
        },
      },
    },
  },
  {
    name: 'mirror_query_account',
    description: `Query comprehensive account data from Hedera Mirror Node REST API.

RETURNS: Balance, EVM address, creation time, keys, memo, transactions (optional)
FREE: No transaction fees (REST API query)

USE FOR: Account inspection, transaction history, state verification.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: { type: 'string', description: 'Account ID (0.0.xxxxx)' },
        includeTransactions: { type: 'boolean', description: 'Include recent transactions' },
        transactionLimit: { type: 'number', description: 'Transaction count (default: 20)' },
        timestamp: {
          type: 'string',
          description:
            'Consensus timestamp to read the account state at, e.g. 1700000000.000000000',
        },
      },
      required: ['accountId'],
    },
  },
  // Every other Mirror Node query, as resources of one tool
  mirrorQueryTool,
  // GraphQL over indexed Mirror Node data (Hgraph)
  graphqlTool,

  // Hardhat & Foundry Integration Tools (4 composite tools)
  ...hardhatFoundryToolDefinitions,

  // Stablecoin Studio (1 composite tool)
  stablecoinToolDefinition,

  // Error Analysis (1 tool - 50+ error codes with debugging guidance)
  errorAnalysisToolDefinition,
];

// Tool count is derived from this array; do not hardcode it elsewhere
// M3 deliverables complete with optimized composite integrations (32 operations in 4 tools)
// Plus enterprise stablecoin management (18 operations in 1 tool)
// Plus error_explain with 55+ Hedera error codes and debugging guidance

/**
 * Handle tool listing - OPTIMIZED
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Return all optimized tools including M3 integrations
  return {
    tools: optimizedToolDefinitions,
  };
});

/**
 * Handle tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  logger.info('Tool called', { name, args });

  const validationError = validateToolArguments(optimizedToolDefinitions, name, args);
  if (validationError) {
    logger.warn('Tool call rejected by schema validation', { name, validationError });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: false, error: validationError }, null, 2),
        },
      ],
      isError: true,
    };
  }

  let result;

  try {
    switch (name) {
      // Health
      case 'health_check':
        result = await healthCheck(args as { verbose?: boolean });
        break;

      // Account Operations
      case 'account_create':
        result = await createAccount(args as any);
        break;
      case 'account_balance':
        result = await getAccountBalance(args as { accountId: string });
        break;
      case 'account_info':
        result = await getAccountInfo(args as { accountId: string });
        break;
      case 'transfer_hbar':
        result = await transferHbar(args as { from: string; to: string; amount: number });
        break;

      // Network Operations
      case 'network_info':
        result = await getCurrentNetwork();
        break;
      case 'network_switch':
        result = await switchNetwork(
          args as { network: 'mainnet' | 'testnet' | 'previewnet' | 'local' }
        );
        break;

      // Composite Tools
      case 'token_manage':
        result = await tokenManage(args as any);
        break;
      case 'addressbook_manage':
        result = await addressBookManage(args as any);
        break;
      case 'state_manage':
        result = await stateManage(args as any);
        break;
      case 'hcs_topic':
        result = await hcsTopicManage(args as any);
        break;
      case 'hcs_message':
        result = await hcsMessageManage(args as any);
        break;

      // RPC Operations
      case 'rpc_call':
        result = await rpcCall(args as any);
        break;
      case 'rpc_call_contract':
        result = await rpcCallContract(args as any);
        break;
      case 'rpc_deploy_contract':
        result = await rpcDeployContract(args as any);
        break;
      case 'rpc_execute_contract':
        result = await rpcExecuteContract(args as any);
        break;

      // RAG & Code Generation
      case 'docs_search':
        result = await docsSearch(args as any);
        break;
      case 'docs_ask':
        result = await docsAsk(args as any);
        break;
      case 'docs_get_example':
        result = await docsGetExample(args as any);
        break;
      case 'code_generate':
        result = await codeGenerate(args as any);
        break;

      // Deployment & Verification
      case 'deploy_contract':
        result = await deployContract(args as any);
        break;
      case 'verify_contract':
        result = await verifyContract(args as any);
        break;
      case 'deployment_history':
        result = await deploymentHistory(args as any);
        break;
      case 'mirror_query_account':
        result = await mirrorQueryAccount(args as any);
        break;

      case 'mirror_query':
        result = await mirrorQuery(args as any);
        break;

      case 'graphql':
        result = await graphqlManage(args as any);
        break;

      // Hardhat & Foundry Composite Tools
      case 'hardhat_project':
        result = await hardhatProjectManage(args as any);
        break;
      case 'hardhat_contract':
        result = await hardhatContractManage(args as any);
        break;
      case 'foundry_project':
        result = await foundryProjectManage(args as any);
        break;
      case 'foundry_contract':
        result = await foundryContractManage(args as any);
        break;

      // Stablecoin Studio Composite Tool
      case 'stablecoin_manage':
        result = await stablecoinManage(args as any);
        break;

      // Error Analysis
      case 'error_explain':
        result = await errorExplain(args as any);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // Tools that already produce MCP content (the docs/RAG tools) are passed
    // through as-is; wrapping them again would hand clients escaped JSON.
    if (
      result &&
      typeof result === 'object' &&
      Array.isArray((result as { content?: unknown }).content)
    ) {
      return result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    }

    // Format result for MCP
    // Handle different result formats (some tools return raw data, others return ToolResult)
    const hasSuccess = 'success' in result;
    const isSuccess = hasSuccess ? (result as any).success : true;

    if (isSuccess) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: true,
      };
    }
  } catch (error) {
    logger.error('Tool execution failed', { name, error });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        },
      ],
      isError: true,
    };
  }
});

/**
 * Resources - For read-only data (to be expanded)
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  throw new Error(`Resource not found: ${uri}`);
});

/**
 * Prompts - Reusable conversation templates (to be expanded)
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name } = request.params;
  throw new Error(`Prompt not found: ${name}`);
});

/**
 * Start Server
 */
let shuttingDown = false;

/**
 * Shut down cleanly when the client goes away.
 *
 * The Hedera SDK client holds open gRPC connections, which keep the Node event
 * loop alive: without this the process survived its MCP client disconnecting
 * and every session leaked a server process still holding those connections.
 */
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  logger.info('Shutting down HashPilot MCP Server', { reason });

  try {
    hederaClient.close();
  } catch (error) {
    logger.warn('Error closing Hedera client during shutdown', { error });
  }

  try {
    await server.close();
  } catch (error) {
    logger.warn('Error closing MCP server during shutdown', { error });
  }

  process.exit(0);
}

async function main() {
  const transport = new StdioServerTransport();

  // The client disconnecting closes the transport; treat that as shutdown.
  transport.onclose = () => {
    void shutdown('transport closed');
  };

  await server.connect(transport);

  // StdioServerTransport only subscribes to stdin's 'data' and 'error' events,
  // so `onclose` above never fires when the client simply goes away and closes
  // the pipe. Watch for end-of-input directly.
  process.stdin.on('end', () => {
    void shutdown('stdin ended');
  });
  process.stdin.on('close', () => {
    void shutdown('stdin closed');
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  logger.info('HashPilot MCP Server running', {
    toolCount: optimizedToolDefinitions.length,
    version: SERVER_VERSION,
  });
}

main().catch((error) => {
  logger.error('Server failed to start', { error });
  process.exit(1);
});
