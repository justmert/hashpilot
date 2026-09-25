/**
 * Mirror Node REST API Tools
 * Direct access to Hedera Mirror Node using official REST API
 * No external dependencies required (no API keys)
 */

import { mirrorNodeService } from '../services/mirror-node-service.js';
import logger from '../utils/logger.js';
import { ToolResult } from '../types/index.js';

/**
 * Query account information from Mirror Node
 */
export async function mirrorQueryAccount(args: {
  accountId: string;
  timestamp?: string;
  includeTransactions?: boolean;
  transactionLimit?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Querying account from Mirror Node', { accountId: args.accountId });

    const account = await mirrorNodeService.getAccount(args.accountId, {
      timestamp: args.timestamp,
    });

    // Recent transactions are a separate REST call, so only make it on request
    let transactions: unknown[] | undefined;
    if (args.includeTransactions) {
      const response = await mirrorNodeService.getTransactions({
        accountId: args.accountId,
        limit: args.transactionLimit ?? 20,
        order: 'desc',
      });
      transactions = response.transactions;
    }

    return {
      success: true,
      data: {
        accountId: account.account,
        evmAddress: account.evm_address,
        balance: {
          hbar: account.balance.balance / 100_000_000, // Convert tinybar to HBAR
          tokens: account.balance.tokens,
        },
        alias: account.alias,
        memo: account.memo,
        createdTimestamp: account.created_timestamp,
        expiryTimestamp: account.expiry_timestamp,
        autoRenewPeriod: account.auto_renew_period,
        deleted: account.deleted,
        ethereumNonce: account.ethereum_nonce,
        maxAutoTokenAssociations: account.max_automatic_token_associations,
        stakedNodeId: account.staked_node_id,
        stakedAccountId: account.staked_account_id,
        pendingReward: account.pending_reward,
        declineReward: account.decline_reward,
        key: account.key,
        ...(transactions ? { transactions, transactionCount: transactions.length } : {}),
      },
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to query account', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
      },
    };
  }
}

/**
 * Query transactions from Mirror Node
 */
export async function mirrorQueryTransactions(args: {
  accountId?: string;
  limit?: number;
  order?: 'asc' | 'desc';
  timestamp?: string;
  result?: string;
  transactionType?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Querying transactions from Mirror Node', args);

    const response = await mirrorNodeService.getTransactions({
      accountId: args.accountId,
      limit: args.limit || 10,
      order: args.order || 'desc',
      timestamp: args.timestamp,
      result: args.result,
      transactionType: args.transactionType,
    });

    const transactions = response.transactions.map((tx) => ({
      transactionId: tx.transaction_id,
      transactionHash: tx.transaction_hash,
      consensusTimestamp: tx.consensus_timestamp,
      type: tx.name,
      result: tx.result,
      chargedFee: tx.charged_tx_fee / 100_000_000, // Convert to HBAR
      maxFee: parseInt(tx.max_fee) / 100_000_000,
      memo: tx.memo_base64 ? Buffer.from(tx.memo_base64, 'base64').toString() : '',
      node: tx.node,
      scheduled: tx.scheduled,
      nonce: tx.nonce,
      transfers: tx.transfers.map((t) => ({
        account: t.account,
        amount: t.amount / 100_000_000, // Convert to HBAR
        isApproval: t.is_approval,
      })),
      tokenTransfers: tx.token_transfers,
      nftTransfers: tx.nft_transfers,
    }));

    return {
      success: true,
      data: {
        transactions,
        count: transactions.length,
      },
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to query transactions', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query token information from Mirror Node
 */
export async function mirrorQueryToken(args: { tokenId: string }): Promise<ToolResult> {
  try {
    logger.info('Querying token from Mirror Node', { tokenId: args.tokenId });

    const token = await mirrorNodeService.getToken(args.tokenId);

    return {
      success: true,
      data: {
        tokenId: token.token_id,
        name: token.name,
        symbol: token.symbol,
        type: token.type,
        decimals: parseInt(token.decimals),
        totalSupply: token.total_supply,
        initialSupply: token.initial_supply,
        maxSupply: token.max_supply,
        treasuryAccountId: token.treasury_account_id,
        supplyType: token.supply_type,
        pauseStatus: token.pause_status,
        freezeDefault: token.freeze_default,
        deleted: token.deleted,
        memo: token.memo,
        metadata: token.metadata,
        createdTimestamp: token.created_timestamp,
        modifiedTimestamp: token.modified_timestamp,
        expiryTimestamp: token.expiry_timestamp,
        autoRenewAccount: token.auto_renew_account,
        autoRenewPeriod: token.auto_renew_period,
        customFees: token.custom_fees,
        keys: {
          admin: token.admin_key,
          kyc: token.kyc_key,
          freeze: token.freeze_key,
          wipe: token.wipe_key,
          supply: token.supply_key,
          pause: token.pause_key,
          feeSchedule: token.fee_schedule_key,
          metadata: token.metadata_key,
        },
      },
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to query token', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query topic messages from Mirror Node
 */
export async function mirrorQueryTopicMessages(args: {
  topicId: string;
  limit?: number;
  order?: 'asc' | 'desc';
  sequenceNumber?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Querying topic messages from Mirror Node', args);

    const response = await mirrorNodeService.getTopicMessages(args.topicId, {
      limit: args.limit || 10,
      order: args.order || 'asc',
      sequenceNumber: args.sequenceNumber,
    });

    const messages = response.messages.map((msg) => ({
      sequenceNumber: msg.sequence_number,
      consensusTimestamp: msg.consensus_timestamp,
      message: Buffer.from(msg.message, 'base64').toString(),
      payerAccountId: msg.payer_account_id,
      runningHash: msg.running_hash,
      runningHashVersion: msg.running_hash_version,
      topicId: msg.topic_id,
    }));

    return {
      success: true,
      data: {
        messages,
        count: messages.length,
      },
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to query topic messages', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query contract logs from Mirror Node
 */
export async function mirrorQueryContractLogs(args: {
  contractId: string;
  limit?: number;
  order?: 'asc' | 'desc';
}): Promise<ToolResult> {
  try {
    logger.info('Querying contract logs from Mirror Node', args);

    const response = await mirrorNodeService.getContractLogs(args.contractId, {
      limit: args.limit || 10,
      order: args.order || 'desc',
    });

    return {
      success: true,
      data: {
        logs: response.logs,
        count: response.logs.length,
      },
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to query contract logs', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get network information from Mirror Node
 */
export async function mirrorGetNetworkInfo(): Promise<ToolResult> {
  try {
    logger.info('Getting network info from Mirror Node');

    const networkInfo = await mirrorNodeService.getNetworkInfo();

    return {
      success: true,
      data: {
        network: mirrorNodeService.getCurrentNetwork(),
        baseUrl: mirrorNodeService.getOpenApiSpecUrl().replace('/api/v1/docs/openapi.yml', ''),
        swaggerUi: mirrorNodeService.getSwaggerUiUrl(),
        openApiSpec: mirrorNodeService.getOpenApiSpecUrl(),
        exchangeRates: networkInfo.exchangeRates,
        fees: networkInfo.fees,
        supply: networkInfo.supply,
      },
      metadata: {
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get network info', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ==================== PRIORITY 1: CORE TOOLS ====================

/**
 * List accounts with filtering
 */
export async function mirrorListAccounts(args: {
  limit?: number;
  order?: 'asc' | 'desc';
  balance?: boolean;
}): Promise<ToolResult> {
  try {
    logger.info('Listing accounts from Mirror Node', args);
    const response = await mirrorNodeService.listAccounts({
      limit: args.limit || 25,
      order: args.order || 'desc',
      balance: args.balance,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to list accounts', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get single transaction by ID
 */
export async function mirrorGetTransaction(args: { transactionId: string }): Promise<ToolResult> {
  try {
    logger.info('Getting transaction from Mirror Node', { transactionId: args.transactionId });
    const response = await mirrorNodeService.getTransaction(args.transactionId);
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get transaction', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * List tokens with filtering
 */
export async function mirrorListTokens(args: {
  limit?: number;
  order?: 'asc' | 'desc';
  type?: 'FUNGIBLE_COMMON' | 'NON_FUNGIBLE_UNIQUE';
}): Promise<ToolResult> {
  try {
    logger.info('Listing tokens from Mirror Node', args);
    const response = await mirrorNodeService.listTokens({
      limit: args.limit || 25,
      order: args.order || 'desc',
      type: args.type,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to list tokens', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get token balance distribution
 */
export async function mirrorGetTokenBalances(args: {
  tokenId: string;
  limit?: number;
  order?: 'asc' | 'desc';
}): Promise<ToolResult> {
  try {
    logger.info('Getting token balances from Mirror Node', args);
    const response = await mirrorNodeService.getTokenBalances(args.tokenId, {
      limit: args.limit || 25,
      order: args.order || 'desc',
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get token balances', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * List blocks
 */
export async function mirrorListBlocks(args: {
  limit?: number;
  order?: 'asc' | 'desc';
}): Promise<ToolResult> {
  try {
    logger.info('Listing blocks from Mirror Node', args);
    const response = await mirrorNodeService.getBlocks({
      limit: args.limit || 10,
      order: args.order || 'desc',
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to list blocks', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get single block by hash or number
 */
export async function mirrorGetBlock(args: { hashOrNumber: string }): Promise<ToolResult> {
  try {
    logger.info('Getting block from Mirror Node', { hashOrNumber: args.hashOrNumber });
    const response = await mirrorNodeService.getBlock(args.hashOrNumber);
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get block', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get network consensus nodes
 */
export async function mirrorGetNetworkNodes(args: { limit?: number }): Promise<ToolResult> {
  try {
    logger.info('Getting network nodes from Mirror Node', args);
    const response = await mirrorNodeService.getNetworkNodes({ limit: args.limit || 100 });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get network nodes', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get network staking information
 */
export async function mirrorGetNetworkStake(): Promise<ToolResult> {
  try {
    logger.info('Getting network stake from Mirror Node');
    const response = await mirrorNodeService.getNetworkStake();
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get network stake', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get topic information
 */
export async function mirrorGetTopicInfo(args: { topicId: string }): Promise<ToolResult> {
  try {
    logger.info('Getting topic info from Mirror Node', { topicId: args.topicId });
    const response = await mirrorNodeService.getTopicInfo(args.topicId);
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get topic info', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ==================== PRIORITY 2: ACCOUNT DETAILS ====================

/**
 * Get account token relationships
 */
export async function mirrorGetAccountTokens(args: {
  accountId: string;
  limit?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Getting account tokens from Mirror Node', args);
    const response = await mirrorNodeService.getAccountTokens(args.accountId, {
      limit: args.limit || 100,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get account tokens', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get account NFT holdings
 */
export async function mirrorGetAccountNFTs(args: {
  accountId: string;
  limit?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Getting account NFTs from Mirror Node', args);
    const response = await mirrorNodeService.getAccountNFTs(args.accountId, {
      limit: args.limit || 100,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get account NFTs', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get account staking rewards history
 */
export async function mirrorGetAccountRewards(args: {
  accountId: string;
  limit?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Getting account rewards from Mirror Node', args);
    const response = await mirrorNodeService.getAccountRewards(args.accountId, {
      limit: args.limit || 100,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get account rewards', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * List balance snapshots
 */
export async function mirrorListBalances(args: {
  accountId?: string;
  limit?: number;
  timestamp?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Listing balances from Mirror Node', args);
    const response = await mirrorNodeService.getBalances(args.accountId, {
      limit: args.limit || 25,
      timestamp: args.timestamp,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to list balances', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ==================== PRIORITY 3: SMART CONTRACTS ====================

/**
 * List all contracts
 */
export async function mirrorListContracts(args: {
  limit?: number;
  order?: 'asc' | 'desc';
}): Promise<ToolResult> {
  try {
    logger.info('Listing contracts from Mirror Node', args);
    const response = await mirrorNodeService.listContracts({
      limit: args.limit || 25,
      order: args.order || 'desc',
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to list contracts', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get contract details
 */
export async function mirrorGetContract(args: { contractId: string }): Promise<ToolResult> {
  try {
    logger.info('Getting contract from Mirror Node', { contractId: args.contractId });
    const response = await mirrorNodeService.getContract(args.contractId);
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get contract', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get contract storage state
 */
export async function mirrorGetContractState(args: {
  contractId: string;
  limit?: number;
  slot?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Getting contract state from Mirror Node', args);
    const response = await mirrorNodeService.getContractState(args.contractId, {
      limit: args.limit || 100,
      slot: args.slot,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get contract state', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get contract execution history
 */
export async function mirrorGetContractResults(args: {
  contractId: string;
  limit?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Getting contract results from Mirror Node', args);
    const response = await mirrorNodeService.getContractResults(args.contractId, {
      limit: args.limit || 25,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get contract results', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Execute EVM call simulation
 */
export async function mirrorCallContract(args: {
  to: string;
  data: string;
  from?: string;
  gas?: number;
  value?: number;
  estimate?: boolean;
}): Promise<ToolResult> {
  try {
    logger.info('Calling contract simulation on Mirror Node', args);
    const response = await mirrorNodeService.callContractSimulation({
      to: args.to,
      data: args.data,
      from: args.from,
      gas: args.gas,
      value: args.value,
      estimate: args.estimate,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to call contract', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Search contract logs globally
 */
export async function mirrorSearchLogs(args: {
  limit?: number;
  timestamp?: string;
  topic0?: string;
  topic1?: string;
  topic2?: string;
  topic3?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Searching contract logs on Mirror Node', args);
    const response = await mirrorNodeService.searchContractLogs({
      timestamp: args.timestamp,
      limit: args.limit || 25,
      topic0: args.topic0,
      topic1: args.topic1,
      topic2: args.topic2,
      topic3: args.topic3,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to search logs', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get contract call actions/trace
 */
export async function mirrorGetContractActions(args: {
  transactionIdOrHash: string;
}): Promise<ToolResult> {
  try {
    logger.info('Getting contract actions from Mirror Node', args);
    const response = await mirrorNodeService.getContractActions(args.transactionIdOrHash);
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get contract actions', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get contract opcode trace (EVM debug)
 */
/** Opcode steps returned per trace; see mirrorGetContractOpcodes */
const MAX_OPCODES = 500;

export async function mirrorGetContractOpcodes(args: {
  transactionIdOrHash: string;
}): Promise<ToolResult> {
  try {
    logger.info('Getting contract opcodes from Mirror Node', args);
    const response = await mirrorNodeService.getContractOpcodes(args.transactionIdOrHash);

    // A trace grows with execution length; a complex transaction can run to
    // megabytes, more than an MCP client can take in one result. Return the
    // first steps and say how many were left out.
    const opcodes: unknown[] = Array.isArray(response?.opcodes) ? response.opcodes : [];
    const truncated = opcodes.length > MAX_OPCODES;
    return {
      success: true,
      data: {
        ...response,
        opcodes: truncated ? opcodes.slice(0, MAX_OPCODES) : opcodes,
        totalOpcodes: opcodes.length,
        ...(truncated
          ? {
              truncated: `Showing the first ${MAX_OPCODES} of ${opcodes.length} steps`,
            }
          : {}),
      },
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get contract opcodes', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ==================== PRIORITY 4: NFTs ====================

/**
 * List NFTs for a token
 */
export async function mirrorListNFTs(args: {
  tokenId: string;
  limit?: number;
  accountId?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Listing NFTs from Mirror Node', args);
    const response = await mirrorNodeService.listTokenNFTs(args.tokenId, {
      limit: args.limit || 25,
      accountId: args.accountId,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to list NFTs', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get single NFT info
 */
export async function mirrorGetNFT(args: {
  tokenId: string;
  serialNumber: number;
}): Promise<ToolResult> {
  try {
    logger.info('Getting NFT from Mirror Node', args);
    const response = await mirrorNodeService.getNFT(args.tokenId, args.serialNumber);
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get NFT', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get NFT transaction history
 */
export async function mirrorGetNFTHistory(args: {
  tokenId: string;
  serialNumber: number;
  limit?: number;
}): Promise<ToolResult> {
  try {
    logger.info('Getting NFT history from Mirror Node', args);
    const response = await mirrorNodeService.getNFTTransactions(args.tokenId, args.serialNumber, {
      limit: args.limit || 25,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get NFT history', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ==================== PRIORITY 5: SCHEDULES ====================

/**
 * List scheduled transactions
 */
export async function mirrorListSchedules(args: {
  limit?: number;
  executed?: boolean;
  accountId?: string;
}): Promise<ToolResult> {
  try {
    logger.info('Listing schedules from Mirror Node', args);
    const response = await mirrorNodeService.listSchedules({
      limit: args.limit || 25,
      executed: args.executed,
      accountId: args.accountId,
    });
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to list schedules', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get schedule details
 */
export async function mirrorGetSchedule(args: { scheduleId: string }): Promise<ToolResult> {
  try {
    logger.info('Getting schedule from Mirror Node', { scheduleId: args.scheduleId });
    const response = await mirrorNodeService.getSchedule(args.scheduleId);
    return {
      success: true,
      data: response,
      metadata: {
        network: mirrorNodeService.getCurrentNetwork(),
        executedVia: 'mirror_node_rest_api',
      },
    };
  } catch (error) {
    logger.error('Failed to get schedule', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Tool definitions for MCP server
 */
export const mirrorNodeTools = [
  {
    name: 'mirror_query_account',
    description:
      'Get comprehensive account information from Hedera Mirror Node REST API. Returns balance, EVM address, keys, memo, staking info, and more. No API key required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: {
          type: 'string',
          description: 'Hedera account ID (format: 0.0.xxxxx), alias, or EVM address',
        },
        timestamp: {
          type: 'string',
          description: 'Optional: Query account state at specific timestamp',
        },
      },
      required: ['accountId'],
    },
  },
  {
    name: 'mirror_query_transactions',
    description:
      'Query transactions from Hedera Mirror Node with flexible filters. Returns transaction details, fees, transfers, and results. No API key required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: {
          type: 'string',
          description: 'Optional: Filter by account ID (format: 0.0.xxxxx)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of transactions to return (default: 10, max: 100)',
          minimum: 1,
          maximum: 100,
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order (default: desc)',
        },
        timestamp: {
          type: 'string',
          description: 'Filter by timestamp (e.g., "lt:1234567890.000000000")',
        },
        result: {
          type: 'string',
          description: 'Filter by transaction result (e.g., "success")',
        },
        transactionType: {
          type: 'string',
          description: 'Filter by transaction type (e.g., "CRYPTOTRANSFER")',
        },
      },
    },
  },
  {
    name: 'mirror_query_token',
    description:
      'Get detailed token information from Hedera Mirror Node. Returns token properties, supply, keys, custom fees, and metadata. No API key required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: {
          type: 'string',
          description: 'Token ID (format: 0.0.xxxxx)',
        },
      },
      required: ['tokenId'],
    },
  },
  {
    name: 'mirror_query_topic_messages',
    description:
      'Query HCS topic messages from Hedera Mirror Node. Returns message content, sequence numbers, timestamps, and hashes. No API key required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        topicId: {
          type: 'string',
          description: 'Topic ID (format: 0.0.xxxxx)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return (default: 10, max: 100)',
          minimum: 1,
          maximum: 100,
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order (default: asc)',
        },
        sequenceNumber: {
          type: 'number',
          description: 'Get messages with sequence number >= this value',
          minimum: 1,
        },
      },
      required: ['topicId'],
    },
  },
  {
    name: 'mirror_query_contract_logs',
    description:
      'Query smart contract event logs from Hedera Mirror Node. Returns log data, topics, block info, and transaction details. No API key required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractId: {
          type: 'string',
          description: 'Contract ID (format: 0.0.xxxxx) or EVM address (0x...)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of logs to return (default: 10, max: 100)',
          minimum: 1,
          maximum: 100,
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order (default: desc)',
        },
      },
      required: ['contractId'],
    },
  },
  {
    name: 'mirror_get_network_info',
    description:
      'Get Hedera network information including exchange rates, fees, and supply from Mirror Node REST API. Also provides OpenAPI spec and Swagger UI URLs.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  // Priority 1: Core tools
  {
    name: 'mirror_list_accounts',
    description:
      'List Hedera accounts with filtering. Returns paginated list of accounts with balances and metadata.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Max results (default: 25, max: 100)',
          minimum: 1,
          maximum: 100,
        },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default: desc)' },
        balance: { type: 'boolean', description: 'Include balance info (default: true)' },
      },
    },
  },
  {
    name: 'mirror_get_transaction',
    description:
      'Get single transaction details by transaction ID. Returns full transaction info including transfers, fees, and result.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        transactionId: {
          type: 'string',
          description: 'Transaction ID (format: 0.0.xxxxx-seconds-nanos)',
        },
      },
      required: ['transactionId'],
    },
  },
  {
    name: 'mirror_list_tokens',
    description:
      'List Hedera tokens with filtering. Filter by type (FUNGIBLE_COMMON or NON_FUNGIBLE_UNIQUE).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Max results (default: 25)',
          minimum: 1,
          maximum: 100,
        },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default: desc)' },
        type: {
          type: 'string',
          enum: ['FUNGIBLE_COMMON', 'NON_FUNGIBLE_UNIQUE'],
          description: 'Token type filter',
        },
      },
    },
  },
  {
    name: 'mirror_get_token_balances',
    description:
      'Get token balance distribution across all holders. Returns list of accounts holding the token with their balances.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: { type: 'string', description: 'Token ID (format: 0.0.xxxxx)' },
        limit: {
          type: 'number',
          description: 'Max results (default: 25)',
          minimum: 1,
          maximum: 100,
        },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order by balance' },
      },
      required: ['tokenId'],
    },
  },
  {
    name: 'mirror_list_blocks',
    description:
      'List Hedera blocks (record files). Returns block hashes, numbers, timestamps, and transaction counts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Max results (default: 10)',
          minimum: 1,
          maximum: 100,
        },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default: desc)' },
      },
    },
  },
  {
    name: 'mirror_get_block',
    description:
      'Get single block by hash or number. Returns block details including transactions and gas usage.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hashOrNumber: { type: 'string', description: 'Block hash (0x...) or block number' },
      },
      required: ['hashOrNumber'],
    },
  },
  {
    name: 'mirror_get_network_nodes',
    description:
      'Get list of consensus nodes on Hedera network. Returns node IDs, accounts, descriptions, and service endpoints.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Max results (default: 100)',
          minimum: 1,
          maximum: 100,
        },
      },
    },
  },
  {
    name: 'mirror_get_network_stake',
    description:
      'Get network staking information including total stake, max stake per node, and staking period.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'mirror_get_topic_info',
    description:
      'Get HCS topic information (not messages). Returns topic memo, admin key, submit key, and auto-renew settings.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        topicId: { type: 'string', description: 'Topic ID (format: 0.0.xxxxx)' },
      },
      required: ['topicId'],
    },
  },
  // Priority 2: Account details
  {
    name: 'mirror_get_account_tokens',
    description:
      'Get all token relationships for an account. Returns token associations, balances, freeze/KYC status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: { type: 'string', description: 'Account ID (format: 0.0.xxxxx)' },
        limit: {
          type: 'number',
          description: 'Max results (default: 100)',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['accountId'],
    },
  },
  {
    name: 'mirror_get_account_nfts',
    description:
      'Get all NFTs owned by an account. Returns token IDs, serial numbers, and metadata.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: { type: 'string', description: 'Account ID (format: 0.0.xxxxx)' },
        limit: {
          type: 'number',
          description: 'Max results (default: 100)',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['accountId'],
    },
  },
  {
    name: 'mirror_get_account_rewards',
    description:
      'Get staking reward history for an account. Returns rewards earned per staking period.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: { type: 'string', description: 'Account ID (format: 0.0.xxxxx)' },
        limit: {
          type: 'number',
          description: 'Max results (default: 100)',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['accountId'],
    },
  },
  {
    name: 'mirror_list_balances',
    description:
      'List network balance snapshots. Filter by account or timestamp for historical balance queries.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        accountId: { type: 'string', description: 'Optional: Filter by account ID' },
        limit: {
          type: 'number',
          description: 'Max results (default: 25)',
          minimum: 1,
          maximum: 100,
        },
        timestamp: { type: 'string', description: 'Optional: Filter by timestamp' },
      },
    },
  },
  // Priority 3: Smart contracts
  {
    name: 'mirror_list_contracts',
    description:
      'List all smart contracts deployed on Hedera. Returns contract IDs, bytecode, and creation info.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Max results (default: 25)',
          minimum: 1,
          maximum: 100,
        },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default: desc)' },
      },
    },
  },
  {
    name: 'mirror_get_contract',
    description:
      'Get smart contract details. Returns bytecode, EVM address, file ID, and admin key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractId: {
          type: 'string',
          description: 'Contract ID (0.0.xxxxx) or EVM address (0x...)',
        },
      },
      required: ['contractId'],
    },
  },
  {
    name: 'mirror_get_contract_state',
    description:
      'Get contract storage state (key-value pairs). Query specific storage slots or get all state.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractId: {
          type: 'string',
          description: 'Contract ID (0.0.xxxxx) or EVM address (0x...)',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 100)',
          minimum: 1,
          maximum: 100,
        },
        slot: { type: 'string', description: 'Optional: Specific storage slot to query (0x...)' },
      },
      required: ['contractId'],
    },
  },
  {
    name: 'mirror_get_contract_results',
    description:
      'Get contract execution history. Returns transaction results, gas used, and error messages.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contractId: {
          type: 'string',
          description: 'Contract ID (0.0.xxxxx) or EVM address (0x...)',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 25)',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['contractId'],
    },
  },
  {
    name: 'mirror_call_contract',
    description:
      'Execute EVM call simulation (read-only, free). Call view/pure functions without gas cost.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Contract address (0x...)' },
        data: { type: 'string', description: 'Encoded function call data (0x...)' },
        from: { type: 'string', description: 'Optional: Caller address' },
        gas: { type: 'number', description: 'Optional: Gas limit' },
        value: { type: 'number', description: 'Optional: Value in tinybars' },
        estimate: { type: 'boolean', description: 'Optional: Estimate gas only' },
      },
      required: ['to', 'data'],
    },
  },
  {
    name: 'mirror_search_logs',
    description:
      'Search contract event logs globally by topic. Filter by event signature (topic0) or indexed parameters.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Max results (default: 25)',
          minimum: 1,
          maximum: 100,
        },
        timestamp: {
          type: 'string',
          description:
            'Time range as "gte:<seconds>,lte:<seconds>". Needs both bounds, under 7 days apart. Defaults to the last 24 hours',
        },
        topic0: { type: 'string', description: 'Event signature hash (0x...)' },
        topic1: { type: 'string', description: 'First indexed parameter (0x...)' },
        topic2: { type: 'string', description: 'Second indexed parameter (0x...)' },
        topic3: { type: 'string', description: 'Third indexed parameter (0x...)' },
      },
    },
  },
  {
    name: 'mirror_get_contract_actions',
    description:
      'Get contract call actions/trace. Returns internal calls, value transfers, and call hierarchy.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        transactionIdOrHash: { type: 'string', description: 'Transaction ID or hash' },
      },
      required: ['transactionIdOrHash'],
    },
  },
  {
    name: 'mirror_get_contract_opcodes',
    description:
      'Get EVM opcode trace for debugging. Returns step-by-step execution with stack, memory, and storage.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        transactionIdOrHash: { type: 'string', description: 'Transaction ID or hash' },
      },
      required: ['transactionIdOrHash'],
    },
  },
  // Priority 4: NFTs
  {
    name: 'mirror_list_nfts',
    description:
      'List NFTs for a token collection. Returns serial numbers, metadata, and current owners.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: { type: 'string', description: 'NFT token ID (format: 0.0.xxxxx)' },
        limit: {
          type: 'number',
          description: 'Max results (default: 25)',
          minimum: 1,
          maximum: 100,
        },
        accountId: { type: 'string', description: 'Optional: Filter by owner account' },
      },
      required: ['tokenId'],
    },
  },
  {
    name: 'mirror_get_nft',
    description:
      'Get single NFT info by serial number. Returns metadata, current owner, and creation timestamp.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: { type: 'string', description: 'NFT token ID (format: 0.0.xxxxx)' },
        serialNumber: { type: 'number', description: 'NFT serial number', minimum: 1 },
      },
      required: ['tokenId', 'serialNumber'],
    },
  },
  {
    name: 'mirror_get_nft_history',
    description:
      'Get NFT transaction history. Returns all transfers and ownership changes for specific NFT.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: { type: 'string', description: 'NFT token ID (format: 0.0.xxxxx)' },
        serialNumber: { type: 'number', description: 'NFT serial number', minimum: 1 },
        limit: {
          type: 'number',
          description: 'Max results (default: 25)',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['tokenId', 'serialNumber'],
    },
  },
  // Priority 5: Schedules
  {
    name: 'mirror_list_schedules',
    description: 'List scheduled transactions. Filter by execution status or creator account.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Max results (default: 25)',
          minimum: 1,
          maximum: 100,
        },
        executed: { type: 'boolean', description: 'Filter by execution status' },
        accountId: { type: 'string', description: 'Filter by creator account ID' },
      },
    },
  },
  {
    name: 'mirror_get_schedule',
    description:
      'Get scheduled transaction details. Returns signatories, expiration, and execution status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        scheduleId: { type: 'string', description: 'Schedule ID (format: 0.0.xxxxx)' },
      },
      required: ['scheduleId'],
    },
  },
];

// ==================== COMBINED TOOL ====================

/**
 * One MCP tool in front of every Mirror Node query above.
 *
 * The 32 functions in this file were written and given schemas, but only
 * `mirror_query_account` was ever registered with the server — the rest were
 * unreachable from any MCP client. Registering 32 separate tools would bloat
 * every client's tool list, so they are exposed as resources of a single tool,
 * the same consolidation the rest of the server uses. Each resource keeps the
 * parameters and required fields of the definition it wraps.
 */
const MIRROR_RESOURCES: Record<
  string,
  { tool: string; handler: (args: any) => Promise<ToolResult>; summary: string }
> = {
  // Accounts
  account: {
    tool: 'mirror_query_account',
    handler: mirrorQueryAccount,
    summary: 'account details, balance, keys',
  },
  accounts: { tool: 'mirror_list_accounts', handler: mirrorListAccounts, summary: 'list accounts' },
  account_tokens: {
    tool: 'mirror_get_account_tokens',
    handler: mirrorGetAccountTokens,
    summary: 'token relationships of an account',
  },
  account_nfts: {
    tool: 'mirror_get_account_nfts',
    handler: mirrorGetAccountNFTs,
    summary: 'NFTs owned by an account',
  },
  account_rewards: {
    tool: 'mirror_get_account_rewards',
    handler: mirrorGetAccountRewards,
    summary: 'staking rewards paid to an account',
  },
  balances: {
    tool: 'mirror_list_balances',
    handler: mirrorListBalances,
    summary: 'balance snapshots',
  },
  // Transactions
  transactions: {
    tool: 'mirror_query_transactions',
    handler: mirrorQueryTransactions,
    summary: 'recent transactions, filterable by account/type/result',
  },
  transaction: {
    tool: 'mirror_get_transaction',
    handler: mirrorGetTransaction,
    summary: 'one transaction by ID: status, fee, transfers',
  },
  // Tokens and NFTs
  token: {
    tool: 'mirror_query_token',
    handler: mirrorQueryToken,
    summary: 'token info: supply, keys, fees, treasury',
  },
  tokens: { tool: 'mirror_list_tokens', handler: mirrorListTokens, summary: 'list tokens' },
  token_balances: {
    tool: 'mirror_get_token_balances',
    handler: mirrorGetTokenBalances,
    summary: 'holders of a token',
  },
  nfts: { tool: 'mirror_list_nfts', handler: mirrorListNFTs, summary: 'NFTs of a collection' },
  nft: { tool: 'mirror_get_nft', handler: mirrorGetNFT, summary: 'one NFT by serial' },
  nft_history: {
    tool: 'mirror_get_nft_history',
    handler: mirrorGetNFTHistory,
    summary: 'transfer history of one NFT',
  },
  // Consensus
  topic: {
    tool: 'mirror_get_topic_info',
    handler: mirrorGetTopicInfo,
    summary: 'topic info: keys, memo, sequence',
  },
  topic_messages: {
    tool: 'mirror_query_topic_messages',
    handler: mirrorQueryTopicMessages,
    summary: 'messages on a topic',
  },
  // Smart contracts
  contracts: {
    tool: 'mirror_list_contracts',
    handler: mirrorListContracts,
    summary: 'list contracts',
  },
  contract: {
    tool: 'mirror_get_contract',
    handler: mirrorGetContract,
    summary: 'contract info and bytecode',
  },
  contract_state: {
    tool: 'mirror_get_contract_state',
    handler: mirrorGetContractState,
    summary: 'storage slots of a contract',
  },
  contract_results: {
    tool: 'mirror_get_contract_results',
    handler: mirrorGetContractResults,
    summary: 'execution results of a contract',
  },
  contract_logs: {
    tool: 'mirror_query_contract_logs',
    handler: mirrorQueryContractLogs,
    summary: 'event logs of a contract',
  },
  contract_call: {
    tool: 'mirror_call_contract',
    handler: mirrorCallContract,
    summary: 'free read-only call / gas estimate (eth_call simulation)',
  },
  contract_actions: {
    tool: 'mirror_get_contract_actions',
    handler: mirrorGetContractActions,
    summary: 'internal calls of a transaction',
  },
  contract_opcodes: {
    tool: 'mirror_get_contract_opcodes',
    handler: mirrorGetContractOpcodes,
    summary: 'opcode trace of a transaction',
  },
  logs: {
    tool: 'mirror_search_logs',
    handler: mirrorSearchLogs,
    summary: 'search event logs by topic across contracts',
  },
  // Scheduled transactions
  schedules: {
    tool: 'mirror_list_schedules',
    handler: mirrorListSchedules,
    summary: 'list scheduled transactions',
  },
  schedule: {
    tool: 'mirror_get_schedule',
    handler: mirrorGetSchedule,
    summary: 'one scheduled transaction and its signatures',
  },
  // Network
  network_info: {
    tool: 'mirror_get_network_info',
    handler: mirrorGetNetworkInfo,
    summary: 'live fee-conversion exchange rate, fee schedule, supply',
  },
  network_nodes: {
    tool: 'mirror_get_network_nodes',
    handler: mirrorGetNetworkNodes,
    summary: 'consensus nodes',
  },
  network_stake: {
    tool: 'mirror_get_network_stake',
    handler: mirrorGetNetworkStake,
    summary: 'network staking parameters',
  },
  blocks: { tool: 'mirror_list_blocks', handler: mirrorListBlocks, summary: 'recent blocks' },
  block: {
    tool: 'mirror_get_block',
    handler: mirrorGetBlock,
    summary: 'one block by hash or number',
  },
};

export const MIRROR_RESOURCE_NAMES = Object.keys(MIRROR_RESOURCES);

function definitionOf(toolName: string): {
  inputSchema: { properties?: Record<string, any>; required?: string[] };
} {
  const definition = mirrorNodeTools.find((tool) => tool.name === toolName);
  if (!definition) {
    throw new Error(`mirror_query resource points at unknown definition ${toolName}`);
  }
  return definition as any;
}

/**
 * Descriptions for parameters whose meaning differs between resources. Without
 * these the combined schema would show whichever resource defined it first.
 */
const SHARED_PARAMETER_DESCRIPTIONS: Record<string, string> = {
  timestamp:
    'Consensus timestamp in seconds. account, balances: the point in time to read state at, ' +
    'e.g. "1790000000.000000000". transactions: a filter such as "gte:1790000000". ' +
    'logs: a range "gte:<seconds>,lte:<seconds>" under 7 days (defaults to the last 24 hours)',
  limit: 'Maximum number of results (list resources)',
  order: 'Sort order, "asc" or "desc" (list resources)',
};

/** Union of every wrapped definition's parameters */
function combinedProperties(): Record<string, any> {
  const properties: Record<string, any> = {};
  for (const { tool } of Object.values(MIRROR_RESOURCES)) {
    for (const [name, schema] of Object.entries(definitionOf(tool).inputSchema.properties || {})) {
      properties[name] ??= { ...(schema as object) };
    }
  }
  for (const [name, description] of Object.entries(SHARED_PARAMETER_DESCRIPTIONS)) {
    if (properties[name]) properties[name].description = description;
  }
  return properties;
}

export const mirrorQueryTool = {
  name: 'mirror_query',
  description:
    'Read-only Hedera Mirror Node queries (free, no operator needed). Pick a `resource`, then pass the ' +
    'parameters it needs:\n' +
    Object.entries(MIRROR_RESOURCES)
      .map(([name, { tool, summary }]) => {
        const required = definitionOf(tool).inputSchema.required || [];
        return `- ${name}: ${summary}${required.length ? ` (requires ${required.join(', ')})` : ''}`;
      })
      .join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      resource: {
        type: 'string',
        enum: MIRROR_RESOURCE_NAMES,
        description: 'What to query',
      },
      ...combinedProperties(),
    },
    required: ['resource'],
  },
};

export async function mirrorQuery(
  args: { resource: string } & Record<string, unknown>
): Promise<ToolResult> {
  const entry = MIRROR_RESOURCES[args.resource];
  if (!entry) {
    return {
      success: false,
      error: `Unknown resource: ${String(args.resource)}. Valid resources: ${MIRROR_RESOURCE_NAMES.join(', ')}`,
    };
  }

  // The combined schema can only require `resource`; each resource's own
  // required fields are enforced here.
  const missing = (definitionOf(entry.tool).inputSchema.required || []).filter((name) => {
    const value = args[name];
    return value === undefined || value === null || value === '';
  });
  if (missing.length > 0) {
    return {
      success: false,
      error: `resource "${args.resource}" requires ${missing.join(', ')}`,
    };
  }

  const { resource: _resource, ...rest } = args;
  return entry.handler(rest);
}
