/**
 * Client for Hedera's official documentation MCP server.
 *
 * HashPilot's own documentation index needs an OpenAI key to embed each query,
 * so a user who has not supplied one got an error from all four documentation
 * tools. Hedera hosts a keyless documentation search at docs.hedera.com/mcp;
 * when HashPilot's index cannot be used, the documentation tools answer from it
 * instead. It covers docs.hedera.com and hips.hedera.com but not the SDK
 * example repositories, HCS standards or other sources HashPilot indexes, so
 * results from it are labelled as coming from the fallback.
 */

import logger from '../utils/logger.js';

export const HEDERA_DOCS_MCP_URL = 'https://docs.hedera.com/mcp';

export interface OfficialDocResult {
  title: string;
  url: string;
  content: string;
}

/** Each search result arrives as one text block of "Title:/Link:/Page:/Content:" lines */
export function parseOfficialResult(text: string): OfficialDocResult | null {
  const title = text.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
  const url = text.match(/^Link:\s*(\S+)/m)?.[1]?.trim();
  const contentIndex = text.search(/^Content:/m);
  if (!title || !url) return null;

  const content = contentIndex >= 0 ? text.slice(contentIndex + 'Content:'.length).trim() : '';
  return { title, url, content };
}

/** Pull the JSON-RPC payload out of a response that may be plain JSON or server-sent events */
function parseRpcBody(body: string): any {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }
  const dataLines = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());
  if (dataLines.length === 0) {
    throw new Error('Empty response from the Hedera docs MCP server');
  }
  return JSON.parse(dataLines[dataLines.length - 1]);
}

/**
 * Search the official Hedera documentation.
 *
 * `maxContentLength` bounds each result: a single section can run to several
 * thousand characters and a search returns ten of them.
 */
export async function searchOfficialDocs(
  query: string,
  options: { limit?: number; maxContentLength?: number; timeoutMs?: number } = {}
): Promise<OfficialDocResult[]> {
  const limit = options.limit ?? 5;
  const maxContentLength = options.maxContentLength ?? 2000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

  try {
    const response = await fetch(HEDERA_DOCS_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search_hedera', arguments: { query } },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Hedera docs MCP returned ${response.status} ${response.statusText}`);
    }

    const payload = parseRpcBody(await response.text());
    if (payload.error) {
      throw new Error(`Hedera docs MCP error: ${payload.error.message || 'unknown'}`);
    }

    const items: Array<{ type?: string; text?: string }> = payload.result?.content || [];
    return items
      .map((item) => (item.type === 'text' && item.text ? parseOfficialResult(item.text) : null))
      .filter((result): result is OfficialDocResult => result !== null)
      .slice(0, limit)
      .map((result) => ({
        ...result,
        content:
          result.content.length > maxContentLength
            ? `${result.content.slice(0, maxContentLength)}…`
            : result.content,
      }));
  } catch (error: any) {
    const message =
      error?.name === 'AbortError' ? 'Hedera docs MCP request timed out' : error?.message;
    logger.warn('Official Hedera docs search failed', { query, error: message });
    throw new Error(message || 'Hedera docs MCP request failed');
  } finally {
    clearTimeout(timer);
  }
}
