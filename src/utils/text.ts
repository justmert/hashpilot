/**
 * Text sanitisation shared by the indexing pipeline and the vector store.
 */

/**
 * Matches an unpaired UTF-16 surrogate: a high surrogate with no low surrogate
 * after it, or a low surrogate with no high surrogate before it.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Remove unpaired surrogates from a string.
 *
 * Source files fetched from GitHub sometimes contain a truncated multi-byte
 * character. JavaScript tolerates the resulting lone surrogate, but
 * `JSON.stringify` emits it as `\ud83d`, which is not valid UTF-8, and
 * ChromaDB's server rejects the entire batch with "lone leading surrogate in
 * hex escape". Valid surrogate pairs (real emoji) are left untouched.
 */
export function stripLoneSurrogates(value: string): string {
  // Fast path: the vast majority of chunks contain no surrogates at all.
  // `test` on a /g regex advances lastIndex, so reset before using it.
  LONE_SURROGATE.lastIndex = 0;
  if (!LONE_SURROGATE.test(value)) return value;
  LONE_SURROGATE.lastIndex = 0;
  return value.replace(LONE_SURROGATE, '');
}
