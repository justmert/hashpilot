/**
 * Pruning chunks a full re-index did not rewrite.
 *
 * Indexing upserts, so pages deleted or renamed upstream kept their chunks
 * forever. Pruning is also the one step that can destroy the index — a source
 * that fails or comes back empty makes everything it owns look stale — so the
 * plan refuses anything that looks like a failed run rather than churn.
 */

import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { MAX_PRUNE_FRACTION, planPrune, readManifest } from '../../src/utils/index-prune';

const ids = (n: number, prefix = 'doc') => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

describe('planPrune', () => {
  it('marks only the chunks the run did not write as stale', () => {
    const existing = ids(100);
    const written = new Set(ids(97));
    const plan = planPrune(existing, written);

    expect(plan.safe).toBe(true);
    expect(plan.stale).toEqual(['doc-97', 'doc-98', 'doc-99']);
  });

  it('does not count newly written chunks as stale', () => {
    const plan = planPrune(ids(10), new Set([...ids(10), 'new-0', 'new-1']));
    expect(plan).toMatchObject({ safe: true, stale: [], written: 12 });
  });

  it('refuses when the run wrote nothing', () => {
    const plan = planPrune(ids(100), new Set());
    expect(plan.safe).toBe(false);
    expect(plan.reason).toMatch(/wrote no chunks/);
  });

  it('refuses to delete more than the limit in one run', () => {
    // A whole source failing silently would look like this
    const plan = planPrune(ids(100), new Set(ids(80)));
    expect(plan.safe).toBe(false);
    expect(plan.reason).toMatch(/20 of 100 chunks \(20\.0%\)/);
  });

  it('allows deletion right at the limit', () => {
    const keep = Math.round(100 * (1 - MAX_PRUNE_FRACTION));
    expect(planPrune(ids(100), new Set(ids(keep))).safe).toBe(true);
  });

  it('is safe on an empty collection', () => {
    expect(planPrune([], new Set(ids(5)))).toMatchObject({ safe: true, stale: [] });
  });
});

describe('readManifest', () => {
  it('reads the ids written to one collection', () => {
    const text = 'hedera-docs-all\ta-1\nother\tb-1\nhedera-docs-all\ta-2\n\n';
    expect([...readManifest(text, 'hedera-docs-all')]).toEqual(['a-1', 'a-2']);
  });
});

describe('manifest recording', () => {
  it('appends every id written while HASHPILOT_INDEX_MANIFEST is set', async () => {
    const manifest = path.join(mkdtempSync(path.join(tmpdir(), 'manifest-')), 'written.tsv');
    process.env.HASHPILOT_INDEX_MANIFEST = manifest;

    const { ChromaDBService } = await import('../../src/services/chromadb-service');
    const service = new ChromaDBService({ url: 'http://localhost:0' });
    const upserts: any[] = [];
    (service as any).getDefaultCollection = async () => ({
      name: 'hedera-docs-all',
      upsert: async (batch: any) => upserts.push(batch),
    });

    const chunk = (id: string) => ({
      id,
      documentId: 'd',
      text: 'text',
      index: 0,
      totalChunks: 1,
      embedding: [0.1],
      metadata: {
        url: 'u',
        title: 't',
        contentType: 'guide',
        hasCode: false,
        tags: [],
        crawledAt: 'now',
      },
    });
    await service.addChunks([chunk('x-1'), chunk('x-2')] as any);
    delete process.env.HASHPILOT_INDEX_MANIFEST;

    expect(upserts).toHaveLength(1);
    expect(readFileSync(manifest, 'utf-8')).toBe('hedera-docs-all\tx-1\nhedera-docs-all\tx-2\n');
  });
});
