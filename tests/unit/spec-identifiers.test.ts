/**
 * Named proposals and standards must reach retrieval as exact identifiers.
 *
 * Asked what HIP-904 changes, semantic search returned HIP-655, HIP-719 and
 * release notes but never HIP-904, although it is indexed. Queries that name an
 * identifier now also fetch the chunks containing it.
 */

import { RAGService } from '../../src/services/rag-service';

const extract = (query: string) => RAGService.extractSpecIdentifiers(query);

describe('extractSpecIdentifiers', () => {
  it('finds a HIP and an HCS standard', () => {
    expect(extract('What does HIP-904 change?')).toEqual(['HIP-904']);
    expect(extract('Explain the HCS-10 agent standard')).toEqual(['HCS-10']);
  });

  it('normalises spacing, case and leading zeros', () => {
    expect(extract('hip 904 and hcs10 and HIP-0540')).toEqual(['HIP-904', 'HCS-10', 'HIP-540']);
  });

  it('deduplicates and caps at three identifiers', () => {
    expect(extract('HIP-1 HIP-1 HIP-2 HIP-3 HIP-4')).toEqual(['HIP-1', 'HIP-2', 'HIP-3']);
  });

  it('ignores queries that name no identifier', () => {
    expect(extract('How do I create a token?')).toEqual([]);
    expect(extract('chip-904 is not a HIP')).toEqual([]);
  });
});
