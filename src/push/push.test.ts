import { createECDH, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ringOf } from '../crypto/keys';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { RateLimiter } from '../limits/rate';
import { account, makeStore } from '../sync/test-support';
import { type PushDeps, pushSubscribe, pushUnsubscribe } from './endpoint';
import {
  MOST_DEVICES,
  deviceCount,
  devicesOf,
  parseSubscription,
  removeSubscription,
  saveSubscription,
} from './store';

/**
 * The devices that are sent Web Push (DESIGN.md §25.2, task 8.4), on every form of the database: what a subscription may be, that the keys are sealed and never text in
 * a column, that an account sees and removes only its own devices, and what the route answers.
 */
const { leg } = testTarget();
const ring = ringOf(Buffer.alloc(32, 8));
if (!ring) throw new Error('a ring');
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

function keys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}
const sub = (endpoint = `https://push.example/${crypto.randomUUID()}`) => ({
  endpoint,
  ...keys(),
});
const browserJson = (s: ReturnType<typeof sub>) => ({
  endpoint: s.endpoint,
  expirationTime: null,
  keys: { p256dh: s.p256dh, auth: s.auth },
});

describe('a subscription as a browser gives it', () => {
  it('is an https address and the two keys, in their shapes', () => {
    const s = sub();
    expect(parseSubscription(browserJson(s))).toEqual({ ok: true, value: s });
  });

  it('refuses an address that is not https, has a user in it, or is not an address, keys that are not keys, and anything more', () => {
    const s = sub();
    const good = browserJson(s);
    for (const bad of [
      { ...good, endpoint: 'http://push.example/x' },
      { ...good, endpoint: 'https://user:pass@push.example/x' },
      { ...good, endpoint: 'not an address' },
      { ...good, endpoint: `https://push.example/${'a'.repeat(3000)}` },
      { ...good, keys: { ...good.keys, auth: 'short' } },
      { ...good, keys: { ...good.keys, p256dh: '!'.repeat(87) } },
      { ...good, keys: { ...good.keys, extra: 'x' } },
      { ...good, owner: 'someone' },
      { endpoint: good.endpoint },
      'a string',
      null,
    ])
      expect(parseSubscription(bad).ok, JSON.stringify(bad).slice(0, 80)).toBe(false);
  });
});

describe(`the devices (${leg})`, () => {
  it('keeps the keys sealed and out of every column, and opens them for the one that sends', async () => {
    const who = account();
    const s = sub();
    expect(await saveSubscription(database, ring, who, s, 1)).toBe('saved');
    const everything = JSON.stringify([
      await dbAll(database, sql`SELECT * FROM push_subscription WHERE account_id = ${who}`),
      await dbAll(database, sql`SELECT * FROM credential WHERE account_id = ${who}`),
    ]);
    expect(everything).not.toContain(s.p256dh);
    expect(everything).not.toContain(s.auth);
    expect(await devicesOf(database, ring, who)).toMatchObject([s]);
  });

  it('is for the account: another account does not see, list or remove it', async () => {
    const ada = account();
    const grace = account();
    const s = sub();
    await saveSubscription(database, ring, ada, s, 1);
    expect(await devicesOf(database, ring, grace)).toEqual([]);
    expect(await removeSubscription(database, grace, s.endpoint)).toBe(false);
    expect(await deviceCount(database, ada)).toBe(1);
    expect(await removeSubscription(database, ada, s.endpoint)).toBe(true);
    expect(await deviceCount(database, ada)).toBe(0);
    // Its sealed keys went with it.
    expect(
      await dbAll(
        database,
        sql`SELECT id FROM credential WHERE account_id = ${ada} AND purpose = 'push-keys'`,
      ),
    ).toEqual([]);
  });

  it('replaces a device that subscribes again, and gives an address to whoever subscribes on it now', async () => {
    const ada = account();
    const grace = account();
    const s = sub();
    await saveSubscription(database, ring, ada, s, 1);
    await saveSubscription(database, ring, ada, { ...s, auth: keys().auth }, 2);
    expect(await deviceCount(database, ada)).toBe(1);
    await saveSubscription(database, ring, grace, s, 3);
    expect(await deviceCount(database, ada)).toBe(0);
    expect(await deviceCount(database, grace)).toBe(1);
    expect(
      await dbAll(
        database,
        sql`SELECT id FROM credential WHERE account_id = ${ada} AND purpose = 'push-keys'`,
      ),
    ).toEqual([]);
  });

  it('allows an account so many devices, and says limit for one more, though one it has already can be replaced', async () => {
    const who = account();
    const first = sub();
    await saveSubscription(database, ring, who, first, 1);
    for (let i = 1; i < MOST_DEVICES; i++) await saveSubscription(database, ring, who, sub(), 1);
    expect(await deviceCount(database, who)).toBe(MOST_DEVICES);
    expect(await saveSubscription(database, ring, who, sub(), 2)).toBe('limit');
    expect(await saveSubscription(database, ring, who, first, 3)).toBe('saved');
    expect(await deviceCount(database, who)).toBe(MOST_DEVICES);
  });
});

describe(`the route's answers (${leg})`, () => {
  const request = (method: string, body: unknown) =>
    new Request('https://tusk.test/api/push/subscription', {
      method,
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const deps = (over: Partial<PushDeps> = {}): PushDeps => ({
    database,
    limiter: new RateLimiter(database),
    ring,
    configured: true,
    now: () => 1,
    ...over,
  });

  it('turns Push on for the account, and off, and off again says the same', async () => {
    const who = account();
    const s = sub();
    const on = await pushSubscribe(request('POST', browserJson(s)), who, deps());
    expect(on.status).toBe(200);
    expect(await deviceCount(database, who)).toBe(1);
    const off = await pushUnsubscribe(request('DELETE', { endpoint: s.endpoint }), who, deps());
    expect(off.status).toBe(200);
    expect(await deviceCount(database, who)).toBe(0);
    expect(
      (await pushUnsubscribe(request('DELETE', { endpoint: s.endpoint }), who, deps())).status,
    ).toBe(200);
  });

  it('answers 503 where the server has no VAPID keys or no instance key, 400 for a body that is not a subscription, and 409 at the limit', async () => {
    const who = account();
    const body = browserJson(sub());
    expect(
      (await pushSubscribe(request('POST', body), who, deps({ configured: false }))).status,
    ).toBe(503);
    expect(
      (await pushSubscribe(request('POST', body), who, deps({ ring: undefined }))).status,
    ).toBe(503);
    expect((await pushSubscribe(request('POST', { endpoint: 'x' }), who, deps())).status).toBe(400);
    expect((await pushSubscribe(request('POST', 'not json'), who, deps())).status).toBe(400);
    expect((await pushUnsubscribe(request('DELETE', { endpoint: 5 }), who, deps())).status).toBe(
      400,
    );
    for (let i = 0; i < MOST_DEVICES; i++) await saveSubscription(database, ring, who, sub(), 1);
    expect((await pushSubscribe(request('POST', browserJson(sub())), who, deps())).status).toBe(
      409,
    );
  });

  it('is for the signed-in account alone: it cannot take another’s device off by naming its address', async () => {
    const ada = account();
    const grace = account();
    const s = sub();
    await saveSubscription(database, ring, ada, s, 1);
    await pushUnsubscribe(request('DELETE', { endpoint: s.endpoint }), grace, deps());
    expect(await deviceCount(database, ada)).toBe(1);
  });

  it('limits how often an account may ask', async () => {
    const who = account();
    const limiter = new RateLimiter(database);
    let last = 200;
    for (let i = 0; i < 31; i++)
      last = (
        await pushUnsubscribe(
          request('DELETE', { endpoint: 'https://push.example/x' }),
          who,
          deps({ limiter }),
        )
      ).status;
    expect(last).toBe(429);
  });
});
