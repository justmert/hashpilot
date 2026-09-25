/**
 * Hedera Client Service
 * Handles all Hedera SDK operations and client management
 */

import {
  Client,
  AccountId,
  PrivateKey,
  TransferTransaction,
  AccountCreateTransaction,
  Hbar,
  HbarUnit,
  Key,
  KeyList,
  PublicKey,
  CustomFee,
  CustomFixedFee,
  CustomFractionalFee,
  CustomRoyaltyFee,
  FeeAssessmentMethod,
  TokenCreateTransaction,
  TokenAssociateTransaction,
  TokenMintTransaction,
  TokenBurnTransaction,
  TokenFreezeTransaction,
  TokenUnfreezeTransaction,
  TokenGrantKycTransaction,
  TokenRevokeKycTransaction,
  TokenSupplyType,
  TokenType,
  TokenWipeTransaction,
  TokenPauseTransaction,
  TokenUnpauseTransaction,
  TokenId,
  TopicCreateTransaction,
  TopicUpdateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
  Transaction,
  TransactionResponse,
} from '@hashgraph/sdk';
import { getHederaConfig } from '../utils/config.js';
import logger from '../utils/logger.js';
import { HederaConfig, SUPPORTED_NETWORKS, isSupportedNetwork } from '../types/index.js';
import { stateService } from './state.js';
import { mirrorNodeService } from './mirror-node-service.js';
import { parseOperatorKey, parsePrivateKey } from '../utils/key-converter.js';

type NetworkName = 'mainnet' | 'testnet' | 'previewnet' | 'local';

/** Account key as reported by the mirror node */
interface MirrorAccountKey {
  type: 'ED25519' | 'ECDSA_SECP256K1' | 'complex';
  key: string;
}

/**
 * Parse mirror node JSON while keeping tinybar balances exact.
 * JSON.parse would round balances above 2^53 tinybars (about 90M HBAR).
 */
function parseMirrorJson(text: string): any {
  return JSON.parse(text.replace(/"balance":\s*(\d{16,})/g, '"balance":"$1"'));
}

/**
 * How a key parameter may be supplied.
 *
 * - `true`   use the operator's public key (the original behaviour)
 * - `false`  do not set the key at all
 * - string   an explicit public key, DER-encoded or raw hex
 * - object   an `m of n` threshold key list, for multi-signature control
 */
export type KeySpec = boolean | string | { threshold: number; keys: string[] };

/** One entry of the `customFees` array accepted by token creation */
export interface CustomFeeSpec {
  /** fixed | fractional | royalty */
  type?: 'fixed' | 'fractional' | 'royalty';
  /** Accepted alias for `type` */
  feeType?: 'fixed' | 'fractional' | 'royalty';
  feeCollectorAccountId: string;
  allCollectorsAreExempt?: boolean;
  /** Fixed fee: units of the denominating token, or tinybars when there is none */
  amount?: number;
  denominatingTokenId?: string;
  numerator?: number;
  denominator?: number;
  minimumAmount?: number;
  maximumAmount?: number;
  /** Accepted alias for minimumAmount */
  min?: number;
  /** Accepted alias for maximumAmount */
  max?: number;
  assessmentMethod?: 'inclusive' | 'exclusive';
  /** Royalty fee only: charged when a transfer carries no fungible value */
  fallbackFee?: number | { amount: number; denominatingTokenId?: string };
}

/** Options understood by `buildTokenCreateTransaction` and `createToken` */
export interface TokenCreateOptions {
  name: string;
  symbol: string;
  decimals?: number;
  initialSupply?: number;
  treasuryAccountId?: string;
  treasuryPrivateKey?: string;
  tokenType?: string;
  supplyType?: string;
  maxSupply?: number;
  adminKey?: KeySpec;
  kycKey?: KeySpec;
  freezeKey?: KeySpec;
  wipeKey?: KeySpec;
  supplyKey?: KeySpec;
  pauseKey?: KeySpec;
  feeScheduleKey?: KeySpec;
  freezeDefault?: boolean;
  customFees?: CustomFeeSpec[];
  memo?: string;
  signerPrivateKeys?: string[];
}

/** Filters accepted by the mirror node topic-message query */
export interface TopicMessageQueryOptions {
  /** Exact sequence number */
  sequenceNumber?: number;
  sequenceNumberGt?: number;
  sequenceNumberGte?: number;
  sequenceNumberLt?: number;
  sequenceNumberLte?: number;
  /** Raw mirror node timestamp filter, e.g. `gte:1700000000.000000000` */
  timestamp?: string;
  /** Consensus timestamp lower bound (inclusive) */
  timestampFrom?: string;
  /** Consensus timestamp upper bound (inclusive) */
  timestampTo?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

/**
 * JSON Schema fragment describing a {@link KeySpec}, for MCP tool inputSchemas.
 * Kept next to the type so the two cannot drift apart.
 */
export const KEY_SPEC_SCHEMA = {
  anyOf: [
    { type: 'boolean', description: 'true = use the operator key, false = do not set this key' },
    { type: 'string', description: 'An explicit public key, DER-encoded or raw hex' },
    {
      type: 'object',
      description: 'A threshold key list: any `threshold` of `keys` must sign',
      properties: {
        threshold: {
          type: 'number',
          description: 'How many of the keys must sign (1..keys.length)',
        },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Public keys, DER-encoded or raw hex',
        },
      },
      required: ['threshold', 'keys'],
    },
  ],
} as const;

/** JSON Schema fragment describing the `customFees` array */
export const CUSTOM_FEES_SCHEMA = {
  type: 'array',
  description:
    'Custom fees charged on every transfer. Fixed and fractional fees apply to fungible tokens; royalty fees apply to non-fungible tokens.',
  items: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['fixed', 'fractional', 'royalty'],
        description: 'Fee kind (alias: feeType)',
      },
      feeType: {
        type: 'string',
        enum: ['fixed', 'fractional', 'royalty'],
        description: 'Alias for type',
      },
      feeCollectorAccountId: {
        type: 'string',
        description: 'Account that receives the fee (format: 0.0.xxxxx)',
      },
      allCollectorsAreExempt: {
        type: 'boolean',
        description: 'Exempt all fee collectors of this token from paying this fee',
      },
      amount: {
        type: 'number',
        description:
          'Fixed fee: units of denominatingTokenId, or tinybars when denominatingTokenId is omitted',
      },
      denominatingTokenId: {
        type: 'string',
        description: 'Fixed fee: token the fee is charged in. 0.0.0 means the token being created.',
      },
      numerator: { type: 'number', description: 'Fractional/royalty fee: numerator' },
      denominator: { type: 'number', description: 'Fractional/royalty fee: denominator' },
      minimumAmount: {
        type: 'number',
        description: 'Fractional fee: minimum charged (alias: min)',
      },
      maximumAmount: {
        type: 'number',
        description: 'Fractional fee: maximum charged, 0 for no cap (alias: max)',
      },
      min: { type: 'number', description: 'Alias for minimumAmount' },
      max: { type: 'number', description: 'Alias for maximumAmount' },
      assessmentMethod: {
        type: 'string',
        enum: ['inclusive', 'exclusive'],
        description:
          'Fractional fee: inclusive takes the fee out of the transferred amount, exclusive charges the sender on top',
      },
      fallbackFee: {
        description:
          'Royalty fee: fixed fee charged when a transfer carries no fungible value. A number (tinybars) or { amount, denominatingTokenId }.',
        anyOf: [
          { type: 'number' },
          {
            type: 'object',
            properties: {
              amount: { type: 'number' },
              denominatingTokenId: { type: 'string' },
            },
            required: ['amount'],
          },
        ],
      },
    },
    required: ['feeCollectorAccountId'],
  },
} as const;

/** Turn one NFT metadata string into the bytes the network stores */
export function decodeMetadata(
  entry: string,
  encoding: 'utf8' | 'base64' | 'hex' = 'utf8'
): Uint8Array {
  if (typeof entry !== 'string') {
    throw new Error('metadata entries must be strings');
  }
  switch (encoding) {
    case 'utf8':
      return Buffer.from(entry, 'utf-8');
    case 'base64':
      return Buffer.from(entry, 'base64');
    case 'hex':
      return Buffer.from(entry.startsWith('0x') ? entry.slice(2) : entry, 'hex');
    default:
      throw new Error(`metadataEncoding must be "utf8", "base64" or "hex" (got ${encoding})`);
  }
}

/** Validate an array of NFT serial numbers */
export function normaliseSerials(serials: number[], label = 'serialNumbers'): number[] {
  if (!Array.isArray(serials) || serials.length === 0) {
    throw new Error(`${label} must be a non-empty array of serial numbers`);
  }
  return serials.map((serial) => {
    if (!Number.isInteger(serial) || serial < 1) {
      throw new Error(
        `${label} entries must be whole numbers of 1 or more (got ${String(serial)})`
      );
    }
    return serial;
  });
}

/** Parse a public key supplied as DER hex or raw hex */
export function parsePublicKeySpec(value: string, label: string): PublicKey {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    throw new Error(`${label}: public key string is empty`);
  }
  try {
    return PublicKey.fromString(trimmed);
  } catch (error) {
    throw new Error(
      `${label}: could not read "${trimmed.slice(0, 24)}" as a public key (expected DER or raw hex): ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Turn a key parameter into an SDK key.
 *
 * Returns undefined when the key should not be set, so callers can write
 * `const key = resolveKey(spec, operatorKey, 'adminKey'); if (key) tx.setAdminKey(key);`
 */
export function resolveKey(
  spec: KeySpec | undefined | null,
  operatorKey: PublicKey | null | undefined,
  label = 'key'
): Key | undefined {
  if (spec === undefined || spec === null) {
    return undefined;
  }

  if (typeof spec === 'boolean') {
    if (!spec) {
      return undefined;
    }
    if (!operatorKey) {
      throw new Error(
        `${label}: no operator key is configured, so the operator key cannot be used. ` +
          'Configure HEDERA_OPERATOR_KEY, or pass an explicit public key string instead of true.'
      );
    }
    return operatorKey;
  }

  if (typeof spec === 'string') {
    return parsePublicKeySpec(spec, label);
  }

  if (typeof spec === 'object' && Array.isArray((spec as { keys?: unknown }).keys)) {
    const { threshold, keys } = spec;
    if (keys.length === 0) {
      throw new Error(`${label}: keys must contain at least one public key`);
    }
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > keys.length) {
      throw new Error(
        `${label}: threshold must be a whole number between 1 and ${keys.length} (got ${String(threshold)})`
      );
    }
    const list = new KeyList(keys.map((key, i) => parsePublicKeySpec(key, `${label}.keys[${i}]`)));
    list.setThreshold(threshold);
    return list;
  }

  throw new Error(
    `${label}: expected true/false, a public key string, or { threshold, keys: [...] }`
  );
}

/** Validate a numeric fee field and return it */
function requireFeeNumber(value: unknown, label: string, options: { min?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} is required and must be a number`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be a whole number`);
  }
  const min = options.min ?? 0;
  if (value < min) {
    throw new Error(`${label} must be ${min} or greater (got ${value})`);
  }
  return value;
}

/**
 * Build SDK custom fee objects from the JSON-friendly `customFees` array.
 */
export function buildCustomFees(specs: CustomFeeSpec[]): CustomFee[] {
  if (!Array.isArray(specs)) {
    throw new Error('customFees must be an array of fee objects');
  }

  return specs.map((spec, index) => {
    const label = `customFees[${index}]`;
    if (!spec || typeof spec !== 'object') {
      throw new Error(`${label} must be an object`);
    }

    const kind = spec.type ?? spec.feeType;
    if (!spec.feeCollectorAccountId) {
      throw new Error(`${label}.feeCollectorAccountId is required`);
    }

    let fee: CustomFee;
    switch (kind) {
      case 'fixed': {
        const fixed = new CustomFixedFee().setAmount(
          requireFeeNumber(spec.amount, `${label}.amount`, { min: 1 })
        );
        if (spec.denominatingTokenId) {
          fixed.setDenominatingTokenId(TokenId.fromString(String(spec.denominatingTokenId)));
        }
        fee = fixed;
        break;
      }

      case 'fractional': {
        const fractional = new CustomFractionalFee()
          .setNumerator(
            requireFeeNumber(spec.numerator ?? spec.amount, `${label}.numerator`, { min: 1 })
          )
          .setDenominator(requireFeeNumber(spec.denominator, `${label}.denominator`, { min: 1 }));

        const minimum = spec.minimumAmount ?? spec.min;
        const maximum = spec.maximumAmount ?? spec.max;
        if (minimum !== undefined) {
          fractional.setMin(requireFeeNumber(minimum, `${label}.minimumAmount`));
        }
        if (maximum !== undefined) {
          fractional.setMax(requireFeeNumber(maximum, `${label}.maximumAmount`));
        }
        if (spec.assessmentMethod !== undefined) {
          if (spec.assessmentMethod !== 'inclusive' && spec.assessmentMethod !== 'exclusive') {
            throw new Error(
              `${label}.assessmentMethod must be "inclusive" or "exclusive" (got ${String(spec.assessmentMethod)})`
            );
          }
          fractional.setAssessmentMethod(
            spec.assessmentMethod === 'inclusive'
              ? FeeAssessmentMethod.Inclusive
              : FeeAssessmentMethod.Exclusive
          );
        }
        fee = fractional;
        break;
      }

      case 'royalty': {
        const royalty = new CustomRoyaltyFee()
          .setNumerator(requireFeeNumber(spec.numerator, `${label}.numerator`, { min: 1 }))
          .setDenominator(requireFeeNumber(spec.denominator, `${label}.denominator`, { min: 1 }));

        if (spec.fallbackFee !== undefined && spec.fallbackFee !== null) {
          const fallbackSpec =
            typeof spec.fallbackFee === 'number' ? { amount: spec.fallbackFee } : spec.fallbackFee;
          const fallback = new CustomFixedFee().setAmount(
            requireFeeNumber(fallbackSpec.amount, `${label}.fallbackFee.amount`, { min: 1 })
          );
          if (fallbackSpec.denominatingTokenId) {
            fallback.setDenominatingTokenId(
              TokenId.fromString(String(fallbackSpec.denominatingTokenId))
            );
          }
          royalty.setFallbackFee(fallback);
        }
        fee = royalty;
        break;
      }

      default:
        throw new Error(
          `${label}.type must be one of "fixed", "fractional" or "royalty" (got ${String(kind)})`
        );
    }

    fee.setFeeCollectorAccountId(AccountId.fromString(String(spec.feeCollectorAccountId)));
    if (spec.allCollectorsAreExempt !== undefined) {
      fee.setAllCollectorsAreExempt(Boolean(spec.allCollectorsAreExempt));
    }
    return fee;
  });
}

/** Map the `tokenType` parameter onto the SDK enum */
export function resolveTokenType(value?: string): TokenType {
  const normalised = String(value ?? 'fungible')
    .trim()
    .toLowerCase();
  switch (normalised) {
    case '':
    case 'fungible':
    case 'ft':
    case 'fungible_common':
    case 'fungiblecommon':
      return TokenType.FungibleCommon;
    case 'nft':
    case 'non_fungible':
    case 'non_fungible_unique':
    case 'nonfungibleunique':
      return TokenType.NonFungibleUnique;
    default:
      throw new Error(`tokenType must be "fungible" or "nft" (got ${String(value)})`);
  }
}

/** Map the `supplyType` parameter onto the SDK enum */
export function resolveSupplyType(value?: string): TokenSupplyType {
  const normalised = String(value ?? 'infinite')
    .trim()
    .toLowerCase();
  switch (normalised) {
    case '':
    case 'infinite':
      return TokenSupplyType.Infinite;
    case 'finite':
      return TokenSupplyType.Finite;
    default:
      throw new Error(`supplyType must be "finite" or "infinite" (got ${String(value)})`);
  }
}

/**
 * Configure a TokenCreateTransaction from plain options.
 *
 * Kept separate from execution so the whole configuration path can be tested
 * without a network or a funded account.
 */
export function buildTokenCreateTransaction(
  options: TokenCreateOptions,
  context: { operatorPublicKey?: PublicKey | null; treasuryAccountId: string }
): TokenCreateTransaction {
  if (!options.name || !String(options.name).trim()) {
    throw new Error('Token name is required');
  }
  if (!options.symbol || !String(options.symbol).trim()) {
    throw new Error('Token symbol is required');
  }
  if (!context.treasuryAccountId) {
    throw new Error(
      'Treasury account ID required. Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY, or pass treasuryAccountId.'
    );
  }

  const operatorKey = context.operatorPublicKey ?? null;
  const tokenType = resolveTokenType(options.tokenType);
  const isNft = tokenType === TokenType.NonFungibleUnique;

  const decimals = options.decimals ?? 0;
  const initialSupply = options.initialSupply ?? (isNft ? 0 : 1000);

  if (isNft && decimals !== 0) {
    throw new Error('A non-fungible token must have decimals 0');
  }
  if (isNft && initialSupply !== 0) {
    throw new Error(
      'A non-fungible token must have initialSupply 0; mint serials after creation with operation "mint" and a metadata array'
    );
  }

  const supplyType = resolveSupplyType(
    options.supplyType ?? (options.maxSupply !== undefined ? 'finite' : 'infinite')
  );
  if (supplyType === TokenSupplyType.Finite) {
    if (options.maxSupply === undefined) {
      throw new Error('supplyType "finite" requires maxSupply');
    }
    if (!Number.isInteger(options.maxSupply) || options.maxSupply <= 0) {
      throw new Error(`maxSupply must be a whole number greater than 0 (got ${options.maxSupply})`);
    }
    if (options.maxSupply < initialSupply) {
      throw new Error(
        `maxSupply (${options.maxSupply}) must be at least initialSupply (${initialSupply})`
      );
    }
  } else if (options.maxSupply !== undefined) {
    throw new Error('maxSupply is only valid with supplyType "finite"');
  }

  const transaction = new TokenCreateTransaction()
    .setTokenName(options.name)
    .setTokenSymbol(options.symbol)
    .setTokenType(tokenType)
    .setDecimals(decimals)
    .setInitialSupply(initialSupply)
    .setTreasuryAccountId(context.treasuryAccountId)
    .setSupplyType(supplyType);

  if (supplyType === TokenSupplyType.Finite && options.maxSupply !== undefined) {
    transaction.setMaxSupply(options.maxSupply);
  }

  const adminKey = resolveKey(options.adminKey, operatorKey, 'adminKey');
  if (adminKey) transaction.setAdminKey(adminKey);

  const kycKey = resolveKey(options.kycKey, operatorKey, 'kycKey');
  if (kycKey) transaction.setKycKey(kycKey);

  const freezeKey = resolveKey(options.freezeKey, operatorKey, 'freezeKey');
  if (freezeKey) transaction.setFreezeKey(freezeKey);

  const wipeKey = resolveKey(options.wipeKey, operatorKey, 'wipeKey');
  if (wipeKey) transaction.setWipeKey(wipeKey);

  // Supply key defaults to the operator key so mint/burn keep working
  const supplyKey = resolveKey(options.supplyKey ?? true, operatorKey, 'supplyKey');
  if (supplyKey) transaction.setSupplyKey(supplyKey);

  const pauseKey = resolveKey(options.pauseKey, operatorKey, 'pauseKey');
  if (pauseKey) transaction.setPauseKey(pauseKey);

  const feeScheduleKey = resolveKey(options.feeScheduleKey, operatorKey, 'feeScheduleKey');
  if (feeScheduleKey) transaction.setFeeScheduleKey(feeScheduleKey);

  if (options.freezeDefault !== undefined) {
    if (!freezeKey) {
      throw new Error('freezeDefault requires a freezeKey on the token');
    }
    transaction.setFreezeDefault(Boolean(options.freezeDefault));
  }

  if (options.customFees && options.customFees.length > 0) {
    const fees = buildCustomFees(options.customFees);
    for (const [index, fee] of fees.entries()) {
      if (fee instanceof CustomRoyaltyFee && !isNft) {
        throw new Error(
          `customFees[${index}]: royalty fees are only valid on non-fungible tokens (set tokenType "nft")`
        );
      }
      if (fee instanceof CustomFractionalFee && isNft) {
        throw new Error(
          `customFees[${index}]: fractional fees are only valid on fungible tokens; use a royalty fee for an NFT`
        );
      }
    }
    transaction.setCustomFees(fees);
  }

  if (options.memo) {
    transaction.setTokenMemo(options.memo);
  }

  return transaction;
}

/** Configure a TopicCreateTransaction from plain options */
export function buildTopicCreateTransaction(
  options: {
    memo?: string;
    adminKey?: KeySpec;
    submitKey?: KeySpec;
    autoRenewPeriod?: number;
    autoRenewAccountId?: string;
  },
  operatorPublicKey?: PublicKey | null
): TopicCreateTransaction {
  const transaction = new TopicCreateTransaction();

  if (options.memo) {
    transaction.setTopicMemo(options.memo);
  }

  const adminKey = resolveKey(options.adminKey, operatorPublicKey, 'adminKey');
  if (adminKey) transaction.setAdminKey(adminKey);

  const submitKey = resolveKey(options.submitKey, operatorPublicKey, 'submitKey');
  if (submitKey) transaction.setSubmitKey(submitKey);

  if (options.autoRenewAccountId) {
    transaction.setAutoRenewAccountId(options.autoRenewAccountId);
  }

  // Default auto-renew period: 90 days (7776000 seconds)
  transaction.setAutoRenewPeriod(options.autoRenewPeriod || 7776000);

  return transaction;
}

/** Configure a TopicUpdateTransaction from plain options */
export function buildTopicUpdateTransaction(
  topicId: string,
  options: {
    memo?: string;
    adminKey?: KeySpec;
    submitKey?: KeySpec;
    clearAdminKey?: boolean;
    clearSubmitKey?: boolean;
    autoRenewPeriod?: number;
    autoRenewAccountId?: string;
  },
  operatorPublicKey?: PublicKey | null
): TopicUpdateTransaction {
  const transaction = new TopicUpdateTransaction().setTopicId(TopicId.fromString(topicId));

  if (options.memo !== undefined) {
    transaction.setTopicMemo(options.memo);
  }

  if (options.clearAdminKey && options.adminKey !== undefined) {
    throw new Error('Pass either adminKey or clearAdminKey, not both');
  }
  if (options.clearSubmitKey && options.submitKey !== undefined) {
    throw new Error('Pass either submitKey or clearSubmitKey, not both');
  }

  // Hedera removes a key when the update carries an empty key list. The SDK's
  // clearAdminKey()/clearSubmitKey() only unset the local field, which makes
  // the update omit the key and leave it unchanged on the network.
  if (options.clearAdminKey) {
    transaction.setAdminKey(new KeyList());
  } else {
    const adminKey = resolveKey(options.adminKey, operatorPublicKey, 'adminKey');
    if (adminKey) transaction.setAdminKey(adminKey);
  }

  if (options.clearSubmitKey) {
    transaction.setSubmitKey(new KeyList());
  } else {
    const submitKey = resolveKey(options.submitKey, operatorPublicKey, 'submitKey');
    if (submitKey) transaction.setSubmitKey(submitKey);
  }

  if (options.autoRenewAccountId) {
    transaction.setAutoRenewAccountId(options.autoRenewAccountId);
  }

  if (options.autoRenewPeriod !== undefined) {
    transaction.setAutoRenewPeriod(options.autoRenewPeriod);
  }

  return transaction;
}

/**
 * Build the mirror node REST path for a topic message query, including the
 * sequence-number and timestamp filters.
 *
 * The mirror node accepts `sequencenumber=gt:5` style operators and repeated
 * parameters to express a range.
 */
export function buildTopicMessageQuery(
  topicId: string,
  options: TopicMessageQueryOptions = {}
): string {
  if (!topicId || !String(topicId).trim()) {
    throw new Error('topicId is required');
  }

  const params = new URLSearchParams();

  const appendSequence = (value: number | undefined, operator: string, label: string): void => {
    if (value === undefined || value === null) return;
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${label} must be a whole number of 0 or more (got ${String(value)})`);
    }
    params.append('sequencenumber', operator ? `${operator}:${value}` : String(value));
  };

  appendSequence(options.sequenceNumber, '', 'sequenceNumber');
  appendSequence(options.sequenceNumberGt, 'gt', 'sequenceNumberGt');
  appendSequence(options.sequenceNumberGte, 'gte', 'sequenceNumberGte');
  appendSequence(options.sequenceNumberLt, 'lt', 'sequenceNumberLt');
  appendSequence(options.sequenceNumberLte, 'lte', 'sequenceNumberLte');

  if (options.timestamp) {
    params.append('timestamp', String(options.timestamp));
  }
  if (options.timestampFrom) {
    params.append('timestamp', `gte:${options.timestampFrom}`);
  }
  if (options.timestampTo) {
    params.append('timestamp', `lte:${options.timestampTo}`);
  }

  if (options.limit !== undefined) {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      throw new Error(`limit must be a whole number between 1 and 100 (got ${options.limit})`);
    }
    params.append('limit', String(options.limit));
  }

  if (options.order !== undefined) {
    if (options.order !== 'asc' && options.order !== 'desc') {
      throw new Error(`order must be "asc" or "desc" (got ${String(options.order)})`);
    }
    params.append('order', options.order);
  }

  const query = params.toString();
  const path = `/api/v1/topics/${encodeURIComponent(topicId)}/messages`;
  return query ? `${path}?${query}` : path;
}

export class HederaClientService {
  private client: Client | null = null;
  private config: HederaConfig;
  private currentNetwork: NetworkName;
  /** Network named in the environment; URL overrides only apply to it */
  private readonly configuredNetwork: NetworkName;
  /**
   * Why the operator could not be set, if it could not. Free Mirror Node
   * reads still work in that state; anything that needs to sign throws this.
   */
  private operatorError: string | null = null;

  constructor() {
    this.config = getHederaConfig();
    this.currentNetwork = this.config.network;
    this.configuredNetwork = this.config.network;
  }

  /**
   * Initialize Hedera client with operator credentials
   */
  async initialize(): Promise<void> {
    try {
      // Load network from state if available
      const savedNetwork = await stateService.loadNetworkState();
      if (savedNetwork && isSupportedNetwork(savedNetwork)) {
        this.currentNetwork = savedNetwork;
        this.config.network = savedNetwork;
        logger.info('Loaded network from state', { network: savedNetwork });
      } else if (savedNetwork) {
        // Recover rather than refuse to start: a state file written by an older
        // build (or hand-edited) must not be able to brick the server.
        logger.warn('Ignoring unsupported network in saved state', {
          savedNetwork,
          using: this.currentNetwork,
        });
      }
      mirrorNodeService.switchNetwork(this.currentNetwork);

      logger.info('Initializing Hedera client', { network: this.currentNetwork });

      // Create client based on network
      switch (this.currentNetwork) {
        case 'mainnet':
          this.client = Client.forMainnet();
          break;
        case 'testnet':
          this.client = Client.forTestnet();
          break;
        case 'previewnet':
          this.client = Client.forPreviewnet();
          break;
        case 'local':
          // For local network, set custom nodes
          this.client = Client.forNetwork({
            '127.0.0.1:50211': new AccountId(3),
          });
          break;
        default:
          throw new Error(`Unknown network: ${this.currentNetwork}`);
      }

      // Set operator if credentials are provided
      this.operatorError = null;
      if (this.config.operatorId && this.config.operatorKey) {
        try {
          const operatorId = AccountId.fromString(this.config.operatorId);
          const operatorKey = await this.resolveOperatorKey(operatorId, this.config.operatorKey);
          this.client.setOperator(operatorId, operatorKey);
          logger.info('Hedera client operator set', {
            operatorId: this.config.operatorId,
            keyType: operatorKey.type,
          });
        } catch (error) {
          // A bad operator key must not take down the free Mirror Node reads
          // (balances, account info, topic messages), which need no operator.
          // Record it and fail only where a signature is actually required.
          this.operatorError = error instanceof Error ? error.message : String(error);
          logger.error(
            'Operator credentials unusable; signing operations will fail, read-only tools still work',
            { operatorId: this.config.operatorId, error: this.operatorError }
          );
        }
      } else {
        logger.warn('No operator credentials provided - some operations will not be available');
      }

      logger.info('Hedera client initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Hedera client', { error });
      throw error;
    }
  }

  /**
   * Parse the operator key and check it against the account's key on the
   * mirror node. A raw hex key carries no curve information, so if the
   * default (ECDSA) does not match the account, the ED25519 reading is tried
   * before giving up with an explicit error.
   */
  private async resolveOperatorKey(operatorId: AccountId, rawKey: string): Promise<PrivateKey> {
    const parsed = parseOperatorKey(rawKey);
    const accountKey = await this.lookupAccountKey(operatorId.toString());

    if (!accountKey) {
      if (parsed.assumed) {
        logger.warn(
          'Operator key supplied as raw hex and assumed ECDSA; mirror node unavailable to confirm. Set HEDERA_OPERATOR_KEY_TYPE=ed25519 if this is an ED25519 key.'
        );
      }
      return parsed.key;
    }

    if (accountKey.type === 'complex') {
      logger.info('Operator account uses a threshold or key list; skipping key verification');
      return parsed.key;
    }

    const matches = (key: PrivateKey): boolean =>
      key.publicKey.toStringRaw().toLowerCase() === accountKey.key.toLowerCase();

    if (matches(parsed.key)) {
      return parsed.key;
    }

    if (parsed.format === 'hex') {
      const alternate = parsePrivateKey(
        rawKey,
        accountKey.type === 'ED25519' ? 'ed25519' : 'ecdsa'
      );
      if (matches(alternate.key)) {
        logger.warn('Operator key re-interpreted to match the account key type', {
          operatorId: operatorId.toString(),
          keyType: accountKey.type,
        });
        return alternate.key;
      }
    }

    throw new Error(
      `HEDERA_OPERATOR_KEY does not match account ${operatorId.toString()}. ` +
        `The account key is ${accountKey.type} ${accountKey.key.slice(0, 16)}…, ` +
        `but the supplied key derives ${parsed.key.type} ${parsed.key.publicKey.toStringRaw().slice(0, 16)}…. ` +
        'Check the key, or set HEDERA_OPERATOR_KEY_TYPE to ecdsa or ed25519 for raw hex keys.'
    );
  }

  /**
   * Fetch an account's key from the mirror node. Returns null when the
   * mirror node cannot be reached, so startup still works offline.
   */
  private async lookupAccountKey(accountId: string): Promise<MirrorAccountKey | null> {
    try {
      const account = await this.mirrorGet(
        `/api/v1/accounts/${encodeURIComponent(accountId)}`,
        5000
      );
      const key = account?.key;
      if (!key || typeof key.key !== 'string') {
        return null;
      }
      if (key._type === 'ED25519' || key._type === 'ECDSA_SECP256K1') {
        return { type: key._type, key: key.key };
      }
      return { type: 'complex', key: key.key };
    } catch (error) {
      logger.warn('Could not verify operator key against the mirror node', {
        accountId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * GET a mirror node path for the current network
   */
  private async mirrorGet(
    pathWithQuery: string,
    timeoutMs: number = 15000,
    attempts: number = 3
  ): Promise<any> {
    const url = `${this.getMirrorNodeUrl()}${pathWithQuery}`;
    let lastError: Error | null = null;

    // The public mirror nodes return 5xx and time out under load often enough
    // that a single attempt is not reliable: account_info failed with a bare
    // "This operation was aborted" and succeeded on an immediate retry. Retry
    // transient failures, and never retry a 4xx, which will fail identically.
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, { signal: controller.signal });
        const text = await response.text();

        if (!response.ok) {
          let message = `${response.status} ${response.statusText}`;
          try {
            const body = JSON.parse(text);
            const detail = body?._status?.messages?.[0]?.message;
            if (detail) message = `${message}: ${detail}`;
          } catch {
            // non-JSON error body
          }

          const error = new Error(`Mirror node request failed (${message}) for ${url}`);
          if (response.status < 500) {
            throw error;
          }
          lastError = error;
        } else {
          return parseMirrorJson(text);
        }
      } catch (error: any) {
        // An aborted fetch is a timeout on our side; report it as one
        const aborted = error?.name === 'AbortError' || /aborted/i.test(error?.message || '');
        lastError = aborted
          ? new Error(
              `Mirror node request timed out after ${timeoutMs}ms for ${url}. ` +
                'The public mirror node may be under load; try again shortly.'
            )
          : error;

        if (!aborted && !/fetch failed|network|ECONN|EAI_AGAIN/i.test(error?.message || '')) {
          throw lastError;
        }
      } finally {
        clearTimeout(timer);
      }

      if (attempt < attempts) {
        const backoffMs = 250 * 2 ** (attempt - 1);
        logger.warn('Mirror node request failed, retrying', {
          url,
          attempt,
          of: attempts,
          backoffMs,
          error: lastError?.message,
        });
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError || new Error(`Mirror node request failed for ${url}`);
  }

  /**
   * Execute a transaction, first signing it with any extra private keys the
   * caller supplied. Needed when a key on the entity (an admin key, a
   * non-operator treasury, one member of a threshold list) is not the
   * operator key.
   */
  private async executeWithSigners(
    transaction: Transaction,
    signerPrivateKeys: string[] | undefined,
    client: Client
  ): Promise<TransactionResponse> {
    if (!signerPrivateKeys || signerPrivateKeys.length === 0) {
      return transaction.execute(client);
    }

    let signed: Transaction = transaction.freezeWith(client);
    for (const key of signerPrivateKeys) {
      signed = await signed.sign(parsePrivateKey(key).key);
    }
    return signed.execute(client);
  }

  /**
   * Get the Hedera client instance
   */
  getClient(): Client {
    if (!this.client) {
      throw new Error('Hedera client not initialized. Call initialize() first.');
    }

    // Every signing path reaches the SDK through here, so this is where a
    // missing operator has to be explained. Without it the SDK failed much
    // later with "`transactionId` must be set or `client` must be provided
    // with `freezeWith`", which says nothing about the actual problem.
    if (!this.config.operatorId || !this.config.operatorKey) {
      throw new Error(
        'This operation must be signed, but no operator account is configured. ' +
          'Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in the env block of your ' +
          'MCP server configuration. Read-only tools (balances, account info, mirror ' +
          'node queries, documentation) work without them.'
      );
    }

    // A key that does not belong to the operator account is only fatal for
    // operations that sign; queries against the Mirror Node never get here.
    if (this.operatorError) {
      throw new Error(this.operatorError);
    }
    return this.client;
  }

  /**
   * Check if client is initialized and has operator
   */
  isReady(): boolean {
    return this.client !== null && this.client.operatorAccountId !== null;
  }

  /**
   * Why the operator is unusable, if it is. Null when the operator is fine or
   * when no credentials were supplied at all.
   */
  getOperatorError(): string | null {
    return this.operatorError;
  }

  /**
   * Switch to a different network
   */
  async switchNetwork(network: 'mainnet' | 'testnet' | 'previewnet' | 'local'): Promise<void> {
    // Validate before touching anything. The name comes from an MCP client, so
    // the parameter type is a compile-time fiction; persisting an unknown value
    // here used to leave the server unusable until the state file was deleted
    // by hand, because the check only happened later in initialize().
    if (!isSupportedNetwork(network)) {
      throw new Error(
        `Unknown network: ${String(network)}. Supported networks: ${SUPPORTED_NETWORKS.join(', ')}`
      );
    }

    if (network === this.currentNetwork) {
      logger.info('Network unchanged', { network });
      return;
    }

    logger.info('Switching network', { from: this.currentNetwork, to: network });

    // Close existing client
    if (this.client) {
      this.client.close();
    }

    this.currentNetwork = network;
    this.config.network = network;
    mirrorNodeService.switchNetwork(network);

    // Persist network change to disk
    await stateService.saveNetworkState(network);

    await this.initialize();
  }

  /**
   * Get current network
   */
  getCurrentNetwork(): string {
    return this.currentNetwork;
  }

  /**
   * Get account balance (HBAR and tokens) from the mirror node.
   *
   * Uses the REST API rather than AccountBalanceQuery: the consensus-node
   * query is removed in consensus node v0.77 (testnet 2026-09-09, mainnet
   * 2026-10-06). Free, and works without an operator.
   */
  async getAccountBalance(accountId: string): Promise<{
    hbar: string;
    tokens: Record<string, string>;
  }> {
    try {
      const result = await this.mirrorGet(
        `/api/v1/balances?account.id=${encodeURIComponent(accountId)}`
      );
      const entry = result?.balances?.[0];
      if (!entry) {
        throw new Error(`Account ${accountId} not found on ${this.currentNetwork}`);
      }

      const tokens: Record<string, string> = {};
      for (const token of entry.tokens || []) {
        tokens[String(token.token_id)] = String(token.balance);
      }

      return {
        hbar: Hbar.fromString(String(entry.balance), HbarUnit.Tinybar).toString(),
        tokens,
      };
    } catch (error) {
      logger.error('Failed to get account balance', { accountId, error });
      throw error;
    }
  }

  /**
   * Get account info
   */
  async getAccountInfo(accountId: string): Promise<{
    accountId: string;
    balance: string;
    evmAddress: string | null;
    key: string;
    keyType: string;
    memo: string;
    autoRenewPeriod: number;
    expirationTime: Date;
    createdTimestamp?: string;
    deleted: boolean;
    maxAutomaticTokenAssociations: number;
    stakedNodeId: number | null;
    stakedAccountId: string | null;
    pendingReward: number;
  }> {
    try {
      // Mirror node: free, no operator needed, and unaffected by the
      // AccountInfoQuery fee. Field names follow the REST API.
      const account = await this.mirrorGet(`/api/v1/accounts/${encodeURIComponent(accountId)}`);
      const expirySeconds = account.expiry_timestamp
        ? Number(String(account.expiry_timestamp).split('.')[0])
        : 0;

      return {
        accountId: account.account,
        balance: Hbar.fromString(
          String(account.balance?.balance ?? 0),
          HbarUnit.Tinybar
        ).toString(),
        evmAddress: account.evm_address || null,
        key: account.key?.key || '',
        keyType: account.key?._type || 'none',
        memo: account.memo || '',
        autoRenewPeriod: account.auto_renew_period || 0,
        expirationTime: expirySeconds ? new Date(expirySeconds * 1000) : new Date(),
        createdTimestamp: account.created_timestamp,
        deleted: Boolean(account.deleted),
        maxAutomaticTokenAssociations: account.max_automatic_token_associations || 0,
        stakedNodeId: account.staked_node_id ?? null,
        stakedAccountId: account.staked_account_id ?? null,
        pendingReward: account.pending_reward || 0,
      };
    } catch (error) {
      logger.error('Failed to get account info', { accountId, error });
      throw error;
    }
  }

  /**
   * Create a new Hedera account
   */
  async createAccount(options: {
    initialBalance?: number;
    publicKey?: string;
    memo?: string;
    keyType?: 'ecdsa' | 'ed25519';
    maxAutomaticTokenAssociations?: number;
    stakedAccountId?: string;
    stakedNodeId?: number;
    declineStakingReward?: boolean;
  }): Promise<{
    accountId: string;
    privateKey: string;
    privateKeyHex: string;
    keyType: string;
    publicKey: string;
    transactionId: string;
  }> {
    try {
      const client = this.getClient();

      const requestedKeyType = (options.keyType || 'ecdsa').toLowerCase();
      if (requestedKeyType !== 'ecdsa' && requestedKeyType !== 'ed25519') {
        throw new Error(`keyType must be "ecdsa" or "ed25519" (got ${String(options.keyType)})`);
      }

      // Generate new key pair unless the caller supplies a public key
      let privateKey: PrivateKey | null = null;
      let publicKey: PublicKey;

      if (options.publicKey) {
        publicKey = parsePublicKeySpec(options.publicKey, 'publicKey');
      } else {
        privateKey =
          requestedKeyType === 'ed25519'
            ? PrivateKey.generateED25519()
            : PrivateKey.generateECDSA();
        publicKey = privateKey.publicKey;
      }

      // Create the account
      const transaction = new AccountCreateTransaction()
        .setKey(publicKey)
        .setInitialBalance(new Hbar(options.initialBalance || 1)); // Default 1 HBAR

      if (options.memo) {
        transaction.setAccountMemo(options.memo);
      }

      if (options.maxAutomaticTokenAssociations !== undefined) {
        if (!Number.isInteger(options.maxAutomaticTokenAssociations)) {
          throw new Error(
            'maxAutomaticTokenAssociations must be a whole number (-1 for unlimited)'
          );
        }
        transaction.setMaxAutomaticTokenAssociations(options.maxAutomaticTokenAssociations);
      }

      if (options.stakedAccountId && options.stakedNodeId !== undefined) {
        throw new Error('Pass either stakedAccountId or stakedNodeId, not both');
      }
      if (options.stakedAccountId) {
        transaction.setStakedAccountId(AccountId.fromString(options.stakedAccountId));
      }
      if (options.stakedNodeId !== undefined) {
        if (!Number.isInteger(options.stakedNodeId) || options.stakedNodeId < 0) {
          throw new Error('stakedNodeId must be a whole number of 0 or more');
        }
        transaction.setStakedNodeId(options.stakedNodeId);
      }
      if (options.declineStakingReward !== undefined) {
        transaction.setDeclineStakingReward(Boolean(options.declineStakingReward));
      }

      const txResponse = await transaction.execute(client);
      const receipt = await txResponse.getReceipt(client);
      const newAccountId = receipt.accountId;

      if (!newAccountId) {
        throw new Error('Failed to create account - no account ID in receipt');
      }

      logger.info('Account created successfully', {
        accountId: newAccountId.toString(),
        initialBalance: options.initialBalance || 1,
        keyType: privateKey ? privateKey.type : 'PROVIDED',
      });

      return {
        accountId: newAccountId.toString(),
        privateKey: privateKey ? privateKey.toStringDer() : 'NOT_GENERATED',
        privateKeyHex: privateKey ? privateKey.toStringRaw() : 'NOT_GENERATED',
        keyType: privateKey
          ? requestedKeyType === 'ed25519'
            ? 'ED25519'
            : 'ECDSA_SECP256K1'
          : 'PROVIDED',
        publicKey: publicKey.toStringDer(),
        transactionId: txResponse.transactionId.toString(),
      };
    } catch (error) {
      logger.error('Failed to create account', { error });
      throw error;
    }
  }

  /**
   * Transfer HBAR between accounts
   */
  async transferHbar(
    fromAccountId: string,
    toAccountId: string,
    amount: number
  ): Promise<{ transactionId: string; status: string }> {
    try {
      const client = this.getClient();

      const transaction = await new TransferTransaction()
        .addHbarTransfer(fromAccountId, new Hbar(-amount))
        .addHbarTransfer(toAccountId, new Hbar(amount))
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to transfer HBAR', { fromAccountId, toAccountId, amount, error });
      throw error;
    }
  }

  /**
   * Create a new token
   */
  async createToken(options: TokenCreateOptions): Promise<{
    tokenId: string;
    transactionId: string;
    tokenType: string;
    supplyType: string;
    treasuryAccountId: string;
  }> {
    try {
      const client = this.getClient();
      const operatorId = client.operatorAccountId?.toString();

      // Treasury account defaults to operator
      const treasuryId = options.treasuryAccountId || operatorId;
      if (!treasuryId) {
        throw new Error(
          'Treasury account ID required. Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY, or pass treasuryAccountId.'
        );
      }

      const transaction = buildTokenCreateTransaction(options, {
        operatorPublicKey: client.operatorPublicKey,
        treasuryAccountId: treasuryId,
      });

      // A treasury other than the operator must sign the create transaction.
      const signerKeys: PrivateKey[] = [];
      if (options.treasuryPrivateKey) {
        signerKeys.push(parsePrivateKey(options.treasuryPrivateKey).key);
      } else if (treasuryId !== operatorId) {
        throw new Error(
          `Treasury account ${treasuryId} is not the operator account (${operatorId ?? 'none'}), ` +
            'so it must sign the token create transaction. Pass treasuryPrivateKey with that ' +
            "account's private key, or leave treasuryAccountId unset to use the operator."
        );
      }
      for (const key of options.signerPrivateKeys ?? []) {
        signerKeys.push(parsePrivateKey(key).key);
      }

      let executable: TokenCreateTransaction = transaction;
      if (signerKeys.length > 0) {
        executable = transaction.freezeWith(client);
        for (const key of signerKeys) {
          executable = await executable.sign(key);
        }
      }

      const txResponse = await executable.execute(client);
      const receipt = await txResponse.getReceipt(client);
      const tokenId = receipt.tokenId;

      if (!tokenId) {
        throw new Error('Failed to create token - no token ID in receipt');
      }

      logger.info('Token created successfully', {
        tokenId: tokenId.toString(),
        name: options.name,
        symbol: options.symbol,
        tokenType: transaction.tokenType?.toString(),
      });

      return {
        tokenId: tokenId.toString(),
        transactionId: txResponse.transactionId.toString(),
        tokenType: transaction.tokenType?.toString() ?? 'FUNGIBLE_COMMON',
        supplyType: transaction.supplyType?.toString() ?? 'INFINITE',
        treasuryAccountId: treasuryId,
      };
    } catch (error) {
      logger.error('Failed to create token', { error });
      throw error;
    }
  }

  /**
   * Associate a token with an account
   */
  async associateToken(
    accountId: string,
    tokenId: string,
    privateKey?: string
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = new TokenAssociateTransaction()
        .setAccountId(accountId)
        .setTokenIds([TokenId.fromString(tokenId)])
        .freezeWith(client);

      // Sign with account's private key if provided
      let signedTx;
      if (privateKey) {
        const accountKey = parsePrivateKey(privateKey).key;
        signedTx = await transaction.sign(accountKey);
      } else {
        // Assume operator is the account
        signedTx = transaction;
      }

      const txResponse = await signedTx.execute(client);
      const receipt = await txResponse.getReceipt(client);

      logger.info('Token associated successfully', { accountId, tokenId });

      return {
        transactionId: txResponse.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to associate token', { accountId, tokenId, error });
      throw error;
    }
  }

  /**
   * Transfer tokens between accounts
   */
  async transferToken(
    tokenId: string,
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    senderPrivateKey?: string
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();
      const token = TokenId.fromString(tokenId);

      const transaction = new TransferTransaction()
        .addTokenTransfer(token, fromAccountId, -amount)
        .addTokenTransfer(token, toAccountId, amount)
        .freezeWith(client);

      // Sign with sender's private key if provided
      let signedTx;
      if (senderPrivateKey) {
        const senderKey = parsePrivateKey(senderPrivateKey).key;
        signedTx = await transaction.sign(senderKey);
      } else {
        // Assume operator is the sender
        signedTx = transaction;
      }

      const txResponse = await signedTx.execute(client);
      const receipt = await txResponse.getReceipt(client);

      logger.info('Token transferred successfully', {
        tokenId,
        from: fromAccountId,
        to: toAccountId,
        amount,
      });

      return {
        transactionId: txResponse.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to transfer token', { tokenId, fromAccountId, toAccountId, error });
      throw error;
    }
  }

  /**
   * Mint tokens
   */
  async mintToken(
    tokenId: string,
    amount?: number,
    options?: { metadata?: string[]; metadataEncoding?: 'utf8' | 'base64' | 'hex' }
  ): Promise<{
    transactionId: string;
    status: string;
    newTotalSupply: string;
    serials: string[];
  }> {
    try {
      const client = this.getClient();
      const metadata = options?.metadata;

      if ((metadata === undefined || metadata.length === 0) && amount === undefined) {
        throw new Error(
          'mint requires amount (fungible token) or metadata (non-fungible token serials)'
        );
      }

      const mint = new TokenMintTransaction().setTokenId(TokenId.fromString(tokenId));

      if (metadata && metadata.length > 0) {
        const encoding = options?.metadataEncoding ?? 'utf8';
        mint.setMetadata(metadata.map((entry) => decodeMetadata(entry, encoding)));
      } else if (amount !== undefined) {
        mint.setAmount(amount);
      }

      const transaction = await mint.execute(client);
      const receipt = await transaction.getReceipt(client);

      logger.info('Token minted successfully', {
        tokenId,
        amount,
        metadataCount: metadata?.length ?? 0,
      });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
        newTotalSupply: receipt.totalSupply?.toString() || '0',
        serials: (receipt.serials || []).map((serial) => serial.toString()),
      };
    } catch (error) {
      logger.error('Failed to mint token', { tokenId, amount, error });
      throw error;
    }
  }

  /**
   * Burn tokens
   */
  async burnToken(
    tokenId: string,
    amount?: number,
    options?: { serialNumbers?: number[] }
  ): Promise<{
    transactionId: string;
    status: string;
    newTotalSupply: string;
  }> {
    try {
      const client = this.getClient();
      const serials = options?.serialNumbers;

      if ((serials === undefined || serials.length === 0) && amount === undefined) {
        throw new Error(
          'burn requires amount (fungible token) or serialNumbers (non-fungible token)'
        );
      }

      const burn = new TokenBurnTransaction().setTokenId(TokenId.fromString(tokenId));
      if (serials && serials.length > 0) {
        burn.setSerials(normaliseSerials(serials));
      } else if (amount !== undefined) {
        burn.setAmount(amount);
      }

      const transaction = await burn.execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token burned successfully', { tokenId, amount, serials });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
        newTotalSupply: receipt.totalSupply?.toString() || '0',
      };
    } catch (error) {
      logger.error('Failed to burn token', { tokenId, amount, error });
      throw error;
    }
  }

  /**
   * Freeze token for an account
   */
  async freezeToken(
    tokenId: string,
    accountId: string
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenFreezeTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAccountId(accountId)
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token frozen successfully', { tokenId, accountId });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to freeze token', { tokenId, accountId, error });
      throw error;
    }
  }

  /**
   * Unfreeze token for an account
   */
  async unfreezeToken(
    tokenId: string,
    accountId: string
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenUnfreezeTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAccountId(accountId)
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token unfrozen successfully', { tokenId, accountId });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to unfreeze token', { tokenId, accountId, error });
      throw error;
    }
  }

  /**
   * Grant KYC status to an account for a token
   */
  async grantKyc(
    tokenId: string,
    accountId: string
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenGrantKycTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAccountId(accountId)
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('KYC granted successfully', { tokenId, accountId });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to grant KYC', { tokenId, accountId, error });
      throw error;
    }
  }

  /**
   * Revoke KYC status from an account for a token
   */
  async revokeKyc(
    tokenId: string,
    accountId: string
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenRevokeKycTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAccountId(accountId)
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('KYC revoked successfully', { tokenId, accountId });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to revoke KYC', { tokenId, accountId, error });
      throw error;
    }
  }

  /**
   * Wipe tokens from an account
   */
  async wipeToken(
    tokenId: string,
    accountId: string,
    amount?: number,
    options?: { serialNumbers?: number[] }
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();
      const serials = options?.serialNumbers;

      if ((serials === undefined || serials.length === 0) && amount === undefined) {
        throw new Error(
          'wipe requires amount (fungible token) or serialNumbers (non-fungible token)'
        );
      }

      const wipe = new TokenWipeTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAccountId(accountId);
      if (serials && serials.length > 0) {
        wipe.setSerials(normaliseSerials(serials));
      } else if (amount !== undefined) {
        wipe.setAmount(amount);
      }

      const transaction = await wipe.execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token wiped successfully', { tokenId, accountId, amount, serials });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to wipe token', { tokenId, accountId, amount, error });
      throw error;
    }
  }

  /**
   * Pause all token operations
   */
  async pauseToken(tokenId: string): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenPauseTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token paused successfully', { tokenId });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to pause token', { tokenId, error });
      throw error;
    }
  }

  /**
   * Unpause token operations
   */
  async unpauseToken(tokenId: string): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = await new TokenUnpauseTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .execute(client);

      const receipt = await transaction.getReceipt(client);

      logger.info('Token unpaused successfully', { tokenId });

      return {
        transactionId: transaction.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to unpause token', { tokenId, error });
      throw error;
    }
  }

  /**
   * Create a new HCS topic
   */
  async createTopic(options: {
    memo?: string;
    adminKey?: KeySpec;
    submitKey?: KeySpec;
    autoRenewPeriod?: number;
    autoRenewAccountId?: string;
    signerPrivateKeys?: string[];
  }): Promise<{
    topicId: string;
    transactionId: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = buildTopicCreateTransaction(options, client.operatorPublicKey);

      const txResponse = await this.executeWithSigners(
        transaction,
        options.signerPrivateKeys,
        client
      );
      const receipt = await txResponse.getReceipt(client);
      const topicId = receipt.topicId;

      if (!topicId) {
        throw new Error('Failed to create topic - no topic ID in receipt');
      }

      logger.info('Topic created successfully', {
        topicId: topicId.toString(),
        memo: options.memo,
      });

      return {
        topicId: topicId.toString(),
        transactionId: txResponse.transactionId.toString(),
      };
    } catch (error) {
      logger.error('Failed to create topic', { error });
      throw error;
    }
  }

  /**
   * Update an existing HCS topic
   */
  async updateTopic(
    topicId: string,
    options: {
      memo?: string;
      adminKey?: KeySpec;
      submitKey?: KeySpec;
      clearAdminKey?: boolean;
      clearSubmitKey?: boolean;
      autoRenewPeriod?: number;
      autoRenewAccountId?: string;
      signerPrivateKeys?: string[];
    }
  ): Promise<{
    transactionId: string;
    status: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = buildTopicUpdateTransaction(topicId, options, client.operatorPublicKey);

      const txResponse = await this.executeWithSigners(
        transaction,
        options.signerPrivateKeys,
        client
      );
      const receipt = await txResponse.getReceipt(client);

      logger.info('Topic updated successfully', { topicId });

      return {
        transactionId: txResponse.transactionId.toString(),
        status: receipt.status.toString(),
      };
    } catch (error) {
      logger.error('Failed to update topic', { topicId, error });
      throw error;
    }
  }

  /**
   * Submit a message to an HCS topic
   */
  async submitMessage(
    topicId: string,
    message: string,
    submitKey?: string
  ): Promise<{
    transactionId: string;
    status: string;
    sequenceNumber: string;
  }> {
    try {
      const client = this.getClient();

      const transaction = new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(message)
        .setMaxChunks(20) // Support up to 20 chunks for large messages
        .freezeWith(client);

      // Sign with submit key if provided (for private topics)
      let signedTx;
      if (submitKey) {
        const key = parsePrivateKey(submitKey).key;
        signedTx = await transaction.sign(key);
      } else {
        signedTx = transaction;
      }

      const txResponse = await signedTx.execute(client);
      const receipt = await txResponse.getReceipt(client);

      logger.info('Message submitted successfully', {
        topicId,
        messageLength: message.length,
        sequenceNumber: receipt.topicSequenceNumber?.toString(),
      });

      return {
        transactionId: txResponse.transactionId.toString(),
        status: receipt.status.toString(),
        sequenceNumber: receipt.topicSequenceNumber?.toString() || '0',
      };
    } catch (error) {
      logger.error('Failed to submit message', { topicId, error });
      throw error;
    }
  }

  /**
   * Query topic messages from Mirror Node REST API
   */
  async queryMessages(
    topicId: string,
    options?: TopicMessageQueryOptions
  ): Promise<{
    messages: Array<{
      consensusTimestamp: string;
      sequenceNumber: number;
      message: string;
      runningHash: string;
      payerAccountId?: string;
    }>;
    next: string | null;
  }> {
    try {
      const path = buildTopicMessageQuery(topicId, options);

      logger.info('Querying topic messages', { topicId, path });

      const data = (await this.mirrorGet(path)) as {
        messages?: Array<{
          consensus_timestamp: string;
          sequence_number: number;
          message: string;
          running_hash: string;
          payer_account_id?: string;
        }>;
        links?: { next?: string | null };
      };

      // Decode base64 messages and format response
      const messages = (data.messages || []).map((msg) => ({
        consensusTimestamp: msg.consensus_timestamp,
        sequenceNumber: msg.sequence_number,
        message: Buffer.from(msg.message, 'base64').toString('utf-8'),
        runningHash: msg.running_hash,
        payerAccountId: msg.payer_account_id,
      }));

      logger.info('Messages retrieved successfully', {
        topicId,
        count: messages.length,
      });

      return { messages, next: data.links?.next ?? null };
    } catch (error) {
      logger.error('Failed to query messages', { topicId, error });
      throw error;
    }
  }

  /**
   * Subscribe to topic messages (real-time)
   */
  async subscribeToTopic(
    topicId: string,
    _options?: {
      startTime?: Date;
    }
  ): Promise<{
    subscriptionId: string;
    message: string;
  }> {
    try {
      // Note: Real subscription would require maintaining a long-running connection
      // For MCP tools, we return a subscription acknowledgment
      // Actual implementation would use TopicMessageQuery with callback

      logger.info('Topic subscription created', { topicId });

      return {
        subscriptionId: `sub-${topicId}-${Date.now()}`,
        message: `Subscription created for topic ${topicId}. Use message_query to retrieve messages.`,
      };
    } catch (error) {
      logger.error('Failed to subscribe to topic', { topicId, error });
      throw error;
    }
  }

  /**
   * Close the client connection
   */
  close(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
      logger.info('Hedera client closed');
    }
  }

  /**
   * Get Mirror Node URL for current network
   */
  getMirrorNodeUrl(): string {
    // MIRROR_NODE_URL applies to the network named in the environment only
    if (this.config.mirrorNodeUrl && this.currentNetwork === this.configuredNetwork) {
      return this.config.mirrorNodeUrl.replace(/\/+$/, '');
    }

    switch (this.currentNetwork) {
      case 'mainnet':
        return 'https://mainnet.mirrornode.hedera.com';
      case 'testnet':
        return 'https://testnet.mirrornode.hedera.com';
      case 'previewnet':
        return 'https://previewnet.mirrornode.hedera.com';
      case 'local':
        return 'http://localhost:5551';
      default:
        throw new Error(`Unknown network: ${this.currentNetwork}`);
    }
  }

  /**
   * Get JSON-RPC Relay URL for current network
   */
  getJsonRpcRelayUrl(): string {
    // JSON_RPC_RELAY_URL applies to the network named in the environment only.
    // Hashio is rate-limited and documented as development-only; production
    // users should point this at Arkhia, QuickNode, or a self-hosted relay.
    if (this.config.jsonRpcRelayUrl && this.currentNetwork === this.configuredNetwork) {
      return this.config.jsonRpcRelayUrl;
    }

    switch (this.currentNetwork) {
      case 'mainnet':
        return 'https://mainnet.hashio.io/api';
      case 'testnet':
        return 'https://testnet.hashio.io/api';
      case 'previewnet':
        return 'https://previewnet.hashio.io/api';
      case 'local':
        return 'http://localhost:7546';
      default:
        throw new Error(`Unknown network: ${this.currentNetwork}`);
    }
  }
}

// Export singleton instance
export const hederaClient = new HederaClientService();
