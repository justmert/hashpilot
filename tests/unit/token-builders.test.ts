/**
 * Token builder unit tests.
 *
 * These exercise the configuration path only: the SDK transaction objects are
 * constructed and inspected through their getters, never executed, so the
 * suite needs no network and no funded account.
 */

import {
  CustomFixedFee,
  CustomFractionalFee,
  CustomRoyaltyFee,
  FeeAssessmentMethod,
  KeyList,
  PrivateKey,
  PublicKey,
  TokenSupplyType,
  TokenType,
} from '@hashgraph/sdk';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  buildCustomFees,
  buildTokenCreateTransaction,
  resolveKey,
  resolveSupplyType,
  resolveTokenType,
  decodeMetadata,
  normaliseSerials,
  TokenCreateOptions,
} from '../../src/services/hedera-client.js';
import { advisoriesFor } from '../../src/services/error-analyzer.js';
import {
  TOKEN_CONFIG_FIELDS,
  loadTokenConfigFile,
  mergeTokenConfig,
} from '../../src/tools/token.js';

const operatorKey = PrivateKey.generateECDSA().publicKey;
const memberA = PrivateKey.generateED25519().publicKey;
const memberB = PrivateKey.generateECDSA().publicKey;

const baseContext = { operatorPublicKey: operatorKey, treasuryAccountId: '0.0.1001' };

describe('resolveKey', () => {
  it('maps true to the operator key and false to no key', () => {
    expect(resolveKey(true, operatorKey)).toBe(operatorKey);
    expect(resolveKey(false, operatorKey)).toBeUndefined();
    expect(resolveKey(undefined, operatorKey)).toBeUndefined();
  });

  it('parses an explicit public key in DER form', () => {
    const resolved = resolveKey(memberA.toStringDer(), operatorKey) as PublicKey;
    expect(resolved.toString()).toBe(memberA.toString());
  });

  it('parses an explicit public key in raw hex form', () => {
    const resolved = resolveKey(memberB.toStringRaw(), operatorKey) as PublicKey;
    expect(resolved.toStringRaw()).toBe(memberB.toStringRaw());
  });

  it('builds a threshold key list', () => {
    const resolved = resolveKey(
      { threshold: 2, keys: [memberA.toStringDer(), memberB.toStringDer()] },
      operatorKey
    );

    expect(resolved).toBeInstanceOf(KeyList);
    const list = resolved as KeyList;
    expect(list.threshold).toBe(2);
    expect(list.toArray()).toHaveLength(2);
  });

  it('rejects a threshold outside the number of keys', () => {
    expect(() => resolveKey({ threshold: 3, keys: [memberA.toStringDer()] }, operatorKey)).toThrow(
      /threshold must be a whole number between 1 and 1/
    );
  });

  it('rejects an empty key list', () => {
    expect(() => resolveKey({ threshold: 1, keys: [] }, operatorKey)).toThrow(
      /at least one public key/
    );
  });

  it('explains that true needs an operator key when none is configured', () => {
    expect(() => resolveKey(true, null, 'adminKey')).toThrow(/adminKey: no operator key/);
  });

  it('reports which key failed to parse', () => {
    expect(() => resolveKey('not-a-key', operatorKey, 'supplyKey')).toThrow(/supplyKey:/);
  });
});

describe('buildCustomFees', () => {
  it('builds a fixed fee denominated in HBAR', () => {
    const [fee] = buildCustomFees([
      { type: 'fixed', amount: 100, feeCollectorAccountId: '0.0.2002' },
    ]);

    expect(fee).toBeInstanceOf(CustomFixedFee);
    const fixed = fee as CustomFixedFee;
    expect(fixed.amount?.toString()).toBe('100');
    expect(fixed.denominatingTokenId).toBeNull();
    expect(fixed.feeCollectorAccountId?.toString()).toBe('0.0.2002');
  });

  it('builds a fixed fee denominated in another token', () => {
    const [fee] = buildCustomFees([
      {
        type: 'fixed',
        amount: 5,
        denominatingTokenId: '0.0.3003',
        feeCollectorAccountId: '0.0.2002',
        allCollectorsAreExempt: true,
      },
    ]);

    const fixed = fee as CustomFixedFee;
    expect(fixed.denominatingTokenId?.toString()).toBe('0.0.3003');
    expect(fixed.allCollectorsAreExempt).toBe(true);
  });

  it('builds a fractional fee with bounds and an assessment method', () => {
    const [fee] = buildCustomFees([
      {
        type: 'fractional',
        numerator: 1,
        denominator: 100,
        minimumAmount: 1,
        maximumAmount: 500,
        assessmentMethod: 'inclusive',
        feeCollectorAccountId: '0.0.2002',
      },
    ]);

    expect(fee).toBeInstanceOf(CustomFractionalFee);
    const fractional = fee as CustomFractionalFee;
    expect(fractional.numerator?.toString()).toBe('1');
    expect(fractional.denominator?.toString()).toBe('100');
    expect(fractional.min?.toString()).toBe('1');
    expect(fractional.max?.toString()).toBe('500');
    expect(fractional.assessmentMethod).toBe(FeeAssessmentMethod.Inclusive);
  });

  it('accepts the legacy feeType, min and max spellings', () => {
    const [fee] = buildCustomFees([
      {
        feeType: 'fractional',
        amount: 3,
        denominator: 50,
        min: 2,
        max: 20,
        feeCollectorAccountId: '0.0.2002',
      },
    ]);

    const fractional = fee as CustomFractionalFee;
    expect(fractional.numerator?.toString()).toBe('3');
    expect(fractional.min?.toString()).toBe('2');
    expect(fractional.max?.toString()).toBe('20');
  });

  it('builds a royalty fee with a fallback fixed fee', () => {
    const [fee] = buildCustomFees([
      {
        type: 'royalty',
        numerator: 5,
        denominator: 100,
        fallbackFee: { amount: 250, denominatingTokenId: '0.0.3003' },
        feeCollectorAccountId: '0.0.2002',
      },
    ]);

    expect(fee).toBeInstanceOf(CustomRoyaltyFee);
    const royalty = fee as CustomRoyaltyFee;
    expect(royalty.numerator?.toString()).toBe('5');
    expect(royalty.denominator?.toString()).toBe('100');
    expect(royalty.fallbackFee).toBeInstanceOf(CustomFixedFee);
    expect(royalty.fallbackFee?.amount?.toString()).toBe('250');
    expect(royalty.fallbackFee?.denominatingTokenId?.toString()).toBe('0.0.3003');
  });

  it('accepts a plain number as a royalty fallback fee', () => {
    const [fee] = buildCustomFees([
      {
        type: 'royalty',
        numerator: 1,
        denominator: 10,
        fallbackFee: 42,
        feeCollectorAccountId: '0.0.2002',
      },
    ]);

    expect((fee as CustomRoyaltyFee).fallbackFee?.amount?.toString()).toBe('42');
  });

  it('builds several fees in one call', () => {
    const fees = buildCustomFees([
      { type: 'fixed', amount: 1, feeCollectorAccountId: '0.0.2002' },
      { type: 'fractional', numerator: 1, denominator: 4, feeCollectorAccountId: '0.0.2003' },
    ]);

    expect(fees).toHaveLength(2);
    expect(fees[0]).toBeInstanceOf(CustomFixedFee);
    expect(fees[1]).toBeInstanceOf(CustomFractionalFee);
  });

  it('names the offending entry when the type is missing', () => {
    expect(() => buildCustomFees([{ feeCollectorAccountId: '0.0.2002' } as never])).toThrow(
      /customFees\[0\]\.type must be one of/
    );
  });

  it('requires a fee collector', () => {
    expect(() => buildCustomFees([{ type: 'fixed', amount: 1 } as never])).toThrow(
      /customFees\[0\]\.feeCollectorAccountId is required/
    );
  });

  it('requires a fixed fee amount', () => {
    expect(() => buildCustomFees([{ type: 'fixed', feeCollectorAccountId: '0.0.2002' }])).toThrow(
      /customFees\[0\]\.amount is required/
    );
  });

  it('rejects a fractional fee with no denominator', () => {
    expect(() =>
      buildCustomFees([{ type: 'fractional', numerator: 1, feeCollectorAccountId: '0.0.2002' }])
    ).toThrow(/customFees\[0\]\.denominator is required/);
  });

  it('rejects an unknown assessment method', () => {
    expect(() =>
      buildCustomFees([
        {
          type: 'fractional',
          numerator: 1,
          denominator: 2,
          assessmentMethod: 'sometimes' as never,
          feeCollectorAccountId: '0.0.2002',
        },
      ])
    ).toThrow(/assessmentMethod must be "inclusive" or "exclusive"/);
  });
});

describe('resolveTokenType and resolveSupplyType', () => {
  it('maps the token type spellings', () => {
    expect(resolveTokenType()).toBe(TokenType.FungibleCommon);
    expect(resolveTokenType('fungible')).toBe(TokenType.FungibleCommon);
    expect(resolveTokenType('NFT')).toBe(TokenType.NonFungibleUnique);
    expect(resolveTokenType('non_fungible_unique')).toBe(TokenType.NonFungibleUnique);
    expect(() => resolveTokenType('coin')).toThrow(/tokenType must be/);
  });

  it('maps the supply type spellings', () => {
    expect(resolveSupplyType()).toBe(TokenSupplyType.Infinite);
    expect(resolveSupplyType('finite')).toBe(TokenSupplyType.Finite);
    expect(() => resolveSupplyType('capped')).toThrow(/supplyType must be/);
  });
});

describe('buildTokenCreateTransaction', () => {
  it('sets the fungible defaults', () => {
    const tx = buildTokenCreateTransaction({ name: 'Acme', symbol: 'ACME' }, baseContext);

    expect(tx.tokenName).toBe('Acme');
    expect(tx.tokenSymbol).toBe('ACME');
    expect(tx.tokenType).toBe(TokenType.FungibleCommon);
    expect(tx.supplyType).toBe(TokenSupplyType.Infinite);
    expect(tx.decimals?.toString()).toBe('0');
    expect(tx.initialSupply?.toString()).toBe('1000');
    expect(tx.treasuryAccountId?.toString()).toBe('0.0.1001');
    expect(tx.maxSupply).toBeNull();
  });

  it('defaults the supply key to the operator key and leaves the rest unset', () => {
    const tx = buildTokenCreateTransaction({ name: 'Acme', symbol: 'ACME' }, baseContext);

    expect(tx.supplyKey?.toString()).toBe(operatorKey.toString());
    expect(tx.adminKey).toBeNull();
    expect(tx.kycKey).toBeNull();
    expect(tx.freezeKey).toBeNull();
    expect(tx.wipeKey).toBeNull();
    expect(tx.pauseKey).toBeNull();
    expect(tx.feeScheduleKey).toBeNull();
  });

  it('honours supplyKey false', () => {
    const tx = buildTokenCreateTransaction(
      { name: 'Acme', symbol: 'ACME', supplyKey: false },
      baseContext
    );

    expect(tx.supplyKey).toBeNull();
  });

  it('applies a finite supply with a maximum', () => {
    const tx = buildTokenCreateTransaction(
      { name: 'Acme', symbol: 'ACME', supplyType: 'finite', maxSupply: 21000000 },
      baseContext
    );

    expect(tx.supplyType).toBe(TokenSupplyType.Finite);
    expect(tx.maxSupply?.toString()).toBe('21000000');
  });

  it('infers a finite supply from maxSupply alone', () => {
    const tx = buildTokenCreateTransaction(
      { name: 'Acme', symbol: 'ACME', maxSupply: 500, initialSupply: 100 },
      baseContext
    );

    expect(tx.supplyType).toBe(TokenSupplyType.Finite);
    expect(tx.maxSupply?.toString()).toBe('500');
  });

  it('rejects a finite supply with no maximum', () => {
    expect(() =>
      buildTokenCreateTransaction(
        { name: 'Acme', symbol: 'ACME', supplyType: 'finite' },
        baseContext
      )
    ).toThrow(/supplyType "finite" requires maxSupply/);
  });

  it('rejects a maximum below the initial supply', () => {
    expect(() =>
      buildTokenCreateTransaction(
        { name: 'Acme', symbol: 'ACME', maxSupply: 10, initialSupply: 100 },
        baseContext
      )
    ).toThrow(/must be at least initialSupply/);
  });

  it('rejects a maximum on an infinite supply', () => {
    expect(() =>
      buildTokenCreateTransaction(
        { name: 'Acme', symbol: 'ACME', supplyType: 'infinite', maxSupply: 10 },
        baseContext
      )
    ).toThrow(/only valid with supplyType "finite"/);
  });

  it('creates a non-fungible token with zero decimals and zero initial supply', () => {
    const tx = buildTokenCreateTransaction(
      { name: 'Acme Art', symbol: 'ART', tokenType: 'nft' },
      baseContext
    );

    expect(tx.tokenType).toBe(TokenType.NonFungibleUnique);
    expect(tx.decimals?.toString()).toBe('0');
    expect(tx.initialSupply?.toString()).toBe('0');
  });

  it('rejects a non-fungible token with decimals or an initial supply', () => {
    expect(() =>
      buildTokenCreateTransaction(
        { name: 'Acme Art', symbol: 'ART', tokenType: 'nft', decimals: 2 },
        baseContext
      )
    ).toThrow(/must have decimals 0/);

    expect(() =>
      buildTokenCreateTransaction(
        { name: 'Acme Art', symbol: 'ART', tokenType: 'nft', initialSupply: 5 },
        baseContext
      )
    ).toThrow(/must have initialSupply 0/);
  });

  it('accepts a boolean, a public key and a threshold list across the key parameters', () => {
    const tx = buildTokenCreateTransaction(
      {
        name: 'Acme',
        symbol: 'ACME',
        adminKey: true,
        wipeKey: memberA.toStringDer(),
        supplyKey: { threshold: 2, keys: [memberA.toStringDer(), memberB.toStringDer()] },
        feeScheduleKey: memberB.toStringDer(),
      },
      baseContext
    );

    expect(tx.adminKey?.toString()).toBe(operatorKey.toString());
    expect(tx.wipeKey?.toString()).toBe(memberA.toString());
    expect(tx.feeScheduleKey?.toString()).toBe(memberB.toString());

    expect(tx.supplyKey).toBeInstanceOf(KeyList);
    const supplyList = tx.supplyKey as KeyList;
    expect(supplyList.threshold).toBe(2);
    expect(supplyList.toArray()).toHaveLength(2);
  });

  it('attaches custom fees of the right classes', () => {
    const tx = buildTokenCreateTransaction(
      {
        name: 'Acme',
        symbol: 'ACME',
        customFees: [
          { type: 'fixed', amount: 100, feeCollectorAccountId: '0.0.2002' },
          {
            type: 'fractional',
            numerator: 1,
            denominator: 100,
            feeCollectorAccountId: '0.0.2002',
          },
        ],
      },
      baseContext
    );

    expect(tx.customFees).toHaveLength(2);
    expect(tx.customFees[0]).toBeInstanceOf(CustomFixedFee);
    expect(tx.customFees[1]).toBeInstanceOf(CustomFractionalFee);
  });

  it('attaches a royalty fee to a non-fungible token', () => {
    const tx = buildTokenCreateTransaction(
      {
        name: 'Acme Art',
        symbol: 'ART',
        tokenType: 'nft',
        customFees: [
          { type: 'royalty', numerator: 5, denominator: 100, feeCollectorAccountId: '0.0.2002' },
        ],
      },
      baseContext
    );

    expect(tx.customFees[0]).toBeInstanceOf(CustomRoyaltyFee);
  });

  it('rejects a royalty fee on a fungible token and a fractional fee on an NFT', () => {
    expect(() =>
      buildTokenCreateTransaction(
        {
          name: 'Acme',
          symbol: 'ACME',
          customFees: [
            { type: 'royalty', numerator: 1, denominator: 10, feeCollectorAccountId: '0.0.2002' },
          ],
        },
        baseContext
      )
    ).toThrow(/royalty fees are only valid on non-fungible tokens/);

    expect(() =>
      buildTokenCreateTransaction(
        {
          name: 'Acme Art',
          symbol: 'ART',
          tokenType: 'nft',
          customFees: [
            {
              type: 'fractional',
              numerator: 1,
              denominator: 10,
              feeCollectorAccountId: '0.0.2002',
            },
          ],
        },
        baseContext
      )
    ).toThrow(/fractional fees are only valid on fungible tokens/);
  });

  it('requires a freeze key before freezeDefault', () => {
    expect(() =>
      buildTokenCreateTransaction(
        { name: 'Acme', symbol: 'ACME', freezeDefault: true },
        baseContext
      )
    ).toThrow(/freezeDefault requires a freezeKey/);

    const tx = buildTokenCreateTransaction(
      { name: 'Acme', symbol: 'ACME', freezeKey: true, freezeDefault: true },
      baseContext
    );
    expect(tx.freezeDefault).toBe(true);
  });

  it('sets the memo and requires a name, a symbol and a treasury', () => {
    const tx = buildTokenCreateTransaction(
      { name: 'Acme', symbol: 'ACME', memo: 'created by HashPilot' },
      baseContext
    );
    expect(tx.tokenMemo).toBe('created by HashPilot');

    expect(() => buildTokenCreateTransaction({ name: '', symbol: 'ACME' }, baseContext)).toThrow(
      /Token name is required/
    );
    expect(() => buildTokenCreateTransaction({ name: 'Acme', symbol: '' }, baseContext)).toThrow(
      /Token symbol is required/
    );
    expect(() =>
      buildTokenCreateTransaction(
        { name: 'Acme', symbol: 'ACME' },
        { operatorPublicKey: operatorKey, treasuryAccountId: '' }
      )
    ).toThrow(/Treasury account ID required/);
  });

  it('works with no operator key when every key is explicit', () => {
    const tx = buildTokenCreateTransaction(
      { name: 'Acme', symbol: 'ACME', supplyKey: memberA.toStringDer() },
      { operatorPublicKey: null, treasuryAccountId: '0.0.1001' }
    );

    expect(tx.supplyKey?.toString()).toBe(memberA.toString());
  });
});

describe('mergeTokenConfig', () => {
  it('lets explicit arguments win over a config', () => {
    const merged = mergeTokenConfig(
      { symbol: 'OVERRIDE', operation: 'create' },
      { name: 'From config', symbol: 'CFG', decimals: 4 }
    );

    expect(merged).toEqual({ name: 'From config', symbol: 'OVERRIDE', decimals: 4 });
  });

  it('lets a later config win over an earlier one', () => {
    const merged = mergeTokenConfig(
      {},
      { name: 'From file', memo: 'file memo' },
      { name: 'From inline' }
    );

    expect(merged).toEqual({ name: 'From inline', memo: 'file memo' });
  });

  it('ignores undefined values on both sides', () => {
    const merged = mergeTokenConfig({ name: undefined, symbol: 'ACME' }, { name: 'Kept' });

    expect(merged).toEqual({ name: 'Kept', symbol: 'ACME' });
  });

  it('drops fields that are not token configuration', () => {
    const merged = mergeTokenConfig({ operation: 'create', tokenId: '0.0.5', name: 'Acme' });

    expect(merged).toEqual({ name: 'Acme' });
  });

  it('carries every documented field through', () => {
    const everything: Record<string, unknown> = {};
    for (const field of TOKEN_CONFIG_FIELDS) everything[field] = `value-${field}`;

    expect(Object.keys(mergeTokenConfig({}, everything)).sort()).toEqual(
      [...TOKEN_CONFIG_FIELDS].sort()
    );
  });

  it('reports a typo in a config rather than ignoring it', () => {
    expect(() => mergeTokenConfig({}, { naem: 'Acme' })).toThrow(
      /Unknown field\(s\) in token configuration: naem/
    );
  });

  it('rejects a config that is not an object', () => {
    expect(() => mergeTokenConfig({}, [] as unknown as Record<string, unknown>)).toThrow(
      /must be a JSON object/
    );
  });
});

describe('loadTokenConfigFile', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hashpilot-token-config-'));
  });

  afterAll(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('reads a JSON file and feeds it into a token create transaction', async () => {
    const file = path.join(directory, 'token.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        name: 'Acme Points',
        symbol: 'ACME',
        decimals: 2,
        supplyType: 'finite',
        maxSupply: 1000000,
        initialSupply: 100000,
        customFees: [{ type: 'fixed', amount: 100, feeCollectorAccountId: '0.0.2002' }],
      })
    );

    const options = mergeTokenConfig({}, await loadTokenConfigFile(file));
    const tx = buildTokenCreateTransaction(options, baseContext);

    expect(tx.tokenName).toBe('Acme Points');
    expect(tx.supplyType).toBe(TokenSupplyType.Finite);
    expect(tx.maxSupply?.toString()).toBe('1000000');
    expect(tx.customFees[0]).toBeInstanceOf(CustomFixedFee);
  });

  it('reports a missing file', async () => {
    await expect(loadTokenConfigFile(path.join(directory, 'nope.json'))).rejects.toThrow(
      /Could not read token config file/
    );
  });

  it('reports invalid JSON', async () => {
    const file = path.join(directory, 'broken.json');
    await fs.writeFile(file, '{ not json');

    await expect(loadTokenConfigFile(file)).rejects.toThrow(/is not valid JSON/);
  });

  it('rejects a file holding something other than an object', async () => {
    const file = path.join(directory, 'array.json');
    await fs.writeFile(file, '[1, 2, 3]');

    await expect(loadTokenConfigFile(file)).rejects.toThrow(/must contain a JSON object/);
  });
});

describe('NFT mint and burn helpers', () => {
  it('decodes metadata in each supported encoding', () => {
    expect(Buffer.from(decodeMetadata('ipfs://cid')).toString('utf-8')).toBe('ipfs://cid');
    expect(Buffer.from(decodeMetadata('aGk=', 'base64')).toString('utf-8')).toBe('hi');
    expect(Buffer.from(decodeMetadata('0x6869', 'hex')).toString('utf-8')).toBe('hi');
  });

  it('validates serial numbers', () => {
    expect(normaliseSerials([1, 2, 3])).toEqual([1, 2, 3]);
    expect(() => normaliseSerials([])).toThrow(/non-empty array/);
    expect(() => normaliseSerials([0])).toThrow(/1 or more/);
    expect(() => normaliseSerials([1.5])).toThrow(/whole numbers/);
  });
});

describe('token create advisories', () => {
  /**
   * A successful token create reports its keys as resolved, so advice to
   * enable a key only appears when the token really lacks it. These cases
   * mirror exactly what createToken passes to advisoriesFor.
   */
  const advise = (options: Partial<TokenCreateOptions>) =>
    advisoriesFor('token_create', {
      adminKey: options.adminKey,
      freezeKey: options.freezeKey,
      wipeKey: options.wipeKey,
      supplyKey: options.supplyKey ?? true,
      kycKey: options.kycKey,
      pauseKey: options.pauseKey,
    });

  it('advises enabling the keys a bare token was created without', () => {
    const advisories = advise({ name: 'Acme', symbol: 'ACME' });

    expect(advisories?.security).toEqual([
      expect.stringContaining('adminKey'),
      expect.stringContaining('freezeKey'),
      expect.stringContaining('wipeKey'),
    ]);
  });

  it('stays silent when every key it would suggest is present', () => {
    expect(
      advise({
        adminKey: { threshold: 2, keys: [memberA.toStringDer(), memberB.toStringDer()] },
        freezeKey: memberA.toStringDer(),
        wipeKey: true,
      })
    ).toBeUndefined();
  });

  it('treats an explicitly disabled key as absent', () => {
    const advisories = advise({ adminKey: false, freezeKey: true, wipeKey: true });

    expect(advisories?.security).toEqual([expect.stringContaining('adminKey')]);
  });
});
