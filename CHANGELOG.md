# Changelog

All notable changes to HashPilot are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.1] - Unreleased

The first maintenance release since 0.1.0. In the eleven months after that
release the Hedera network and several services HashPilot depends on changed
underneath it. The hosted documentation index went offline. Sourcify retired the
API that contract verification used. The consensus node began removing
`AccountBalanceQuery`. The SDK repositories moved to the `hiero-ledger`
organisation. This release brings HashPilot back in line with all of that. It
also fixes every problem found in a full audit and in integration testing
through real MCP clients. [MAINTENANCE.md](MAINTENANCE.md) has the detail and
evidence behind each entry.

### Upgrading from 0.1.0

- **Node.js 20 or newer is required** (was 18).
- **Raw-hex operator keys are now read as ECDSA.** In 0.1.0 they were silently
  read as ED25519, so every signed transaction from an ECDSA account failed with
  `INVALID_SIGNATURE`. If your account has an ED25519 key in raw hex, set
  `HEDERA_OPERATOR_KEY_TYPE=ed25519`. DER-encoded keys are detected
  automatically, and the key is checked against the account on startup.
- **Data files moved to `~/.hedera-mcp`**, or to `HASHPILOT_DATA_DIR` if you
  set it. Your existing address book, state and deployment history are migrated
  on first start.
- **Hardhat is no longer bundled.** The Hardhat tools run the project's own
  Hardhat. Projects created with `hardhat_project init` already include it.
- **`OPENAI_API_KEY` is now optional.** See the documentation fallback under
  Added.
- **GraphQL needs `HGRAPH_API_KEY`**, which you can get free from Hgraph.
- Stablecoin operations on mainnet and previewnet need
  `STABLECOIN_FACTORY_ADDRESS` and `STABLECOIN_RESOLVER_ADDRESS`. 0.1.0 shipped
  placeholder addresses for these networks.
- Contract verification supports mainnet and testnet. Sourcify does not support
  previewnet.
- The local network uses chain ID 298 everywhere.

### Added

- **`mirror_query`**: one tool with 32 free, read-only Mirror Node resources.
  It covers transactions, token info and holders, NFTs and their history,
  topics, contract state, results, event logs and opcode traces, scheduled
  transactions, blocks, nodes, staking, and the live exchange rate. These
  queries existed in 0.1.0, but no MCP client could call them.
- **`graphql`**: query indexed Hedera data with GraphQL through Hgraph, on
  mainnet and testnet. It lists the queryable entities, generates queries from
  the schema, validates hand-written queries (reporting line and column), and
  runs read-only queries. Nanosecond timestamps and large IDs come back exact,
  and requests are paced to the free plan's rate limit. It needs an
  `HGRAPH_API_KEY`; Hgraph has a free tier. HashPilot now has 32 tools.
- **Documentation fallback.** When no OpenAI key is set, or HashPilot's index
  can't be reached, `docs_search`, `docs_ask`, `docs_get_example` and
  `code_generate` answer from Hedera's official documentation search at
  `docs.hedera.com/mcp`, instead of failing. Each response says where it came
  from and why.
- **Token creation**:
  - custom fees: fixed, fractional and royalty
  - finite supply with a maximum
  - an explicit treasury account
  - NFT collections
  - token keys given as a public key or a threshold key list (multi-signature)
  - configuration from a JSON file or an inline object
- **Account creation**: choose the key type (ECDSA or ED25519), and set
  automatic token associations and staking.
- **Consensus**:
  - topics take real admin and submit keys
  - message queries filter by sequence number and by timestamp range
- About twenty parameters that the code supported but no client could send are
  now available. They include custom fees, gas limits, network overrides,
  address book aliases, block numbers, Hardhat Ignition parameters, and
  verification build-info paths.
- `code_generate` lists any import or class name it cannot find in the
  documentation it used, so invented API names are flagged instead of passing
  silently.
- Documentation questions that name a HIP or HCS standard, for example "What
  does HIP-904 change?", are answered from that standard's own document.
- **Documentation index**: grew from 59 to 69 verified sources (10,931
  sections).
  - Newly indexed: Hedera's protobuf service definitions, the HCS standards,
    Solo and its documentation, the Hiero CLI, the Mirror Node, Stablecoin
    Studio, the Hedera Agent Kit, Wallet Connect and the NFT SDK.
  - docs.hedera.com is now indexed in full from its source repository.
  - Rust works across all documentation tools.
  - The official Solidity contracts in `hedera-smart-contracts` can be returned
    as code examples.
- Security and optimisation advice is attached to contract deploy and execute
  results.
- `hardhat_contract` accepts `functionName`/`args` as well as
  `method`/`methodArgs`.
- New documentation pages cover best practices, self-hosting the
  documentation index, and tutorials. Setup instructions for the VS Code
  `.vscode/mcp.json` format and for Gemini CLI were added.
- Maintainer tooling:
  - `npm run test:mcp` tests the built server over the protocol, as a real MCP
    client would.
  - `npm run smoke` runs read-only checks against the live network.
  - `npm run check:sources` and `npm run check:sourcify` check the index
    sources and contract verification against live services.
  - GitHub Actions: CI, plus a scheduled canary check.
  - Deployment files for hosting the documentation index on Railway.

### Changed

- `account_balance` and `account_info` read from the Mirror Node. They are
  free, need no operator account, and keep working after consensus nodes
  remove `AccountBalanceQuery`.
- The hosted documentation index moved to new infrastructure.
- Contract verification uses the Sourcify v2 API. Sourcify retired v1 on
  2026-07-07.
- Hardhat contract calls go through the Hedera JSON-RPC relay. With Hardhat no
  longer bundled, HashPilot installs about 340 fewer packages (1.0 GB down to
  689 MB).
- Tool arguments are checked against each tool's published schema. A missing,
  mistyped or unrecognised value gets a message naming the problem, not an
  internal error.
- A signing tool with no operator configured says which environment variables
  to set. Read-only tools keep working with a missing or wrong operator key.
- Mirror Node requests time out after 15 seconds and retry temporary failures.
- Documentation answers:
  - Must use only API names that appear in the documentation, and don't
    answer questions about live or future prices.
  - List each source once.
  - Show relevance between 0 and 100%.
- The Foundry project template initialises git and installs `forge-std`.
- `JSON_RPC_RELAY_URL` and `MIRROR_NODE_URL` are respected, and the Mirror Node
  tools follow `network_switch`.

### Fixed

**Network, signing and server**

- Signed transactions failed with `INVALID_SIGNATURE` for raw-hex ECDSA
  operator keys.
- One `network_switch` call with an unknown network name broke every tool.
  The bad value was saved to disk, so it persisted after restarts. Unknown
  names are now rejected, and a bad saved value is ignored on start.
- The server kept running after its MCP client disconnected, leaving one
  process behind per session.
- `account_create` with a supplied public key failed.
- Stablecoin unpause and unfreeze used SDK classes that don't exist.
- Restoring state from a backup silently did nothing. Backups now respect a
  custom filename and record the correct HashPilot version.
- Account lookups on busy accounts timed out.
- Searching contract event logs by topic always failed.
- Opcode traces had no size limit. They now omit the EVM stack and return the
  first 500 steps.

**Documentation**

- All four documentation tools failed because the hosted index was offline.
- `docs_get_example` returned no examples in any language.
- The language filter was ignored; a request for Go examples returned Rust.
- SDK example files and Solidity contracts weren't recognised as code.
- A question naming a HIP or HCS standard could miss that document.
- Relevance scores could be negative.
- The same source was listed several times.
- A blank HCS template ranked above the real specification.
- Exchange-rate data was indexed as documentation and answered as the HBAR
  price.
- Code examples were sometimes described using unrelated code.
- Indexed sections could start mid-word.
- One malformed character in a source file could abort a whole indexing run.

### Removed

- The bundled Hardhat 2 and its plugins, and unused GraphQL packages.
- Support for Node.js 18.

### Known limitations

- Generated code can still contain incorrect API names. They are flagged but
  not prevented, so compile generated code before relying on it.
- Not yet supported:
  - token and HBAR allowances
  - token airdrops (HIP-904)
  - scheduled transactions
  - token update and dissociate
  - account update and delete
  - topic delete
- Transactions are always signed with the configured operator key. There is no
  mode that hands unsigned transactions to a wallet for approval.
- The `local` network targets Hiero Local Node, which is deprecated in favour
  of Solo.

## [0.1.0] - 2025-11-25

Initial release.

[0.1.0]: https://www.npmjs.com/package/hashpilot/v/0.1.0
