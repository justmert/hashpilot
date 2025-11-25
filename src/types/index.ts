/**
 * Type definitions for Hashpilot MCP Server
 */

export interface ServerConfig {
  name: string;
  version: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface HederaConfig {
  network: 'mainnet' | 'testnet' | 'previewnet' | 'local';
  operatorId?: string;
  operatorKey?: string;
  mirrorNodeUrl?: string;
  jsonRpcRelayUrl?: string;
  graphqlEndpoint?: string;
}

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
}

export interface ChromaDBConfig {
  host: string;
  port: number;
  collectionName: string;
  url?: string; // Full URL takes precedence if provided
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AccountInfo {
  accountId: string;
  balance: string;
  evmAddress?: string;
  publicKey?: string;
}

export interface TokenInfo {
  tokenId: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  treasury: string;
}

export interface TopicInfo {
  topicId: string;
  memo?: string;
  adminKey?: string;
  submitKey?: string;
}
