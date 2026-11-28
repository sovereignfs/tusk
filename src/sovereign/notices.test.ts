import { createFakeCore } from '@sovereignfs/sdk/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestAuth, makeAuth } from '../auth/test-support';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { openStoreBesideAuth } from '../sync/test-support';
import { testTarget } from '../db/test-support';
import { RateLimiter } from '../limits/rate';
import { accountOfSub } from './identity';
import { buildNotices } from './server';

/**
 * Core's notices (DESIGN.md §22), end to end through the real wiring (`buildNotices`): `@sovereignfs/auth`'s `coreNotices` against the
 * SDK's fake core, behind Tusk's guards, ending sessions through better-auth on the package and deleting through Tusk's `deletePerson`,
 * on whichever database the leg runs on. What is checked is what the notices promise: whose sessions end and nobody else's, that a deletion
 * leaves nothing of the person, that core's retry is harmless, and that a notice cannot be replayed, even by another process.
 */
const { leg } = testTarget();
let t: TestAuth;
let app: Database;
let closeApp: () => Promise<void>;
beforeAll(async () => {
  t = await makeAuth({ local: false, signUp: 'open' });
  ({ database: app, close: closeApp } = await openStoreBesideAuth());
});
afterAll(async () => {
  await t.close();
  await closeApp();
});

let n = 0;
/**
 * An account that came in through core as `sub`, with `sessions` sessions, each with the record a sign-in through core leaves (its core
 * session `sid-<i>-<id>`), as `@sovereignfs/auth/core` writes them; and a rate counter of the account's in the app store.
 */
async function viaCore(sub: string, sessions = 2): Promise<string> {
  const id = `account-${++n}`;
  const now = Date.now();
  const time = (ms: number) => (t.store.family === 'postgres' ? new Date(ms) : ms);
  const truth = t.store.family === 'postgres' ? true : 1;
  await t.store.run(
    'INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, id, `${id}@example.test`, truth, time(now), time(now)],
  );
  await t.store.run(
    "INSERT INTO accounts (id, account_id, provider_id, user_id, created_at, updated_at) VALUES (?, ?, 'sovereign', ?, ?, ?)",
    [`a-${id}`, sub, id, time(now), time(now)],
  );
  for (let i = 0; i < sessions; i++) {
    await t.store.run(
      'INSERT INTO sessions (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)',
      [`s${i}-${id}`, time(now + 86_400_000), `t${i}-${id}`, time(now), time(now), id],
    );
    await t.store.run(
      'INSERT INTO sv_core_sign_ins (session_id, sub, sid, checked_at) VALUES (?, ?, ?, ?)',
      [`s${i}-${id}`, sub, `sid-${i}-${id}`, now],
    );
  }
  await new RateLimiter(app).take(`sync:${id}`, { limit: 10, windowMs: 60_000 });
  return id;
}
const sessionsOf = async (id: string) =>
  Number(
    (await t.store.run('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [id])).rows[0]?.n,
  );
/** The account's counters in the app store, keyed `kind:account` (`src/sovereign/people.ts`). */
const countersOf = async (id: string) =>
  (
    await dbAll(
      app,
      sql`SELECT 1 AS one FROM ${sql.raw(app.dialect === 'postgres' ? 'tusk.rate_bucket' : 'rate_bucket')} WHERE "key" LIKE ${`%:${id}`}`,
    )
  ).length;

function world() {
  const core = createFakeCore();
  // As `noticeHandlers` makes them, on this core: a restarted process is another `make()`, with nothing of the first in memory.
  const make = () =>
    buildNotices({
      auth: t.auth,
      authStore: t.store,
      database: app,
      coreUrl: core.url,
      clientId: core.credentials.clientId,
      limiter: new RateLimiter(app),
      fetch: core.fetch,
    });
  return { core, notices: make(), another: make };
}
const form = (field: string, token: string) =>
  new Request('https://tusk.example.com/api/sovereign/notice', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ [field]: token }).toString(),
  });

describe(`core's notices, through the real wiring (${leg})`, () => {
  it('a logout notice ends every session of the person it names, and no one else’s', async () => {
    const { core, notices } = world();
    const ada = await viaCore('sub-ada', 3);
    const grace = await viaCore('sub-grace', 2);
    const reply = await notices.backChannelLogout(
      form('logout_token', await core.logoutToken({ sub: 'sub-ada' })),
    );
    expect(reply.status).toBe(200);
    expect(await sessionsOf(ada)).toBe(0);
    expect(await sessionsOf(grace)).toBe(2);
    // The account is theirs still: they can sign in again.
    expect(await accountOfSub(t.store, 'sub-ada')).toBe(ada);
  });

  it('a logout notice that names only a core session ends that session here, and the person’s others stay', async () => {
    const { core, notices } = world();
    const ada = await viaCore('sub-ada-s', 2);
    const reply = await notices.backChannelLogout(
      form('logout_token', await core.logoutToken({ sid: `sid-0-${ada}` })),
    );
    expect(reply.status).toBe(200);
    expect(await sessionsOf(ada)).toBe(1);
  });

  it('an account-deleted notice leaves nothing of the person, and nobody else is touched', async () => {
    const { core, notices } = world();
    const ada = await viaCore('sub-ada-d', 2);
    const grace = await viaCore('sub-grace-d', 1);
    const reply = await notices.accountDeleted(
      form('account_deleted_token', await core.accountDeletedToken({ sub: 'sub-ada-d' })),
    );
    expect(reply.status).toBe(200);
    for (const [table, column] of [
      ['users', 'id'],
      ['accounts', 'user_id'],
      ['sessions', 'user_id'],
    ] as const)
      expect(
        (await t.store.run(`SELECT 1 AS one FROM ${table} WHERE ${column} = ?`, [ada])).rows,
        table,
      ).toHaveLength(0);
    expect(await accountOfSub(t.store, 'sub-ada-d')).toBeNull();
    expect(await countersOf(ada)).toBe(0);
    expect(await sessionsOf(grace)).toBe(1);
    expect(await countersOf(grace)).toBe(1);
    expect(await accountOfSub(t.store, 'sub-grace-d')).toBe(grace);
    // Core sends a deletion until it is answered, with a new token each time: the second finds nobody and is answered 200 too.
    const again = await notices.accountDeleted(
      form('account_deleted_token', await core.accountDeletedToken({ sub: 'sub-ada-d' })),
    );
    expect(again.status).toBe(200);
  });

  it('a notice cannot be replayed, even to another process that has just started', async () => {
    const { core, notices, another } = world();
    const ada = await viaCore('sub-ada-r', 1);
    const token = await core.logoutToken({ sub: 'sub-ada-r' });
    expect((await notices.backChannelLogout(form('logout_token', token))).status).toBe(200);
    expect(await sessionsOf(ada)).toBe(0);
    // Ada signs in through core again; the same token, to a process that has just started, must not end that session.
    const now = Date.now();
    const time = (ms: number) => (t.store.family === 'postgres' ? new Date(ms) : ms);
    await t.store.run(
      'INSERT INTO sessions (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)',
      [`again-${ada}`, time(now + 86_400_000), `again-token-${ada}`, time(now), time(now), ada],
    );
    await t.store.run(
      'INSERT INTO sv_core_sign_ins (session_id, sub, sid, checked_at) VALUES (?, ?, ?, ?)',
      [`again-${ada}`, 'sub-ada-r', 'sid-again', now],
    );
    const replay = await another().backChannelLogout(form('logout_token', token));
    // Refused: its jti is remembered in the store, not in a process (auth.md §8).
    expect(replay.status).toBe(400);
    expect(await sessionsOf(ada)).toBe(1);
  });

  it('a notice that is wrong in any way ends and deletes nothing', async () => {
    const { core, notices } = world();
    const ada = await viaCore('sub-ada-w', 2);
    for (const wrong of ['signature', 'audience', 'expired', 'type'] as const) {
      const logout = await notices.backChannelLogout(
        form('logout_token', await core.logoutToken({ sub: 'sub-ada-w' }, { wrong })),
      );
      const deleted = await notices.accountDeleted(
        form(
          'account_deleted_token',
          await core.accountDeletedToken({ sub: 'sub-ada-w' }, { wrong }),
        ),
      );
      expect([logout.status, deleted.status], wrong).toEqual([400, 400]);
    }
    expect(await sessionsOf(ada)).toBe(2);
    expect(await accountOfSub(t.store, 'sub-ada-w')).toBe(ada);
  });

  it('refuses a body larger than a notice can be, unread, and ends nothing', async () => {
    const { core, notices } = world();
    const ada = await viaCore('sub-ada-b', 1);
    const token = await core.logoutToken({ sub: 'sub-ada-b' });
    const reply = await notices.backChannelLogout(
      new Request('https://tusk.example.com/api/sovereign/backchannel-logout', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `${new URLSearchParams({ logout_token: token }).toString()}&pad=${'x'.repeat(17 * 1024)}`,
      }),
    );
    expect(reply.status).toBe(413);
    expect(await sessionsOf(ada)).toBe(1);
  });
});
