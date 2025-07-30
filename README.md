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

This MVP includes 5 essential tools to **interact with JSON-RPC**

1. **get_account_balance** - Check HBAR balance of any account

|  With MCP | Without MCP | 
|---|---|
| <img width="863" height="400" alt="account balance" src="https://github.com/user-attachments/assets/7ce3879d-4862-49b6-a713-89332eeb033a" /> | <img width="863" height="675" alt="account_balance_without_mcp" src="https://github.com/user-attachments/assets/40351c8d-306f-490a-b4fa-25bf8900602a" /> |  

2. **get_block_info** - View block information 

<img width="863" height="408" alt="block_info" src="https://github.com/user-attachments/assets/14b6937e-b270-4332-b0e6-06f49a078030" />

3. **estimate_gas** - Calculate transaction costs

<img width="863" height="440" alt="estimategas" src="https://github.com/user-attachments/assets/6fabde4c-fc2f-4c96-879e-53163d0299bf" />

4. **get_network_info** - Current network status

<img width="863" height="499" alt="network info" src="https://github.com/user-attachments/assets/f38e348a-1596-48c0-a093-33b362975fec" />

5. **get_transaction_receipt** - Get transaction details


## 🌐 Networks

- **Testnet** (default) - For testing

## 🎯 Example Queries

```
"Check balance of 0.0.1234"
"Get latest block info"
"Estimate gas for sending 10 HBAR"
```
