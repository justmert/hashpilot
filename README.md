# HashPilot

[![npm version](https://img.shields.io/npm/v/hashpilot.svg)](https://www.npmjs.com/package/hashpilot)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

**AI-powered MCP server for Hedera blockchain development**

HashPilot is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that integrates with AI assistants like Claude Desktop, Cursor, Windsurf, and VS Code to provide a complete toolkit for Hedera blockchain development.

## Quick Start

### Install via npm

```bash
npm install -g hashpilot
```

### Or use with npx (no install required)

```bash
npx hashpilot
```

## Editor Configuration

HashPilot works with any MCP-compatible editor. Configure your editor to use HashPilot:

### Claude Desktop

**Config file location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

**Configuration:**
```json
{
  "mcpServers": {
    "hashpilot": {
      "command": "npx",
      "args": ["-y", "hashpilot"],
      "env": {
        "HEDERA_NETWORK": "testnet",
        "HEDERA_OPERATOR_ID": "0.0.YOUR_ACCOUNT_ID",
        "HEDERA_OPERATOR_KEY": "YOUR_PRIVATE_KEY_HEX",
        "OPENAI_API_KEY": "sk-YOUR_OPENAI_KEY"
      }
    }
  }
}
```

### Cursor

**Config file location:**
- macOS: `~/.cursor/mcp.json`
- Windows: `%USERPROFILE%\.cursor\mcp.json`
- Linux: `~/.cursor/mcp.json`

**Configuration:**
```json
{
  "mcpServers": {
    "hashpilot": {
      "command": "npx",
      "args": ["-y", "hashpilot"],
      "env": {
        "HEDERA_NETWORK": "testnet",
        "HEDERA_OPERATOR_ID": "0.0.YOUR_ACCOUNT_ID",
        "HEDERA_OPERATOR_KEY": "YOUR_PRIVATE_KEY_HEX",
        "OPENAI_API_KEY": "sk-YOUR_OPENAI_KEY"
      }
    }
  }
}
```

### Windsurf

**Config file location:**
- macOS: `~/.codeium/windsurf/mcp_config.json`
- Windows: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`
- Linux: `~/.codeium/windsurf/mcp_config.json`

**Configuration:**
```json
{
  "mcpServers": {
    "hashpilot": {
      "command": "npx",
      "args": ["-y", "hashpilot"],
      "env": {
        "HEDERA_NETWORK": "testnet",
        "HEDERA_OPERATOR_ID": "0.0.YOUR_ACCOUNT_ID",
        "HEDERA_OPERATOR_KEY": "YOUR_PRIVATE_KEY_HEX",
        "OPENAI_API_KEY": "sk-YOUR_OPENAI_KEY"
      }
    }
  }
}
```

### VS Code (with MCP extension)

Install the [MCP extension](https://marketplace.visualstudio.com/items?itemName=anthropics.mcp) and add to your `settings.json`:

```json
{
  "mcp.servers": {
    "hashpilot": {
      "command": "npx",
      "args": ["-y", "hashpilot"],
      "env": {
        "HEDERA_NETWORK": "testnet",
        "HEDERA_OPERATOR_ID": "0.0.YOUR_ACCOUNT_ID",
        "HEDERA_OPERATOR_KEY": "YOUR_PRIVATE_KEY_HEX",
        "OPENAI_API_KEY": "sk-YOUR_OPENAI_KEY"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HEDERA_NETWORK` | Yes | Network to use: `testnet`, `mainnet`, or `previewnet` |
| `HEDERA_OPERATOR_ID` | Yes | Your Hedera account ID (e.g., `0.0.12345`) |
| `HEDERA_OPERATOR_KEY` | Yes | Your private key in hex format |
| `OPENAI_API_KEY` | For RAG | Required for documentation search and code generation |

## Features

HashPilot provides 30+ MCP tools covering the complete Hedera development workflow:

### Account Management
- Create new accounts with ECDSA keys
- Query balances (HBAR and tokens)
- Transfer HBAR between accounts
- Get detailed account information

### Token Operations (HTS)
- Create fungible and non-fungible tokens
- Mint, burn, and transfer tokens
- Freeze/unfreeze accounts
- Manage KYC compliance
- Configure custom fees

### Consensus Service (HCS)
- Create and manage topics
- Submit messages (auto-chunking for large messages)
- Query message history
- Real-time subscriptions

### Smart Contracts
- Deploy contracts via Hardhat or Foundry
- Verify contracts on HashScan
- Call read-only functions (free)
- Execute state-changing transactions
- Full deployment history tracking

### JSON-RPC (EVM Compatibility)
- 55+ JSON-RPC methods supported
- `eth_call`, `eth_sendRawTransaction`, `eth_getLogs`
- Contract deployment and interaction
- Full EVM tooling compatibility

### Stablecoin Studio
- Create compliant stablecoins
- Role-based access control
- KYC/AML compliance features
- Proof-of-Reserve support
- Cash-in allowances

### Development Tools
- Hardhat integration (compile, test, deploy)
- Foundry integration (forge, cast, anvil)
- Error code explanations
- Address book management
- State backup/restore

## RAG-Powered Documentation

HashPilot includes a powerful RAG (Retrieval-Augmented Generation) system with **10,000+ pre-indexed documents** from the Hedera ecosystem:

### docs_search
Semantic search across all Hedera documentation:
```
"Search for token creation examples in JavaScript"
```

### docs_ask
Ask any question and get cited answers:
```
"How do I implement a multi-sig account on Hedera?"
```

### code_generate
Generate SDK code from natural language:
```
"Generate code to create an NFT collection with royalties"
```

**Indexed Sources:**
- Official Hedera Documentation
- SDK References (JavaScript, Java, Go, Rust, Python)
- Hedera Improvement Proposals (HIPs)
- Tutorials and Examples
- Smart Contract Patterns

**Note:** RAG features require an OpenAI API key for embeddings and completions.

## Requirements

- **Node.js** 18.0.0 or higher
- **Hedera Account** - Get a free testnet account at [portal.hedera.com](https://portal.hedera.com)
- **OpenAI API Key** - Required for RAG features (documentation search, code generation)

## Getting a Hedera Testnet Account

1. Visit [portal.hedera.com](https://portal.hedera.com)
2. Create a free account
3. Navigate to "Testnet" tab
4. Copy your Account ID and Private Key (DER encoded)
5. Convert DER to hex if needed, or use the raw hex key

## Example Usage

Once configured, ask your AI assistant:

> "Create a new Hedera account with 10 HBAR initial balance"

> "Deploy this Solidity contract to testnet using Hardhat"

> "Search the docs for HCS message chunking"

> "Generate code to create a fungible token with 2 decimals"

> "Explain the INSUFFICIENT_PAYER_BALANCE error"

## Links

- [HashPilot Documentation](https://hash-pilot.app/)
- [GitHub Repository](https://github.com/justmert/hashpilot)
- [npm Package](https://www.npmjs.com/package/hashpilot)
- [Hedera Documentation](https://docs.hedera.com)
- [MCP Protocol](https://modelcontextprotocol.io)

## License

Apache-2.0

## Contributing

Contributions are welcome! Please see our [GitHub repository](https://github.com/justmert/hashpilot) for guidelines.
