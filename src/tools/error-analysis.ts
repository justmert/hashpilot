/**
 * Error Analysis Tools
 * Provides intelligent error code lookup and debugging guidance
 */

import {
  getErrorInfo,
  searchErrors,
  getErrorsByCategory,
  HEDERA_ERROR_CODES,
  ErrorInfo,
} from '../utils/hedera-error-codes.js';
import { analyzeError } from '../services/error-analyzer.js';

/**
 * Tool definition for error explanation
 */
export const errorAnalysisToolDefinition = {
  name: 'error_explain',
  description: `Explain Hedera error codes and provide debugging guidance.

USE FOR:
- Understanding cryptic Hedera error codes (e.g., INSUFFICIENT_PAYER_BALANCE)
- Getting step-by-step solutions for common errors
- Finding related errors and security recommendations

EXAMPLES:
- "What does INSUFFICIENT_PAYER_BALANCE mean?"
- "Explain TOKEN_NOT_ASSOCIATED_TO_ACCOUNT error"
- "I got CONTRACT_REVERT_EXECUTED - what's wrong?"
- "List all token-related errors"`,
  inputSchema: {
    type: 'object',
    properties: {
      errorCode: {
        type: 'string',
        description: 'Hedera error code to explain (e.g., INSUFFICIENT_PAYER_BALANCE, TOKEN_NOT_ASSOCIATED_TO_ACCOUNT)',
      },
      errorMessage: {
        type: 'string',
        description: 'Full error message to analyze (will extract error code automatically)',
      },
      category: {
        type: 'string',
        enum: ['account', 'token', 'contract', 'consensus', 'network', 'transaction', 'key', 'file'],
        description: 'List all errors in a specific category',
      },
      search: {
        type: 'string',
        description: 'Search errors by keyword',
      },
    },
  },
};

/**
 * Handle error explanation requests
 */
export async function errorExplain(args: {
  errorCode?: string;
  errorMessage?: string;
  category?: ErrorInfo['category'];
  search?: string;
}): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // If category specified, list all errors in that category
    if (args.category) {
      const categoryErrors = getErrorsByCategory(args.category);
      return {
        success: true,
        data: {
          category: args.category,
          errorCount: categoryErrors.length,
          errors: categoryErrors.map((e) => ({
            code: e.code,
            name: e.name,
            description: e.description,
            solution: e.solution,
          })),
        },
      };
    }

    // If search specified, search errors by keyword
    if (args.search) {
      const results = searchErrors(args.search);
      return {
        success: true,
        data: {
          searchTerm: args.search,
          resultCount: results.length,
          results: results.map((e) => ({
            code: e.code,
            name: e.name,
            description: e.description,
            solution: e.solution,
          })),
        },
      };
    }

    // If error message provided, analyze it
    if (args.errorMessage) {
      const analysis = analyzeError(args.errorMessage);
      return {
        success: true,
        data: {
          originalError: analysis.originalError,
          detectedCode: analysis.errorCode,
          severity: analysis.severity,
          explanation: analysis.errorInfo
            ? {
                name: analysis.errorInfo.name,
                description: analysis.errorInfo.description,
                cause: analysis.errorInfo.cause,
                solution: analysis.errorInfo.solution,
                category: analysis.errorInfo.category,
              }
            : null,
          guidance: analysis.guidance,
          securityRecommendations: analysis.securityRecommendations,
          optimizationSuggestions: analysis.optimizationSuggestions,
          relatedErrors: analysis.relatedErrors,
        },
      };
    }

    // If error code provided, look it up directly
    if (args.errorCode) {
      const errorInfo = getErrorInfo(args.errorCode);

      if (!errorInfo) {
        // Try to find similar errors
        const similar = searchErrors(args.errorCode);
        return {
          success: false,
          error: `Error code "${args.errorCode}" not found in database.`,
          data: {
            suggestion: 'Try one of these similar errors:',
            similarErrors: similar.slice(0, 5).map((e) => e.code),
            availableCategories: ['account', 'token', 'contract', 'consensus', 'network', 'transaction', 'key'],
          },
        };
      }

      return {
        success: true,
        data: {
          code: errorInfo.code,
          name: errorInfo.name,
          description: errorInfo.description,
          cause: errorInfo.cause,
          solution: errorInfo.solution,
          category: errorInfo.category,
          relatedErrors: getErrorsByCategory(errorInfo.category)
            .filter((e) => e.code !== errorInfo.code)
            .slice(0, 3)
            .map((e) => e.code),
        },
      };
    }

    // No input provided - return available error codes summary
    const categories = ['account', 'token', 'contract', 'consensus', 'network', 'transaction', 'key'] as const;
    const summary = categories.map((cat) => ({
      category: cat,
      count: getErrorsByCategory(cat).length,
    }));

    return {
      success: true,
      data: {
        message: 'Provide an errorCode, errorMessage, category, or search term',
        totalErrorCodes: Object.keys(HEDERA_ERROR_CODES).length,
        categorySummary: summary,
        exampleUsage: [
          { errorCode: 'INSUFFICIENT_PAYER_BALANCE' },
          { errorMessage: 'Status: TOKEN_NOT_ASSOCIATED_TO_ACCOUNT' },
          { category: 'token' },
          { search: 'balance' },
        ],
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to analyze error',
    };
  }
}
