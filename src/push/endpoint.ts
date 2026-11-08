import { readCapped } from '../sync/endpoint';
import type { KeyRing } from '../crypto/keys';
import type { Database } from '../db/client';
import type { Limiter, Rule } from '../limits/rate';
import { parseSubscription, removeSubscription, saveSubscription } from './store';

/**
 * `POST` and `DELETE /api/push/subscription` (DESIGN.md §25.2, task 8.4): a device turns Web Push on or off for the account that is signed in on it. The account is the
 * session's (`accountRoute`); **a body names a subscription or is refused**; and where the server has no VAPID keys or no instance key to seal the device's keys with,
 * there is no Push and this answers so (`503 NOT_AVAILABLE`), as Settings does not offer it.
 */
export interface PushDeps {
  database: Database;
  limiter: Limiter;
  /** The instance key, which seals what a device gives; none, and there is no Push. */
  ring: KeyRing | undefined;
  /** Whether the operator gave VAPID keys. */
  configured: boolean;
  now(): number;
}

export const PUSH_RATE: Rule = { limit: 30, windowMs: 60_000 };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

async function read(request: Request): Promise<unknown | undefined> {
  const body = await readCapped(request, 4096);
  if (body === null) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export async function pushSubscribe(
  request: Request,
  accountId: string,
  deps: PushDeps,
): Promise<Response> {
  if (!deps.configured || !deps.ring) return json(503, { code: 'NOT_AVAILABLE' });
  const taken = await deps.limiter.take(`push:${accountId}`, PUSH_RATE);
  if (!taken.ok) return json(429, { code: 'RATE_LIMITED' });
  const value = await read(request);
  const parsed = parseSubscription(value);
  if (!parsed.ok) return json(400, { code: 'BAD_REQUEST' });
  const saved = await saveSubscription(
    deps.database,
    deps.ring,
    accountId,
    parsed.value,
    deps.now(),
  );
  return saved === 'limit' ? json(409, { code: 'LIMIT' }) : json(200, { subscribed: true });
}

export async function pushUnsubscribe(
  request: Request,
  accountId: string,
  deps: PushDeps,
): Promise<Response> {
  const taken = await deps.limiter.take(`push:${accountId}`, PUSH_RATE);
  if (!taken.ok) return json(429, { code: 'RATE_LIMITED' });
  const value = await read(request);
  const endpoint =
    typeof value === 'object' && value !== null && 'endpoint' in value
      ? (value as { endpoint: unknown }).endpoint
      : undefined;
  if (typeof endpoint !== 'string' || endpoint.length > 2048)
    return json(400, { code: 'BAD_REQUEST' });
  // The same answer whether the device was there, was another account's or never was.
  await removeSubscription(deps.database, accountId, endpoint);
  return json(200, { subscribed: false });
}
