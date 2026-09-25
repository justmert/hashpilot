/**
 * Foundry Configuration Generator
 * Generates foundry.toml config files and templates for Hedera networks
 */

/**
 * Network configuration
 */
export interface NetworkConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
}

/**
 * Hedera network configurations
 */
export const HEDERA_NETWORKS = {
  mainnet: {
    name: 'mainnet',
    rpcUrl: 'https://mainnet.hashio.io/api',
    chainId: 295,
  },
  testnet: {
    name: 'testnet',
    rpcUrl: 'https://testnet.hashio.io/api',
    chainId: 296,
  },
  previewnet: {
    name: 'previewnet',
    rpcUrl: 'https://previewnet.hashio.io/api',
    chainId: 297,
  },
  local: {
    name: 'local',
    rpcUrl: 'http://localhost:7546',
    chainId: 298,
  },
};

/**
 * Generate foundry.toml config for Hedera
 */
export function generateHederaFoundryConfig(options: {
  solidity?: string;
  networks?: Array<'mainnet' | 'testnet' | 'previewnet' | 'local'>;
  optimizer?: boolean;
  optimizerRuns?: number;
}): string {
  const solidity = options.solidity || '0.8.20';
  const networks = options.networks || ['testnet', 'local'];
  const optimizer = options.optimizer ?? true;
  const optimizerRuns = options.optimizerRuns || 200;

  // Build RPC endpoints section
  const rpcEndpoints = networks
    .map((net) => {
      const network = HEDERA_NETWORKS[net];
      return `hedera-${net} = "${network.rpcUrl}"`;
    })
    .join('\n');

  // Build network profiles
  const networkProfiles = networks
    .map((net) => {
      const envPrefix = net.toUpperCase();

      // Keys are passed on the command line (--private-key $ENV), never stored in foundry.toml
      return `[profile.hedera-${net}]
eth_rpc_url = "\${${envPrefix}_RPC_URL}"`;
    })
    .join('\n\n');

  // Generate foundry.toml
  const config = `# Foundry Configuration for Hedera Network
# See https://book.getfoundry.sh/reference/config/overview

[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"
cache_path = "cache"

# Solidity compiler settings
# evm_version stays at "london" for broad compatibility; raise it once you have
# confirmed the target Hedera release supports the newer opcodes you need.
solc_version = "${solidity}"
evm_version = "london"
optimizer = ${optimizer}
optimizer_runs = ${optimizerRuns}
via_ir = false

# Test settings
verbosity = 3
fuzz = { runs = 256 }
invariant = { runs = 256 }

# Formatter settings
[fmt]
line_length = 120
tab_width = 4
bracket_spacing = true
int_types = "long"

# RPC endpoints
[rpc_endpoints]
${rpcEndpoints}

# Network profiles
${networkProfiles}

# Verification: HashScan reads from Sourcify (no API key needed).
#   forge verify-contract --verifier sourcify --chain-id 296 <ADDRESS> src/Greeter.sol:Greeter
# Chain IDs: mainnet 295, testnet 296. Previewnet is not supported by Sourcify.
`;

  return config;
}

/**
 * Generate .env template
 */
export function generateEnvTemplate(
  networks: Array<'mainnet' | 'testnet' | 'previewnet' | 'local'>
): string {
  const envVars = networks
    .map((net) => {
      const envPrefix = net.toUpperCase();
      const networkName = net.charAt(0).toUpperCase() + net.slice(1);
      const rpcUrl = HEDERA_NETWORKS[net].rpcUrl;

      return `# ${networkName} Network
${envPrefix}_RPC_URL=${rpcUrl}
${envPrefix}_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000`;
    })
    .join('\n\n');

  return `# Hedera Network Environment Variables
# Copy this file to .env and fill in your private keys

${envVars}

# Contract verification goes through Sourcify (used by HashScan); no API key is required.
`;
}

/**
 * Generate sample Greeter contract
 */
export function generateSampleContract(): string {
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Greeter
 * @dev Simple contract for storing and retrieving a greeting message
 */
contract Greeter {
    string private greeting;

    event GreetingChanged(string indexed oldGreeting, string indexed newGreeting, address indexed changer);

    constructor(string memory _greeting) {
        greeting = _greeting;
    }

    function greet() public view returns (string memory) {
        return greeting;
    }

    function setGreeting(string memory _greeting) public {
        string memory oldGreeting = greeting;
        greeting = _greeting;
        emit GreetingChanged(oldGreeting, _greeting, msg.sender);
    }
}
`;
}

/**
 * Generate sample Foundry test
 */
export function generateSampleTest(): string {
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Greeter.sol";

contract GreeterTest is Test {
    Greeter public greeter;
    address public user = address(0x1);

    // Event declaration for testing
    event GreetingChanged(string indexed oldGreeting, string indexed newGreeting, address indexed changer);

    function setUp() public {
        greeter = new Greeter("Hello, Hedera!");
    }

    function testInitialGreeting() public {
        assertEq(greeter.greet(), "Hello, Hedera!");
    }

    function testSetGreeting() public {
        vm.prank(user);
        greeter.setGreeting("Hola, Hedera!");
        assertEq(greeter.greet(), "Hola, Hedera!");
    }

    function testGreetingChangedEvent() public {
        vm.expectEmit(true, true, true, true);
        emit GreetingChanged("Hello, Hedera!", "Hola, Hedera!", address(this));
        greeter.setGreeting("Hola, Hedera!");
    }

    function testFuzzSetGreeting(string memory newGreeting) public {
        greeter.setGreeting(newGreeting);
        assertEq(greeter.greet(), newGreeting);
    }

    function test_RevertWhen_EmptyGreeting() public {
        // This test demonstrates the modern test pattern
        // Note: The Greeter contract doesn't actually enforce non-empty strings
        // This test will pass because the contract allows empty strings
        greeter.setGreeting("");
    }
}
`;
}

/**
 * Generate sample deployment script
 */
export function generateSampleDeployScript(): string {
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/Greeter.sol";

contract DeployScript is Script {
    function run() external {
        // Get deployer private key from environment
        uint256 deployerPrivateKey = vm.envUint("TESTNET_PRIVATE_KEY");

        // Start broadcasting transactions
        vm.startBroadcast(deployerPrivateKey);

        // Deploy Greeter contract
        Greeter greeter = new Greeter("Hello, Hedera!");
        console.log("Greeter deployed to:", address(greeter));
        console.log("Initial greeting:", greeter.greet());

        // Stop broadcasting
        vm.stopBroadcast();
    }
}
`;
}

/**
 * Generate .gitignore
 */
export function generateGitignore(): string {
  return `# Foundry
cache/
out/
broadcast/

# Dependencies
lib/

# Environment variables
.env

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log

# Build info
*.build_info
`;
}

/**
 * Generate README
 */
export function generateReadme(): string {
  return `# Hedera Foundry Project

This project uses Foundry for Solidity smart contract development on the Hedera network.

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) installed
- Hedera account with testnet HBAR

## Installation

\`\`\`bash
# Install Foundry (if not already installed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
forge install
\`\`\`

## Configuration

1. Copy \`.env.example\` to \`.env\`
2. Add your Hedera private keys to \`.env\`

## Usage

### Build

\`\`\`bash
forge build
\`\`\`

### Test

\`\`\`bash
# Run all tests
forge test

# Run with gas report
forge test --gas-report

# Run specific test
forge test --match-test testSetGreeting

# Run with verbosity
forge test -vvv
\`\`\`

### Deploy

\`\`\`bash
# Deploy to Hedera testnet
forge script script/Deploy.s.sol --rpc-url hedera-testnet --broadcast --private-key $TESTNET_PRIVATE_KEY

# Verify contract (HashScan reads verification from Sourcify; chain 296 = testnet, 295 = mainnet)
forge verify-contract --verifier sourcify --chain-id 296 <CONTRACT_ADDRESS> src/Greeter.sol:Greeter
\`\`\`

### Interact

\`\`\`bash
# Call contract (read-only)
cast call <CONTRACT_ADDRESS> "greet()(string)" --rpc-url hedera-testnet

# Send transaction
cast send <CONTRACT_ADDRESS> "setGreeting(string)" "Hello, World!" --rpc-url hedera-testnet --private-key $TESTNET_PRIVATE_KEY
\`\`\`

## Foundry Commands

- \`forge build\` - Compile contracts
- \`forge test\` - Run tests
- \`forge fmt\` - Format code
- \`forge snapshot\` - Create gas snapshots
- \`forge clean\` - Clean build artifacts
- \`forge install <dependency>\` - Install dependency
- \`cast call\` - Call contract function
- \`cast send\` - Send transaction

## Project Structure

\`\`\`
.
├── src/              # Contract source files
├── test/             # Test files
├── script/           # Deployment scripts
├── lib/              # Dependencies (git submodules)
├── out/              # Compiled artifacts
└── foundry.toml      # Foundry configuration
\`\`\`

## Resources

- [Foundry Book](https://book.getfoundry.sh/)
- [Hedera Documentation](https://docs.hedera.com/)
- [HashScan Explorer](https://hashscan.io/)
- [Hedera JSON-RPC Relay](https://github.com/hashgraph/hedera-json-rpc-relay)
`;
}

/**
 * Generate remappings.txt for dependency resolution
 */
export function generateRemappings(): string {
  return `forge-std/=lib/forge-std/src/
@openzeppelin/=lib/openzeppelin-contracts/
`;
}
