/**
 * RAG System Coverage Tests
 *
 * Validates that the RAG system has comprehensive coverage of all required documentation:
 * i) Complete official Hedera Network documentation
 * ii) SDK documentation and API references for JavaScript, Java, Go, Rust, and Python
 * iii) Official tutorials, code examples, and integration guides
 * iv) Hedera Network service specifications (HTS, HCS, Smart Contract Service, File Service)
 * v) Hedera network configuration details, fee schedules, and operational parameters
 */

import dotenv from 'dotenv';
import { docsSearch, docsGetExample } from '../../dist/tools/rag.js';

// Load environment variables
dotenv.config();

interface TestScenario {
  id: string;
  requirement: string;
  query: string;
  expectedKeywords: string[];
  expectedSources?: string[];
  minScore?: number;
  mustHaveCode?: boolean;
  language?: string;
}

interface TestResult {
  scenario: TestScenario;
  passed: boolean;
  actualResults: any;
  foundKeywords: string[];
  missingKeywords: string[];
  score: number;
  message: string;
}

interface CoverageReport {
  requirement: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  coverage: number;
  details: TestResult[];
}

/**
 * Test Scenarios for Each Requirement
 */
const TEST_SCENARIOS: TestScenario[] = [
  // ==========================================================================
  // i) Complete official Hedera Network documentation
  // ==========================================================================
  {
    id: 'i-1',
    requirement: 'i) Core Documentation',
    query: 'What are Hedera consensus nodes?',
    expectedKeywords: ['consensus', 'node', 'hashgraph', 'network'],
    minScore: 0.15,
  },
  {
    id: 'i-2',
    requirement: 'i) Core Documentation',
    query: 'Explain Hedera account structure',
    expectedKeywords: ['account', 'account id', 'key', 'balance'],
    minScore: 0.15,
  },
  {
    id: 'i-3',
    requirement: 'i) Core Documentation',
    query: 'What is Hedera state and history?',
    expectedKeywords: ['state', 'history', 'record', 'mirror node'],
    minScore: 0.15,
  },
  {
    id: 'i-4',
    requirement: 'i) Core Documentation',
    query: 'How does Hedera staking work?',
    expectedKeywords: ['staking', 'reward', 'node', 'hbar'],
    minScore: 0.15,
  },

  // ==========================================================================
  // ii) SDK Documentation - JavaScript
  // ==========================================================================
  {
    id: 'ii-js-1',
    requirement: 'ii) SDK Documentation (JavaScript)',
    query: 'How to create an account using JavaScript SDK?',
    expectedKeywords: ['accountcreatetransaction', 'client', 'privatekey', 'javascript'],
    mustHaveCode: true,
    language: 'javascript',
    minScore: 0.12,
  },
  {
    id: 'ii-js-2',
    requirement: 'ii) SDK Documentation (JavaScript)',
    query: 'Transfer HBAR with JavaScript SDK',
    expectedKeywords: ['transfertransaction', 'hbar', 'accountid', 'execute'],
    mustHaveCode: true,
    language: 'javascript',
    minScore: 0.12,
  },
  {
    id: 'ii-js-3',
    requirement: 'ii) SDK Documentation (JavaScript)',
    query: 'Create token using Hedera JavaScript SDK',
    expectedKeywords: ['tokencreatetransaction', 'treasury', 'supply', 'token'],
    mustHaveCode: true,
    language: 'javascript',
    minScore: 0.12,
  },

  // ==========================================================================
  // ii) SDK Documentation - Java
  // ==========================================================================
  {
    id: 'ii-java-1',
    requirement: 'ii) SDK Documentation (Java)',
    query: 'How to create account in Java SDK',
    expectedKeywords: ['accountcreatetransaction', 'client', 'java', 'accountid'],
    mustHaveCode: true,
    language: 'java',
    minScore: 0.1,
  },
  {
    id: 'ii-java-2',
    requirement: 'ii) SDK Documentation (Java)',
    query: 'Submit transaction with Java Hedera SDK',
    expectedKeywords: ['transaction', 'execute', 'receipt', 'java'],
    mustHaveCode: true,
    language: 'java',
    minScore: 0.1,
  },

  // ==========================================================================
  // ii) SDK Documentation - Go
  // ==========================================================================
  {
    id: 'ii-go-1',
    requirement: 'ii) SDK Documentation (Go)',
    query: 'Initialize Hedera client in Go',
    expectedKeywords: ['client', 'newclient', 'go', 'setoperator'],
    mustHaveCode: true,
    language: 'go',
    minScore: 0.1,
  },
  {
    id: 'ii-go-2',
    requirement: 'ii) SDK Documentation (Go)',
    query: 'Create token with Go SDK',
    expectedKeywords: ['token', 'create', 'go', 'hedera'],
    mustHaveCode: true,
    language: 'go',
    minScore: 0.1,
  },

  // ==========================================================================
  // ii) SDK Documentation - Python
  // ==========================================================================
  {
    id: 'ii-python-1',
    requirement: 'ii) SDK Documentation (Python)',
    query: 'How to use Hedera Python SDK?',
    expectedKeywords: ['python', 'sdk', 'hedera', 'client'],
    mustHaveCode: true,
    language: 'python',
    minScore: 0.1,
  },

  // ==========================================================================
  // ii) SDK Documentation - Rust
  // ==========================================================================
  {
    id: 'ii-rust-1',
    requirement: 'ii) SDK Documentation (Rust)',
    query: 'Submit transaction in Rust SDK',
    expectedKeywords: ['rust', 'transaction', 'hedera', 'sdk'],
    mustHaveCode: true,
    language: 'rust',
    minScore: 0.1,
  },

  // ==========================================================================
  // iii) Tutorials and Integration Guides
  // ==========================================================================
  {
    id: 'iii-1',
    requirement: 'iii) Tutorials',
    query: 'Tutorial for creating NFTs on Hedera',
    expectedKeywords: ['nft', 'tutorial', 'token', 'create', 'step'],
    mustHaveCode: true,
    minScore: 0.12,
  },
  {
    id: 'iii-2',
    requirement: 'iii) Tutorials',
    query: 'How to set up Hedera local node',
    expectedKeywords: ['local', 'node', 'setup', 'configuration', 'docker'],
    minScore: 0.12,
  },
  {
    id: 'iii-3',
    requirement: 'iii) Tutorials',
    query: 'Smart contract deployment tutorial',
    expectedKeywords: ['smart contract', 'deploy', 'tutorial', 'solidity'],
    mustHaveCode: true,
    minScore: 0.15,
  },
  {
    id: 'iii-4',
    requirement: 'iii) Tutorials',
    query: 'Hedera Consensus Service tutorial',
    expectedKeywords: ['hcs', 'topic', 'message', 'tutorial', 'submit'],
    mustHaveCode: true,
    minScore: 0.15,
  },
  {
    id: 'iii-5',
    requirement: 'iii) Tutorials',
    query: 'How to integrate with Hedera wallets',
    expectedKeywords: ['wallet', 'integration', 'connect', 'sign'],
    minScore: 0.1,
  },

  // ==========================================================================
  // iv) Service Specifications - HTS
  // ==========================================================================
  {
    id: 'iv-hts-1',
    requirement: 'iv) Service Specs (HTS)',
    query: 'What are token creation parameters in HTS?',
    expectedKeywords: ['token', 'create', 'parameter', 'treasury', 'supply'],
    minScore: 0.15,
  },
  {
    id: 'iv-hts-2',
    requirement: 'iv) Service Specs (HTS)',
    query: 'Token properties and metadata in Hedera',
    expectedKeywords: ['token', 'property', 'metadata', 'symbol', 'name'],
    minScore: 0.15,
  },
  {
    id: 'iv-hts-3',
    requirement: 'iv) Service Specs (HTS)',
    query: 'How to mint and burn tokens',
    expectedKeywords: ['mint', 'burn', 'token', 'supply'],
    expectedSources: ['hedera.com/hedera/sdks-and-apis/sdks/token-service'],
    minScore: 0.15,
  },
  {
    id: 'iv-hts-4',
    requirement: 'iv) Service Specs (HTS)',
    query: 'Token association requirements',
    expectedKeywords: ['associate', 'token', 'account', 'transfer'],
    minScore: 0.15,
  },

  // ==========================================================================
  // iv) Service Specifications - HCS
  // ==========================================================================
  {
    id: 'iv-hcs-1',
    requirement: 'iv) Service Specs (HCS)',
    query: 'Topic message size limits in HCS',
    expectedKeywords: ['topic', 'message', 'size', 'limit', 'hcs'],
    minScore: 0.12,
  },
  {
    id: 'iv-hcs-2',
    requirement: 'iv) Service Specs (HCS)',
    query: 'How to create and manage topics',
    expectedKeywords: ['topic', 'create', 'submit', 'message'],
    minScore: 0.15,
  },
  {
    id: 'iv-hcs-3',
    requirement: 'iv) Service Specs (HCS)',
    query: 'HCS submit key and access control',
    expectedKeywords: ['submitkey', 'topic', 'access', 'permission'],
    minScore: 0.12,
  },

  // ==========================================================================
  // iv) Service Specifications - Smart Contracts
  // ==========================================================================
  {
    id: 'iv-sc-1',
    requirement: 'iv) Service Specs (Smart Contracts)',
    query: 'Gas limits for contract deployment',
    expectedKeywords: ['gas', 'limit', 'contract', 'deployment', 'fee'],
    minScore: 0.15,
  },
  {
    id: 'iv-sc-2',
    requirement: 'iv) Service Specs (Smart Contracts)',
    query: 'Smart contract size limits on Hedera',
    expectedKeywords: ['contract', 'size', 'limit', 'bytecode'],
    minScore: 0.12,
  },
  {
    id: 'iv-sc-3',
    requirement: 'iv) Service Specs (Smart Contracts)',
    query: 'EVM compatibility and differences',
    expectedKeywords: ['evm', 'compatibility', 'ethereum', 'difference'],
    minScore: 0.15,
  },
  {
    id: 'iv-sc-4',
    requirement: 'iv) Service Specs (Smart Contracts)',
    query: 'Hedera system contracts and precompiles',
    expectedKeywords: ['system', 'contract', 'precompile', 'address'],
    minScore: 0.12,
  },

  // ==========================================================================
  // iv) Service Specifications - File Service
  // ==========================================================================
  {
    id: 'iv-file-1',
    requirement: 'iv) Service Specs (File)',
    query: 'Maximum file size on Hedera',
    expectedKeywords: ['file', 'size', 'limit', 'maximum'],
    minScore: 0.12,
  },
  {
    id: 'iv-file-2',
    requirement: 'iv) Service Specs (File)',
    query: 'How to create and update files',
    expectedKeywords: ['file', 'create', 'update', 'append'],
    minScore: 0.15,
  },

  // ==========================================================================
  // v) Network Configuration and Operational Parameters
  // ==========================================================================
  {
    id: 'v-1',
    requirement: 'v) Network Configuration',
    query: 'What are Hedera testnet endpoints?',
    expectedKeywords: ['testnet', 'endpoint', 'node', 'url'],
    minScore: 0.12,
  },
  {
    id: 'v-2',
    requirement: 'v) Network Configuration',
    query: 'Hedera mainnet node addresses',
    expectedKeywords: ['mainnet', 'node', 'address', 'endpoint'],
    minScore: 0.1,
  },
  {
    id: 'v-3',
    requirement: 'v) Network Configuration',
    query: 'How much does a token transfer cost?',
    expectedKeywords: ['fee', 'cost', 'token', 'transfer', 'hbar'],
    minScore: 0.12,
  },
  {
    id: 'v-4',
    requirement: 'v) Network Configuration',
    query: 'Hedera transaction rate limits',
    expectedKeywords: ['rate', 'limit', 'tps', 'transaction', 'throughput'],
    minScore: 0.1,
  },
  {
    id: 'v-5',
    requirement: 'v) Network Configuration',
    query: 'Fee schedule for Hedera services',
    expectedKeywords: ['fee', 'schedule', 'cost', 'price'],
    minScore: 0.1,
  },
  {
    id: 'v-6',
    requirement: 'v) Network Configuration',
    query: 'Mirror Node REST API endpoints',
    expectedKeywords: ['mirror', 'node', 'api', 'endpoint', 'rest'],
    minScore: 0.12,
  },
  {
    id: 'v-7',
    requirement: 'v) Network Configuration',
    query: 'JSON-RPC relay configuration',
    expectedKeywords: ['json-rpc', 'relay', 'endpoint', 'configuration'],
    minScore: 0.12,
  },
];

/**
 * Run a single test scenario
 */
async function runTestScenario(scenario: TestScenario): Promise<TestResult> {
  console.log(`\n  Testing: ${scenario.id} - "${scenario.query}"`);

  try {
    let results;

    // Use appropriate tool based on scenario
    if (scenario.mustHaveCode) {
      results = await docsGetExample({
        description: scenario.query,
        language: scenario.language,
        limit: 3,
      });
    } else {
      results = await docsSearch({
        query: scenario.query,
        limit: 5,
      });
    }

    // Parse results
    const content = results.content[0].text;
    const data = JSON.parse(content);

    // Check for keywords
    const contentLower = content.toLowerCase();
    const foundKeywords = scenario.expectedKeywords.filter((keyword) =>
      contentLower.includes(keyword.toLowerCase())
    );
    const missingKeywords = scenario.expectedKeywords.filter(
      (keyword) => !contentLower.includes(keyword.toLowerCase())
    );

    // Calculate score
    const keywordScore = foundKeywords.length / scenario.expectedKeywords.length;
    const hasMinResults = data.results?.length > 0 || data.examples?.length > 0;
    const resultsScore = data.results?.[0]?.score || data.examples?.[0]?.relevance || 0;

    // Determine pass/fail
    const meetsMinScore = !scenario.minScore || resultsScore >= scenario.minScore;
    const hasEnoughKeywords = keywordScore >= 0.5; // At least 50% keywords found
    const passed = hasMinResults && meetsMinScore && hasEnoughKeywords;

    const message = passed
      ? `✅ PASS - Found ${foundKeywords.length}/${scenario.expectedKeywords.length} keywords, score: ${resultsScore.toFixed(2)}`
      : `❌ FAIL - Found ${foundKeywords.length}/${scenario.expectedKeywords.length} keywords, score: ${resultsScore.toFixed(2)}, missing: ${missingKeywords.join(', ')}`;

    return {
      scenario,
      passed,
      actualResults: data,
      foundKeywords,
      missingKeywords,
      score: resultsScore,
      message,
    };
  } catch (error: any) {
    return {
      scenario,
      passed: false,
      actualResults: null,
      foundKeywords: [],
      missingKeywords: scenario.expectedKeywords,
      score: 0,
      message: `❌ ERROR - ${error.message}`,
    };
  }
}

/**
 * Run all test scenarios and generate coverage report
 */
async function runCoverageTests(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('RAG SYSTEM COVERAGE TESTS');
  console.log('='.repeat(80));
  console.log(`\nRunning ${TEST_SCENARIOS.length} test scenarios...\n`);

  const results: TestResult[] = [];
  const coverageByRequirement: Map<string, CoverageReport> = new Map();

  // Run all tests
  for (const scenario of TEST_SCENARIOS) {
    const result = await runTestScenario(scenario);
    results.push(result);
    console.log(`  ${result.message}`);

    // Group by requirement
    if (!coverageByRequirement.has(scenario.requirement)) {
      coverageByRequirement.set(scenario.requirement, {
        requirement: scenario.requirement,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        coverage: 0,
        details: [],
      });
    }

    const report = coverageByRequirement.get(scenario.requirement)!;
    report.totalTests++;
    report.details.push(result);
    if (result.passed) {
      report.passedTests++;
    } else {
      report.failedTests++;
    }
    report.coverage = (report.passedTests / report.totalTests) * 100;

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Generate summary report
  console.log('\n' + '='.repeat(80));
  console.log('COVERAGE REPORT BY REQUIREMENT');
  console.log('='.repeat(80));

  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (const [requirement, report] of coverageByRequirement.entries()) {
    totalTests += report.totalTests;
    totalPassed += report.passedTests;
    totalFailed += report.failedTests;

    const status = report.coverage >= 85 ? '✅' : report.coverage >= 70 ? '⚠️' : '❌';
    console.log(`\n${status} ${requirement}`);
    console.log(
      `   Coverage: ${report.coverage.toFixed(1)}% (${report.passedTests}/${report.totalTests} tests passed)`
    );

    if (report.failedTests > 0) {
      console.log(`   Failed tests:`);
      report.details
        .filter((d) => !d.passed)
        .forEach((d) => {
          console.log(`     - ${d.scenario.id}: ${d.scenario.query}`);
          console.log(`       Missing keywords: ${d.missingKeywords.join(', ')}`);
        });
    }
  }

  // Overall summary
  const overallCoverage = (totalPassed / totalTests) * 100;
  const overallStatus =
    overallCoverage >= 85
      ? '✅ EXCELLENT'
      : overallCoverage >= 70
        ? '⚠️ GOOD'
        : '❌ NEEDS IMPROVEMENT';

  console.log('\n' + '='.repeat(80));
  console.log('OVERALL COVERAGE');
  console.log('='.repeat(80));
  console.log(`\n${overallStatus}`);
  console.log(`Total Coverage: ${overallCoverage.toFixed(1)}%`);
  console.log(`Tests Passed: ${totalPassed}/${totalTests}`);
  console.log(`Tests Failed: ${totalFailed}/${totalTests}`);

  // Recommendations
  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(80));

  for (const [requirement, report] of coverageByRequirement.entries()) {
    if (report.coverage < 85) {
      console.log(`\n${requirement} (${report.coverage.toFixed(1)}%)`);
      console.log(`  Action needed: Expand indexing to include:`);

      if (
        requirement.includes('JavaScript') ||
        requirement.includes('Java') ||
        requirement.includes('Go') ||
        requirement.includes('Python') ||
        requirement.includes('Rust')
      ) {
        console.log(`    - SDK API documentation for ${requirement.split('(')[1].split(')')[0]}`);
        console.log(`    - Code examples from GitHub repository`);
        console.log(`    - SDK-specific tutorials`);
      } else if (requirement.includes('Network Configuration')) {
        console.log(`    - Network endpoint documentation`);
        console.log(`    - Fee schedule pages`);
        console.log(`    - Operational parameter specifications`);
      } else if (requirement.includes('Tutorials')) {
        console.log(`    - Additional tutorial pages from docs.hedera.com/hedera/tutorials`);
        console.log(`    - Step-by-step integration guides`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n');
}

// Run tests
runCoverageTests().catch(console.error);
