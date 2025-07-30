# HashPilot (MVP Demo)

A Model Context Protocol (MCP) server that lets AI assistants interact with Hedera blockchain in real-time.

> **🎯 This is a demo MVP** - The production version will include advanced features like transaction signing, smart contract interactions, token operations, and more.

## What is MCP?

MCP (Model Context Protocol) allows AI assistants to use external tools and data sources. Think of it as giving your AI assistant superpowers to interact with the real world.

### Without MCP:
- ❌ AI can only talk about Hedera conceptually
- ❌ Can't check real balances or transactions
- ❌ Information might be outdated
- ❌ You need to manually check blockchain explorers

### With MCP:
- ✅ AI can check real account balances
- ✅ Get live transaction data
- ✅ Query current gas prices
- ✅ Access real-time blockchain info

## 🚀 Quick Start (MVP)

### 1. Install & Build
```bash
git clone https://github.com/justmert/hashpilot
cd hashpilot
npm install
npm run build
```

### 2. Configure Your AI Assistant

Add HashPilot to your AI assistant's MCP configuration file:

```json
{
  "mcpServers": {
    "hashpilot": {
      "command": "node",
      "args": ["/absolute/path/to/hashpilot/dist/index.js"]
    }
  }
}
```

**Configuration file locations:**

- **Cursor**: `~/.cursor/mcp/mcp.json`
- **Windsurf**: `~/.windsurf/mcp/mcp.json`

**Manual steps:**
1. Find your AI assistant's config file
2. Add the HashPilot configuration (merge with existing `mcpServers` if present)
3. Replace `/absolute/path/to/hashpilot` with your actual path
4. Save the file

### 3. Restart Your AI Assistant

### 4. Try It!

Ask your AI assistant:
- "What's the balance of Hedera account 0.0.98?"
- "Show me the latest block on testnet"
- "What's the current gas price?"

## 📦 What's Included (MVP)

This MVP includes 5 essential tools:

1. **get_account_balance** - Check HBAR balance of any account
2. **get_transaction_receipt** - Get transaction details
3. **get_block_info** - View block information 
4. **estimate_gas** - Calculate transaction costs
5. **get_network_info** - Current network status

## 🌐 Networks

- **Testnet** (default) - For testing
- **Mainnet** - For production
- **Previewnet** - For development

## ⚠️ Demo Limitations

This MVP demo is intentionally limited to showcase core functionality:

- Read-only operations (no transaction signing)
- Basic error handling
- Community endpoints only
- Limited to 5 essential tools

**Coming in the full version:**
- Transaction creation and signing
- Smart contract deployment and interaction
- Token operations (create, transfer, query)
- Account creation and management
- Scheduled transactions
- Multi-signature support
- Production-grade error handling
- Custom RPC endpoint configuration
- and more...

## 🎯 Example Queries

```
"Check balance of 0.0.1234"
"Get latest block info"
"Estimate gas for sending 10 HBAR"
```