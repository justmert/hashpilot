/**
 * Intelligent Error Analyzer Service
 *
 * Provides intelligent error analysis, debugging guidance,
 * and proactive security/optimization recommendations for Hedera development.
 */

import {
  getErrorInfo,
  extractErrorCode,
  formatErrorInfo,
  ErrorInfo,
  HEDERA_ERROR_CODES,
} from '../utils/hedera-error-codes.js';
import { logger } from '../utils/logger.js';

/**
 * Analysis result from the error analyzer
 */
export interface ErrorAnalysis {
  /** Original error message */
  originalError: string;
  /** Detected error code (if any) */
  errorCode?: string;
  /** Human-readable error information */
  errorInfo?: ErrorInfo;
  /** Formatted debugging guidance */
  guidance: string;
  /** Security recommendations (if applicable) */
  securityRecommendations: string[];
  /** Optimization suggestions (if applicable) */
  optimizationSuggestions: string[];
  /** Related error codes to consider */
  relatedErrors: string[];
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Security patterns to detect in code and operations
 */
const SECURITY_PATTERNS = {
  keyExposure: {
    pattern: /private[_-]?key|secret|mnemonic|seed/i,
    recommendation: 'Never expose private keys in logs or error messages. Use environment variables.',
  },
  hardcodedCredentials: {
    pattern: /0x[a-fA-F0-9]{64}|302[0-9a-fA-F]{60,}/,
    recommendation: 'Avoid hardcoding keys in source code. Use secure key management.',
  },
  adminKeyMissing: {
    pattern: /adminKey.*false|no.*admin.*key/i,
    recommendation: 'Consider enabling admin key for entities that may need updates.',
  },
  noSupplyKey: {
    pattern: /supplyKey.*false|no.*supply.*key/i,
    recommendation: 'Tokens without supply keys cannot have their supply modified later.',
  },
  infiniteApproval: {
    pattern: /approve.*max|unlimited.*allowance/i,
    recommendation: 'Avoid infinite approvals. Use specific amounts for better security.',
  },
};

/**
 * Optimization patterns for Hedera development
 */
const OPTIMIZATION_PATTERNS = {
  batchTransfers: {
    pattern: /transfer.*loop|multiple.*transfer/i,
    suggestion: 'Batch multiple transfers into a single CryptoTransfer transaction.',
  },
  mirrorNodeForReads: {
    pattern: /getBalance|getAccountInfo|getTokenInfo/i,
    suggestion: 'Use Mirror Node REST API for read operations (free, no transaction fees).',
  },
  gasEstimation: {
    pattern: /gas.*limit|insufficient.*gas/i,
    suggestion: 'Use eth_estimateGas before transactions. Add 20% buffer for safety.',
  },
  chunkLargeMessages: {
    pattern: /message.*too.*large|1024.*bytes/i,
    suggestion: 'Split messages larger than 1KB into chunks for HCS.',
  },
  cacheAccountInfo: {
    pattern: /repeated.*account.*query/i,
    suggestion: 'Cache account info locally to reduce Mirror Node queries.',
  },
};

/**
 * Error Analyzer Service
 */
class ErrorAnalyzerService {
  /**
   * Analyze an error and provide comprehensive debugging guidance
   */
  analyze(error: Error | string): ErrorAnalysis {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Extract error code from message
    const errorCode = extractErrorCode(errorMessage);
    const errorInfo = errorCode ? getErrorInfo(errorCode) : undefined;

    // Determine severity
    const severity = this.determineSeverity(errorCode, errorMessage);

    // Generate guidance
    const guidance = this.generateGuidance(errorMessage, errorInfo, errorStack);

    // Check for security issues
    const securityRecommendations = this.checkSecurityPatterns(errorMessage);

    // Check for optimization opportunities
    const optimizationSuggestions = this.checkOptimizationPatterns(errorMessage);

    // Find related errors
    const relatedErrors = this.findRelatedErrors(errorCode, errorMessage);

    const analysis: ErrorAnalysis = {
      originalError: errorMessage,
      errorCode,
      errorInfo,
      guidance,
      securityRecommendations,
      optimizationSuggestions,
      relatedErrors,
      severity,
    };

    logger.debug('Error analyzed', { errorCode, severity });
    return analysis;
  }

  /**
   * Determine error severity
   */
  private determineSeverity(
    errorCode: string | undefined,
    errorMessage: string
  ): ErrorAnalysis['severity'] {
    // Critical errors
    const criticalPatterns = [
      /INVALID_SIGNATURE/i,
      /INVALID_PAYER_SIGNATURE/i,
      /CONTRACT_REVERT/i,
      /UNAUTHORIZED/i,
    ];

    // High severity errors
    const highPatterns = [
      /INSUFFICIENT.*BALANCE/i,
      /ACCOUNT.*DELETED/i,
      /TOKEN.*DELETED/i,
      /CONTRACT.*DELETED/i,
    ];

    // Medium severity errors
    const mediumPatterns = [
      /NOT_ASSOCIATED/i,
      /FROZEN/i,
      /PAUSED/i,
      /KYC_NOT_GRANTED/i,
    ];

    const fullText = `${errorCode || ''} ${errorMessage}`;

    if (criticalPatterns.some((p) => p.test(fullText))) {
      return 'critical';
    }
    if (highPatterns.some((p) => p.test(fullText))) {
      return 'high';
    }
    if (mediumPatterns.some((p) => p.test(fullText))) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Generate comprehensive debugging guidance
   */
  private generateGuidance(
    errorMessage: string,
    errorInfo: ErrorInfo | undefined,
    errorStack: string | undefined
  ): string {
    const sections: string[] = [];

    // Error info section
    if (errorInfo) {
      sections.push(formatErrorInfo(errorInfo));
    } else {
      sections.push(this.generateGenericGuidance(errorMessage));
    }

    // Stack trace analysis
    if (errorStack) {
      const stackAnalysis = this.analyzeStackTrace(errorStack);
      if (stackAnalysis) {
        sections.push(`\n**Stack Analysis:** ${stackAnalysis}`);
      }
    }

    // Common troubleshooting steps
    sections.push(this.getCommonTroubleshootingSteps(errorMessage));

    return sections.join('\n\n');
  }

  /**
   * Generate guidance for unknown errors
   */
  private generateGenericGuidance(errorMessage: string): string {
    // Check for common patterns in error messages
    if (errorMessage.includes('ECONNREFUSED')) {
      return `**Connection Error**

The service cannot connect to the Hedera network or a required service.

**Possible Causes:**
- Network connectivity issues
- Wrong network endpoint
- Service is down

**Solutions:**
1. Check your internet connection
2. Verify HEDERA_NETWORK is set correctly
3. Check https://status.hedera.com for network status`;
    }

    if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      return `**Timeout Error**

The operation took too long to complete.

**Solutions:**
1. Retry the operation
2. Check network connectivity
3. Increase timeout settings if available`;
    }

    if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      return `**Rate Limit Error**

Too many requests were sent too quickly.

**Solutions:**
1. Implement exponential backoff
2. Reduce request frequency
3. Use batching for multiple operations`;
    }

    return `**Unknown Error**

Error: ${errorMessage}

**General Troubleshooting:**
1. Check account balance has sufficient HBAR
2. Verify all IDs are correct (0.0.xxxxx format)
3. Ensure you're on the correct network (testnet/mainnet)
4. Check that required keys are available`;
  }

  /**
   * Analyze stack trace for useful information
   */
  private analyzeStackTrace(stack: string): string | undefined {
    // Look for common patterns in stack traces
    if (stack.includes('Transaction.execute')) {
      return 'Error occurred during transaction execution.';
    }
    if (stack.includes('Query.execute')) {
      return 'Error occurred during query execution.';
    }
    if (stack.includes('ContractCall')) {
      return 'Error occurred during smart contract interaction.';
    }
    return undefined;
  }

  /**
   * Get common troubleshooting steps based on error
   */
  private getCommonTroubleshootingSteps(errorMessage: string): string {
    const steps: string[] = ['**Common Troubleshooting Steps:**'];

    if (errorMessage.toLowerCase().includes('account')) {
      steps.push('1. Verify account ID format: 0.0.xxxxx');
      steps.push('2. Check account exists: use account_info tool');
      steps.push('3. Verify account has sufficient balance');
    }

    if (errorMessage.toLowerCase().includes('token')) {
      steps.push('1. Verify token ID format: 0.0.xxxxx');
      steps.push('2. Check token is associated with account');
      steps.push('3. Verify KYC status if required');
      steps.push('4. Check token is not paused');
    }

    if (errorMessage.toLowerCase().includes('contract')) {
      steps.push('1. Verify contract address (0x... or 0.0.xxxxx)');
      steps.push('2. Check gas limit is sufficient');
      steps.push('3. Verify function parameters are correct');
      steps.push('4. Check contract is not deleted');
    }

    if (errorMessage.toLowerCase().includes('key') || errorMessage.toLowerCase().includes('sign')) {
      steps.push('1. Verify private key matches account');
      steps.push('2. Check key format (DER encoding)');
      steps.push('3. Ensure required keys are enabled on entity');
    }

    if (steps.length === 1) {
      steps.push('1. Check network connectivity');
      steps.push('2. Verify all parameters are correct');
      steps.push('3. Check account balance');
      steps.push('4. Review Hedera status page');
    }

    return steps.join('\n');
  }

  /**
   * Check for security patterns in error/code
   */
  private checkSecurityPatterns(text: string): string[] {
    const recommendations: string[] = [];

    for (const [, check] of Object.entries(SECURITY_PATTERNS)) {
      if (check.pattern.test(text)) {
        recommendations.push(check.recommendation);
      }
    }

    return recommendations;
  }

  /**
   * Check for optimization opportunities
   */
  private checkOptimizationPatterns(text: string): string[] {
    const suggestions: string[] = [];

    for (const [, check] of Object.entries(OPTIMIZATION_PATTERNS)) {
      if (check.pattern.test(text)) {
        suggestions.push(check.suggestion);
      }
    }

    return suggestions;
  }

  /**
   * Find related error codes
   */
  private findRelatedErrors(errorCode: string | undefined, _errorMessage: string): string[] {
    const related: string[] = [];

    if (!errorCode) {
      return related;
    }

    const errorInfo = getErrorInfo(errorCode);
    if (!errorInfo) {
      return related;
    }

    // Find errors in the same category
    const categoryErrors = Object.entries(HEDERA_ERROR_CODES)
      .filter(
        ([code, info]) =>
          info.category === errorInfo.category && code !== errorCode
      )
      .map(([code]) => code)
      .slice(0, 3);

    related.push(...categoryErrors);
    return related;
  }

  /**
   * Get proactive security recommendations for an operation
   */
  getSecurityRecommendations(operation: string, params: Record<string, unknown>): string[] {
    const recommendations: string[] = [];

    // Token creation security
    if (operation === 'token_create' || operation === 'create') {
      if (!params.adminKey) {
        recommendations.push(
          'Consider enabling adminKey for token updates and management.'
        );
      }
      if (!params.freezeKey) {
        recommendations.push(
          'Consider enabling freezeKey for compliance and emergency response.'
        );
      }
      if (!params.wipeKey) {
        recommendations.push(
          'Consider enabling wipeKey for regulatory compliance.'
        );
      }
    }

    // Account creation security
    if (operation === 'account_create') {
      recommendations.push(
        'Store the generated private key securely. It cannot be recovered.'
      );
      recommendations.push(
        'Consider using a key management service for production.'
      );
    }

    // Contract deployment security
    if (operation.includes('deploy') || operation.includes('contract')) {
      recommendations.push('Audit smart contracts before deployment.');
      recommendations.push('Consider using upgradeable proxy patterns.');
      recommendations.push('Test thoroughly on testnet before mainnet.');
    }

    return recommendations;
  }

  /**
   * Get optimization suggestions for an operation
   */
  getOptimizationSuggestions(operation: string, _params: Record<string, unknown>): string[] {
    const suggestions: string[] = [];

    // Balance queries
    if (operation.includes('balance') || operation.includes('info')) {
      suggestions.push(
        'Use Mirror Node REST API for read operations (free, faster).'
      );
    }

    // Multiple transfers
    if (operation === 'transfer_hbar' || operation === 'token_transfer') {
      suggestions.push(
        'Batch multiple transfers in a single transaction to save fees.'
      );
    }

    // Contract calls
    if (operation.includes('contract')) {
      suggestions.push('Use eth_call for read-only operations (free).');
      suggestions.push(
        'Estimate gas before transactions: eth_estimateGas.'
      );
    }

    // HCS messages
    if (operation.includes('message') || operation.includes('topic')) {
      suggestions.push('Messages over 1KB will be automatically chunked.');
      suggestions.push(
        'Consider compression for large payloads.'
      );
    }

    return suggestions;
  }
}

// Export singleton instance
export const errorAnalyzer = new ErrorAnalyzerService();

// Export utility function for quick analysis
export function analyzeError(error: Error | string): ErrorAnalysis {
  return errorAnalyzer.analyze(error);
}
