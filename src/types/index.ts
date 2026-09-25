/**
 * Type definitions for Hashpilot MCP Server
 */

export interface ServerConfig {
  name: string;
  version: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * The networks this server can talk to.
 *
 * Exported as a value, not just a type: the network name arrives from an MCP
 * client, from a persisted state file and from a restored backup, none of which
 * TypeScript checks at runtime. Persisting an unvalidated name used to brick the
 * server permanently — every tool answered "Unknown network: <junk>" and the bad
 * value survived restarts.
 */
export const SUPPORTED_NETWORKS = ['mainnet', 'testnet', 'previewnet', 'local'] as const;

export type SupportedNetwork = (typeof SUPPORTED_NETWORKS)[number];

export function isSupportedNetwork(value: unknown): value is SupportedNetwork {
  return typeof value === 'string' && (SUPPORTED_NETWORKS as readonly string[]).includes(value);
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
