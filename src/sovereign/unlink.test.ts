import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { derivedFor } from '../auth/test-support';
import { testTarget } from '../db/test-support';
import { unlinkSovereign } from './unlink';

/**
 * `/api/account/unlink-sovereign` (DESIGN.md §6): unlinking asks for the password again, as its sign-in value, and acts on the session's
 * own account only; an account with no password keeps its one way in.
 */
const { leg } = testTarget();
const PASSWORD = derivedFor('a password long enough to be one');
let t: TwoAccounts;
beforeAll(async () => {
  t = await twoAccounts();
});
afterAll(async () => t.close());

const route = () =>
  accountRoute(
    ({ request, accountId }) =>
      unlinkSovereign(request, accountId, { auth: t.auth.auth, store: t.auth.store }),
    t.deps,
  );
const post = (who: typeof t.ada, body: unknown) =>
  t.request(who, '/api/account/unlink-sovereign', { method: 'POST', body });
/** Links a Sovereign identity to a person's account as the package's link leaves it, with a session of theirs through core. */
async function linked(who: typeof t.ada, sub: string) {
  const now = Date.now();
  const time = (ms: number) => (t.auth.store.family === 'postgres' ? new Date(ms) : ms);
  await t.auth.store.run(
    "INSERT INTO accounts (id, account_id, provider_id, user_id, created_at, updated_at) VALUES (?, ?, 'sovereign', ?, ?, ?)",
    [`link-${sub}`, sub, who.id, time(now), time(now)],
  );
  const { rows } = await t.auth.store.run('SELECT id FROM sessions WHERE user_id = ? LIMIT 1', [
    who.id,
  ]);
  await t.auth.store.run(
    'INSERT INTO sv_core_sign_ins (session_id, sub, checked_at) VALUES (?, ?, ?) ON CONFLICT (session_id) DO NOTHING',
    [String(rows[0]?.id), sub, now],
  );
}
const providers = async (who: typeof t.ada) =>
  (
    await t.auth.store.run(
      'SELECT provider_id FROM accounts WHERE user_id = ? ORDER BY provider_id',
      [who.id],
    )
  ).rows.map((row) => row.provider_id);

describe(`unlinking Sovereign (${leg})`, () => {
  it('asks for the password, and a wrong one unlinks nothing', async () => {
    await linked(t.ada, 'sub-ada-unlink');
    const wrong = await route()(post(t.ada, { password: derivedFor('not the password') }));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ code: 'WRONG_PASSWORD' });
    expect((await route()(post(t.ada, {}))).status).toBe(400);
    expect(await providers(t.ada)).toEqual(['credential', 'sovereign']);
  });

  it('unlinks the session’s own account with the password, and its sessions are no longer core’s', async () => {
    await linked(t.grace, 'sub-grace-unlink');
    const done = await route()(post(t.grace, { password: PASSWORD }));
    expect(done.status).toBe(204);
    expect(await providers(t.grace)).toEqual(['credential']);
    const { rows } = await t.auth.store.run('SELECT 1 AS one FROM sv_core_sign_ins WHERE sub = ?', [
      'sub-grace-unlink',
    ]);
    expect(rows).toEqual([]);
    // Ada's link is hers, and stays.
    expect(await providers(t.ada)).toEqual(['credential', 'sovereign']);
  });

  it('is for someone signed in and from the app', async () => {
    expect(
      (
        await route()(
          t.request(null, '/api/account/unlink-sovereign', {
            method: 'POST',
            body: { password: PASSWORD },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await route()(
          t.request(t.ada, '/api/account/unlink-sovereign', {
            method: 'POST',
            body: { password: PASSWORD },
            headers: { origin: 'https://evil.example' },
          }),
        )
      ).status,
    ).toBe(403);
    expect(await providers(t.ada)).toEqual(['credential', 'sovereign']);
  });
});
