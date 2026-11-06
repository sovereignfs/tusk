import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { createIdentity } from '../cipher/identity';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import { testTarget } from '../db/test-support';
import { RateLimiter } from '../limits/rate';
import { makeStore } from '../sync/test-support';
import { type EncryptionDeps, encryptionSetup, encryptionSkip, encryptionStatus } from './endpoint';
import { readEncryption, setUpPersonalKey, skipKeyOffer } from './state';

/**
 * `/api/encryption` (DESIGN.md §9.1) with two real accounts: who may call it, that a key is set up once and one way, that the server holds a public key and
 * refuses a secret one, that two devices setting up at once end with one key, that skipping is remembered, and that the operator's mode offers nothing.
 */
const { leg } = testTarget();
let t: TwoAccounts;
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  t = await twoAccounts();
  ({ database, close } = await makeStore());
});
afterAll(async () => {
  await t.close();
  await close();
});

const deps = (extra: Partial<EncryptionDeps> = {}): EncryptionDeps => ({
  database,
  limiter: { take: async () => ({ ok: true }) },
  now: () => 1_800_000_000_000,
  operatorEncryption: false,
  ...extra,
});
const routes = (extra: Partial<EncryptionDeps> = {}) => ({
  status: accountRoute(({ accountId }) => encryptionStatus(accountId, deps(extra)), t.deps),
  setup: accountRoute(
    ({ request, accountId }) => encryptionSetup(request, accountId, deps(extra)),
    t.deps,
  ),
  skip: accountRoute(({ accountId }) => encryptionSkip(accountId, deps(extra)), t.deps),
});
const post = (who: typeof t.ada | null, path: string, body?: unknown, headers = {}) =>
  t.request(who, path, { method: 'POST', ...(body === undefined ? {} : { body }), headers });

describe(`the Desk’s key (${leg})`, () => {
  it('is for someone signed in and from the app', async () => {
    const r = routes();
    expect((await r.status(t.request(null, '/api/encryption'))).status).toBe(401);
    expect((await r.setup(post(null, '/api/encryption/setup', { recipient: 'x' }))).status).toBe(
      401,
    );
    expect((await r.skip(post(null, '/api/encryption/skip'))).status).toBe(401);
    const foreign = { origin: 'https://evil.example' };
    expect((await r.setup(post(t.ada, '/api/encryption/setup', {}, foreign))).status).toBe(403);
    expect((await r.skip(post(t.ada, '/api/encryption/skip', undefined, foreign))).status).toBe(
      403,
    );
  });

  it('starts as a Desk with no key that is to be asked, and sets up a key once, for one account only', async () => {
    const r = routes();
    expect(await (await r.status(t.request(t.ada, '/api/encryption'))).json()).toEqual({
      mode: 'none',
      recipient: null,
      available: true,
      offer: true,
    });
    const { recipient } = await createIdentity();
    const set = await r.setup(post(t.ada, '/api/encryption/setup', { recipient }));
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({
      mode: 'personal',
      recipient,
      available: true,
      offer: false,
    });
    // Grace's Desk is not Ada's.
    expect(await (await r.status(t.request(t.grace, '/api/encryption'))).json()).toMatchObject({
      mode: 'none',
      recipient: null,
      offer: true,
    });
  });

  it('is one way and one key: the same key again is the same success, another key is refused, and nothing changes', async () => {
    const r = routes();
    const { recipient } = await createIdentity();
    await r.setup(post(t.grace, '/api/encryption/setup', { recipient }));
    expect((await r.setup(post(t.grace, '/api/encryption/setup', { recipient }))).status).toBe(200);
    const other = (await createIdentity()).recipient;
    const refused = await r.setup(post(t.grace, '/api/encryption/setup', { recipient: other }));
    expect(refused.status).toBe(409);
    expect(await (await r.status(t.request(t.grace, '/api/encryption'))).json()).toMatchObject({
      mode: 'personal',
      recipient,
    });
  });

  it('ends with one key when two devices set up at once', async () => {
    const account = crypto.randomUUID();
    const [a, b] = [(await createIdentity()).recipient, (await createIdentity()).recipient];
    const results = await Promise.all([
      setUpPersonalKey(database, account, a, 1),
      setUpPersonalKey(database, account, b, 2),
    ]);
    expect(results.filter((each) => each.ok)).toHaveLength(1);
    expect(results.filter((each) => !each.ok && each.reason === 'already')).toHaveLength(1);
    const state = await readEncryption(database, account);
    expect([a, b]).toContain(state.recipient);
  });

  it('holds a public key and refuses anything else, a secret key above all, which it does not keep', async () => {
    const r = routes();
    const person = await createIdentity();
    for (const bad of [
      person.identity,
      person.identity.toLowerCase(),
      '',
      'age1',
      person.recipient.toUpperCase(),
      `${person.recipient}x`,
      person.recipient.slice(0, -1),
      ` ${person.recipient}`,
      `age1${'b'.repeat(58)}`,
      5,
      null,
    ]) {
      const response = await r.setup(post(t.ada, '/api/encryption/setup', { recipient: bad }));
      expect(response.status, JSON.stringify(bad)).toBe(400);
    }
    // The secret was in no row of the account's settings.
    const settings =
      database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;
    const rows = JSON.stringify(await dbAll(database, sql`SELECT * FROM ${settings}`));
    expect(rows).not.toContain('AGE-SECRET-KEY');
    expect(rows).not.toContain(person.identity);
  });

  it('remembers a skip, once, and a skip does not take a key away', async () => {
    const r = routes();
    const fresh = crypto.randomUUID();
    const first = await skipKeyOffer(database, fresh, 1000);
    const again = await skipKeyOffer(database, fresh, 9000);
    expect(first).toMatchObject({ mode: 'none', offered: true });
    expect(again.offered).toBe(true);
    // Asked again, the time of the first choice is kept.
    const settings =
      database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;
    const [row] = await dbAll<{ at: number | string }>(
      database,
      sql`SELECT key_offered_at AS at FROM ${settings} WHERE account_id = ${fresh}`,
    );
    expect(Number(row?.at)).toBe(1000);
    // Through the route, for an account that has a key.
    await r.skip(post(t.ada, '/api/encryption/skip'));
    expect(await (await r.status(t.request(t.ada, '/api/encryption'))).json()).toMatchObject({
      mode: 'personal',
      offer: false,
    });
  });

  it('offers nothing in the operator’s mode, and refuses a key there', async () => {
    const r = routes({ operatorEncryption: true });
    expect(await (await r.status(t.request(t.grace, '/api/encryption'))).json()).toMatchObject({
      available: false,
      offer: false,
    });
    const { recipient } = await createIdentity();
    expect((await r.setup(post(t.grace, '/api/encryption/setup', { recipient }))).status).toBe(403);
    expect((await r.skip(post(t.grace, '/api/encryption/skip'))).status).toBe(403);
  });

  it('refuses what is not a request, and counts the tries', async () => {
    const r = routes();
    const raw = (body: string) =>
      new Request(t.request(t.ada, '/api/encryption/setup').url, {
        method: 'POST',
        headers: {
          origin: new URL(t.request(t.ada, '/api/encryption').url).origin,
          cookie: t.ada.client.cookieHeader(),
        },
        body,
      });
    expect((await r.setup(raw('{no'))).status).toBe(400);
    expect((await r.setup(raw('null'))).status).toBe(400);
    expect((await r.setup(raw(JSON.stringify({ recipient: 'x'.repeat(2000) })))).status).toBe(413);
    const limited = routes({ limiter: new RateLimiter(database) });
    let last = 0;
    for (let n = 0; n < 25; n += 1)
      last = (await limited.skip(post(t.grace, '/api/encryption/skip'))).status;
    expect(last).toBe(429);
  });
});
