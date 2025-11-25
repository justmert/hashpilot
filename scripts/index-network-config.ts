#!/usr/bin/env tsx
/**
 * Network Configuration and Fee Schedule Indexer
 *
 * Fetches and indexes Hedera network configuration including:
 * - Fee schedules (current and all historical)
 * - Network parameters
 * - Exchange rates
 * - Node information
 */

import { config as loadEnv } from 'dotenv';
import { ChromaDBService } from '../src/services/chromadb-service.js';
import { EmbeddingService } from '../src/services/embedding-service.js';
import { DocumentChunker } from '../src/utils/document-chunker.js';
import { createRAGConfig, validateRAGConfig } from '../src/config/rag.js';
import { Document } from '../src/types/rag.js';
import { logger } from '../src/utils/logger.js';

// Load environment variables
loadEnv();

interface IndexingStats {
  totalDocuments: number;
  totalChunks: number;
  errors: string[];
}

const MIRROR_NODE_CONFIG = {
  mainnet: 'https://mainnet.mirrornode.hedera.com',
  testnet: 'https://testnet.mirrornode.hedera.com',
  previewnet: 'https://previewnet.mirrornode.hedera.com',
};

const ENDPOINTS = {
  networkNodes: '/api/v1/network/nodes',
  networkFees: '/api/v1/network/fees',
  exchangeRates: '/api/v1/network/exchangerate',
  networkStake: '/api/v1/network/stake',
  networkSupply: '/api/v1/network/supply',
};

/**
 * Fetch data from Mirror Node API
 */
async function fetchMirrorNode(baseUrl: string, endpoint: string): Promise<any> {
  try {
    const url = `${baseUrl}${endpoint}`;
    console.log(`   📡 Fetching ${endpoint}...`);

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Hedera-MCP-Network-Indexer',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    logger.warn(`Failed to fetch ${endpoint}`, { error: error.message });
    return null;
  }
}

/**
 * Create document from network node data
 */
function createNetworkNodesDocument(data: any, network: string): Document {
  const nodes = data.nodes || [];
  const content = `# Hedera ${network.toUpperCase()} Network Nodes

## Overview
Total network nodes: ${nodes.length}
Network: ${network}

## Node Information

${nodes
  .slice(0, 50) // Limit to first 50 nodes for manageability
  .map((node: any) => {
    return `### Node ${node.node_id} (Account: ${node.node_account_id})
- **Description**: ${node.description || 'N/A'}
- **Public Key**: ${node.public_key || 'N/A'}
- **Service Endpoints**: ${(node.service_endpoints || []).map((ep: any) => `${ep.ip_address_v4}:${ep.port}`).join(', ')}
- **Stake**: ${node.stake || 'N/A'}
- **Stake Rewarded**: ${node.stake_rewarded || 'N/A'}
- **Stake Not Rewarded**: ${node.stake_not_rewarded || 'N/A'}
- **Min Stake**: ${node.min_stake || 'N/A'}
- **Max Stake**: ${node.max_stake || 'N/A'}
`;
  })
  .join('\n')}

## Summary Statistics
- Total Nodes: ${nodes.length}
- Network Type: ${network}
- Last Updated: ${new Date().toISOString()}
`;

  return {
    id: `network-nodes-${network}`,
    url: `${MIRROR_NODE_CONFIG[network as keyof typeof MIRROR_NODE_CONFIG]}/api/v1/network/nodes`,
    title: `Hedera ${network.toUpperCase()} Network Nodes`,
    content,
    metadata: {
      url: `${MIRROR_NODE_CONFIG[network as keyof typeof MIRROR_NODE_CONFIG]}/api/v1/network/nodes`,
      title: `Hedera ${network.toUpperCase()} Network Nodes`,
      description: `Complete list of ${nodes.length} consensus nodes on Hedera ${network} including stakes and endpoints`,
      contentType: 'reference',
      tags: ['network', 'nodes', 'consensus', network, 'infrastructure', 'stake'],
      crawledAt: new Date().toISOString(),
    },
  };
}

/**
 * Create document from fee schedule data
 */
function createFeeScheduleDocument(data: any, network: string): Document {
  const fees = data.fees || [];
  const timestamp = data.timestamp;

  // Group fees by service
  const feesByService: Record<string, any[]> = {};
  fees.forEach((fee: any) => {
    const service = fee.transaction_type?.split('_')[0] || 'OTHER';
    if (!feesByService[service]) {
      feesByService[service] = [];
    }
    feesByService[service].push(fee);
  });

  const content = `# Hedera ${network.toUpperCase()} Fee Schedule

## Overview
Network: ${network}
Timestamp: ${timestamp?.from || 'Current'}
Total Fee Entries: ${fees.length}

## Fee Schedule by Service

${Object.entries(feesByService)
  .map(([service, serviceFees]) => {
    return `### ${service} Service Fees

${(serviceFees as any[])
  .slice(0, 20)
  .map((fee: any) => {
    const gasPrice = fee.gas ? `Gas: ${fee.gas}` : '';
    return `- **${fee.transaction_type}**: ${fee.current_rate || 'Variable'} tinybars ${gasPrice}`;
  })
  .join('\n')}
`;
  })
  .join('\n')}

## Important Fee Information

### Fee Components
1. **Node Fee**: Payment to the specific node processing the transaction
2. **Network Fee**: Payment to the Hedera network
3. **Service Fee**: Payment for the specific service used

### Fee Calculation
- Fees are denominated in tinybars (1 HBAR = 100,000,000 tinybars)
- Actual fees may vary based on:
  - Current exchange rate (USD/HBAR)
  - Transaction complexity
  - Network congestion
  - Smart contract gas usage

### Common Transaction Fees (Approximate)
- CryptoCreate: Creates new account
- CryptoTransfer: Transfer HBAR between accounts
- TokenCreate: Create new HTS token
- TokenMint: Mint new tokens
- ConsensusSubmitMessage: Submit message to HCS topic
- FileCreate: Create file on File Service
- SmartContractCreate: Deploy smart contract

## Fee Schedule Updates
Fee schedules are updated through Hedera Improvement Proposals (HIPs) and governance.
Current schedule effective from: ${timestamp?.from || 'See Hedera documentation'}

Last indexed: ${new Date().toISOString()}
`;

  return {
    id: `fee-schedule-${network}`,
    url: `${MIRROR_NODE_CONFIG[network as keyof typeof MIRROR_NODE_CONFIG]}/api/v1/network/fees`,
    title: `Hedera ${network.toUpperCase()} Fee Schedule`,
    content,
    metadata: {
      url: `${MIRROR_NODE_CONFIG[network as keyof typeof MIRROR_NODE_CONFIG]}/api/v1/network/fees`,
      title: `Hedera ${network.toUpperCase()} Fee Schedule`,
      description: `Complete fee schedule for Hedera ${network} with ${fees.length} transaction types and pricing`,
      contentType: 'reference',
      tags: ['fees', 'pricing', 'transactions', network, 'costs', 'tinybars', 'hbar'],
      crawledAt: new Date().toISOString(),
    },
  };
}

/**
 * Create document from exchange rate data
 */
function createExchangeRateDocument(data: any, network: string): Document {
  const currentRate = data.current_rate;
  const nextRate = data.next_rate;

  const content = `# Hedera ${network.toUpperCase()} Exchange Rates

## Current Exchange Rate
- **USD to HBAR**: ${currentRate?.cent_equivalent || 'N/A'} cents = ${currentRate?.hbar_equivalent || 'N/A'} tinybars
- **Effective From**: ${currentRate?.expiration_time ? new Date(currentRate.expiration_time * 1000).toISOString() : 'Current'}
- **Rate**: 1 USD = ${currentRate?.hbar_equivalent && currentRate?.cent_equivalent ? (currentRate.hbar_equivalent / (currentRate.cent_equivalent / 100)).toFixed(2) : 'N/A'} HBAR

## Next Exchange Rate
- **USD to HBAR**: ${nextRate?.cent_equivalent || 'N/A'} cents = ${nextRate?.hbar_equivalent || 'N/A'} tinybars
- **Effective From**: ${nextRate?.expiration_time ? new Date(nextRate.expiration_time * 1000).toISOString() : 'Pending'}

## Understanding Exchange Rates

### Purpose
Exchange rates are used to:
1. Calculate transaction fees in USD terms
2. Maintain fee stability regardless of HBAR price fluctuations
3. Provide predictable costs for developers

### Rate Updates
- Exchange rates are updated regularly by the Hedera governing council
- Updates ensure fees remain stable in fiat terms
- Rate changes are announced in advance

### Fee Calculation Example
If a transaction costs 1,000,000 tinybars and:
- Current rate: ${currentRate?.cent_equivalent || '12'} cents = ${currentRate?.hbar_equivalent || '100000000'} tinybars
- USD cost = (1,000,000 / ${currentRate?.hbar_equivalent || '100000000'}) * (${currentRate?.cent_equivalent || '12'} / 100) USD

## Network Information
- Network: ${network}
- Last Updated: ${new Date().toISOString()}
- Data Source: Hedera Mirror Node API
`;

  return {
    id: `exchange-rate-${network}`,
    url: `${MIRROR_NODE_CONFIG[network as keyof typeof MIRROR_NODE_CONFIG]}/api/v1/network/exchangerate`,
    title: `Hedera ${network.toUpperCase()} Exchange Rates`,
    content,
    metadata: {
      url: `${MIRROR_NODE_CONFIG[network as keyof typeof MIRROR_NODE_CONFIG]}/api/v1/network/exchangerate`,
      title: `Hedera ${network.toUpperCase()} Exchange Rates`,
      description: `Current and next exchange rates for Hedera ${network} USD to HBAR conversion`,
      contentType: 'reference',
      tags: ['exchange-rate', 'pricing', 'usd', 'hbar', network, 'conversion', 'fees'],
      crawledAt: new Date().toISOString(),
    },
  };
}

/**
 * Create document from network stake data
 */
function createNetworkStakeDocument(data: any, network: string): Document {
  const content = `# Hedera ${network.toUpperCase()} Network Staking Information

## Overview
Network: ${network}

## Staking Parameters
- **Max Stake Rewarded**: ${data.max_stake_rewarded || 'N/A'} tinybars
- **Max Staking Reward Rate Per HBAR**: ${data.max_staking_reward_rate_per_hbar || 'N/A'}
- **Max Total Reward**: ${data.max_total_reward || 'N/A'} tinybars
- **Node Reward Fee Fraction**: ${data.node_reward_fee_fraction || 'N/A'}
- **Reserved Staking Rewards**: ${data.reserved_staking_rewards || 'N/A'} tinybars
- **Reward Balance Threshold**: ${data.reward_balance_threshold || 'N/A'} tinybars
- **Stake Total**: ${data.stake_total || 'N/A'} tinybars
- **Staking Period**: ${data.staking_period?.from || 'N/A'} to ${data.staking_period?.to || 'N/A'}
- **Staking Period Duration**: ${data.staking_period_duration || 'N/A'} nanoseconds
- **Staking Periods Stored**: ${data.staking_periods_stored || 'N/A'}
- **Staking Reward Fee Fraction**: ${data.staking_reward_fee_fraction || 'N/A'}
- **Staking Reward Rate**: ${data.staking_reward_rate || 'N/A'}
- **Staking Start Threshold**: ${data.staking_start_threshold || 'N/A'} tinybars
- **Unreserved Staking Reward Balance**: ${data.unreserved_staking_reward_balance || 'N/A'} tinybars

## Staking Mechanics

### How Staking Works
1. HBAR holders can stake to consensus nodes
2. Staking helps secure the network
3. Rewards are distributed based on stake amount and node performance
4. No slashing - staked HBAR is never at risk

### Reward Calculation
- Rewards are calculated daily
- Based on percentage of total stake
- Affected by node performance and uptime
- Maximum reward rate is capped

### Staking Best Practices
- Choose reliable nodes with high uptime
- Consider stake distribution across multiple nodes
- Monitor node performance regularly
- Understand reward periods and distribution

## Data Source
- Network: ${network}
- API: Hedera Mirror Node
- Last Updated: ${new Date().toISOString()}
`;

  return {
    id: `network-stake-${network}`,
    url: `${MIRROR_NODE_CONFIG[network as keyof typeof MIRROR_NODE_CONFIG]}/api/v1/network/stake`,
    title: `Hedera ${network.toUpperCase()} Network Staking`,
    content,
    metadata: {
      url: `${MIRROR_NODE_CONFIG[network as keyof typeof MIRROR_NODE_CONFIG]}/api/v1/network/stake`,
      title: `Hedera ${network.toUpperCase()} Network Staking`,
      description: `Network staking parameters and reward information for Hedera ${network}`,
      contentType: 'reference',
      tags: ['staking', 'rewards', 'consensus', network, 'hbar', 'nodes'],
      crawledAt: new Date().toISOString(),
    },
  };
}

/**
 * Create document from network supply data
 */
function createNetworkSupplyDocument(data: any, network: string): Document {
  const content = `# Hedera ${network.toUpperCase()} Network Supply

## Supply Statistics
- **Released Supply**: ${data.released_supply || 'N/A'} tinybars (${data.released_supply ? (data.released_supply / 100000000).toLocaleString() : 'N/A'} HBAR)
- **Total Supply**: ${data.total_supply || 'N/A'} tinybars (${data.total_supply ? (data.total_supply / 100000000).toLocaleString() : 'N/A'} HBAR)
- **Timestamp**: ${data.timestamp || 'Current'}

## Supply Distribution

### Key Metrics
- Released Supply: HBAR currently in circulation
- Total Supply: Maximum HBAR that will ever exist (50 billion)
- Remaining to Release: ${data.total_supply && data.released_supply ? ((data.total_supply - data.released_supply) / 100000000).toLocaleString() : 'N/A'} HBAR

### Supply Schedule
Hedera has a fixed supply schedule:
1. Total supply capped at 50 billion HBAR
2. Gradual release over time per published schedule
3. No inflation beyond the fixed supply
4. Burns reduce circulating supply

### Important Considerations
- Released supply increases over time per schedule
- Network fees are partially burned, reducing supply
- Staking rewards come from reserved supply
- Treasury manages unreleased HBAR

## Network Information
- Network: ${network}
- Data Source: Hedera Mirror Node API
- Last Updated: ${new Date().toISOString()}
`;

  return {
    id: `network-supply-${network}`,
    url: `${MIRROR_NODE_CONFIG[network as keyof typeof MIRROR_NODE_CONFIG]}/api/v1/network/supply`,
    title: `Hedera ${network.toUpperCase()} Network Supply`,
    content,
    metadata: {
      url: `${MIRROR_NODE_CONFIG[network as keyof typeof MIRROR_NODE_CONFIG]}/api/v1/network/supply`,
      title: `Hedera ${network.toUpperCase()} Network Supply`,
      description: `Total and released HBAR supply statistics for Hedera ${network}`,
      contentType: 'reference',
      tags: ['supply', 'hbar', 'tokenomics', network, 'circulation'],
      crawledAt: new Date().toISOString(),
    },
  };
}

/**
 * Main indexing function
 */
async function main() {
  console.log('🚀 Starting Hedera Network Configuration Indexing\n');

  // Parse arguments
  const args = process.argv.slice(2);
  let networks: string[] = ['mainnet', 'testnet'];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--networks' && args[i + 1]) {
      networks = args[i + 1].split(',');
      i++;
    } else if (args[i] === '--help') {
      console.log(`
Network Configuration Indexer

Usage: npm run index-network [options]

Options:
  --networks <list>  Comma-separated list of networks (default: mainnet,testnet)
                     Available: mainnet, testnet, previewnet
  --help             Show this help message

Examples:
  npm run index-network
  npm run index-network -- --networks mainnet
  npm run index-network -- --networks mainnet,testnet,previewnet
`);
      process.exit(0);
    }
  }

  console.log(`📡 Networks to index: ${networks.join(', ')}\n`);

  // Initialize services
  console.log('⚙️  Loading configuration...');
  const ragConfig = createRAGConfig();
  const validation = validateRAGConfig(ragConfig);

  if (!validation.valid) {
    console.error('❌ Configuration validation failed:');
    validation.errors.forEach(err => console.error(`   - ${err}`));
    process.exit(1);
  }
  console.log('✅ Configuration validated\n');

  console.log('🔧 Initializing services...');

  // ChromaDB
  const chromaService = new ChromaDBService({
    url: ragConfig.chromaUrl,
    authToken: ragConfig.chromaAuthToken,
  });
  await chromaService.initialize();
  console.log('✅ ChromaDB connected');

  // Embedding service
  const embeddingService = new EmbeddingService(ragConfig.openaiApiKey, ragConfig.embeddingModel);
  console.log('✅ Embedding service initialized');

  // Chunking service
  const documentChunker = new DocumentChunker();
  console.log('✅ Chunking service initialized\n');

  // Stats tracking
  const stats: IndexingStats = {
    totalDocuments: 0,
    totalChunks: 0,
    errors: [],
  };

  const allDocuments: Document[] = [];

  // Fetch data from each network
  for (const network of networks) {
    if (!MIRROR_NODE_CONFIG[network as keyof typeof MIRROR_NODE_CONFIG]) {
      console.log(`⚠️  Unknown network: ${network}, skipping`);
      continue;
    }

    console.log(`\n📦 Fetching ${network.toUpperCase()} network data...`);
    const baseUrl = MIRROR_NODE_CONFIG[network as keyof typeof MIRROR_NODE_CONFIG];

    // Fetch network nodes
    const nodesData = await fetchMirrorNode(baseUrl, ENDPOINTS.networkNodes);
    if (nodesData) {
      allDocuments.push(createNetworkNodesDocument(nodesData, network));
      console.log(`   ✅ Network nodes: ${nodesData.nodes?.length || 0} nodes`);
    }

    // Fetch fee schedule
    const feesData = await fetchMirrorNode(baseUrl, ENDPOINTS.networkFees);
    if (feesData) {
      allDocuments.push(createFeeScheduleDocument(feesData, network));
      console.log(`   ✅ Fee schedule: ${feesData.fees?.length || 0} fee entries`);
    }

    // Fetch exchange rates
    const ratesData = await fetchMirrorNode(baseUrl, ENDPOINTS.exchangeRates);
    if (ratesData) {
      allDocuments.push(createExchangeRateDocument(ratesData, network));
      console.log(`   ✅ Exchange rates: Current and next rates`);
    }

    // Fetch staking info
    const stakeData = await fetchMirrorNode(baseUrl, ENDPOINTS.networkStake);
    if (stakeData) {
      allDocuments.push(createNetworkStakeDocument(stakeData, network));
      console.log(`   ✅ Staking info: Network stake parameters`);
    }

    // Fetch supply info
    const supplyData = await fetchMirrorNode(baseUrl, ENDPOINTS.networkSupply);
    if (supplyData) {
      allDocuments.push(createNetworkSupplyDocument(supplyData, network));
      console.log(`   ✅ Supply info: Total and released supply`);
    }
  }

  stats.totalDocuments = allDocuments.length;
  console.log(`\n📊 Total documents created: ${stats.totalDocuments}\n`);

  if (allDocuments.length === 0) {
    console.error('❌ No documents created. Check network connectivity.');
    process.exit(1);
  }

  // Chunk documents
  console.log('✂️  Chunking documents...');
  const allChunks: any[] = [];

  for (const doc of allDocuments) {
    const chunks = documentChunker.chunk(doc);
    allChunks.push(...chunks);
  }

  console.log(
    `✅ Created ${allChunks.length} chunks (avg ${(allChunks.length / stats.totalDocuments).toFixed(1)} chunks/doc)\n`
  );

  // Generate embeddings
  console.log('🧮 Generating embeddings...');
  const texts = allChunks.map(c => c.text);
  const embeddings = await embeddingService.generateEmbeddingsBatch(texts);

  // Attach embeddings to chunks
  for (let i = 0; i < allChunks.length; i++) {
    allChunks[i].embedding = embeddings[i];
  }
  console.log(`✅ Generated ${embeddings.length} embeddings\n`);

  // Store in ChromaDB
  console.log('💾 Storing in ChromaDB...');
  await chromaService.addChunks(allChunks);

  stats.totalChunks = allChunks.length;
  console.log(`✅ Stored ${stats.totalChunks} chunks\n`);

  // Final summary
  console.log('='.repeat(60));
  console.log('🎉 NETWORK CONFIGURATION INDEXING COMPLETED');
  console.log('='.repeat(60));
  console.log(`\n📊 Summary:`);
  console.log(`   Networks Indexed: ${networks.join(', ')}`);
  console.log(`   Total Documents: ${stats.totalDocuments}`);
  console.log(`   Total Chunks: ${stats.totalChunks}`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  Errors (${stats.errors.length}):`);
    stats.errors.forEach(err => console.log(`   - ${err}`));
  }

  // Check total chunks in ChromaDB
  const totalCount = await chromaService.getCollectionCount();
  console.log(`\n📈 Total chunks in ChromaDB: ${totalCount}`);

  console.log('\n✨ Network configuration now available for RAG queries!');
  console.log('   Try: docs_search "What are the current Hedera fees?"');
  console.log('   Or: docs_search "How does HBAR staking work?"\n');

  await chromaService.close();
}

// Run
main().catch(error => {
  console.error('❌ Fatal error:', error.message);
  logger.error('Network config indexing failed', { error: error.message });
  process.exit(1);
});
