import dotenv from 'dotenv';
import { ServerConfig, HederaConfig, OpenAIConfig, ChromaDBConfig } from '../types/index.js';

// Always load .env file for backend secrets (OPENAI_API_KEY, CHROMA_URL, etc.)
// MCP config provides user-specific values (HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_NETWORK)
// dotenv won't override existing env vars, so MCP config takes precedence for user values
dotenv.config();

export function getServerConfig(): ServerConfig {
  return {
    name: process.env.MCP_SERVER_NAME || 'hashpilot',
    version: process.env.MCP_SERVER_VERSION || '0.1.0',
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
  };
}

export function getHederaConfig(): HederaConfig {
  const network = process.env.HEDERA_NETWORK as 'mainnet' | 'testnet' | 'previewnet' | 'local';

  return {
    network: network || 'testnet',
    operatorId: process.env.HEDERA_OPERATOR_ID,
    operatorKey: process.env.HEDERA_OPERATOR_KEY,
    mirrorNodeUrl: process.env.MIRROR_NODE_URL,
    jsonRpcRelayUrl: process.env.JSON_RPC_RELAY_URL,
    graphqlEndpoint: process.env.GRAPHQL_ENDPOINT,
  };
}

export function getOpenAIConfig(): OpenAIConfig {
  // OpenAI API key is loaded from .env (backend secret)
  // If not available, RAG features will be disabled gracefully
  const apiKey = process.env.OPENAI_API_KEY || '';

  return {
    apiKey,
    model: process.env.OPENAI_MODEL || 'text-embedding-3-small',
  };
}

export function getChromaDBConfig(): ChromaDBConfig {
  // ChromaDB config is loaded from .env (backend infrastructure)
  // Default to localhost:8000 for local development
  return {
    host: process.env.CHROMA_HOST || 'localhost',
    port: parseInt(process.env.CHROMA_PORT || '8000', 10),
    collectionName: process.env.CHROMA_COLLECTION_NAME || 'hedera_docs',
    // Full URL takes precedence if provided
    url: process.env.CHROMA_URL || 'http://localhost:8000',
  };
}
