/**
 * Private key parsing: every format a user might paste must map to the
 * right curve. Regression test for the raw-hex-parsed-as-ED25519 bug.
 */

import { PrivateKey } from '@hashgraph/sdk';
import { parsePrivateKey, operatorKeyHint } from '../../src/utils/key-converter';

describe('parsePrivateKey', () => {
  const ecdsa = PrivateKey.generateECDSA();
  const ed25519 = PrivateKey.generateED25519();

  const samePublicKey = (a: PrivateKey, b: PrivateKey): boolean =>
    a.publicKey.toStringRaw() === b.publicKey.toStringRaw();

  it('parses ECDSA DER', () => {
    const parsed = parsePrivateKey(ecdsa.toStringDer());
    expect(parsed.format).toBe('der');
    expect(parsed.assumed).toBe(false);
    expect(samePublicKey(parsed.key, ecdsa)).toBe(true);
  });

  it('parses ED25519 DER', () => {
    const parsed = parsePrivateKey(ed25519.toStringDer());
    expect(parsed.format).toBe('der');
    expect(parsed.key.type).toBe('ED25519');
    expect(samePublicKey(parsed.key, ed25519)).toBe(true);
  });

  it('treats raw hex as ECDSA by default (the portal default)', () => {
    for (const input of [
      ecdsa.toStringRaw(),
      `0x${ecdsa.toStringRaw()}`,
      ` ${ecdsa.toStringRaw()} `,
    ]) {
      const parsed = parsePrivateKey(input);
      expect(parsed.format).toBe('hex');
      expect(parsed.assumed).toBe(true);
      expect(parsed.key.type).toBe('secp256k1');
      expect(samePublicKey(parsed.key, ecdsa)).toBe(true);
    }
  });

  it('parses raw hex as ED25519 when hinted', () => {
    const parsed = parsePrivateKey(ed25519.toStringRaw(), 'ed25519');
    expect(parsed.assumed).toBe(false);
    expect(parsed.key.type).toBe('ED25519');
    expect(samePublicKey(parsed.key, ed25519)).toBe(true);
  });

  it('never produces the wrong curve for raw hex the way fromStringDer does', () => {
    const wrong = PrivateKey.fromStringDer(ecdsa.toStringRaw());
    expect(samePublicKey(wrong, ecdsa)).toBe(false); // the original bug
    const right = parsePrivateKey(ecdsa.toStringRaw()).key;
    expect(samePublicKey(right, ecdsa)).toBe(true);
  });

  it('rejects empty input', () => {
    expect(() => parsePrivateKey('')).toThrow(/empty/);
    expect(() => parsePrivateKey('   ')).toThrow(/empty/);
  });

  it('rejects garbage', () => {
    expect(() => parsePrivateKey('not-a-key')).toThrow(/Unrecognised/);
  });
});

describe('operatorKeyHint', () => {
  const original = process.env.HEDERA_OPERATOR_KEY_TYPE;
  afterEach(() => {
    if (original === undefined) delete process.env.HEDERA_OPERATOR_KEY_TYPE;
    else process.env.HEDERA_OPERATOR_KEY_TYPE = original;
  });

  it('defaults to auto', () => {
    delete process.env.HEDERA_OPERATOR_KEY_TYPE;
    expect(operatorKeyHint()).toBe('auto');
  });

  it('accepts ed25519 and ecdsa spellings', () => {
    process.env.HEDERA_OPERATOR_KEY_TYPE = 'ED25519';
    expect(operatorKeyHint()).toBe('ed25519');
    process.env.HEDERA_OPERATOR_KEY_TYPE = 'ecdsa_secp256k1';
    expect(operatorKeyHint()).toBe('ecdsa');
  });
});
