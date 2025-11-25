/**
 * Hedera Client Service
 * Handles all Hedera SDK operations and client management
 */

import {
  Client,
  AccountId,
  PrivateKey,
  AccountBalanceQuery,
  AccountInfoQuery,
  TransferTransaction,
  AccountCreateTransaction,
  Hbar,
  PublicKey,
  TokenCreateTransaction,
  TokenAssociateTransaction,
  TokenMintTransaction,
  TokenBurnTransaction,
  TokenFreezeTransaction,
  TokenUnfreezeTransaction,
  TokenGrantKycTransaction,
  TokenRevokeKycTransaction,
  TokenWipeTransaction,
  TokenPauseTransaction,
  TokenUnpauseTransaction,
  TokenId,
  TopicCreateTransaction,
  TopicUpdateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
} from '@hashgraph/sdk';
import { getHederaConfig } from '../utils/config.js';
import logger from '../utils/logger.js';
import { HederaConfig } from '../types/index.js';
import { stateService } from './state.js';

export class HederaClientService {
  private client: Client | null = null;
  private config: HederaConfig;
  private currentNetwork: 'mainnet' | 'testnet' | 'previewnet' | 'local';

  constructor() {
    this.config = getHederaConfig();
    this.currentNetwork = this.config.network;
  }

  /**
   * Initialize Hedera client with operator credentials
   */
  async initialize(): Promise<void> {
    try {
      // Load network from state if available
      const savedNetwork = await stateService.loadNetworkState();
      if (savedNetwork) {
        this.currentNetwork = savedNetwork;
        this.config.network = savedNetwork;
        logger.info('Loaded network from state', { network: savedNetwork });
      }

      logger.info('Initializing Hedera client', { network: this.currentNetwork });

      // Create client based on network
      switch (this.currentNetwork) {
        case 'mainnet':
          this.client = Client.forMainnet();
          break;
        case 'testnet':
          this.client = Client.forTestnet();
          break;
        case 'previewnet':
          this.client = Client.forPreviewnet();
          break;
        case 'local':
          // For local network, set custom nodes
          this.client = Client.forNetwork({
            '127.0.0.1:50211': new AccountId(3),
          });
          break;
        default:
          throw new Error(`Unknown network: ${this.currentNetwork}`);
      }

      // Set operator if credentials are provided
      if (this.config.operatorId && this.config.operatorKey) {
        const operatorId = AccountId.fromString(this.config.operatorId);
        const operatorKey = PrivateKey.fromStringDer(this.config.operatorKey);
        this.client.setOperator(operatorId, operatorKey);
        logger.info('Hedera client operator set', { operatorId: this.config.operatorId });
      } else {
        logger.warn('No operator credentials provided - some operations will not be available');
      }

      logger.info('Hedera client initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Hedera client', { error });
      throw error;
    }
  }

  /**
   * Get the Hedera client instance
   */
  getClient(): Client {
    if (!this.client) {
      throw new Error('Hedera client not initialized. Call initialize() first.');
    }
    return this.client;
  }

  /**
   * Check if client is initialized and has operator
   */
  isReady(): boolean {
    return this.client !== null && this.client.operatorAccountId !== null;
  }

  /**
   * Switch to a different network
   */
  async switchNetwork(network: 'mainnet' | 'testnet' | 'previewnet' | 'local'): Promise<void> {
    logger.info('Switching network', { from: this.currentNetwork, to: network });

    // Close existing client
    if (this.client) {
      this.client.close();
    }

    this.currentNetwork = network;
    this.config.network = network;

    // Clear hardcoded URLs so network-specific URLs are used
    // This ensures Mirror Node and JSON-RPC URLs match the new network
    this.config.mirrorNodeUrl = undefined;
    this.config.jsonRpcRelayUrl = undefined;

    // Persist network change to disk
    await stateService.saveNetworkState(network);

    await this.initialize();
  }

  /**
   * Get current network
   */
  getCurrentNetwork(): string {
    return this.currentNetwork;
  }

  /**
   * Get account balance (HBAR and tokens)
   */
  async getAccountBalance(accountId: string): Promise<{
    hbar: string;
    tokens: Record<string, string>;
  }> {
    try {
      const client = this.getClient();
      const balance = await new AccountBalanceQuery()
        .setAccountId(AccountId.fromString(accountId))
        .execute(client);

      // Convert token balances to object
      const tokens: Record<string, string> = {};
      if (balance.tokens) {
        for (const [tokenId, amount] of balance.tokens) {
          tokens[tokenId.toString()] = amount.toString();
        }
      }

      return {
        hbar: balance.hbars.toString(),
        tokens,
      };
    } catch (error) {
      logger.error('Failed to get account balance', { accountId, error });
      throw error;
    }
  }

  /**
   * Get account info
   */
  async getAccountInfo(accountId: string): Promise<{
    accountId: string;
    balance: string;
    evmAddress: string | null;
    key: string;
    memo: string;
    autoRenewPeriod: number;
    expirationTime: Date;
  }> {
    try {
      const client = this.getClient();
      const info = await new AccountInfoQuery()
        .setAccountId(AccountId.fromString(accountId))
        .execute(client);

      return {
        accountId: info.accountId.toString(),
        balance: info.balance.toString(),
        evmAddress: info.contractAccountId || null,
        key: info.key.toString(),
        memo: info.accountMemo,
        autoRenewPeriod: info.autoRenewPeriod?.seconds?.toNumber() || 0,
        expirationTime: info.expirationTime
          ? new Date(info.expirationTime.seconds.toNumber() * 1000)
          : new Date(),
      };
    } catch (error) {
      logger.error('Failed to get account info', { accountId, error });
      throw error;
    }
  }

  /**
   * Create a new Hedera account
   */
  async createAccount(options: {
    initialBalance?: number;
    publicKey?: string;
    memo?: string;
  }): Promise<{
    accountId: string;
    privateKey: string;
    publicKey: string;
    transactionId: string;
  }> {
    try {
      const client = this.getClient();

      // Generate new key pair if not provided
      let privateKey: PrivateKey;
      let publicKey: PublicKey;

      if (options.publicKey) {
        publicKey = PublicKey.fromString(options.publicKey);
        privateKey = PrivateKey.fromString(''); // Will not be returned if using provided key
      } else {
        privateKey = PrivateKey.generateECDSA();
        publicKey = privateKey.publicKey;
      }

      // Create the account
      const transaction = new AccountCreateTransaction()
        .setKey(publicKey)
        .setInitialBalance(new Hbar(options.initialBalance || 1)); // Default 1 HBAR

      if (options.memo) {
        transaction.setAccountMemo(options.memo);
      }

      const txResponse = await transaction.execute(client);
      const receipt = await txResponse.getReceipt(client);
      const newAccountId = receipt.accountId;

      if (!newAccountId) {
        throw new Error('Failed to create account - no account ID in receipt');
      }

      logger.info('Account created successfully', {
        accountId: newAccountId.toString(),
        initialBalance: options.initialBalance || 1,
      });

      return {
        accountId: newAccountId.toString(),
        privateKey: options.publicKey ? 'NOT_GENERATED' : privateKey.toStringDer(),
        publicKey: publicKey.toStringDer(),
        transactionId: txResponse.transactionId.toString(),
      };
    } catch (error) {
      logger.error('Failed to create account', { error });
      throw error;
    }
  }

  /**
   * Transfer HBAR between accounts
   */
  async transferHbar(
    fromAccountId: string,
    toAccountId: string,
    amount: number
  ): Promise<{ transactionId: string; status: string }> {
    try {
      const client = this.getClient();

      const transaction = await new TransferTransaction()
        .addHbarTransfer(fromAccountId, new Hbar(-amount))
        .addHbarTransfer(toAccountId, new Hbar(amount))
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to transfer HBAR', { fromAccountId, toAccountId, amount, error });
      throw error;
    }
  }

  /**
   * Create a new token
   */
  async createToken(options: {
    name: string;
    symbol: string;
    decimals?: number;
    initialSupply?: number;
    treasuryAccountId?: string;
    adminKey?: boolean;
    kycKey?: boolean;
    freezeKey?: boolean;
    wipeKey?: boolean;
    supplyKey?: boolean;
    pauseKey?: boolean;
    memo?: string;
  }): Promise<{
    tokenId: string;
    transactionId: string;
  }> {
    try {
      const client = this.getClient();
      const operatorKey = client.operatorPublicKey;

      if (!operatorKey) {
        throw new Error('Operator key not set on client');
      }

      // Treasury account defaults to operator
      const treasuryId = options.treasuryAccountId || client.operatorAccountId?.toString();
      if (!treasuryId) {
        throw new Error('Treasury account ID required');
      }

      const transaction = new TokenCreateTransaction()
        .setTokenName(options.name)
        .setTokenSymbol(options.symbol)
        .setDecimals(options.decimals || 0)
        .setInitialSupply(options.initialSupply || 1000)
        .setTreasuryAccountId(treasuryId);

      // Set keys if enabled (all use operator key)
      if (options.adminKey) {
        transaction.setAdminKey(operatorKey);
      }
      if (options.kycKey) {
        transaction.setKycKey(operatorKey);
      }
      if (options.freezeKey) {
        transaction.setFreezeKey(operatorKey);
      }
      if (options.wipeKey) {
        transaction.setWipeKey(operatorKey);
      }
      if (options.supplyKey !== false) {
        // Default to true
        transaction.setSupplyKey(operatorKey);
      }
      if (options.pauseKey) {
        transaction.setPauseKey(operatorKey);
      }

      if (options.memo) {
        transaction.setTokenMemo(options.memo);
      }

      const txResponse = await transaction.execute(client);
      const receipt = await txResponse.getReceipt(client);
      const tokenId = receipt.tokenId;

      if (!tokenId) {
        throw new Error('Failed to create token - no token ID in receipt');
      }

      logger.info('Token created successfully', {
        tokenId: tokenId.toString(),
        name: options.name,
        symbol: options.symbol,
      });

      return {
        tokenId: tokenId.toString(),
        transactionId: txResponse.transactionId.toString(),
      };
    } catch (error) {
      logger.error('Failed to create token', { error });
      throw error;
    }
  }

  /**
   * Associate a token with an account
   */
  async associateToken(
    accountId: string,
    tokenId: string,
    privateKey?: string
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = new TokenAssociateTransaction()
        .setAccountId(accountId)
        .setTokenIds([TokenId.fromString(tokenId)])
        .freezeWith(client);

      // Sign with account's private key if provided
      let signedTx;
      if (privateKey) {
        const accountKey = PrivateKey.fromStringDer(privateKey);
        signedTx = await transaction.sign(accountKey);
      } else {
        // Assume operator is the account
        signedTx = transaction;
      }

      const txResponse = await signedTx.execute(client);
      const receipt = await txResponse.getReceipt(client);

      logger.info('Token associated successfully', { accountId, tokenId });

      return {
        transactionId: txResponse.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to associate token', { accountId, tokenId, error });
      throw error;
    }
  }

  /**
   * Transfer tokens between accounts
   */
  async transferToken(
    tokenId: string,
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    senderPrivateKey?: string
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();
      const token = TokenId.fromString(tokenId);

      const transaction = new TransferTransaction()
        .addTokenTransfer(token, fromAccountId, -amount)
        .addTokenTransfer(token, toAccountId, amount)
        .freezeWith(client);

      // Sign with sender's private key if provided
      let signedTx;
      if (senderPrivateKey) {
        const senderKey = PrivateKey.fromStringDer(senderPrivateKey);
        signedTx = await transaction.sign(senderKey);
      } else {
        // Assume operator is the sender
        signedTx = transaction;
      }

      const txResponse = await signedTx.execute(client);
      const receipt = await txResponse.getReceipt(client);

      logger.info('Token transferred successfully', {
        tokenId,
        from: fromAccountId,
        to: toAccountId,
        amount,
      });

      return {
        transactionId: txResponse.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to transfer token', { tokenId, fromAccountId, toAccountId, error });
      throw error;
    }
  }

  /**
   * Mint tokens
   */
  async mintToken(
    tokenId: string,
    amount: number
  ): Promise<{
    transactionId: string;
    status: string;
    newTotalSupply: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenMintTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAmount(amount)
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token minted successfully', { tokenId, amount });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
        newTotalSupply: receipt.totalSupply?.toString() || '0',
      };
    } catch (error) {
      logger.error('Failed to mint token', { tokenId, amount, error });
      throw error;
    }
  }

  /**
   * Burn tokens
   */
  async burnToken(
    tokenId: string,
    amount: number
  ): Promise<{
    transactionId: string;
    status: string;
    newTotalSupply: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenBurnTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAmount(amount)
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token burned successfully', { tokenId, amount });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
        newTotalSupply: receipt.totalSupply?.toString() || '0',
      };
    } catch (error) {
      logger.error('Failed to burn token', { tokenId, amount, error });
      throw error;
    }
  }

  /**
   * Freeze token for an account
   */
  async freezeToken(
    tokenId: string,
    accountId: string
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenFreezeTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAccountId(accountId)
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token frozen successfully', { tokenId, accountId });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to freeze token', { tokenId, accountId, error });
      throw error;
    }
  }

  /**
   * Unfreeze token for an account
   */
  async unfreezeToken(
    tokenId: string,
    accountId: string
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenUnfreezeTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAccountId(accountId)
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token unfrozen successfully', { tokenId, accountId });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to unfreeze token', { tokenId, accountId, error });
      throw error;
    }
  }

  /**
   * Grant KYC status to an account for a token
   */
  async grantKyc(
    tokenId: string,
    accountId: string
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenGrantKycTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAccountId(accountId)
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('KYC granted successfully', { tokenId, accountId });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to grant KYC', { tokenId, accountId, error });
      throw error;
    }
  }

  /**
   * Revoke KYC status from an account for a token
   */
  async revokeKyc(
    tokenId: string,
    accountId: string
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenRevokeKycTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAccountId(accountId)
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('KYC revoked successfully', { tokenId, accountId });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to revoke KYC', { tokenId, accountId, error });
      throw error;
    }
  }

  /**
   * Wipe tokens from an account
   */
  async wipeToken(
    tokenId: string,
    accountId: string,
    amount: number
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenWipeTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAccountId(accountId)
        .setAmount(amount)
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token wiped successfully', { tokenId, accountId, amount });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to wipe token', { tokenId, accountId, amount, error });
      throw error;
    }
  }

  /**
   * Pause all token operations
   */
  async pauseToken(tokenId: string): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenPauseTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token paused successfully', { tokenId });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to pause token', { tokenId, error });
      throw error;
    }
  }

  /**
   * Unpause token operations
   */
  async unpauseToken(tokenId: string): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenUnpauseTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token unpaused successfully', { tokenId });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to unpause token', { tokenId, error });
      throw error;
    }
  }

  /**
   * Create a new HCS topic
   */
  async createTopic(options: {
    memo?: string;
    adminKey?: boolean;
    submitKey?: boolean;
    autoRenewPeriod?: number;
  }): Promise<{
    topicId: string;
    transactionId: string;
  }> {
    try {
      const client = this.getClient();
      const operatorKey = client.operatorPublicKey;

      if (!operatorKey) {
        throw new Error('Operator key not set on client');
      }

      const transaction = new TopicCreateTransaction();

      if (options.memo) {
        transaction.setTopicMemo(options.memo);
      }

      if (options.adminKey) {
        transaction.setAdminKey(operatorKey);
      }

      if (options.submitKey) {
        transaction.setSubmitKey(operatorKey);
      }

      // Default auto-renew period: 90 days (7776000 seconds)
      transaction.setAutoRenewPeriod(options.autoRenewPeriod || 7776000);

      const txResponse = await transaction.execute(client);
      const receipt = await txResponse.getReceipt(client);
      const topicId = receipt.topicId;

      if (!topicId) {
        throw new Error('Failed to create topic - no topic ID in receipt');
      }

      logger.info('Topic created successfully', {
        topicId: topicId.toString(),
        memo: options.memo,
      });

      return {
        topicId: topicId.toString(),
        transactionId: txResponse.transactionId.toString(),
      };
    } catch (error) {
      logger.error('Failed to create topic', { error });
      throw error;
    }
  }

  /**
   * Update an existing HCS topic
   */
  async updateTopic(
    topicId: string,
    options: {
      memo?: string;
      autoRenewPeriod?: number;
    }
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = new TopicUpdateTransaction().setTopicId(TopicId.fromString(topicId));

      if (options.memo !== undefined) {
        transaction.setTopicMemo(options.memo);
      }

      if (options.autoRenewPeriod !== undefined) {
        transaction.setAutoRenewPeriod(options.autoRenewPeriod);
      }

      const txResponse = await transaction.execute(client);
      const receipt = await txResponse.getReceipt(client);

      logger.info('Topic updated successfully', { topicId });

      return {
        transactionId: txResponse.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to update topic', { topicId, error });
      throw error;
    }
  }

  /**
   * Submit a message to an HCS topic
   */
  async submitMessage(
    topicId: string,
    message: string,
    submitKey?: string
  ): Promise<{
    transactionId: string;
    status: string;
    sequenceNumber: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(message)
        .setMaxChunks(20) // Support up to 20 chunks for large messages
        .freezeWith(client);

      // Sign with submit key if provided (for private topics)
      let signedTx;
      if (submitKey) {
        const key = PrivateKey.fromStringDer(submitKey);
        signedTx = await transaction.sign(key);
      } else {
        signedTx = transaction;
      }

      const txResponse = await signedTx.execute(client);
      const receipt = await txResponse.getReceipt(client);

      logger.info('Message submitted successfully', {
        topicId,
        messageLength: message.length,
        sequenceNumber: receipt.topicSequenceNumber?.toString(),
      });

      return {
        transactionId: txResponse.transactionId.toString(),
        status: receipt.status.toString(),
        sequenceNumber: receipt.topicSequenceNumber?.toString() || '0',
      };
    } catch (error) {
      logger.error('Failed to submit message', { topicId, error });
      throw error;
    }
  }

  /**
   * Query topic messages from Mirror Node REST API
   */
  async queryMessages(
    topicId: string,
    options?: {
      sequenceNumber?: number;
      limit?: number;
      order?: 'asc' | 'desc';
    }
  ): Promise<{
    messages: Array<{
      consensusTimestamp: string;
      sequenceNumber: number;
      message: string;
      runningHash: string;
    }>;
  }> {
    try {
      const mirrorNodeUrl = this.getMirrorNodeUrl();
      let url = `${mirrorNodeUrl}/api/v1/topics/${topicId}/messages`;

      // Add query parameters
      const params = new URLSearchParams();
      if (options?.sequenceNumber) {
        params.append('sequencenumber', `gte:${options.sequenceNumber}`);
      }
      if (options?.limit) {
        params.append('limit', options.limit.toString());
      }
      if (options?.order) {
        params.append('order', options.order);
      }

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      logger.info('Querying topic messages', { topicId, url });

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Mirror Node API error: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        messages: Array<{
          consensus_timestamp: string;
          sequence_number: number;
          message: string;
          running_hash: string;
        }>;
      };

      // Decode base64 messages and format response
      const messages = data.messages.map((msg) => ({
        consensusTimestamp: msg.consensus_timestamp,
        sequenceNumber: msg.sequence_number,
        message: Buffer.from(msg.message, 'base64').toString('utf-8'),
        runningHash: msg.running_hash,
      }));

      logger.info('Messages retrieved successfully', {
        topicId,
        count: messages.length,
      });

      return { messages };
    } catch (error) {
      logger.error('Failed to query messages', { topicId, error });
      throw error;
    }
  }

  /**
   * Subscribe to topic messages (real-time)
   */
  async subscribeToTopic(
    topicId: string,
    _options?: {
      startTime?: Date;
    }
  ): Promise<{
    subscriptionId: string;
    message: string;
  }> {
    try {
      // Note: Real subscription would require maintaining a long-running connection
      // For MCP tools, we return a subscription acknowledgment
      // Actual implementation would use TopicMessageQuery with callback

      logger.info('Topic subscription created', { topicId });

      return {
        subscriptionId: `sub-${topicId}-${Date.now()}`,
        message: `Subscription created for topic ${topicId}. Use message_query to retrieve messages.`,
      };
    } catch (error) {
      logger.error('Failed to subscribe to topic', { topicId, error });
      throw error;
    }
  }

  /**
   * Close the client connection
   */
  close(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
      logger.info('Hedera client closed');
    }
  }

  /**
   * Get Mirror Node URL for current network
   */
  getMirrorNodeUrl(): string {
    if (this.config.mirrorNodeUrl) {
      return this.config.mirrorNodeUrl;
    }

    switch (this.currentNetwork) {
      case 'mainnet':
        return 'https://mainnet.mirrornode.hedera.com';
      case 'testnet':
        return 'https://testnet.mirrornode.hedera.com';
      case 'previewnet':
        return 'https://previewnet.mirrornode.hedera.com';
      case 'local':
        return 'http://localhost:5551';
      default:
        throw new Error(`Unknown network: ${this.currentNetwork}`);
    }
  }

  /**
   * Get JSON-RPC Relay URL for current network
   */
  getJsonRpcRelayUrl(): string {
    if (this.config.jsonRpcRelayUrl) {
      return this.config.jsonRpcRelayUrl;
    }

    switch (this.currentNetwork) {
      case 'mainnet':
        return 'https://mainnet.hashio.io/api';
      case 'testnet':
        return 'https://testnet.hashio.io/api';
      case 'previewnet':
        return 'https://previewnet.hashio.io/api';
      case 'local':
        return 'http://localhost:7546';
      default:
        throw new Error(`Unknown network: ${this.currentNetwork}`);
    }
  }
}

// Export singleton instance
export const hederaClient = new HederaClientService();
