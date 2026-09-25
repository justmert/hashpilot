/**
 * Chunk overlap boundaries.
 *
 * The overlap between consecutive chunks used to be a character slice sized by
 * a token ratio, so it began mid-word and mid-code-block. Indexed chunks opened
 * with fragments like "onst txResponse = await ..." and carried a closing ```
 * with no opener, which made retrieved code examples truncated and unlabelled.
 */

import { DocumentChunker } from '../../src/utils/document-chunker';

const chunker = new DocumentChunker();
const overlap = (text: string): string => (chunker as any).getOverlapText(text);

describe('getOverlapText', () => {
  it('returns short text unchanged', () => {
    expect(overlap('a single short line')).toBe('a single short line');
  });

  it('never begins in the middle of a line', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} of the document body text`);
    const result = overlap(lines.join('\n'));

    expect(result.length).toBeGreaterThan(0);
    expect(lines).toContain(result.split('\n')[0]);
  });

  it('keeps the tail of the text, not the head', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} of the document body text`);
    const result = overlap(lines.join('\n'));

    expect(result).toContain('line 199');
    expect(result).not.toContain('line 0 of');
  });

  it('re-opens a fenced block when the overlap starts inside one', () => {
    const text = [
      'Some introductory prose about creating a token on the network.',
      '```javascript',
      ...Array.from({ length: 120 }, (_, i) => `const value${i} = await client.call(${i});`),
      '```',
    ].join('\n');

    const result = overlap(text);

    // The slice lands inside the code block, so it must carry an opening fence
    expect(result.split('\n')[0]).toBe('```javascript');
    expect(result.match(/```/g)).toHaveLength(2);
  });

  it('does not add a fence when the overlap sits outside a code block', () => {
    const text = [
      '```javascript',
      'const client = Client.forTestnet();',
      '```',
      ...Array.from(
        { length: 150 },
        (_, i) => `Explanatory sentence number ${i} about the result.`
      ),
    ].join('\n');

    const result = overlap(text);
    expect(result).not.toContain('```');
  });
});
