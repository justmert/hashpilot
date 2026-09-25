/**
 * Falling back to Hedera's official documentation MCP.
 *
 * HashPilot's own index needs an OpenAI key to embed a query, so every user
 * without one got an error from all four documentation tools. They now answer
 * from docs.hedera.com/mcp when the index cannot be used.
 */

import { jest } from '@jest/globals';
import { parseOfficialResult, searchOfficialDocs } from '../../src/services/hedera-docs-mcp';
import { isIndexUnavailable, officialDocsFallback } from '../../src/tools/rag';

const originalFetch = global.fetch;

function sseResponse(texts: string[]) {
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    result: { content: texts.map((text) => ({ type: 'text', text })) },
  };
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
  } as any;
}

const RESULT = [
  'Title: Transfer cryptocurrency',
  'Link: https://docs.hedera.com/native/accounts/transfer',
  'Page: native/accounts/transfer',
  'Content: Use TransferTransaction to move HBAR.',
  'It spans lines.',
].join('\n');

afterEach(() => {
  global.fetch = originalFetch;
});

describe('parseOfficialResult', () => {
  it('reads title, link and multi-line content', () => {
    expect(parseOfficialResult(RESULT)).toEqual({
      title: 'Transfer cryptocurrency',
      url: 'https://docs.hedera.com/native/accounts/transfer',
      content: 'Use TransferTransaction to move HBAR.\nIt spans lines.',
    });
  });

  it('skips a block without a title or link', () => {
    expect(parseOfficialResult('Content: orphaned text')).toBeNull();
  });
});

describe('searchOfficialDocs', () => {
  it('parses a server-sent-events response and applies the limit', async () => {
    global.fetch = jest.fn(async () => sseResponse([RESULT, RESULT, RESULT])) as any;
    const results = await searchOfficialDocs('transfer hbar', { limit: 2 });
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Transfer cryptocurrency');
  });

  it('bounds the length of each result', async () => {
    const long = RESULT.replace('It spans lines.', 'x'.repeat(5000));
    global.fetch = jest.fn(async () => sseResponse([long])) as any;
    const [result] = await searchOfficialDocs('q', { maxContentLength: 100 });
    expect(result.content.length).toBe(101); // 100 characters plus the ellipsis
  });

  it('surfaces an HTTP failure', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
    })) as any;
    await expect(searchOfficialDocs('q')).rejects.toThrow(/503/);
  });
});

describe('isIndexUnavailable', () => {
  it.each([
    'RAG initialization failed: Invalid RAG configuration: openaiApiKey is required',
    '401 Incorrect API key provided',
    '429 You exceeded your current quota',
    'Failed to connect to ChromaDB after 3 attempts',
    'fetch failed',
  ])('treats "%s" as the index being unavailable', (message) => {
    expect(isIndexUnavailable(new Error(message))).toBe(true);
  });

  it('does not hide ordinary request errors', () => {
    expect(isIndexUnavailable(new Error('Unknown language: cobol'))).toBe(false);
  });
});

describe('officialDocsFallback', () => {
  it('labels the answer as coming from the official docs and says why', async () => {
    global.fetch = jest.fn(async () => sseResponse([RESULT])) as any;
    const response: any = await officialDocsFallback(
      'docs_ask',
      'How do I transfer HBAR?',
      'no OPENAI_API_KEY is configured'
    );

    const text = response.content[0].text as string;
    const body = JSON.parse(text.split('\n\n---')[0]);
    expect(response.isError).toBeUndefined();
    expect(body.source).toBe('official-hedera-docs-mcp');
    expect(body.note).toMatch(/because no OPENAI_API_KEY is configured/);
    expect(body.note).toMatch(/No answer was written/);
    expect(body.results[0].url).toBe('https://docs.hedera.com/native/accounts/transfer');
    expect(text).toMatch(/\*\*Sources \(docs\.hedera\.com\):\*\*/);
  });

  it('reports both failures when the official search is down too', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('fetch failed');
    }) as any;
    const response: any = await officialDocsFallback('docs_search', 'q', 'no key');
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(
      /index is unavailable \(no key\).*official Hedera docs search failed too/
    );
  });
});
