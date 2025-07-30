#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ethers } from "ethers";

const HEDERA_NETWORKS = {
  mainnet: {
    chainId: 295,
    rpcUrl: "https://mainnet.hashio.io/api",
    name: "Hedera Mainnet"
  },
  testnet: {
    chainId: 296,
    rpcUrl: "https://testnet.hashio.io/api",
    name: "Hedera Testnet"
  },
  previewnet: {
    chainId: 297,
    rpcUrl: "https://previewnet.hashio.io/api",
    name: "Hedera Previewnet"
  }
};

const DEFAULT_NETWORK = "testnet";

function getProvider(network: string = DEFAULT_NETWORK) {
  const networkConfig = HEDERA_NETWORKS[network as keyof typeof HEDERA_NETWORKS];
  if (!networkConfig) {
    throw new Error(`Unknown network: ${network}`);
  }
  return new ethers.JsonRpcProvider(networkConfig.rpcUrl);
}

function convertHederaAccountToEvmAddress(accountId: string): string {
  const parts = accountId.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid Hedera account ID format. Expected: 0.0.12345");
  }
  const accountNum = parseInt(parts[2]);
  return "0x" + accountNum.toString(16).padStart(40, "0");
}

const server = new Server(
  {
    name: "hashpilot",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_account_balance",
        description: "Get the HBAR balance of a Hedera account using JSON-RPC",
        inputSchema: {
          type: "object",
          properties: {
            accountId: {
              type: "string",
              description: "The Hedera account ID (e.g., 0.0.12345)",
            },
            network: {
              type: "string",
              description: "Network to query (mainnet, testnet, previewnet). Default: testnet",
              enum: ["mainnet", "testnet", "previewnet"],
            },
          },
          required: ["accountId"],
        },
      },
      {
        name: "get_transaction_receipt",
        description: "Get transaction receipt by transaction hash",
        inputSchema: {
          type: "object",
          properties: {
            txHash: {
              type: "string",
              description: "The transaction hash (0x...)",
            },
            network: {
              type: "string",
              description: "Network to query (mainnet, testnet, previewnet). Default: testnet",
              enum: ["mainnet", "testnet", "previewnet"],
            },
          },
          required: ["txHash"],
        },
      },
      {
        name: "get_block_info",
        description: "Get information about a specific block",
        inputSchema: {
          type: "object",
          properties: {
            blockNumber: {
              type: "string",
              description: "Block number or 'latest'",
            },
            network: {
              type: "string",
              description: "Network to query (mainnet, testnet, previewnet). Default: testnet",
              enum: ["mainnet", "testnet", "previewnet"],
            },
          },
          required: ["blockNumber"],
        },
      },
      {
        name: "estimate_gas",
        description: "Estimate gas for a transaction",
        inputSchema: {
          type: "object",
          properties: {
            from: {
              type: "string",
              description: "From address (Hedera account ID or 0x address)",
            },
            to: {
              type: "string",
              description: "To address (Hedera account ID or 0x address)",
            },
            value: {
              type: "string",
              description: "Amount in HBAR to send (optional)",
            },
            data: {
              type: "string",
              description: "Transaction data for contract calls (optional)",
            },
            network: {
              type: "string",
              description: "Network to query (mainnet, testnet, previewnet). Default: testnet",
              enum: ["mainnet", "testnet", "previewnet"],
            },
          },
          required: ["from", "to"],
        },
      },
      {
        name: "get_network_info",
        description: "Get current network information (chain ID, gas price, block number)",
        inputSchema: {
          type: "object",
          properties: {
            network: {
              type: "string",
              description: "Network to query (mainnet, testnet, previewnet). Default: testnet",
              enum: ["mainnet", "testnet", "previewnet"],
            },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "get_account_balance": {
        const { accountId, network } = request.params.arguments as { 
          accountId: string; 
          network?: string;
        };
        
        const provider = getProvider(network);
        const evmAddress = convertHederaAccountToEvmAddress(accountId);
        const balance = await provider.getBalance(evmAddress);
        const balanceInHbar = ethers.formatEther(balance);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                accountId,
                evmAddress,
                balance: balanceInHbar + " HBAR",
                network: network || DEFAULT_NETWORK,
              }, null, 2),
            },
          ],
        };
      }
      
      case "get_transaction_receipt": {
        const { txHash, network } = request.params.arguments as { 
          txHash: string; 
          network?: string;
        };
        
        const provider = getProvider(network);
        const receipt = await provider.getTransactionReceipt(txHash);
        
        if (!receipt) {
          return {
            content: [
              {
                type: "text",
                text: "Transaction receipt not found",
              },
            ],
          };
        }
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                transactionHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                from: receipt.from,
                to: receipt.to,
                gasUsed: receipt.gasUsed.toString(),
                status: receipt.status,
                network: network || DEFAULT_NETWORK,
              }, null, 2),
            },
          ],
        };
      }
      
      case "get_block_info": {
        const { blockNumber, network } = request.params.arguments as { 
          blockNumber: string; 
          network?: string;
        };
        
        const provider = getProvider(network);
        const block = await provider.getBlock(blockNumber);
        
        if (!block) {
          return {
            content: [
              {
                type: "text",
                text: "Block not found",
              },
            ],
          };
        }
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                number: block.number,
                hash: block.hash,
                timestamp: block.timestamp,
                gasLimit: block.gasLimit.toString(),
                gasUsed: block.gasUsed.toString(),
                transactions: block.transactions.length,
                network: network || DEFAULT_NETWORK,
              }, null, 2),
            },
          ],
        };
      }
      
      case "estimate_gas": {
        const { from, to, value, data, network } = request.params.arguments as { 
          from: string; 
          to: string;
          value?: string;
          data?: string;
          network?: string;
        };
        
        const provider = getProvider(network);
        
        const fromAddress = from.startsWith("0x") ? from : convertHederaAccountToEvmAddress(from);
        const toAddress = to.startsWith("0x") ? to : convertHederaAccountToEvmAddress(to);
        
        const tx: ethers.TransactionRequest = {
          from: fromAddress,
          to: toAddress,
          value: value ? ethers.parseEther(value) : undefined,
          data: data,
        };
        
        const gasEstimate = await provider.estimateGas(tx);
        const gasPrice = (await provider.getFeeData()).gasPrice;
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                gasLimit: gasEstimate.toString(),
                gasPrice: gasPrice ? ethers.formatUnits(gasPrice, "gwei") + " gwei" : "unknown",
                estimatedCost: gasPrice ? ethers.formatEther(gasEstimate * gasPrice) + " HBAR" : "unknown",
                network: network || DEFAULT_NETWORK,
              }, null, 2),
            },
          ],
        };
      }
      
      case "get_network_info": {
        const { network } = request.params.arguments as { 
          network?: string;
        };
        
        const provider = getProvider(network);
        const [blockNumber, feeData, chainId] = await Promise.all([
          provider.getBlockNumber(),
          provider.getFeeData(),
          provider.getNetwork().then(n => n.chainId),
        ]);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                network: network || DEFAULT_NETWORK,
                chainId: chainId.toString(),
                currentBlock: blockNumber,
                gasPrice: feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, "gwei") + " gwei" : "unknown",
                maxFeePerGas: feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, "gwei") + " gwei" : "unknown",
                rpcUrl: HEDERA_NETWORKS[network as keyof typeof HEDERA_NETWORKS || DEFAULT_NETWORK].rpcUrl,
              }, null, 2),
            },
          ],
        };
      }
      
      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("HashPilot server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});