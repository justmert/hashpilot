Hashpilot is a developer assistant built on the Model Context Protocol (MCP) framework, specifically designed to improve the development experience on the Hedera network. Hashpilot addresses the critical challenge of developer experience fragmentation in the Hedera ecosystem by providing a unified, intelligent interface that seamlessly integrates with popular IDEs and AI assistants.
Core Architecture

While existing blockchain MCPs typically focus on either smart contract code generation or documentation querying, Hashpilot represents a comprehensive MCP beyond these limited approaches. Most blockchain development assistants either helping write smart contract code or answering questions from docs—but fail to bridge the gap between code generation and actual interaction/execution. Hashpilot fundamentally transforms this paradigm by integrating with direct Hedera-cli execution, real-time RPC operations, Hedera developer toolings, and complete development framework orchestration (Hardhat/Foundry), as well as RAG-powered documentation search and intelligent code generation. This means developers can not only receive code for "create a token" but immediately execute "create this token on testnet," then "deploy a contract that interacts with it," and "run tests to verify integration"—all within where they do 'vibe-coding', eliminating the traditional tool fragmentation that no existing blockchain MCP currently addresses.

Hashpilot operates as a sophisticated MCP server that bridges MCP executer environments like Claude, Cursor, Windsurf, Gemini CLI with the comprehensive Hedera development toolkit.


## Core Execution Features

**Executing Hedera CLI Commands**:The AI assistant can execute the complete suite of Hedera CLI commands through natural language requests within the IDE, eliminating context switching between terminal and code editor. (Example: User says "Create a new testnet account named 'test-user' with 1000 HBAR" → MCP executes `hcli account create --alias test-user --balance 1000` and returns the account ID). It can support all major CLI commands.

The MCP supports all major CLI command categories:

- Account Management: Create, import, and manage Hedera accounts with customizable parameters including balance allocation and key types. Query comprehensive account information including HBAR/token balances, EVM addresses, and manage address books for multi-account workflows.

- Token Operations: Create fungible tokens with comprehensive configuration including custom fees, multi-signature keys, and supply controls using both simple commands and JSON-based configuration files. Execute token association and transfer operations between accounts with full support for complex tokenomics.

- Consensus Service (HCS): Create public and private topics with configurable submit and admin keys, submit authenticated messages, and query topic messages with advanced filtering by sequence numbers and other criteria.

- Network and State Management: Switch seamlessly between networks (mainnet, testnet, previewnet, localnet) and manage CLI state through backup/restore operations.

**Direct RPC Network Operations**: Perform real-time blockchain operations using JSON-RPC relay for comprehensive state queries and transaction submission. Seamlessly bridge between Hedera's native services and EVM-compatible operations for maximum flexibility. (Example: "Get balance of account 0.0.1234" → MCP uses JSON-RPC methods to query and return the balance)

## Integration Features

**Hardhat Integration**: Seamlessly configure and execute Hardhat tasks for Hedera development including project setup, contract compilation, deployment, testing, and verification with automatic network configuration and Hedera-specific plugin integration. (Example: "Deploy my contract to Hedera testnet" → MCP runs `npx hardhat run scripts/deploy.js --network hederaTestnet` with proper configuration and returns deployment address)

**Foundry Integration**: Support complete Foundry toolchain for Solidity development and testing on Hedera including forge compilation, testing, deployment, and gas optimization with automatic network configuration for Hedera's JSON-RPC relay. (Example: "Run Foundry tests on Hedera" → MCP executes `forge test --fork-url https://testnet.hashio.io/api` and displays test results with gas usage)

**Unified Testing Workflow**: Manage both Hardhat and Foundry tests through a single interface with automatic project detection, cross-framework compatibility, and unified result reporting for hybrid projects. (Example: "Run all tests" → MCP detects project type, executes appropriate test runners for both JavaScript and Solidity tests, and displays consolidated results)

**Hedera Stablecoin Studio Integration**: Leverage the Hedera Stablecoin Studio CLI for compliant token creation workflows. (Example: If a user wants to create a compliant stablecoin token, the AI can suggest or invoke the Stablecoin Studio CLI wizard for guided token creation with regulatory features)

**Hedera GraphQL Integration**: Comprehensive support for querying Hedera data through GraphQL, providing a modern alternative to REST APIs. The MCP can help developers write, test, and execute GraphQL queries against Mirror Node endpoints. (Example: User asks "Get all NFT transfers for account 0.0.1234 in the last 24 hours" → MCP generates and executes a GraphQL query that returns structured data including token IDs, timestamps, and counterparties)

## Development Assistance, Knowledge and Documentation Features

**Intelligent Code Generation (Hedera SDK, APIs, Smart Contracts)**: Generate context-aware Hedera SDK code and Solidity smart contracts from natural language descriptions. (Example: "Generate a JavaScript function to create an NFT with 5% royalty fee" → MCP produces complete code with proper SDK imports and transaction handling)
    *Generate code snippets and complete programs for Hedera SDK across JavaScript, Java, Go, and Rust.
    * Auto-generate smart contract code in Solidity tailored for Hedera's EVM compatibility.
    *Provide automatic boilerplate and configuration setups for common developer tasks.
    * Help write, review, and optimize Solidity contracts with Hedera-specific considerations.

**RAG-Powered Documentation Search**: Answer technical questions using indexed Hedera documentation, SDKs, and tutorials. (Example: "What's the difference between HCS and Ethereum event logs?" → MCP retrieves relevant docs and explains HCS's verifiable timestamping vs. Ethereum's event system). Core Knowledge Base Coverage:

- Complete official Hedera documentation (docs.hedera.com) with real-time updates
- SDK documentation and API references for JavaScript, Java, Go, Rust, and Python
- Official tutorials, code examples, and integration guides
- Hedera service specifications (HTS, HCS, Smart Contract Service, File Service)
- Network configuration details, fee schedules, and operational parameters

**Intelligent Error Analysis and Best Practice Guidance**: Translate cryptic error codes into actionable guidance while providing proactive security and optimization recommendations for Hedera-specific development patterns. (Example: Transaction fails with "INVALID_SIGNATURE" → MCP explains "This error occurs when the transaction wasn't signed with the correct key. Check if you're using the right account's private key for this operation" and suggests reviewing key management practices)

## Additional Features

**IDE Integration (Windsurf/Cursor/Gemini/Claude)**: MCP integration for popular IDEs like Windsurf, Cursor, and Gemini CLI, Claude, allowing developers to interact with Hedera directly from their environment. Hedera MCP can be used everywhere where MCP is supported. This allows developers to issue commands, get code completions, and query the network without leaving their editor.

**Multi-Network Support**: Work seamlessly across mainnet, testnet, previewnet, and local networks. (Example: Configuration allows switching between networks with environment variables like `HEDERA_NETWORK=testnet`)

**Project Scaffolding**: Automatically set up new Hedera projects with proper configuration. (Example: "Create new Hardhat project for Hedera" → MCP generates project structure with pre-configured `hardhat.config.js`, necessary plugin dependencies, and environment variables for testnet access)
