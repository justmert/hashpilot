/**
 * Mirror Node request resilience and the missing-operator guard.
 *
 * Both were found by driving the server as a real MCP client:
 *
 *   - `account_info` failed with a bare "This operation was aborted" and
 *     succeeded on an immediate retry. The public mirror nodes return 5xx and
 *     time out under load, and there was no retry and no explanation — the raw
 *     `AbortError` message reached the caller.
 *   - With no operator configured, signing tools failed deep inside the SDK
 *     with "`transactionId` must be set or `client` must be provided with
 *     `freezeWith`", which never mentions the missing credentials.
 */

import { jest } from '@jest/globals';
import { HederaClientService } from '../../src/services/hedera-client';

const originalFetch = global.fetch;

function mockFetch(...responses: Array<{ status: number; body?: string } | Error>) {
  const calls: string[] = [];
  const fn = jest.fn(async (url: string) => {
    calls.push(String(url));
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected extra fetch call');
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      statusText: `status ${next.status}`,
      text: async () => next.body ?? '{}',
    } as any;
  });
  global.fetch = fn as any;
  return { fn, calls };
}

function abortError(): Error {
  const error = new Error('This operation was aborted');
  error.name = 'AbortError';
  return error;
}

describe('mirrorGet resilience', () => {
  let service: HederaClientService;

  beforeEach(() => {
    service = new HederaClientService();
    jest
      .spyOn(service, 'getMirrorNodeUrl')
      .mockReturnValue('https://testnet.mirrornode.hedera.com');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const mirrorGet = (service: HederaClientService, path: string, timeout = 50, attempts = 3) =>
    (service as any).mirrorGet(path, timeout, attempts);

  it('retries a 502 and returns the eventual success', async () => {
    const { fn } = mockFetch(
      { status: 502 },
      { status: 502 },
      { status: 200, body: '{"balance":{"balance":123}}' }
    );

    await expect(mirrorGet(service, '/api/v1/accounts/0.0.98')).resolves.toEqual({
      balance: { balance: 123 },
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries an aborted request and reports it as a timeout if it never succeeds', async () => {
    const { fn } = mockFetch(abortError(), abortError(), abortError());

    // The bare "This operation was aborted" must not reach the caller
    await expect(mirrorGet(service, '/api/v1/accounts/0.0.98')).rejects.toThrow(
      /Mirror node request timed out after 50ms/
    );
    await expect(mirrorGet(service, '/api/v1/accounts/0.0.98', 50, 0)).rejects.not.toThrow(
      /^This operation was aborted$/
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 4xx, which would fail identically', async () => {
    const { fn } = mockFetch({
      status: 400,
      body: '{"_status":{"messages":[{"message":"Invalid parameter: account.id"}]}}',
    });

    await expect(mirrorGet(service, '/api/v1/accounts/not-an-account')).rejects.toThrow(
      /Invalid parameter: account.id/
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds on the first attempt without retrying', async () => {
    const { fn } = mockFetch({ status: 200, body: '{"ok":true}' });

    await expect(mirrorGet(service, '/api/v1/accounts/0.0.2')).resolves.toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('getClient operator guard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('explains that no operator is configured instead of failing inside the SDK', () => {
    const service = new HederaClientService();
    (service as any).client = {} as any;
    (service as any).config = { network: 'testnet' };

    expect(() => service.getClient()).toThrow(/no operator account is configured/i);
    expect(() => service.getClient()).toThrow(/HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY/);
    // It must also say what still works, so the user is not left stuck
    expect(() => service.getClient()).toThrow(/read-only tools/i);
  });

  it('reports an unusable operator key rather than the missing-operator message', () => {
    const service = new HederaClientService();
    (service as any).client = {} as any;
    (service as any).config = { network: 'testnet', operatorId: '0.0.2', operatorKey: 'abc' };
    (service as any).operatorError = 'Operator key does not match account 0.0.2';

    expect(() => service.getClient()).toThrow(/does not match account 0.0.2/);
  });

  it('returns the client when an operator is configured and valid', () => {
    const service = new HederaClientService();
    const client = { marker: true } as any;
    (service as any).client = client;
    (service as any).config = { network: 'testnet', operatorId: '0.0.2', operatorKey: 'abc' };
    (service as any).operatorError = null;

    expect(service.getClient()).toBe(client);
  });
});
