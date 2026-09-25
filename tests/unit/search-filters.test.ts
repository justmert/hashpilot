/**
 * ChromaDB metadata filter construction.
 *
 * The language filter used to be commented out with "skip for now due to
 * ChromaDB compatibility issues": the v2 API rejects a `where` object carrying
 * more than one key, so `{ hasCode: true, language: 'go' }` failed and the
 * filter was dropped rather than combined with `$and`. The visible symptom was
 * `docs_get_example({ language: 'go' })` answering with Rust.
 */

import { ChromaDBService } from '../../src/services/chromadb-service';

const service = new ChromaDBService({ url: 'http://localhost:8000' });
const build = (filters?: any): any => (service as any).buildWhereClause(filters);
const matches = (metadata: any, filters?: any): boolean =>
  (service as any).matchesPostFilters(metadata, filters);

describe('buildWhereClause', () => {
  it('returns null when there is nothing to filter on', () => {
    expect(build(undefined)).toBeNull();
    expect(build({})).toBeNull();
  });

  it('emits a bare condition when only one filter is set', () => {
    expect(build({ hasCode: true })).toEqual({ hasCode: { $eq: true } });
  });

  it('combines several filters with $and rather than stacking keys', () => {
    const where = build({ hasCode: true, language: 'go' });

    expect(Object.keys(where)).toEqual(['$and']);
    expect(where.$and).toEqual([{ language: { $eq: 'go' } }, { hasCode: { $eq: true } }]);
  });

  it('keeps hasCode: false meaningful instead of dropping it', () => {
    expect(build({ hasCode: false })).toEqual({ hasCode: { $eq: false } });
  });

  it('uses $in for a list of languages or content types', () => {
    expect(build({ language: ['go', 'rust'] })).toEqual({ language: { $in: ['go', 'rust'] } });
    expect(build({ contentType: ['tutorial', 'reference'] })).toEqual({
      contentType: { $in: ['tutorial', 'reference'] },
    });
  });

  it('restricts to one document, combined with other filters', () => {
    expect(build({ documentId: 'hip-904-HIP-hip-904-md' })).toEqual({
      documentId: { $eq: 'hip-904-HIP-hip-904-md' },
    });
    expect(build({ hasCode: true, documentId: 'd1' })).toEqual({
      $and: [{ hasCode: { $eq: true } }, { documentId: { $eq: 'd1' } }],
    });
  });

  it('leaves tag and URL filters out of the where clause', () => {
    // Neither maps onto a ChromaDB metadata operator: tags are stored as one
    // comma-joined string and URL matching is a substring test.
    expect(build({ tags: ['hts'], urlPattern: '/tutorials/' })).toBeNull();
  });
});

describe('matchesPostFilters', () => {
  const metadata = { url: 'https://docs.hedera.com/native/tutorials/tokens/x', tags: 'hts,token' };

  it('matches a URL substring', () => {
    expect(matches(metadata, { urlPattern: '/tutorials/' })).toBe(true);
    expect(matches(metadata, { urlPattern: '/sdk/' })).toBe(false);
  });

  it('requires every requested tag to be present', () => {
    expect(matches(metadata, { tags: ['hts'] })).toBe(true);
    expect(matches(metadata, { tags: ['hts', 'token'] })).toBe(true);
    expect(matches(metadata, { tags: ['hts', 'hcs'] })).toBe(false);
  });

  it('passes everything through when no post-filter is set', () => {
    expect(matches(metadata, {})).toBe(true);
    expect(matches({}, undefined)).toBe(true);
  });
});
