/**
 * HCS builder unit tests.
 *
 * Topic transactions are constructed and inspected through their getters, and
 * the mirror node query string is built as a plain string, so nothing here
 * touches the network or needs an operator account.
 */

import { KeyList, PrivateKey, PublicKey } from '@hashgraph/sdk';

import {
  buildTopicCreateTransaction,
  buildTopicMessageQuery,
  buildTopicUpdateTransaction,
} from '../../src/services/hedera-client.js';

const operatorKey = PrivateKey.generateECDSA().publicKey;
const memberA = PrivateKey.generateED25519().publicKey;
const memberB = PrivateKey.generateECDSA().publicKey;

/** Parse the query part of a mirror node path into repeatable parameters */
function queryOf(path: string): URLSearchParams {
  const [, query = ''] = path.split('?');
  return new URLSearchParams(query);
}

describe('buildTopicCreateTransaction', () => {
  it('creates a public topic by default', () => {
    const tx = buildTopicCreateTransaction({}, operatorKey);

    expect(tx.getAdminKey()).toBeNull();
    expect(tx.getSubmitKey()).toBeNull();
    expect(tx.autoRenewPeriod?.seconds.toString()).toBe('7776000');
  });

  it('uses the operator key when a key parameter is true', () => {
    const tx = buildTopicCreateTransaction({ adminKey: true, submitKey: true }, operatorKey);

    expect(tx.getAdminKey()?.toString()).toBe(operatorKey.toString());
    expect(tx.getSubmitKey()?.toString()).toBe(operatorKey.toString());
  });

  it('makes a private topic with an explicit submit key', () => {
    const tx = buildTopicCreateTransaction({ submitKey: memberA.toStringDer() }, operatorKey);

    expect((tx.getSubmitKey() as PublicKey).toString()).toBe(memberA.toString());
    expect(tx.getAdminKey()).toBeNull();
  });

  it('builds a threshold submit key for multi-signature control', () => {
    const tx = buildTopicCreateTransaction(
      { submitKey: { threshold: 2, keys: [memberA.toStringDer(), memberB.toStringDer()] } },
      operatorKey
    );

    const submitKey = tx.getSubmitKey();
    expect(submitKey).toBeInstanceOf(KeyList);
    expect((submitKey as KeyList).threshold).toBe(2);
    expect((submitKey as KeyList).toArray()).toHaveLength(2);
  });

  it('sets the memo, auto-renew period and auto-renew account', () => {
    const tx = buildTopicCreateTransaction(
      { memo: 'audit log', autoRenewPeriod: 5184000, autoRenewAccountId: '0.0.4004' },
      operatorKey
    );

    expect(tx.getTopicMemo()).toBe('audit log');
    expect(tx.autoRenewPeriod?.seconds.toString()).toBe('5184000');
    expect(tx.getAutoRenewAccountId()?.toString()).toBe('0.0.4004');
  });

  it('explains that true needs an operator key when none is configured', () => {
    expect(() => buildTopicCreateTransaction({ adminKey: true }, null)).toThrow(
      /adminKey: no operator key/
    );
  });

  it('works without an operator key when the keys are explicit', () => {
    const tx = buildTopicCreateTransaction({ submitKey: memberA.toStringDer() }, null);

    expect((tx.getSubmitKey() as PublicKey).toString()).toBe(memberA.toString());
  });
});

describe('buildTopicUpdateTransaction', () => {
  it('replaces the submit key', () => {
    const tx = buildTopicUpdateTransaction(
      '0.0.5005',
      { submitKey: memberB.toStringDer() },
      operatorKey
    );

    expect(tx.topicId?.toString()).toBe('0.0.5005');
    expect((tx.submitKey as PublicKey).toString()).toBe(memberB.toString());
  });

  it('clears a key with an empty key list, which is how the network removes it', () => {
    const tx = buildTopicUpdateTransaction(
      '0.0.5005',
      { clearAdminKey: true, clearSubmitKey: true },
      operatorKey
    );

    expect(tx.adminKey).toBeInstanceOf(KeyList);
    expect((tx.adminKey as KeyList).toArray()).toHaveLength(0);
    expect(tx.submitKey).toBeInstanceOf(KeyList);
    expect((tx.submitKey as KeyList).toArray()).toHaveLength(0);

    // The transaction body must actually carry the empty list, otherwise the
    // network sees no key field and leaves the key in place.
    const body = (
      tx as unknown as { _makeTransactionData(): { adminKey?: unknown; submitKey?: unknown } }
    )._makeTransactionData();
    expect(body.adminKey).toEqual({ keyList: { keys: [] } });
    expect(body.submitKey).toEqual({ keyList: { keys: [] } });
  });

  it('leaves an untouched key alone', () => {
    const tx = buildTopicUpdateTransaction('0.0.5005', { memo: 'renamed' }, operatorKey);

    expect(tx.topicMemo).toBe('renamed');
    expect(tx.adminKey).toBeNull();
    expect(tx.submitKey).toBeNull();
  });

  it('refuses to both set and clear the same key', () => {
    expect(() =>
      buildTopicUpdateTransaction('0.0.5005', { adminKey: true, clearAdminKey: true }, operatorKey)
    ).toThrow(/Pass either adminKey or clearAdminKey/);

    expect(() =>
      buildTopicUpdateTransaction(
        '0.0.5005',
        { submitKey: true, clearSubmitKey: true },
        operatorKey
      )
    ).toThrow(/Pass either submitKey or clearSubmitKey/);
  });

  it('updates the auto-renew settings', () => {
    const tx = buildTopicUpdateTransaction(
      '0.0.5005',
      { autoRenewPeriod: 5184000, autoRenewAccountId: '0.0.4004' },
      operatorKey
    );

    expect(tx.autoRenewPeriod?.seconds.toString()).toBe('5184000');
    expect(tx.autoRenewAccountId?.toString()).toBe('0.0.4004');
  });
});

describe('buildTopicMessageQuery', () => {
  it('builds a bare path when there are no filters', () => {
    expect(buildTopicMessageQuery('0.0.5005')).toBe('/api/v1/topics/0.0.5005/messages');
  });

  it('matches an exact sequence number', () => {
    const params = queryOf(buildTopicMessageQuery('0.0.5005', { sequenceNumber: 7 }));

    expect(params.getAll('sequencenumber')).toEqual(['7']);
  });

  it('applies each sequence-number operator', () => {
    expect(
      queryOf(buildTopicMessageQuery('0.0.5005', { sequenceNumberGt: 5 })).get('sequencenumber')
    ).toBe('gt:5');
    expect(
      queryOf(buildTopicMessageQuery('0.0.5005', { sequenceNumberGte: 5 })).get('sequencenumber')
    ).toBe('gte:5');
    expect(
      queryOf(buildTopicMessageQuery('0.0.5005', { sequenceNumberLt: 5 })).get('sequencenumber')
    ).toBe('lt:5');
    expect(
      queryOf(buildTopicMessageQuery('0.0.5005', { sequenceNumberLte: 5 })).get('sequencenumber')
    ).toBe('lte:5');
  });

  it('combines two operators into a range', () => {
    const params = queryOf(
      buildTopicMessageQuery('0.0.5005', { sequenceNumberGte: 10, sequenceNumberLte: 20 })
    );

    expect(params.getAll('sequencenumber')).toEqual(['gte:10', 'lte:20']);
  });

  it('bounds the consensus timestamp', () => {
    const params = queryOf(
      buildTopicMessageQuery('0.0.5005', {
        timestampFrom: '1700000000.000000000',
        timestampTo: '1700003600.000000000',
      })
    );

    expect(params.getAll('timestamp')).toEqual([
      'gte:1700000000.000000000',
      'lte:1700003600.000000000',
    ]);
  });

  it('passes a raw timestamp filter through unchanged', () => {
    const params = queryOf(
      buildTopicMessageQuery('0.0.5005', { timestamp: 'gt:1700000000.000000000' })
    );

    expect(params.getAll('timestamp')).toEqual(['gt:1700000000.000000000']);
  });

  it('carries the limit and the order', () => {
    const params = queryOf(buildTopicMessageQuery('0.0.5005', { limit: 25, order: 'desc' }));

    expect(params.get('limit')).toBe('25');
    expect(params.get('order')).toBe('desc');
  });

  it('builds every filter at once against the right path', () => {
    const path = buildTopicMessageQuery('0.0.5005', {
      sequenceNumberGte: 1,
      sequenceNumberLt: 100,
      timestampFrom: '1700000000.000000000',
      limit: 50,
      order: 'asc',
    });

    expect(path.startsWith('/api/v1/topics/0.0.5005/messages?')).toBe(true);
    const params = queryOf(path);
    expect(params.getAll('sequencenumber')).toEqual(['gte:1', 'lt:100']);
    expect(params.get('timestamp')).toBe('gte:1700000000.000000000');
    expect(params.get('limit')).toBe('50');
    expect(params.get('order')).toBe('asc');
  });

  it('rejects filters the mirror node would not accept', () => {
    expect(() => buildTopicMessageQuery('')).toThrow(/topicId is required/);
    expect(() => buildTopicMessageQuery('0.0.5005', { sequenceNumber: -1 })).toThrow(
      /sequenceNumber must be a whole number/
    );
    expect(() => buildTopicMessageQuery('0.0.5005', { sequenceNumberGt: 1.5 })).toThrow(
      /sequenceNumberGt must be a whole number/
    );
    expect(() => buildTopicMessageQuery('0.0.5005', { limit: 0 })).toThrow(/limit must be/);
    expect(() => buildTopicMessageQuery('0.0.5005', { limit: 500 })).toThrow(/limit must be/);
    expect(() => buildTopicMessageQuery('0.0.5005', { order: 'sideways' as never })).toThrow(
      /order must be/
    );
  });
});
