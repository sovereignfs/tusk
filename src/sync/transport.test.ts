import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from './format';
import { fetchTransport } from './transport';

const request = { protocol: PROTOCOL_VERSION, cursor: 0, mutations: [] };
const answering = (init: ResponseInit & { body?: string }) =>
  fetchTransport('/api/sync', async () => new Response(init.body ?? '', init));

describe('the browser’s transport', () => {
  it('posts the request as JSON to the same origin with the session cookie', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const transport = fetchTransport('/api/sync', async (url, init) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(
        JSON.stringify({
          protocol: 1,
          results: [],
          pull: { cursor: 3, more: false, rows: [], tombstones: [] },
        }),
        { status: 200 },
      );
    });
    expect(await transport(request)).toMatchObject({ kind: 'ok' });
    expect(seen?.url).toBe('/api/sync');
    expect(seen?.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(String(seen?.init.body))).toEqual(request);
  });

  it('says every way it can go wrong as a value', async () => {
    expect(await answering({ status: 401 })(request)).toEqual({ kind: 'signed-out' });
    expect(await answering({ status: 426 })(request)).toEqual({ kind: 'update-required' });
    expect(await answering({ status: 410 })(request)).toEqual({ kind: 'account-deleted' });
    expect(await answering({ status: 500 })(request)).toEqual({ kind: 'error', status: 500 });
    expect(await answering({ status: 413 })(request)).toEqual({ kind: 'error', status: 413 });
  });

  it('reads when to come back from a 429, and has a pause of its own for one that does not say', async () => {
    expect(await answering({ status: 429, headers: { 'retry-after': '12' } })(request)).toEqual({
      kind: 'rate-limited',
      retryAfterMs: 12_000,
    });
    expect(await answering({ status: 429 })(request)).toEqual({
      kind: 'rate-limited',
      retryAfterMs: 5000,
    });
    expect(await answering({ status: 429, headers: { 'retry-after': 'soon' } })(request)).toEqual({
      kind: 'rate-limited',
      retryAfterMs: 5000,
    });
  });

  it('calls a request that never got there offline, and an answer it cannot read an error to be tried again', async () => {
    const down = fetchTransport('/api/sync', async () => {
      throw new TypeError('failed to fetch');
    });
    expect(await down(request)).toEqual({ kind: 'offline' });
    expect(await answering({ status: 200, body: '<html>captive portal</html>' })(request)).toEqual({
      kind: 'error',
      status: 502,
    });
    expect(await answering({ status: 200, body: '{}' })(request)).toEqual({
      kind: 'error',
      status: 502,
    });
  });
});
