/**
 * Hedera Error Code Mappings
 *
 * Translates cryptic Hedera error codes into human-readable explanations
 * with actionable debugging guidance.
 */

export interface ErrorInfo {
  code: string;
  name: string;
  description: string;
  cause: string;
  solution: string;
  category:
    'account' | 'token' | 'contract' | 'consensus' | 'network' | 'transaction' | 'key' | 'file';
}

/**
 * Comprehensive mapping of Hedera response codes to human-readable information
 * Reference: https://docs.hedera.com/hedera/sdks-and-apis/sdks/response-codes
 */
export const HEDERA_ERROR_CODES: Record<string, ErrorInfo> = {
  // ============================================
  // Account Errors
  // ============================================
  INSUFFICIENT_PAYER_BALANCE: {
    code: 'INSUFFICIENT_PAYER_BALANCE',
    name: 'Insufficient Payer Balance',
    description: 'The payer account does not have enough HBAR to pay for this transaction.',
    cause: 'Account balance is less than the transaction fee plus any transfer amount.',
    solution: 'Fund the payer account with more HBAR. Check balance with account_balance tool.',
    category: 'account',
  },
  INSUFFICIENT_ACCOUNT_BALANCE: {
    code: 'INSUFFICIENT_ACCOUNT_BALANCE',
    name: 'Insufficient Account Balance',
    description: 'The account does not have sufficient balance for this operation.',
    cause: 'Trying to transfer more HBAR or tokens than the account holds.',
    solution: 'Reduce the transfer amount or fund the account with more assets.',
    category: 'account',
  },
  ACCOUNT_ID_DOES_NOT_EXIST: {
    code: 'ACCOUNT_ID_DOES_NOT_EXIST',
    name: 'Account Does Not Exist',
    description: 'The specified account ID does not exist on the network.',
    cause: 'The account ID is invalid or the account has been deleted.',
    solution: 'Verify the account ID format (0.0.xxxxx) and that it exists on the current network.',
    category: 'account',
  },
  ACCOUNT_DELETED: {
    code: 'ACCOUNT_DELETED',
    name: 'Account Deleted',
    description: 'The account has been deleted and cannot be used.',
    cause: 'The account was previously deleted via an AccountDeleteTransaction.',
    solution: 'Use a different account. Deleted accounts cannot be restored.',
    category: 'account',
  },
  ACCOUNT_REPEATED_IN_ACCOUNT_AMOUNTS: {
    code: 'ACCOUNT_REPEATED_IN_ACCOUNT_AMOUNTS',
    name: 'Duplicate Account in Transfer',
    description: 'The same account appears multiple times in a transfer list.',
    cause: 'Attempting to credit/debit the same account multiple times in one transaction.',
    solution: 'Consolidate transfers to the same account into a single entry.',
    category: 'account',
  },
  ACCOUNT_IS_IMMUTABLE: {
    code: 'ACCOUNT_IS_IMMUTABLE',
    name: 'Account Is Immutable',
    description: 'The account cannot be modified because it has no admin key.',
    cause: 'Trying to update an account that was created without an admin key.',
    solution:
      'This account cannot be modified. Create a new account with an admin key if mutability is needed.',
    category: 'account',
  },

  // ============================================
  // Key and Signature Errors
  // ============================================
  INVALID_SIGNATURE: {
    code: 'INVALID_SIGNATURE',
    name: 'Invalid Signature',
    description: 'The transaction signature is invalid or missing.',
    cause: 'The private key used does not match the required signing key for the account.',
    solution:
      'Verify you are using the correct private key for the account. Check key format (DER vs raw).',
    category: 'key',
  },
  INVALID_PAYER_SIGNATURE: {
    code: 'INVALID_PAYER_SIGNATURE',
    name: 'Invalid Payer Signature',
    description: 'The payer account signature is invalid.',
    cause: 'The operator key does not match the payer account key.',
    solution: 'Ensure HEDERA_OPERATOR_KEY matches the key for HEDERA_OPERATOR_ID.',
    category: 'key',
  },
  KEY_NOT_PROVIDED: {
    code: 'KEY_NOT_PROVIDED',
    name: 'Key Not Provided',
    description: 'A required key was not provided for this operation.',
    cause: 'The transaction requires a specific key that was not included.',
    solution: 'Provide the required key (admin, supply, freeze, etc.) for this operation.',
    category: 'key',
  },
  INVALID_KEY_ENCODING: {
    code: 'INVALID_KEY_ENCODING',
    name: 'Invalid Key Encoding',
    description: 'The provided key has an invalid format.',
    cause: 'The key is not properly encoded (DER, raw hex, etc.).',
    solution: 'Verify the key format. Use DER-encoded keys (starting with 302e or 3030).',
    category: 'key',
  },
  KEY_REQUIRED: {
    code: 'KEY_REQUIRED',
    name: 'Key Required',
    description: 'This operation requires a key that is not set on the entity.',
    cause: 'Trying to perform an operation that requires a key (e.g., mint without supply key).',
    solution:
      'The token/account was created without the required key. Create a new entity with the key enabled.',
    category: 'key',
  },

  // ============================================
  // Token Errors
  // ============================================
  TOKEN_NOT_ASSOCIATED_TO_ACCOUNT: {
    code: 'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT',
    name: 'Token Not Associated',
    description: 'The token is not associated with the target account.',
    cause: 'Trying to transfer tokens to an account that has not associated with the token.',
    solution:
      'Associate the token with the account first using token_manage with operation: "associate".',
    category: 'token',
  },
  TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT: {
    code: 'TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT',
    name: 'Token Already Associated',
    description: 'The token is already associated with this account.',
    cause: 'Attempting to associate a token that is already associated.',
    solution: 'No action needed - the token is already associated.',
    category: 'token',
  },
  INVALID_TOKEN_ID: {
    code: 'INVALID_TOKEN_ID',
    name: 'Invalid Token ID',
    description: 'The specified token ID is invalid or does not exist.',
    cause: 'The token ID format is wrong or the token was deleted.',
    solution: 'Verify the token ID format (0.0.xxxxx) and that it exists on the current network.',
    category: 'token',
  },
  TOKEN_WAS_DELETED: {
    code: 'TOKEN_WAS_DELETED',
    name: 'Token Was Deleted',
    description: 'The token has been deleted and cannot be used.',
    cause: 'The token was previously deleted by an admin.',
    solution: 'Use a different token. Deleted tokens cannot be restored.',
    category: 'token',
  },
  TOKEN_HAS_NO_SUPPLY_KEY: {
    code: 'TOKEN_HAS_NO_SUPPLY_KEY',
    name: 'Token Has No Supply Key',
    description: 'Cannot mint or burn because the token has no supply key.',
    cause: 'The token was created without a supply key.',
    solution:
      'This token cannot have its supply modified. Create a new token with supplyKey enabled.',
    category: 'token',
  },
  TOKEN_HAS_NO_FREEZE_KEY: {
    code: 'TOKEN_HAS_NO_FREEZE_KEY',
    name: 'Token Has No Freeze Key',
    description: 'Cannot freeze/unfreeze because the token has no freeze key.',
    cause: 'The token was created without a freeze key.',
    solution: 'This token cannot freeze accounts. Create a new token with freezeKey enabled.',
    category: 'token',
  },
  TOKEN_HAS_NO_KYC_KEY: {
    code: 'TOKEN_HAS_NO_KYC_KEY',
    name: 'Token Has No KYC Key',
    description: 'Cannot grant/revoke KYC because the token has no KYC key.',
    cause: 'The token was created without a KYC key.',
    solution: 'This token cannot enforce KYC. Create a new token with kycKey enabled.',
    category: 'token',
  },
  TOKEN_HAS_NO_WIPE_KEY: {
    code: 'TOKEN_HAS_NO_WIPE_KEY',
    name: 'Token Has No Wipe Key',
    description: 'Cannot wipe tokens because the token has no wipe key.',
    cause: 'The token was created without a wipe key.',
    solution: 'This token cannot be wiped from accounts. Create a new token with wipeKey enabled.',
    category: 'token',
  },
  TOKEN_HAS_NO_PAUSE_KEY: {
    code: 'TOKEN_HAS_NO_PAUSE_KEY',
    name: 'Token Has No Pause Key',
    description: 'Cannot pause/unpause because the token has no pause key.',
    cause: 'The token was created without a pause key.',
    solution: 'This token cannot be paused. Create a new token with pauseKey enabled.',
    category: 'token',
  },
  TOKEN_IS_PAUSED: {
    code: 'TOKEN_IS_PAUSED',
    name: 'Token Is Paused',
    description: 'The token is currently paused and cannot be transferred.',
    cause: 'An admin has paused all operations on this token.',
    solution: 'Wait for the token to be unpaused or contact the token admin.',
    category: 'token',
  },
  ACCOUNT_FROZEN_FOR_TOKEN: {
    code: 'ACCOUNT_FROZEN_FOR_TOKEN',
    name: 'Account Frozen for Token',
    description: 'The account is frozen and cannot transfer this token.',
    cause: 'An admin has frozen this account for this specific token.',
    solution: 'Request unfreezing from the token admin.',
    category: 'token',
  },
  ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN: {
    code: 'ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN',
    name: 'KYC Not Granted',
    description: 'The account has not been granted KYC for this token.',
    cause: 'This token requires KYC and the account has not been verified.',
    solution: 'Grant KYC to the account using token_manage with operation: "kyc_grant".',
    category: 'token',
  },
  INSUFFICIENT_TOKEN_BALANCE: {
    code: 'INSUFFICIENT_TOKEN_BALANCE',
    name: 'Insufficient Token Balance',
    description: 'The account does not have enough tokens for this transfer.',
    cause: 'Trying to transfer more tokens than the account holds.',
    solution: 'Reduce the transfer amount or acquire more tokens.',
    category: 'token',
  },
  TOKEN_MAX_SUPPLY_REACHED: {
    code: 'TOKEN_MAX_SUPPLY_REACHED',
    name: 'Max Supply Reached',
    description: 'Cannot mint more tokens because max supply has been reached.',
    cause: 'The token has a finite supply and the maximum has been minted.',
    solution: 'Burn some tokens first or create a new token with higher max supply.',
    category: 'token',
  },

  // ============================================
  // Smart Contract Errors
  // ============================================
  CONTRACT_REVERT_EXECUTED: {
    code: 'CONTRACT_REVERT_EXECUTED',
    name: 'Contract Reverted',
    description: 'The smart contract execution reverted.',
    cause: 'The contract logic failed a require/revert condition.',
    solution:
      'Check contract inputs, verify conditions are met (e.g., ownership, balances, timing).',
    category: 'contract',
  },
  INVALID_CONTRACT_ID: {
    code: 'INVALID_CONTRACT_ID',
    name: 'Invalid Contract ID',
    description: 'The specified contract ID is invalid or does not exist.',
    cause: 'The contract ID format is wrong or the contract was deleted.',
    solution: 'Verify the contract ID format (0.0.xxxxx) or EVM address (0x...).',
    category: 'contract',
  },
  CONTRACT_DELETED: {
    code: 'CONTRACT_DELETED',
    name: 'Contract Deleted',
    description: 'The contract has been deleted.',
    cause: 'The contract was previously deleted by its admin.',
    solution: 'Deploy a new contract. Deleted contracts cannot be restored.',
    category: 'contract',
  },
  INSUFFICIENT_GAS: {
    code: 'INSUFFICIENT_GAS',
    name: 'Insufficient Gas',
    description: 'The transaction ran out of gas.',
    cause: 'The gas limit was too low for the contract operation.',
    solution: 'Increase the gas limit. Complex operations require more gas.',
    category: 'contract',
  },
  MAX_GAS_LIMIT_EXCEEDED: {
    code: 'MAX_GAS_LIMIT_EXCEEDED',
    name: 'Max Gas Limit Exceeded',
    description: 'The requested gas limit exceeds the maximum allowed.',
    cause: 'Gas limit is higher than the network maximum (15,000,000).',
    solution: 'Reduce the gas limit to below 15,000,000.',
    category: 'contract',
  },
  LOCAL_CALL_MODIFICATION_EXCEPTION: {
    code: 'LOCAL_CALL_MODIFICATION_EXCEPTION',
    name: 'Read-Only Call Modified State',
    description: 'A read-only call attempted to modify contract state.',
    cause: 'Using eth_call on a function that modifies state.',
    solution: 'Use eth_sendTransaction for state-changing functions.',
    category: 'contract',
  },

  // ============================================
  // Consensus Service (HCS) Errors
  // ============================================
  INVALID_TOPIC_ID: {
    code: 'INVALID_TOPIC_ID',
    name: 'Invalid Topic ID',
    description: 'The specified topic ID is invalid or does not exist.',
    cause: 'The topic ID format is wrong or the topic was deleted.',
    solution: 'Verify the topic ID format (0.0.xxxxx) and that it exists.',
    category: 'consensus',
  },
  TOPIC_EXPIRED: {
    code: 'TOPIC_EXPIRED',
    name: 'Topic Expired',
    description: 'The topic has expired and is no longer accepting messages.',
    cause: 'The topic auto-renew period has passed without renewal.',
    solution: 'Create a new topic or extend the auto-renew period before expiration.',
    category: 'consensus',
  },
  MESSAGE_SIZE_TOO_LARGE: {
    code: 'MESSAGE_SIZE_TOO_LARGE',
    name: 'Message Too Large',
    description: 'The message exceeds the maximum allowed size (1KB).',
    cause: 'Attempting to submit a message larger than 1024 bytes.',
    solution: 'Split the message into chunks of 1KB or less.',
    category: 'consensus',
  },
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    name: 'Unauthorized',
    description: 'Not authorized to perform this operation.',
    cause: 'The topic has a submit key and you are not signing with it.',
    solution: 'Provide the topic submit key when submitting messages.',
    category: 'consensus',
  },

  // ============================================
  // Transaction Errors
  // ============================================
  INVALID_TRANSACTION: {
    code: 'INVALID_TRANSACTION',
    name: 'Invalid Transaction',
    description: 'The transaction is invalid.',
    cause: 'The transaction format is incorrect or missing required fields.',
    solution: 'Verify all required transaction fields are provided correctly.',
    category: 'transaction',
  },
  INVALID_TRANSACTION_ID: {
    code: 'INVALID_TRANSACTION_ID',
    name: 'Invalid Transaction ID',
    description: 'The transaction ID is invalid.',
    cause: 'The transaction ID format is incorrect.',
    solution: 'Use the correct format: accountId@seconds.nanos',
    category: 'transaction',
  },
  TRANSACTION_EXPIRED: {
    code: 'TRANSACTION_EXPIRED',
    name: 'Transaction Expired',
    description: 'The transaction has expired before being processed.',
    cause: 'The transaction validity window (default 120 seconds) has passed.',
    solution: 'Create a new transaction with a fresh timestamp.',
    category: 'transaction',
  },
  DUPLICATE_TRANSACTION: {
    code: 'DUPLICATE_TRANSACTION',
    name: 'Duplicate Transaction',
    description: 'This transaction has already been submitted.',
    cause: 'A transaction with the same ID was already processed.',
    solution: 'Create a new transaction with a new transaction ID.',
    category: 'transaction',
  },
  BUSY: {
    code: 'BUSY',
    name: 'Network Busy',
    description: 'The network is currently busy. Try again later.',
    cause: 'High network load or temporary congestion.',
    solution: 'Wait a few seconds and retry the transaction.',
    category: 'network',
  },
  PLATFORM_NOT_ACTIVE: {
    code: 'PLATFORM_NOT_ACTIVE',
    name: 'Platform Not Active',
    description: 'The Hedera network is not currently active.',
    cause: 'Network maintenance or outage.',
    solution: 'Check https://status.hedera.com for network status.',
    category: 'network',
  },

  // ============================================
  // Network and Rate Limiting Errors
  // ============================================
  THROTTLED_AT_CONSENSUS: {
    code: 'THROTTLED_AT_CONSENSUS',
    name: 'Throttled at Consensus',
    description: 'The transaction was throttled by the network.',
    cause: 'Too many transactions submitted too quickly.',
    solution: 'Reduce transaction frequency or implement exponential backoff.',
    category: 'network',
  },
  MAX_CHILD_RECORDS_EXCEEDED: {
    code: 'MAX_CHILD_RECORDS_EXCEEDED',
    name: 'Max Child Records Exceeded',
    description: 'The transaction created too many child records.',
    cause: 'Complex transaction with too many internal operations.',
    solution: 'Split the operation into multiple smaller transactions.',
    category: 'transaction',
  },

  // ============================================
  // Additional Common Errors
  // ============================================
  EMPTY_TOKEN_TRANSFER_BODY: {
    code: 'EMPTY_TOKEN_TRANSFER_BODY',
    name: 'Empty Token Transfer Body',
    description: 'The token transfer transaction has no transfers specified.',
    cause: 'Token transfer was submitted without any actual transfer entries.',
    solution: 'Add at least one token transfer (from/to/amount) to the transaction.',
    category: 'token',
  },
  INVALID_RECEIVING_NODE_ACCOUNT: {
    code: 'INVALID_RECEIVING_NODE_ACCOUNT',
    name: 'Invalid Receiving Node Account',
    description: 'The specified node account is invalid.',
    cause: 'Transaction was submitted to a non-existent or invalid node.',
    solution: 'Use a valid node account ID. The SDK handles this automatically.',
    category: 'network',
  },
  PAYER_ACCOUNT_NOT_FOUND: {
    code: 'PAYER_ACCOUNT_NOT_FOUND',
    name: 'Payer Account Not Found',
    description: 'The payer account does not exist.',
    cause: 'The HEDERA_OPERATOR_ID account does not exist on the network.',
    solution: 'Verify HEDERA_OPERATOR_ID is correct and exists on the current network.',
    category: 'account',
  },
  INVALID_AUTORENEW_PERIOD: {
    code: 'INVALID_AUTORENEW_PERIOD',
    name: 'Invalid Auto-Renew Period',
    description: 'The auto-renew period is outside allowed bounds.',
    cause: 'Auto-renew must be between 30 days and 90 days (in seconds).',
    solution: 'Set auto-renew period between 2592000 (30 days) and 7776000 (90 days) seconds.',
    category: 'transaction',
  },
  MEMO_TOO_LONG: {
    code: 'MEMO_TOO_LONG',
    name: 'Memo Too Long',
    description: 'The memo exceeds the maximum allowed length.',
    cause: 'Memos cannot exceed 100 bytes.',
    solution: 'Shorten the memo to 100 bytes or less.',
    category: 'transaction',
  },
  INVALID_ZERO_BYTE_IN_STRING: {
    code: 'INVALID_ZERO_BYTE_IN_STRING',
    name: 'Invalid Zero Byte in String',
    description: 'The string contains invalid null bytes.',
    cause: 'Memos and other string fields cannot contain null (0x00) characters.',
    solution: 'Remove null bytes from the string.',
    category: 'transaction',
  },
  AUTORENEW_DURATION_NOT_IN_RANGE: {
    code: 'AUTORENEW_DURATION_NOT_IN_RANGE',
    name: 'Auto-Renew Duration Not in Range',
    description: 'The auto-renew duration is outside the valid range.',
    cause: 'Duration must be between 30 and 90 days.',
    solution: 'Set duration between 2592000 and 7776000 seconds.',
    category: 'transaction',
  },
  INVALID_ACCOUNT_AMOUNTS: {
    code: 'INVALID_ACCOUNT_AMOUNTS',
    name: 'Invalid Account Amounts',
    description: 'The transfer amounts do not balance to zero.',
    cause: 'Total debits must equal total credits in a transfer.',
    solution: 'Ensure sum of all transfers equals zero (debits = credits).',
    category: 'account',
  },
  RECORD_NOT_FOUND: {
    code: 'RECORD_NOT_FOUND',
    name: 'Record Not Found',
    description: 'The transaction record was not found.',
    cause: 'The transaction may have expired or the ID is invalid.',
    solution: 'Check the transaction ID and retry. Records expire after 3 minutes.',
    category: 'transaction',
  },
  RECEIPT_NOT_FOUND: {
    code: 'RECEIPT_NOT_FOUND',
    name: 'Receipt Not Found',
    description: 'The transaction receipt was not found.',
    cause: 'The transaction may still be processing or the ID is invalid.',
    solution: 'Wait for the transaction to complete and retry.',
    category: 'transaction',
  },
  INVALID_FEE_SUBMITTED: {
    code: 'INVALID_FEE_SUBMITTED',
    name: 'Invalid Fee Submitted',
    description: 'The submitted fee is invalid.',
    cause: 'The transaction fee is too low or incorrectly formatted.',
    solution: 'Let the SDK calculate fees automatically, or increase max fee.',
    category: 'transaction',
  },
  INSUFFICIENT_TX_FEE: {
    code: 'INSUFFICIENT_TX_FEE',
    name: 'Insufficient Transaction Fee',
    description: 'The transaction fee is insufficient.',
    cause: 'The max transaction fee is lower than required.',
    solution: 'Increase the max transaction fee for this operation.',
    category: 'transaction',
  },
  INVALID_ACCOUNT_ID: {
    code: 'INVALID_ACCOUNT_ID',
    name: 'Invalid Account ID',
    description:
      'The account ID is malformed or refers to an account that does not exist on this network.',
    cause:
      'The ID is not in shard.realm.num form (for example 0.0.12345), was copied from a different network, or the account was never created.',
    solution:
      'Use the 0.0.x form and check the account exists on the current network with account_info; switch networks with network_switch if it was created elsewhere.',
    category: 'account',
  },
  INVALID_TRANSACTION_START: {
    code: 'INVALID_TRANSACTION_START',
    name: 'Invalid Transaction Start',
    description: 'The transaction start time is outside the window the network accepts.',
    cause: 'The local clock is skewed, or a transaction was built long before it was submitted.',
    solution:
      'Sync the system clock (NTP) and build transactions immediately before executing them.',
    category: 'transaction',
  },
  INVALID_TOKEN_MINT_AMOUNT: {
    code: 'INVALID_TOKEN_MINT_AMOUNT',
    name: 'Invalid Token Mint Amount',
    description: 'The mint amount is not valid for this token.',
    cause:
      'Minting zero or a negative amount, minting units for an NFT collection instead of metadata, or exceeding the maximum supply of a finite token.',
    solution:
      'Mint a positive amount within the remaining supply; for NFTs pass metadata entries instead of an amount.',
    category: 'token',
  },
};

/**
 * Get human-readable error information for a Hedera error code
 */
export function getErrorInfo(errorCode: string): ErrorInfo | undefined {
  // Normalize the error code (handle variations)
  const normalizedCode = errorCode
    .toUpperCase()
    .replace(/^STATUS_/, '')
    .replace(/-/g, '_');

  return HEDERA_ERROR_CODES[normalizedCode];
}

/**
 * Get all error codes for a specific category
 */
export function getErrorsByCategory(category: ErrorInfo['category']): ErrorInfo[] {
  return Object.values(HEDERA_ERROR_CODES).filter((error) => error.category === category);
}

/**
 * Search error codes by keyword
 */
export function searchErrors(keyword: string): ErrorInfo[] {
  const lowerKeyword = keyword.toLowerCase();
  return Object.values(HEDERA_ERROR_CODES).filter(
    (error) =>
      error.name.toLowerCase().includes(lowerKeyword) ||
      error.description.toLowerCase().includes(lowerKeyword) ||
      error.cause.toLowerCase().includes(lowerKeyword) ||
      error.solution.toLowerCase().includes(lowerKeyword)
  );
}

/**
 * Format error information for display
 */
export function formatErrorInfo(error: ErrorInfo): string {
  return `
**${error.name}** (${error.code})

**Description:** ${error.description}

**Cause:** ${error.cause}

**Solution:** ${error.solution}

**Category:** ${error.category}
`.trim();
}

/**
 * Extract error code from various error message formats
 */
export function extractErrorCode(errorMessage: string): string | undefined {
  // Common patterns for Hedera error codes in error messages
  const patterns = [
    /Status:\s*(\w+)/i,
    /status\s*=\s*(\w+)/i,
    /ResponseCode:\s*(\w+)/i,
    /HEDERA_(\w+)/i,
    /Status\.(\w+)/i,
    /precheck:\s*(\w+)/i,
    /receipt:\s*(\w+)/i,
  ];

  for (const pattern of patterns) {
    const match = errorMessage.match(pattern);
    if (match && match[1]) {
      const code = match[1].toUpperCase();
      if (HEDERA_ERROR_CODES[code]) {
        return code;
      }
    }
  }

  // Also check if any known error code is present in the message
  for (const code of Object.keys(HEDERA_ERROR_CODES)) {
    if (errorMessage.toUpperCase().includes(code)) {
      return code;
    }
  }

  return undefined;
}
