/**
 * Unpaired surrogate handling.
 *
 * Regression coverage for a real indexing failure: an SDK example file fetched
 * from GitHub contained a truncated multi-byte character, so one chunk carried
 * a lone high surrogate. `JSON.stringify` emitted it as `\ud83d`, which is not
 * valid UTF-8, and ChromaDB rejected the entire 100-chunk batch with
 * "lone leading surrogate in hex escape", aborting the whole SDK index.
 */

import { stripLoneSurrogates } from '../../src/utils/text';

const HIGH = '\uD83D'; // lone high surrogate
const LOW = '\uDE00'; // lone low surrogate
const EMOJI = '😀'; // 😀, a valid pair

describe('stripLoneSurrogates', () => {
  it('removes a lone high surrogate', () => {
    expect(stripLoneSurrogates(`before ${HIGH} after`)).toBe('before  after');
  });

  it('removes a lone low surrogate', () => {
    expect(stripLoneSurrogates(`before ${LOW} after`)).toBe('before  after');
  });

  it('keeps valid surrogate pairs intact', () => {
    expect(stripLoneSurrogates(`hi ${EMOJI} there`)).toBe(`hi ${EMOJI} there`);
    expect(stripLoneSurrogates('日本語 ok ✅')).toBe('日本語 ok ✅');
  });

  it('keeps a valid pair while dropping an adjacent lone surrogate', () => {
    expect(stripLoneSurrogates(`${EMOJI}${HIGH}`)).toBe(EMOJI);
    expect(stripLoneSurrogates(`${HIGH}${EMOJI}`)).toBe(EMOJI);
  });

  it('returns ordinary strings untouched', () => {
    const plain = 'const client = Client.forTestnet();';
    expect(stripLoneSurrogates(plain)).toBe(plain);
    expect(stripLoneSurrogates('')).toBe('');
  });

  it('is idempotent and safe to apply repeatedly', () => {
    const once = stripLoneSurrogates(`a${HIGH}b${EMOJI}c${LOW}d`);
    expect(stripLoneSurrogates(once)).toBe(once);
    expect(once).toBe(`ab${EMOJI}cd`);
  });

  it('produces output that survives a JSON round trip as valid UTF-8', () => {
    const dirty = `example ${HIGH} code ${EMOJI}`;
    const cleaned = stripLoneSurrogates(dirty);

    // The raw string encodes to replacement bytes; the cleaned one does not.
    expect(Buffer.from(cleaned, 'utf8').toString('utf8')).toBe(cleaned);
    expect(JSON.parse(JSON.stringify(cleaned))).toBe(cleaned);
    expect(JSON.stringify(cleaned)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
  });

  it('handles many lone surrogates without the /g lastIndex trap', () => {
    // A global regex used with .test() advances lastIndex; calling twice on
    // similar inputs must not skip a match.
    for (let i = 0; i < 5; i++) {
      expect(stripLoneSurrogates(`chunk${i} ${HIGH}`)).toBe(`chunk${i} `);
    }
  });
});
