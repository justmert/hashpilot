#!/usr/bin/env tsx
/**
 * Mock OpenAI API for end-to-end RAG tests without an API key.
 *
 * Implements just enough of the OpenAI REST surface for HashPilot:
 *   POST /v1/embeddings         deterministic 512-dim bag-of-words vectors
 *   POST /v1/chat/completions   canned answer that quotes the supplied context
 *
 * Point the SDK at it with OPENAI_BASE_URL=http://127.0.0.1:4141/v1 and any
 * OPENAI_API_KEY. Embeddings are hash-based, so they are NOT comparable with
 * real OpenAI vectors; use a scratch collection (RAG_COLLECTION).
 *
 * Usage: npx tsx scripts/mock-openai.ts [port]
 */

import http from 'http';
import { createHash } from 'crypto';

const PORT = parseInt(process.argv[2] || process.env.MOCK_OPENAI_PORT || '4141', 10);
const DIMENSIONS = 512;

/** Bag-of-words hashing embedding: shared vocabulary -> similar vectors */
export function embed(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 2);
  for (const token of tokens) {
    const digest = createHash('sha1').update(token).digest();
    const index = digest.readUInt32BE(0) % DIMENSIONS;
    const sign = digest[4] % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

let requests = 0;

const server = http.createServer(async (req, res) => {
  requests++;
  try {
    if (req.method === 'POST' && req.url?.endsWith('/embeddings')) {
      const body = await readJson(req);
      const inputs: string[] = Array.isArray(body.input) ? body.input : [String(body.input)];
      return send(res, 200, {
        object: 'list',
        model: body.model || 'mock-embedding',
        data: inputs.map((text, index) => ({ object: 'embedding', index, embedding: embed(text) })),
        usage: {
          prompt_tokens: inputs.join(' ').length / 4,
          total_tokens: inputs.join(' ').length / 4,
        },
      });
    }

    if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
      const body = await readJson(req);
      const messages: Array<{ role: string; content: string }> = body.messages || [];
      const user = messages.filter((m) => m.role === 'user').pop()?.content || '';
      const contextMatch = user.match(
        /Context from Hedera documentation:\n([\s\S]*?)\n\nQuestion:/
      );
      const sources = (contextMatch?.[1] || '').match(/^Source: (.+)$/gm) || [];
      const question = user.match(/Question: ([\s\S]*?)(\n|$)/)?.[1] || '(no question)';
      const answer =
        `MOCK ANSWER for "${question.trim()}". ` +
        (sources.length
          ? `Based on ${sources.length} documentation excerpt(s): ${sources.map((s) => s.replace('Source: ', '')).join('; ')}.`
          : 'No documentation context was supplied.') +
        '\n\n```javascript\n// mock code example\nconsole.log("hedera");\n```';
      return send(res, 200, {
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model || 'mock-chat',
        choices: [
          { index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' },
        ],
        usage: {
          prompt_tokens: user.length / 4,
          completion_tokens: answer.length / 4,
          total_tokens: (user.length + answer.length) / 4,
        },
      });
    }

    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true, requests });
    }

    send(res, 404, { error: { message: `mock: unsupported ${req.method} ${req.url}` } });
  } catch (error) {
    send(res, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `mock OpenAI listening on http://127.0.0.1:${PORT}/v1 (embeddings + chat completions)`
  );
});
