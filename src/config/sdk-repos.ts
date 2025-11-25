/**
 * SDK Repository Configuration
 *
 * Configuration for Hedera SDK GitHub repositories to index.
 * Each SDK has specific files and examples to fetch for RAG indexing.
 */

export type SDKLanguage = 'javascript' | 'java' | 'go' | 'python' | 'rust';

export interface SDKRepoConfig {
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Default branch */
  branch: string;
  /** Display name */
  displayName: string;
  /** Documentation files to fetch (relative paths) */
  docFiles: string[];
  /** Examples directory */
  examplesDir: string;
  /** File patterns for examples (glob-like) */
  examplePatterns: string[];
  /** Directories to exclude from examples */
  excludeDirs: string[];
}

/**
 * Hedera SDK Repository Configurations
 */
export const SDK_REPOS: Record<SDKLanguage, SDKRepoConfig> = {
  javascript: {
    owner: 'hashgraph',
    repo: 'hedera-sdk-js',
    branch: 'main',
    displayName: 'JavaScript/TypeScript SDK',
    docFiles: [
      'README.md',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'manual/CONFIGURATION.md',
      'manual/MIGRATING_V1.md',
    ],
    examplesDir: 'examples',
    examplePatterns: ['*.js', '*.mjs', '*.ts'],
    excludeDirs: ['node_modules', 'frontend-examples', 'react-native-example'],
  },

  java: {
    owner: 'hashgraph',
    repo: 'hedera-sdk-java',
    branch: 'main',
    displayName: 'Java SDK',
    docFiles: [
      'README.md',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'HIERO_MIGRATION.md',
      'docs/java-app-quickstart.md',
      'docs/android-app-quickstart.md',
      'docs/developer-guide.md',
    ],
    examplesDir: 'examples/src/main/java/com/hedera/hashgraph/sdk/examples',
    examplePatterns: ['*.java'],
    excludeDirs: ['test'],
  },

  go: {
    owner: 'hashgraph',
    repo: 'hedera-sdk-go',
    branch: 'main',
    displayName: 'Go SDK',
    docFiles: [
      'README.md',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'MIGRATING_V1.md',
    ],
    examplesDir: 'examples',
    examplePatterns: ['*.go'],
    excludeDirs: ['vendor'],
  },

  python: {
    owner: 'hiero-ledger',
    repo: 'hiero-sdk-python',
    branch: 'main',
    displayName: 'Python SDK',
    docFiles: [
      'README.md',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'docs/sdk_users/running_examples.md',
      'docs/sdk_developers/setup.md',
      'docs/sdk_developers/workflow.md',
    ],
    examplesDir: 'examples',
    examplePatterns: ['*.py'],
    excludeDirs: ['__pycache__'],
  },

  rust: {
    owner: 'hashgraph',
    repo: 'hedera-sdk-rust',
    branch: 'main',
    displayName: 'Rust SDK',
    docFiles: [
      'README.md',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'MIGRATION.md',
    ],
    examplesDir: 'examples',
    examplePatterns: ['*.rs'],
    excludeDirs: ['target'],
  },
};

/**
 * Get all SDK languages
 */
export function getAllSDKLanguages(): SDKLanguage[] {
  return Object.keys(SDK_REPOS) as SDKLanguage[];
}

/**
 * Get SDK config by language
 */
export function getSDKConfig(language: SDKLanguage): SDKRepoConfig {
  return SDK_REPOS[language];
}

/**
 * Build GitHub raw content URL
 */
export function buildRawUrl(config: SDKRepoConfig, filePath: string): string {
  return `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/${filePath}`;
}

/**
 * Build GitHub API URL for directory listing
 */
export function buildApiUrl(config: SDKRepoConfig, dirPath: string): string {
  return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${dirPath}?ref=${config.branch}`;
}

/**
 * Build GitHub repository URL
 */
export function buildRepoUrl(config: SDKRepoConfig): string {
  return `https://github.com/${config.owner}/${config.repo}`;
}
