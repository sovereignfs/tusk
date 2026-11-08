import { createECDH, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { ringOf } from '../crypto/keys';
import { type Database, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { testTarget } from '../db/test-support';
import { RateLimiter } from '../limits/rate';
import { type PushDeps, pushSubscribe, pushUnsubscribe } from './endpoint';
import { deviceCount } from './store';

/**
 * Who may call `/api/push/subscription` (DESIGN.md §7, §25.2), with two real accounts and real sessions: no session is 401, a request from another site is 403,
 * and a person turns on and off only their own device.
 */
const { leg } = testTarget();
const ring = ringOf(Buffer.alloc(32, 9));
let t: TwoAccounts;
let database: Database;
let deps: PushDeps;
beforeAll(async () => {
  t = await twoAccounts();
  database = await openDatabase(testTarget().config, 'app');
  await runMigrations(database);
  deps = { database, limiter: new RateLimiter(database), ring, configured: true, now: Date.now };
});
afterAll(async () => {
  await database.close();
  await t.close();
});

const subscription = () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://push.example/${crypto.randomUUID()}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
};

describe(`who may call the Push route (${leg})`, () => {
  const routes = () => ({
    post: accountRoute(({ request, accountId }) => pushSubscribe(request, accountId, deps), t.deps),
    del: accountRoute(
      ({ request, accountId }) => pushUnsubscribe(request, accountId, deps),
      t.deps,
    ),
  });

  it('refuses a visitor with no session (401) and a request that does not come from this app (403), and writes nothing', async () => {
    const { post: p } = routes();
    expect(
      (await p(t.request(null, '/api/push/subscription', { method: 'POST', body: subscription() })))
        .status,
    ).toBe(401);
    expect(
      (
        await p(
          t.request(t.ada, '/api/push/subscription', {
            method: 'POST',
            body: subscription(),
            headers: { origin: 'https://evil.example' },
          }),
        )
      ).status,
    ).toBe(403);
    // No Origin at all is refused too.
    expect(
      (
        await p(
          t.request(t.ada, '/api/push/subscription', {
            method: 'POST',
            body: subscription(),
            headers: { origin: '' },
          }),
        )
      ).status,
    ).toBe(403);
    expect(await deviceCount(database, t.ada.id)).toBe(0);
  });

  it('turns a device on for the signed-in person, and another person cannot turn it off', async () => {
    const { post: p, del } = routes();
    const s = subscription();
    expect(
      (await p(t.request(t.ada, '/api/push/subscription', { method: 'POST', body: s }))).status,
    ).toBe(200);
    expect(await deviceCount(database, t.ada.id)).toBe(1);
    await del(
      t.request(t.grace, '/api/push/subscription', {
        method: 'DELETE',
        body: { endpoint: s.endpoint },
      }),
    );
    expect(await deviceCount(database, t.ada.id)).toBe(1);
    await del(
      t.request(t.ada, '/api/push/subscription', {
        method: 'DELETE',
        body: { endpoint: s.endpoint },
      }),
    );
    expect(await deviceCount(database, t.ada.id)).toBe(0);
  });
});
