import { type SyncRequest, type SyncResponse } from './format';

/**
 * How a device reaches the server (DESIGN.md §8.3): one request, and what came of it. **Every way it can go wrong is a value, not an exception**, so
 * that the loop can decide what each means without guessing from an error's text: no network is `offline`, a session that ended is `signed-out`, an account that was deleted is `account-deleted`,
 * a device too old is `update-required`, and the rest are `refused` (too often, too large) or `error`.
 */
export type TransportResult =
  | { kind: 'ok'; response: SyncResponse }
  | { kind: 'offline' }
  | { kind: 'signed-out' }
  | { kind: 'update-required' }
  | { kind: 'account-deleted' }
  | { kind: 'rate-limited'; retryAfterMs: number }
  | { kind: 'error'; status: number };

export type Transport = (request: SyncRequest) => Promise<TransportResult>;

/** The browser's: a `fetch` to the same origin, with the session cookie. `Origin` is the browser's own, which is what the server checks. */
export function fetchTransport(
  url = '/api/sync',
  fetcher: typeof fetch = (...args) => fetch(...args),
): Transport {
  return async (request) => {
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
    } catch {
      // A fetch rejects when there is no network, and for nothing else that a device could tell apart.
      return { kind: 'offline' };
    }
    if (response.status === 401) return { kind: 'signed-out' };
    if (response.status === 426) return { kind: 'update-required' };
    // The account this device holds the tasks of has been deleted (DESIGN.md §20): not a session that ended, which would be 401 and keeps the outbox.
    if (response.status === 410) return { kind: 'account-deleted' };
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      return {
        kind: 'rate-limited',
        retryAfterMs: (Number.isFinite(seconds) && seconds > 0 ? seconds : 5) * 1000,
      };
    }
    if (!response.ok) return { kind: 'error', status: response.status };
    try {
      const body = (await response.json()) as SyncResponse;
      if (!Array.isArray(body.results) || typeof body.pull?.cursor !== 'number')
        return { kind: 'error', status: 502 };
      return { kind: 'ok', response: body };
    } catch {
      // A proxy that answered with a page, or a connection cut in the middle of the body: nothing to apply, and not an answer to remember.
      return { kind: 'error', status: 502 };
    }
  };
}
