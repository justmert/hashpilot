# HashPilot

[![npm](https://img.shields.io/npm/v/hashpilot.svg)](https://www.npmjs.com/package/hashpilot)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/justmert/hashpilot/blob/master/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

**The Hedera developer toolkit for AI coding assistants.** An [MCP](https://modelcontextprotocol.io) server that lets Claude, Cursor, VS Code, Windsurf and Gemini CLI build on Hedera. It creates accounts, tokens and topics, deploys and verifies contracts, queries the Mirror Node, and answers from the Hedera docs, SDK examples and specifications.

```text
"Create an NFT collection with a 5% royalty on testnet"
"Scaffold a Hardhat project, deploy it, and verify the contract"
"Why did my last transaction fail?"
"Show me a Go example that submits a message to a topic"
```

## Quick start

Add HashPilot to your editor's MCP config:

```json
{
  "mcpServers": {
    "hashpilot": {
      "command": "npx",
      "args": ["-y", "hashpilot"],
      "env": {
        "HEDERA_NETWORK": "testnet",
        "HEDERA_OPERATOR_ID": "0.0.12345",
        "HEDERA_OPERATOR_KEY": "302e…"
      }
    }
  }
}
```

That's it. Get a free testnet account at [portal.hedera.com](https://portal.hedera.com).

| Editor         | Config file                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) · `%APPDATA%\Claude\claude_desktop_config.json` (Windows) |
| Cursor         | `~/.cursor/mcp.json`                                                                                                                |
| Windsurf       | `~/.codeium/windsurf/mcp_config.json`                                                                                               |
| Gemini CLI     | `~/.gemini/settings.json`                                                                                                           |
| VS Code        | `.vscode/mcp.json`. Use `"servers"` instead of `"mcpServers"`, and add `"type": "stdio"`                                            |

No operator? Mirror Node queries, network info and documentation work without one. Only transactions need a key.

## What's inside

32 tools, grouped by what you're doing:

| Area                | Tools                                                                                                    | Highlights                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accounts & HBAR** | `account_create` `account_balance` `account_info` `transfer_hbar`                                        | ECDSA or ED25519 keys, auto-associations, staking                                                                                              |
| **Tokens (HTS)**    | `token_manage`                                                                                           | Fungible and NFT, custom fees (fixed, fractional, royalty), finite supply, threshold keys. Plus mint, burn, transfer, freeze, KYC, wipe, pause |
| **Consensus (HCS)** | `hcs_topic` `hcs_message`                                                                                | Topics with admin and submit keys, auto-chunked messages, queries by sequence or time                                                          |
| **Mirror Node**     | `mirror_query` `mirror_query_account`                                                                    | 32 free read-only resources: transactions, tokens, NFTs, topics, contract state, logs and traces, schedules, blocks, staking, exchange rate    |
| **GraphQL**         | `graphql`                                                                                                | Query indexed Mirror Node data with GraphQL through Hgraph: explore the schema, generate and validate queries, run them                        |
| **Smart contracts** | `hardhat_project` `hardhat_contract` `foundry_project` `foundry_contract` `deploy_contract`              | Scaffold, compile, test and deploy with your project's own Hardhat or Foundry                                                                  |
| **Verification**    | `verify_contract`                                                                                        | Sourcify v2, shown on HashScan (mainnet and testnet)                                                                                           |
| **EVM / JSON-RPC**  | `rpc_call` `rpc_call_contract` `rpc_deploy_contract` `rpc_execute_contract`                              | Any relay method (`eth_call`, `eth_getLogs`, …), and free read-only calls                                                                      |
| **Stablecoins**     | `stablecoin_manage`                                                                                      | Hedera Stablecoin Studio: 18 operations with roles, KYC, freeze, cash-in and Proof-of-Reserve                                                  |
| **Docs & code**     | `docs_search` `docs_ask` `docs_get_example` `code_generate`                                              | Answers and code examples from Hedera's docs, SDKs and specifications                                                                          |
| **Workflow**        | `error_explain` `addressbook_manage` `state_manage` `deployment_history` `network_switch` `health_check` | Status codes explained, account aliases, backups, deploy history                                                                               |

Full parameter reference: [docs/tools.mdx](https://github.com/justmert/hashpilot/blob/master/docs/tools.mdx).

### Documentation index

The docs tools search a hosted index of 69 Hedera sources (about 11,000 sections):

- docs.hedera.com and all HIPs
- the HCS standards
- the protobuf service definitions
- SDK examples in JavaScript, Java, Go, Python and Rust
- the official Solidity contracts
- Solo, the Hiero CLI, the Mirror Node, the JSON-RPC relay, the Agent Kit and Stablecoin Studio

Questions that name a standard, such as "what does HIP-904 change?", are answered from that document. Generated code flags any API name the docs don't confirm.

Set `OPENAI_API_KEY` for this full index, written answers and code generation. Without a key, the docs tools answer from Hedera's official documentation search instead, which is free and needs no key.

## HashPilot and Hedera's official MCP servers

Hedera's own MCP servers are built for transacting and for reading the docs. HashPilot is built for the part they don't cover, which is developing and shipping on Hedera. They can be used together.

|                                              | **HashPilot**                                                                                          | [Agent Kit MCP](https://github.com/hashgraph/hedera-agent-kit-js) | [Hosted Network MCP](https://docs.hedera.com/solutions/ai/hosted-mcp-server) | [Docs MCP](https://docs.hedera.com/learn/getting-started/mcp-setup) |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Built for                                    | Developers building on Hedera                                                                          | Agents that transact                                              | Transacting from a chat, via your wallet                                     | Reading the docs                                                    |
| Networks                                     | mainnet, testnet, previewnet, local                                                                    | mainnet, testnet                                                  | testnet only                                                                 | –                                                                   |
| Accounts, HBAR, tokens, topics               | ✅                                                                                                     | ✅                                                                | ✅                                                                           | –                                                                   |
| Mirror Node queries                          | 32 resources                                                                                           | 10 query tools                                                    | subset of the Agent Kit's                                                    | –                                                                   |
| GraphQL (via Hgraph)                         | ✅                                                                                                     | –                                                                 | –                                                                            | –                                                                   |
| Hardhat and Foundry projects                 | ✅                                                                                                     | –                                                                 | –                                                                            | –                                                                   |
| Contract verification                        | ✅ Sourcify                                                                                            | –                                                                 | –                                                                            | –                                                                   |
| Raw JSON-RPC access                          | ✅                                                                                                     | –                                                                 | –                                                                            | –                                                                   |
| Stablecoin Studio                            | ✅                                                                                                     | –                                                                 | –                                                                            | –                                                                   |
| Error explanations                           | ✅                                                                                                     | –                                                                 | –                                                                            | –                                                                   |
| Documentation                                | Docs, HIPs, HCS standards, protobufs, SDK examples in 5 languages; written answers and code generation | –                                                                 | –                                                                            | Docs and HIPs, returned as raw text; no key needed                  |
| Allowances, airdrops, scheduled transactions | not yet                                                                                                | ✅                                                                | allowances                                                                   | –                                                                   |
| Wallet approval (no key on the server)       | not yet                                                                                                | ✅                                                                | ✅                                                                           | –                                                                   |

Agent Kit columns list its core plugins only. Third-party plugins add more.

## Configuration

| Variable                                                    | Needed for              | Notes                                                                                                           |
| ----------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `HEDERA_NETWORK`                                            | choosing a network      | `testnet` (default), `mainnet`, `previewnet` or `local`                                                         |
| `HEDERA_OPERATOR_ID`                                        | transactions            | Your account, e.g. `0.0.12345`                                                                                  |
| `HEDERA_OPERATOR_KEY`                                       | transactions            | DER or raw hex. Raw hex is read as ECDSA, and the key is checked against the account on startup                 |
| `HEDERA_OPERATOR_KEY_TYPE`                                  | ED25519 raw hex keys    | `ecdsa` (default) or `ed25519`                                                                                  |
| `OPENAI_API_KEY`                                            | full docs index         | Optional; see [Documentation index](#documentation-index)                                                       |
| `JSON_RPC_RELAY_URL`                                        | production EVM calls    | The default relay (Hashio) is rate-limited                                                                      |
| `MIRROR_NODE_URL`                                           | custom Mirror Node      | Defaults to Hedera's public Mirror Node                                                                         |
| `HGRAPH_API_KEY`                                            | GraphQL                 | Free key at [app.hgraph.com](https://app.hgraph.com). `GRAPHQL_ENDPOINT` points to a different GraphQL endpoint |
| `HASHPILOT_DATA_DIR`                                        | custom data location    | Address book, backups and history. Default `~/.hedera-mcp`                                                      |
| `CHROMA_URL`, `CHROMA_AUTH_TOKEN`                           | self-hosted docs index  | [Self-hosting guide](https://github.com/justmert/hashpilot/blob/master/docs/self-hosting.mdx)                   |
| `STABLECOIN_FACTORY_ADDRESS`, `STABLECOIN_RESOLVER_ADDRESS` | stablecoins off testnet | Only testnet addresses are built in                                                                             |

Smart contract tools also need [Hardhat](https://hardhat.org) or [Foundry](https://getfoundry.sh) in the project. Node.js 20 or newer is required.

## Safety

- **Start on testnet.** Your operator key lives in the MCP config, and HashPilot signs with it without asking.
- **Know what costs HBAR.** Queries, docs and verification are free. Creating, transferring, minting and deploying are paid transactions. See [best practices](https://github.com/justmert/hashpilot/blob/master/docs/best-practices.mdx).
- **Compile generated code before relying on it.** Unconfirmed API names are flagged, but not every mistake can be caught.

## Development

```bash
npm install
npm run build && npm test      # unit tests, no network needed
npm run test:mcp               # drives the built server as a real MCP client
npm run smoke                  # read-only checks against HEDERA_NETWORK
```

Changes are listed in [CHANGELOG.md](https://github.com/justmert/hashpilot/blob/master/CHANGELOG.md). Maintenance notes and verification details are in [MAINTENANCE.md](https://github.com/justmert/hashpilot/blob/master/MAINTENANCE.md).

## License

[Apache-2.0](https://github.com/justmert/hashpilot/blob/master/LICENSE)
