/**
 * Hardhat Configuration Generator
 * Generates Hardhat config files and .env templates for Hedera networks
 */

/**
 * Network configuration
 */
export interface NetworkConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
  accounts?: string[];
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
 * Generate Hardhat config for Hedera (Hardhat v3 with ESM)
 */
export function generateHederaHardhatConfig(options: {
  solidity?: string;
  networks?: Array<'mainnet' | 'testnet' | 'previewnet' | 'local'>;
  typescript?: boolean;
}): string {
  const solidity = options.solidity || '0.8.20';
  const networks = options.networks || ['testnet', 'local'];
  const typescript = options.typescript || false;

  // Hardhat v3 requires ESM (import/export) for both JS and TS
  const imports = typescript
    ? `import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import "dotenv/config";`
    : `import "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import "dotenv/config";`;

  // Hardhat v3 network config requires type and chainType properties
  const networkConfigs = networks
    .map((net) => {
      const network = HEDERA_NETWORKS[net];
      const envPrefix = net.toUpperCase();

      return `    ${net}: {
      type: "http",
      url: process.env.${envPrefix}_RPC_URL || "${network.rpcUrl}",
      accounts: process.env.${envPrefix}_PRIVATE_KEY ? [process.env.${envPrefix}_PRIVATE_KEY] : [],
      chainId: ${network.chainId},
      chainType: "generic",
    }`;
    })
    .join(',\n');

  // Generate config with ESM syntax (export default)
  // Note: In Hardhat v3, importing the plugin is sufficient for registration
  const config = typescript
    ? `${imports}

const config: HardhatUserConfig = {
  solidity: {
    version: "${solidity}",
    settings: {
      optimizer: {
        enabled: true,
        runs: 500,
      },
    },
  },
  networks: {
${networkConfigs}
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
`
    : `${imports}

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: {
    version: "${solidity}",
    settings: {
      optimizer: {
        enabled: true,
        runs: 500,
      },
    },
  },
  networks: {
${networkConfigs}
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
`;

  return config;
}

/**
 * Generate .env file template for Hedera
 */
export function generateEnvTemplate(
  networks?: Array<'mainnet' | 'testnet' | 'previewnet' | 'local'>
): string {
  const nets = networks || ['testnet', 'local'];

  const envVars = nets
    .map((net) => {
      const network = HEDERA_NETWORKS[net];
      const envPrefix = net.toUpperCase();

      return `# ${network.name.charAt(0).toUpperCase() + network.name.slice(1)} Network
${envPrefix}_RPC_URL=${network.rpcUrl}
${envPrefix}_PRIVATE_KEY=0x[your-hex-encoded-private-key-here]
`;
    })
    .join('\n');

  return `# Hedera Network Configuration
# DO NOT commit this file to version control
# Copy this to .env and fill in your private keys

${envVars}
# Optional: Gas reporter
REPORT_GAS=false

# Optional: Coinmarketcap API key for gas reporter
COINMARKETCAP_API_KEY=
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
 * @dev Simple contract that stores and returns a greeting message
 */
contract Greeter {
    string private greeting;

    event GreetingChanged(string oldGreeting, string newGreeting);

    constructor(string memory _greeting) {
        greeting = _greeting;
    }

    function greet() public view returns (string memory) {
        return greeting;
    }

    function setGreeting(string memory _greeting) public {
        string memory oldGreeting = greeting;
        greeting = _greeting;
        emit GreetingChanged(oldGreeting, _greeting);
    }
}
`;
}

/**
 * Generate sample deployment script (Hardhat v3 - always ESM)
 */
export function generateSampleDeployScript(_typescript?: boolean): string {
  // Hardhat v3 requires ESM for both JS and TS (typescript param kept for API compatibility)
  return `import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const Greeter = await ethers.getContractFactory("Greeter");
  const greeter = await Greeter.deploy("Hello, Hedera!");

  await greeter.waitForDeployment();

  const address = await greeter.getAddress();
  console.log("Greeter deployed to:", address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
`;
}

/**
 * Generate sample test file (Hardhat v3 - always ESM)
 */
export function generateSampleTest(_typescript?: boolean): string {
  // Hardhat v3 requires ESM for both JS and TS (typescript param kept for API compatibility)
  return `import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("Greeter", function () {
  it("Should return the greeting", async function () {
    const Greeter = await ethers.getContractFactory("Greeter");
    const greeter = await Greeter.deploy("Hello, Hedera!");
    await greeter.waitForDeployment();

    expect(await greeter.greet()).to.equal("Hello, Hedera!");
  });

  it("Should update the greeting", async function () {
    const Greeter = await ethers.getContractFactory("Greeter");
    const greeter = await Greeter.deploy("Hello, Hedera!");
    await greeter.waitForDeployment();

    await greeter.setGreeting("Hola, Hedera!");
    expect(await greeter.greet()).to.equal("Hola, Hedera!");
  });

  it("Should emit GreetingChanged event", async function () {
    const Greeter = await ethers.getContractFactory("Greeter");
    const greeter = await Greeter.deploy("Hello, Hedera!");
    await greeter.waitForDeployment();

    await expect(greeter.setGreeting("Hola, Hedera!"))
      .to.emit(greeter, "GreetingChanged")
      .withArgs("Hello, Hedera!", "Hola, Hedera!");
  });
});
`;
}

/**
 * Generate .gitignore for Hardhat project
 */
export function generateGitignore(): string {
  return `# Hardhat
node_modules
.env
coverage
coverage.json
typechain
typechain-types

# Hardhat files
cache
artifacts

# MacOS
.DS_Store

# IDE
.vscode
.idea
*.swp
*.swo

# Logs
*.log
`;
}

/**
 * Generate README for Hardhat project
 */
export function generateReadme(): string {
  return `# Hedera Hardhat Project

This project demonstrates a basic Hardhat use case for Hedera. It comes with a sample contract, a test for that contract, and a deployment script.

## Setup

Install dependencies:

\`\`\`bash
npm install
\`\`\`

Copy \`.env.example\` to \`.env\` and fill in your private keys:

\`\`\`bash
cp .env.example .env
\`\`\`

## Available Commands

\`\`\`bash
# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to testnet
npx hardhat run scripts/deploy.js --network testnet

# Deploy to local node
npx hardhat run scripts/deploy.js --network local

# Clean artifacts
npx hardhat clean
\`\`\`

## Networks

- **Testnet**: Hedera testnet (Chain ID: 296)
- **Mainnet**: Hedera mainnet (Chain ID: 295)
- **Previewnet**: Hedera previewnet (Chain ID: 297)
- **Local**: Local Hedera node (Chain ID: 298)

## Learn More

- [Hardhat Documentation](https://hardhat.org/docs)
- [Hedera Documentation](https://docs.hedera.com/)
- [Hedera Smart Contract Guide](https://docs.hedera.com/hedera/core-concepts/smart-contracts)
`;
}
