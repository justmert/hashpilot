/**
 * Mirror Node REST API Service
 * Direct access to Hedera Mirror Node using official REST API
 * OpenAPI 3.0 spec: https://testnet.mirrornode.hedera.com/api/v1/docs/
 */

import logger from '../utils/logger.js';
import { getHederaConfig } from '../utils/config.js';

interface MirrorNodeConfig {
  baseUrl: string;
  network: 'mainnet' | 'testnet' | 'previewnet' | 'local';
}

interface QueryOptions {
  limit?: number;
  order?: 'asc' | 'desc';
  timestamp?: string;
}

interface AccountInfo {
  account: string;
  alias: string | null;
  auto_renew_period: number;
  balance: {
    balance: number;
    timestamp: string;
    tokens: Array<{ token_id: string; balance: number }>;
  };
  created_timestamp: string;
  decline_reward: boolean;
  deleted: boolean;
  ethereum_nonce: number;
  evm_address: string;
  expiry_timestamp: string;
  key: any;
  max_automatic_token_associations: number;
  memo: string;
  pending_reward: number;
  receiver_sig_required: boolean;
  staked_account_id: string | null;
  staked_node_id: number | null;
  stake_period_start: string | null;
}

interface Transaction {
  bytes: string | null;
  charged_tx_fee: number;
  consensus_timestamp: string;
  entity_id: string | null;
  max_fee: string;
  memo_base64: string;
  name: string;
  nft_transfers: Array<any>;
  node: string;
  nonce: number;
  parent_consensus_timestamp: string | null;
  result: string;
  scheduled: boolean;
  staking_reward_transfers: Array<any>;
  token_transfers: Array<any>;
  transaction_hash: string;
  transaction_id: string;
  transfers: Array<{ account: string; amount: number; is_approval: boolean }>;
  valid_duration_seconds: string;
  valid_start_timestamp: string;
}

interface TokenInfo {
  token_id: string;
  symbol: string;
  admin_key: any;
  auto_renew_account: string | null;
  auto_renew_period: number;
  created_timestamp: string;
  custom_fees: {
    created_timestamp: string;
    fixed_fees: Array<any>;
    fractional_fees: Array<any>;
    royalty_fees: Array<any>;
  };
  decimals: string;
  deleted: boolean;
  expiry_timestamp: string;
  fee_schedule_key: any;
  freeze_default: boolean;
  freeze_key: any;
  initial_supply: string;
  kyc_key: any;
  max_supply: string;
  memo: string;
  metadata: string;
  metadata_key: any;
  modified_timestamp: string;
  name: string;
  pause_key: any;
  pause_status: string;
  supply_key: any;
  supply_type: string;
  total_supply: string;
  treasury_account_id: string;
  type: string;
  wipe_key: any;
}

interface TopicMessage {
  chunk_info: any;
  consensus_timestamp: string;
  message: string;
  payer_account_id: string;
  running_hash: string;
  running_hash_version: number;
  sequence_number: number;
  topic_id: string;
}

interface ContractLog {
  address: string;
  bloom: string;
  contract_id: string;
  data: string;
  index: number;
  topics: string[];
  block_hash: string;
  block_number: number;
  root_contract_id: string;
  timestamp: string;
  transaction_hash: string;
  transaction_index: number;
}

interface NetworkInfo {
  exchangeRates?: any;
  fees?: any;
  nodes?: any[];
  stake?: any;
  supply?: any;
}

export class MirrorNodeService {
  private config: MirrorNodeConfig;

  constructor(network: 'mainnet' | 'testnet' | 'previewnet' | 'local' = getHederaConfig().network) {
    this.config = {
      network,
      baseUrl: this.getBaseUrl(network),
    };
  }

  private getBaseUrl(network: string): string {
    // MIRROR_NODE_URL overrides the host for the network named in the environment
    const hederaConfig = getHederaConfig();
    if (hederaConfig.mirrorNodeUrl && network === hederaConfig.network) {
      return hederaConfig.mirrorNodeUrl.replace(/\/+$/, '');
    }

    switch (network) {
      case 'mainnet':
        return 'https://mainnet-public.mirrornode.hedera.com';
      case 'testnet':
        return 'https://testnet.mirrornode.hedera.com';
      case 'previewnet':
        return 'https://previewnet.mirrornode.hedera.com';
      case 'local':
        return 'http://localhost:5551';
      default:
        return 'https://testnet.mirrornode.hedera.com';
    }
  }

  /**
   * Switch to a different network
   */
  switchNetwork(network: 'mainnet' | 'testnet' | 'previewnet' | 'local'): void {
    this.config.network = network;
    this.config.baseUrl = this.getBaseUrl(network);
    logger.info('Mirror Node network switched', { network });
  }

  /**
   * Get current network
   */
  getCurrentNetwork(): string {
    return this.config.network;
  }

  /**
   * Execute REST API request
   */
  private async request<T>(endpoint: string, queryParams?: Record<string, any>): Promise<T> {
    let url = `${this.config.baseUrl}${endpoint}`;

    if (queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        if (value === undefined || value === null) continue;
        // An array repeats the parameter, as a timestamp range needs
        // (?timestamp=gte:X&timestamp=lte:Y)
        for (const item of Array.isArray(value) ? value : [value]) {
          params.append(key, String(item));
        }
      }
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    logger.debug('Mirror Node API request', { url });

    // The public mirror nodes return 5xx and stall under load. This service had
    // no timeout and no retry, so one upstream hiccup cost a 30-second wait and
    // a failed call — the same query succeeded in under two seconds moments
    // later. Transient failures are retried; a 4xx would fail identically and
    // is not.
    const attempts = 3;
    const timeoutMs = 15_000;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startTime = Date.now();

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (response.ok) {
          const data = await response.json();
          logger.debug('Mirror Node API response', {
            executionTime: `${Date.now() - startTime}ms`,
          });
          return data as T;
        }

        const errorText = (await response.text()).slice(0, 500);
        const error = new Error(
          `Mirror Node API error: ${response.status} ${response.statusText} - ${errorText}`
        );
        logger.error('Mirror Node API error', { status: response.status, attempt, url });
        if (response.status < 500) {
          throw error;
        }
        lastError = error;
      } catch (error: any) {
        if (error?.message?.startsWith('Mirror Node API error: 4')) {
          throw error;
        }
        const aborted = error?.name === 'AbortError';
        lastError = aborted
          ? new Error(
              `Mirror Node request timed out after ${timeoutMs}ms for ${url}. ` +
                'The public mirror node may be under load; try again shortly.'
            )
          : error;
      } finally {
        clearTimeout(timer);
      }

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
    }

    throw lastError || new Error(`Mirror Node request failed for ${url}`);
  }

  /**
   * Get account information
   * GET /api/v1/accounts/{idOrAliasOrEvmAddress}
   */
  async getAccount(accountId: string, options?: QueryOptions): Promise<AccountInfo> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.timestamp) queryParams.timestamp = options.timestamp;
    // The endpoint embeds the account's latest transactions by default. For a
    // busy account that makes the mirror node time out (0.0.800 returned 502
    // after 30s; with transactions=false it answers in 0.4s). Callers that want
    // transactions fetch them separately with a limit.
    queryParams.transactions = 'false';

    return this.request<AccountInfo>(`/api/v1/accounts/${accountId}`, queryParams);
  }

  /**
   * Get transactions with filtering
   * GET /api/v1/transactions
   */
  async getTransactions(options?: {
    accountId?: string;
    limit?: number;
    order?: 'asc' | 'desc';
    timestamp?: string;
    result?: string;
    type?: string;
    transactionType?: string;
  }): Promise<{ transactions: Transaction[]; links: any }> {
    const queryParams: Record<string, any> = {};
    if (options?.accountId) queryParams['account.id'] = options.accountId;
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.timestamp) queryParams.timestamp = options.timestamp;
    if (options?.result) queryParams.result = options.result;
    if (options?.type) queryParams.type = options.type;
    if (options?.transactionType) queryParams.transactiontype = options.transactionType;

    return this.request<{ transactions: Transaction[]; links: any }>(
      '/api/v1/transactions',
      queryParams
    );
  }

  /**
   * Get token information
   * GET /api/v1/tokens/{tokenId}
   */
  async getToken(tokenId: string): Promise<TokenInfo> {
    return this.request<TokenInfo>(`/api/v1/tokens/${tokenId}`);
  }

  /**
   * Get topic messages
   * GET /api/v1/topics/{topicId}/messages
   */
  async getTopicMessages(
    topicId: string,
    options?: {
      limit?: number;
      order?: 'asc' | 'desc';
      sequenceNumber?: number;
      timestamp?: string;
    }
  ): Promise<{ messages: TopicMessage[]; links: any }> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.sequenceNumber) queryParams.sequencenumber = `gte:${options.sequenceNumber}`;
    if (options?.timestamp) queryParams.timestamp = options.timestamp;

    return this.request<{ messages: TopicMessage[]; links: any }>(
      `/api/v1/topics/${topicId}/messages`,
      queryParams
    );
  }

  /**
   * Get contract logs
   * GET /api/v1/contracts/{contractId}/results/logs
   */
  async getContractLogs(
    contractId: string,
    options?: {
      limit?: number;
      order?: 'asc' | 'desc';
      timestamp?: string;
    }
  ): Promise<{ logs: ContractLog[]; links: any }> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.timestamp) queryParams.timestamp = options.timestamp;

    return this.request<{ logs: ContractLog[]; links: any }>(
      `/api/v1/contracts/${contractId}/results/logs`,
      queryParams
    );
  }

  /**
   * Get network information
   * Multiple endpoints: /api/v1/network/*
   */
  async getNetworkInfo(): Promise<NetworkInfo> {
    const [exchangeRates, fees, supply] = await Promise.all([
      this.request<any>('/api/v1/network/exchangerate').catch(() => null),
      this.request<any>('/api/v1/network/fees').catch(() => null),
      this.request<any>('/api/v1/network/supply').catch(() => null),
    ]);

    return {
      exchangeRates,
      fees,
      supply,
    };
  }

  /**
   * Get contract information
   * GET /api/v1/contracts/{contractId}
   */
  async getContract(contractId: string): Promise<any> {
    return this.request<any>(`/api/v1/contracts/${contractId}`);
  }

  /**
   * Get blocks
   * GET /api/v1/blocks
   */
  async getBlocks(options?: { limit?: number; order?: 'asc' | 'desc' }): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;

    return this.request<any>('/api/v1/blocks', queryParams);
  }

  /**
   * Get account balances with token breakdown
   * GET /api/v1/balances
   */
  async getBalances(accountId?: string, options?: QueryOptions): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (accountId) queryParams['account.id'] = accountId;
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.timestamp) queryParams.timestamp = options.timestamp;

    return this.request<any>('/api/v1/balances', queryParams);
  }

  /**
   * List accounts with filtering
   * GET /api/v1/accounts
   */
  async listAccounts(options?: {
    accountId?: string;
    balance?: boolean;
    limit?: number;
    order?: 'asc' | 'desc';
    publicKey?: string;
  }): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.accountId) queryParams['account.id'] = options.accountId;
    if (options?.balance !== undefined) queryParams.balance = options.balance;
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.publicKey) queryParams['account.publickey'] = options.publicKey;

    return this.request<any>('/api/v1/accounts', queryParams);
  }

  /**
   * Get account tokens
   * GET /api/v1/accounts/{id}/tokens
   */
  async getAccountTokens(
    accountId: string,
    options?: { limit?: number; order?: 'asc' | 'desc'; tokenId?: string }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.tokenId) queryParams['token.id'] = options.tokenId;

    return this.request<any>(`/api/v1/accounts/${accountId}/tokens`, queryParams);
  }

  /**
   * Get account NFTs
   * GET /api/v1/accounts/{id}/nfts
   */
  async getAccountNFTs(
    accountId: string,
    options?: { limit?: number; order?: 'asc' | 'desc'; tokenId?: string; serialNumber?: number }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.tokenId) queryParams['token.id'] = options.tokenId;
    if (options?.serialNumber) queryParams.serialnumber = options.serialNumber;

    return this.request<any>(`/api/v1/accounts/${accountId}/nfts`, queryParams);
  }

  /**
   * Get account staking rewards
   * GET /api/v1/accounts/{id}/rewards
   */
  async getAccountRewards(
    accountId: string,
    options?: { limit?: number; order?: 'asc' | 'desc'; timestamp?: string }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.timestamp) queryParams.timestamp = options.timestamp;

    return this.request<any>(`/api/v1/accounts/${accountId}/rewards`, queryParams);
  }

  /**
   * Get crypto allowances for account
   * GET /api/v1/accounts/{id}/allowances/crypto
   */
  async getCryptoAllowances(
    accountId: string,
    options?: { limit?: number; order?: 'asc' | 'desc'; spender?: string }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.spender) queryParams['spender.id'] = options.spender;

    return this.request<any>(`/api/v1/accounts/${accountId}/allowances/crypto`, queryParams);
  }

  /**
   * Get token allowances for account
   * GET /api/v1/accounts/{id}/allowances/tokens
   */
  async getTokenAllowances(
    accountId: string,
    options?: { limit?: number; order?: 'asc' | 'desc'; tokenId?: string; spender?: string }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.tokenId) queryParams['token.id'] = options.tokenId;
    if (options?.spender) queryParams['spender.id'] = options.spender;

    return this.request<any>(`/api/v1/accounts/${accountId}/allowances/tokens`, queryParams);
  }

  /**
   * Get NFT allowances for account
   * GET /api/v1/accounts/{id}/allowances/nfts
   */
  async getNFTAllowances(
    accountId: string,
    options?: { limit?: number; order?: 'asc' | 'desc'; tokenId?: string }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.tokenId) queryParams['token.id'] = options.tokenId;

    return this.request<any>(`/api/v1/accounts/${accountId}/allowances/nfts`, queryParams);
  }

  /**
   * Get outstanding airdrops sent by account
   * GET /api/v1/accounts/{id}/airdrops/outstanding
   */
  async getOutstandingAirdrops(
    accountId: string,
    options?: { limit?: number; order?: 'asc' | 'desc'; receiverId?: string; tokenId?: string }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.receiverId) queryParams['receiver.id'] = options.receiverId;
    if (options?.tokenId) queryParams['token.id'] = options.tokenId;

    return this.request<any>(`/api/v1/accounts/${accountId}/airdrops/outstanding`, queryParams);
  }

  /**
   * Get pending airdrops received by account
   * GET /api/v1/accounts/{id}/airdrops/pending
   */
  async getPendingAirdrops(
    accountId: string,
    options?: { limit?: number; order?: 'asc' | 'desc'; senderId?: string; tokenId?: string }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.senderId) queryParams['sender.id'] = options.senderId;
    if (options?.tokenId) queryParams['token.id'] = options.tokenId;

    return this.request<any>(`/api/v1/accounts/${accountId}/airdrops/pending`, queryParams);
  }

  /**
   * Get single block by hash or number
   * GET /api/v1/blocks/{hashOrNumber}
   */
  async getBlock(hashOrNumber: string | number): Promise<any> {
    return this.request<any>(`/api/v1/blocks/${hashOrNumber}`);
  }

  /**
   * List all contracts
   * GET /api/v1/contracts
   */
  async listContracts(options?: {
    contractId?: string;
    limit?: number;
    order?: 'asc' | 'desc';
  }): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.contractId) queryParams['contract.id'] = options.contractId;
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;

    return this.request<any>('/api/v1/contracts', queryParams);
  }

  /**
   * Get contract state (storage)
   * GET /api/v1/contracts/{id}/state
   */
  async getContractState(
    contractId: string,
    options?: { limit?: number; order?: 'asc' | 'desc'; slot?: string; timestamp?: string }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.slot) queryParams.slot = options.slot;
    if (options?.timestamp) queryParams.timestamp = options.timestamp;

    return this.request<any>(`/api/v1/contracts/${contractId}/state`, queryParams);
  }

  /**
   * Get contract results (execution history)
   * GET /api/v1/contracts/{id}/results
   */
  async getContractResults(
    contractId: string,
    options?: { limit?: number; order?: 'asc' | 'desc'; timestamp?: string; from?: string }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.timestamp) queryParams.timestamp = options.timestamp;
    if (options?.from) queryParams.from = options.from;

    return this.request<any>(`/api/v1/contracts/${contractId}/results`, queryParams);
  }

  /**
   * Get single contract result by transaction ID or hash
   * GET /api/v1/contracts/results/{transactionIdOrHash}
   */
  async getContractResult(transactionIdOrHash: string): Promise<any> {
    return this.request<any>(`/api/v1/contracts/results/${transactionIdOrHash}`);
  }

  /**
   * Get contract call actions/trace
   * GET /api/v1/contracts/results/{transactionIdOrHash}/actions
   */
  async getContractActions(transactionIdOrHash: string): Promise<any> {
    return this.request<any>(`/api/v1/contracts/results/${transactionIdOrHash}/actions`);
  }

  /**
   * Get contract opcodes (EVM trace)
   * GET /api/v1/contracts/results/{transactionIdOrHash}/opcodes
   */
  async getContractOpcodes(
    transactionIdOrHash: string,
    options: { stack?: boolean; memory?: boolean; storage?: boolean } = {}
  ): Promise<any> {
    // The endpoint includes the full EVM stack at every step unless told not
    // to, which made a trace of a simple transaction 97KB.
    return this.request<any>(`/api/v1/contracts/results/${transactionIdOrHash}/opcodes`, {
      stack: options.stack ?? false,
      memory: options.memory ?? false,
      storage: options.storage ?? false,
    });
  }

  /**
   * Execute EVM call simulation (read-only)
   * POST /api/v1/contracts/call
   */
  async callContractSimulation(params: {
    block?: string;
    data: string;
    estimate?: boolean;
    from?: string;
    gas?: number;
    gasPrice?: number;
    to: string;
    value?: number;
  }): Promise<any> {
    const url = `${this.config.baseUrl}/api/v1/contracts/call`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Mirror Node API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return response.json();
  }

  /**
   * Search contract logs across all contracts
   * GET /api/v1/contracts/results/logs
   */
  async searchContractLogs(options?: {
    limit?: number;
    order?: 'asc' | 'desc';
    timestamp?: string | string[];
    topic0?: string;
    topic1?: string;
    topic2?: string;
    topic3?: string;
  }): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.timestamp) queryParams.timestamp = options.timestamp;
    if (options?.topic0) queryParams.topic0 = options.topic0;
    if (options?.topic1) queryParams.topic1 = options.topic1;
    if (options?.topic2) queryParams.topic2 = options.topic2;
    if (options?.topic3) queryParams.topic3 = options.topic3;

    // The mirror node refuses a topic search without a bounded time range
    // (both a lower and an upper bound, under seven days apart), so the search
    // was unusable as written. Default to the last 24 hours.
    const searchesTopics = Boolean(
      options?.topic0 || options?.topic1 || options?.topic2 || options?.topic3
    );
    if (searchesTopics && !options?.timestamp) {
      const now = Math.floor(Date.now() / 1000);
      queryParams.timestamp = [`gte:${now - 86_400}`, `lte:${now}`];
    } else if (typeof options?.timestamp === 'string' && options.timestamp.includes(',')) {
      // "gte:X,lte:Y" -> the repeated parameter the API expects
      queryParams.timestamp = options.timestamp.split(',').map((bound) => bound.trim());
    }

    return this.request<any>('/api/v1/contracts/results/logs', queryParams);
  }

  /**
   * Get all contract results (global)
   * GET /api/v1/contracts/results
   */
  async getAllContractResults(options?: {
    limit?: number;
    order?: 'asc' | 'desc';
    timestamp?: string;
    from?: string;
  }): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.timestamp) queryParams.timestamp = options.timestamp;
    if (options?.from) queryParams.from = options.from;

    return this.request<any>('/api/v1/contracts/results', queryParams);
  }

  /**
   * Get network consensus nodes
   * GET /api/v1/network/nodes
   */
  async getNetworkNodes(options?: {
    limit?: number;
    order?: 'asc' | 'desc';
    nodeId?: number;
  }): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.nodeId) queryParams['node.id'] = options.nodeId;

    return this.request<any>('/api/v1/network/nodes', queryParams);
  }

  /**
   * Get network staking information
   * GET /api/v1/network/stake
   */
  async getNetworkStake(): Promise<any> {
    return this.request<any>('/api/v1/network/stake');
  }

  /**
   * List scheduled transactions
   * GET /api/v1/schedules
   */
  async listSchedules(options?: {
    accountId?: string;
    limit?: number;
    order?: 'asc' | 'desc';
    scheduleId?: string;
    executed?: boolean;
  }): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.accountId) queryParams['account.id'] = options.accountId;
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.scheduleId) queryParams['schedule.id'] = options.scheduleId;
    if (options?.executed !== undefined) queryParams.executed = options.executed;

    return this.request<any>('/api/v1/schedules', queryParams);
  }

  /**
   * Get single schedule by ID
   * GET /api/v1/schedules/{scheduleId}
   */
  async getSchedule(scheduleId: string): Promise<any> {
    return this.request<any>(`/api/v1/schedules/${scheduleId}`);
  }

  /**
   * Get single transaction by ID
   * GET /api/v1/transactions/{transactionId}
   */
  async getTransaction(transactionId: string): Promise<any> {
    return this.request<any>(`/api/v1/transactions/${transactionId}`);
  }

  /**
   * Get topic information (not just messages)
   * GET /api/v1/topics/{topicId}
   */
  async getTopicInfo(topicId: string): Promise<any> {
    return this.request<any>(`/api/v1/topics/${topicId}`);
  }

  /**
   * Get single topic message by sequence number
   * GET /api/v1/topics/{topicId}/messages/{sequenceNumber}
   */
  async getTopicMessage(topicId: string, sequenceNumber: number): Promise<any> {
    return this.request<any>(`/api/v1/topics/${topicId}/messages/${sequenceNumber}`);
  }

  /**
   * Get topic message by timestamp
   * GET /api/v1/topics/messages/{timestamp}
   */
  async getTopicMessageByTimestamp(timestamp: string): Promise<any> {
    return this.request<any>(`/api/v1/topics/messages/${timestamp}`);
  }

  /**
   * List tokens with filtering
   * GET /api/v1/tokens
   */
  async listTokens(options?: {
    accountId?: string;
    limit?: number;
    order?: 'asc' | 'desc';
    publicKey?: string;
    tokenId?: string;
    type?: 'FUNGIBLE_COMMON' | 'NON_FUNGIBLE_UNIQUE';
  }): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.accountId) queryParams['account.id'] = options.accountId;
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.publicKey) queryParams.publickey = options.publicKey;
    if (options?.tokenId) queryParams['token.id'] = options.tokenId;
    if (options?.type) queryParams.type = options.type;

    return this.request<any>('/api/v1/tokens', queryParams);
  }

  /**
   * Get token balances distribution
   * GET /api/v1/tokens/{tokenId}/balances
   */
  async getTokenBalances(
    tokenId: string,
    options?: { accountId?: string; limit?: number; order?: 'asc' | 'desc'; timestamp?: string }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.accountId) queryParams['account.id'] = options.accountId;
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.timestamp) queryParams.timestamp = options.timestamp;

    return this.request<any>(`/api/v1/tokens/${tokenId}/balances`, queryParams);
  }

  /**
   * List NFTs for a token
   * GET /api/v1/tokens/{tokenId}/nfts
   */
  async listTokenNFTs(
    tokenId: string,
    options?: { accountId?: string; limit?: number; order?: 'asc' | 'desc'; serialNumber?: number }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.accountId) queryParams['account.id'] = options.accountId;
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.serialNumber) queryParams.serialnumber = options.serialNumber;

    return this.request<any>(`/api/v1/tokens/${tokenId}/nfts`, queryParams);
  }

  /**
   * Get single NFT by serial number
   * GET /api/v1/tokens/{tokenId}/nfts/{serialNumber}
   */
  async getNFT(tokenId: string, serialNumber: number): Promise<any> {
    return this.request<any>(`/api/v1/tokens/${tokenId}/nfts/${serialNumber}`);
  }

  /**
   * Get NFT transaction history
   * GET /api/v1/tokens/{tokenId}/nfts/{serialNumber}/transactions
   */
  async getNFTTransactions(
    tokenId: string,
    serialNumber: number,
    options?: { limit?: number; order?: 'asc' | 'desc'; timestamp?: string }
  ): Promise<any> {
    const queryParams: Record<string, any> = {};
    if (options?.limit) queryParams.limit = options.limit;
    if (options?.order) queryParams.order = options.order;
    if (options?.timestamp) queryParams.timestamp = options.timestamp;

    return this.request<any>(
      `/api/v1/tokens/${tokenId}/nfts/${serialNumber}/transactions`,
      queryParams
    );
  }

  /**
   * Get OpenAPI spec info
   */
  getOpenApiSpecUrl(): string {
    return `${this.config.baseUrl}/api/v1/docs/openapi.yml`;
  }

  /**
   * Get Swagger UI URL
   */
  getSwaggerUiUrl(): string {
    return `${this.config.baseUrl}/api/v1/docs/`;
  }
}

// Export singleton instance
export const mirrorNodeService = new MirrorNodeService();
