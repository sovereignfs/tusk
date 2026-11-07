import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { authDirectory } from '../auth/directory';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresAuth from '../db/schema/postgres/auth';
import * as sqliteAuth from '../db/schema/sqlite/auth';
import { testTarget } from '../db/test-support';
import { RateLimiter } from '../limits/rate';
import { applyMutation } from '../sync/apply';
import { list, openStoreBesideAuth, mutation } from '../sync/test-support';
import { tableOf } from '../sync/tables';
import { type DeleteDeps, deleteAccount, deletionPreview } from './delete-account';

/**
 * `/api/account/delete` (DESIGN.md §22): the preview, and the deletion with the password, for the session's account and no other. A password that is not the
 * account's deletes nothing; the right one does, and the session ends with the account.
 */
const { leg } = testTarget();
const PASSWORD = 'a password long enough to be one';
let t: TwoAccounts;
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  t = await twoAccounts();
  ({ database, close } = await openStoreBesideAuth());
});
afterAll(async () => {
  await t.close();
  await close();
});

const deps = (extra: Partial<DeleteDeps> = {}): DeleteDeps => ({
  database,
  authDatabase: t.auth.database,
  directory: authDirectory(t.auth.database),
  limiter: { take: async () => ({ ok: true }) },
  now: () => 1_800_000_000_000,
  verify: async (request, password) => {
    try {
      return (
        (await t.auth.auth.api.verifyPassword({ body: { password }, headers: request.headers }))
          .status === true
      );
    } catch {
      return false;
    }
  },
  hasPassword: async () => true,
  fresh: async () => true,
  ...extra,
});
const routes = (extra: Partial<DeleteDeps> = {}) => ({
  preview: accountRoute(({ accountId }) => deletionPreview(accountId, deps(extra)), t.deps),
  remove: accountRoute(
    ({ request, accountId }) => deleteAccount(request, accountId, deps(extra)),
    t.deps,
  ),
});
const post = (who: typeof t.ada | null, body: unknown, headers = {}) =>
  t.request(who, '/api/account/delete', { method: 'POST', body, headers });
const users = async () =>
  (
    await dbAll<{ id: string }>(
      t.auth.database,
      sql`SELECT id FROM ${t.auth.database.dialect === 'postgres' ? postgresAuth.user : sqliteAuth.user}`,
    )
  ).map((row) => row.id);

describe(`deleting the account over HTTP (${leg})`, () => {
  it('is for someone signed in and from the app', async () => {
    const r = routes();
    expect((await r.preview(t.request(null, '/api/account/delete'))).status).toBe(401);
    expect((await r.remove(post(null, { password: PASSWORD }))).status).toBe(401);
    expect(
      (await r.remove(post(t.grace, { password: PASSWORD }, { origin: 'https://evil.example' })))
        .status,
    ).toBe(403);
    expect(await users()).toContain(t.grace.id);
  });

  it('says what it would do: which workspaces pass to whom or go, and whether a repository is connected', async () => {
    const preview = await routes().preview(t.request(t.grace, '/api/account/delete'));
    expect(await preview.json()).toEqual({ password: true, workspaces: [], backup: null });
  });

  it('refuses a wrong password and an absent one, deleting nothing, and counts the tries', async () => {
    const r = routes();
    await applyMutation(database, t.grace.id, mutation(list({ title: 'Mine' })), { now: 1 });
    for (const body of [
      { password: 'not the password at all' },
      {},
      { password: '' },
      { password: 5 },
      null,
    ]) {
      const response = await r.remove(post(t.grace, body));
      expect([400, 403], JSON.stringify(body)).toContain(response.status);
    }
    expect(await users()).toContain(t.grace.id);
    const raw = await r.remove(
      new Request(t.request(t.grace, '/x').url.replace('/x', '/api/account/delete'), {
        method: 'POST',
        headers: {
          origin: new URL(t.request(t.grace, '/x').url).origin,
          cookie: t.grace.client.cookieHeader(),
        },
        body: '{no',
      }),
    );
    expect(raw.status).toBe(400);
    const limited = routes({ limiter: new RateLimiter(database) });
    let last = 0;
    for (let n = 0; n < 7; n += 1)
      last = (await limited.remove(post(t.grace, { password: 'wrong wrong wrong' }))).status;
    expect(last).toBe(429);
    expect(await users()).toContain(t.grace.id);
  });

  it('deletes the account of the session with the right password and no other, and the session ends with it', async () => {
    const r = routes();
    const done = await r.remove(post(t.grace, { password: PASSWORD }));
    expect(done.status).toBe(204);
    expect(await users()).toEqual([t.ada.id]);
    const lists = await dbAll<{ n: number | string }>(
      database,
      sql`SELECT COUNT(*) AS n FROM ${tableOf(database, 'desk_list')} WHERE owner_id = ${t.grace.id}`,
    );
    expect(Number(lists[0]?.n)).toBe(0);
    // Her cookies no longer make a session.
    expect((await r.preview(t.request(t.grace, '/api/account/delete'))).status).toBe(401);
    // Ada's are untouched.
    expect((await r.preview(t.request(t.ada, '/api/account/delete'))).status).toBe(200);
  });

  it('asks an account with no password for a session made just now instead, and deletes nothing for a stale one', async () => {
    const noPassword = { hasPassword: async () => false };
    // The preview says there is no password to ask for.
    const preview = await routes(noPassword).preview(t.request(t.ada, '/api/account/delete'));
    expect(await preview.json()).toMatchObject({ password: false });

    const stale = routes({ ...noPassword, fresh: async () => false });
    const refused = await stale.remove(post(t.ada, {}));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: 'SESSION_NOT_FRESH' });
    // A password it does not have is not a way round.
    expect((await stale.remove(post(t.ada, { password: PASSWORD }))).status).toBe(403);
    expect(await users()).toContain(t.ada.id);

    const fresh = routes({ ...noPassword, fresh: async () => true });
    expect((await fresh.remove(post(t.ada, {}))).status).toBe(204);
    expect(await users()).not.toContain(t.ada.id);
  });
});
