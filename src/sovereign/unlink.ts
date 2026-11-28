import type { Database as AuthStore } from '@sovereignfs/auth/database';
import { confirmPassword } from '@sovereignfs/auth/server';
import type { Auth } from '../auth/auth';
import { readCapped } from '../sync/endpoint';

/**
 * `/api/account/unlink-sovereign` (DESIGN.md §13.1): taking the link to a Sovereign account off the session's own account. **It asks for the
 * password again**, as the sign-in value the page makes from it, through the package, which counts wrong answers (auth.md §4, rule 3): this
 * is what a session made in the last ten minutes stood for before the package (RFC 0007, "Decided in review"). An account with no password
 * has no other way in, so it keeps Sovereign. The account's sessions stay, as sessions of its own: none of them is checked against core
 * any more.
 */
export interface UnlinkDeps {
  /** better-auth on the package, for its accounts and to check the password. */
  readonly auth: Auth;
  readonly store: AuthStore;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * `POST { password }`: 204 when Sovereign is unlinked, or was not linked; 400 for what is not a request; 403 for a password that is not
 * the account's (`WRONG_PASSWORD`) or an account with no password (`NO_PASSWORD_ACCOUNT`); 429 after too many wrong ones.
 */
export async function unlinkSovereign(
  request: Request,
  accountId: string,
  deps: UnlinkDeps,
): Promise<Response> {
  const body = await readCapped(request, 1024);
  if (body === null) return json(413, { code: 'TOO_LARGE' });
  let password: unknown;
  try {
    password = (JSON.parse(body) as { password?: unknown } | null)?.password;
  } catch {
    return json(400, { code: 'BAD_REQUEST' });
  }
  if (typeof password !== 'string' || password === '') return json(400, { code: 'BAD_REQUEST' });
  const context = await deps.auth.$context;
  const accounts = await context.internalAdapter.findAccounts(accountId);
  if (!accounts.some((account) => account.providerId === 'credential'))
    return json(403, { code: 'NO_PASSWORD_ACCOUNT' });
  const check = await confirmPassword(deps.store, deps.auth, accountId, password);
  if (check === 'limited') return json(429, { code: 'PASSWORD_LIMITED' });
  if (check !== 'ok') return json(403, { code: 'WRONG_PASSWORD' });
  const linked = accounts.find((account) => account.providerId === 'sovereign');
  if (linked) {
    await context.internalAdapter.deleteAccount(linked.id);
    // Its sessions are its own from now on: none is checked against core again (`needsCoreCheck`).
    await deps.store.run(
      'DELETE FROM sv_core_sign_ins WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)',
      [accountId],
    );
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
