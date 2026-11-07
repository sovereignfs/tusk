import type { Directory } from '../auth/directory';
import type { Database } from '../db/client';
import type { Limiter, Rule } from '../limits/rate';
import { readCapped } from '../sync/endpoint';
import { previewLeaving } from '../workspaces/person';
import { readConnection } from '../backup/connection';
import { deletePerson } from './people';

/**
 * `/api/account/delete` (DESIGN.md §22): what deleting the account would do, and doing it. **It asks for the password** (a stolen session cannot delete an
 * account), counted, and runs `People.deletePerson` for the session's account and no other. The preview says which workspaces would pass to whom or be
 * deleted, and whether a backup repository is connected, which is left alone.
 */
export interface DeleteDeps {
  readonly database: Database;
  readonly authDatabase: Database;
  readonly directory: Pick<Directory, 'profiles'>;
  readonly limiter: Limiter;
  readonly now: () => number;
  /** Whether this is the password of the account the request is for. */
  verify(request: Request, password: string): Promise<boolean>;
}

const RATE: Rule = { limit: 5, windowMs: 10 * 60_000 };

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

export async function deletionPreview(accountId: string, deps: DeleteDeps): Promise<Response> {
  const workspaces = await previewLeaving(deps.database, deps.directory, accountId);
  const connection = await readConnection(deps.database, accountId);
  return json(200, {
    workspaces: workspaces.map((each) => ({ name: each.name, to: each.to })),
    backup: connection ? connection.repository : null,
  });
}

/** `POST { password }`: 204 when it is done; 400 for what is not a request; 403 for a password that is not this account's; 429 when tried too often. */
export async function deleteAccount(
  request: Request,
  accountId: string,
  deps: DeleteDeps,
): Promise<Response> {
  const body = await readCapped(request, 1024);
  if (body === null) return json(413, { code: 'TOO_LARGE' });
  const taken = await deps.limiter.take(`delete-account:${accountId}`, RATE);
  if (!taken.ok)
    return json(
      429,
      { code: 'RATE_LIMITED' },
      { 'retry-after': String(Math.max(1, Math.ceil(taken.retryAfterMs / 1000))) },
    );
  let password: unknown;
  try {
    password = (JSON.parse(body) as { password?: unknown } | null)?.password;
  } catch {
    return json(400, { code: 'BAD_REQUEST' });
  }
  if (typeof password !== 'string' || password === '' || password.length > 1000)
    return json(400, { code: 'BAD_REQUEST' });
  if (!(await deps.verify(request, password))) return json(403, { code: 'WRONG_PASSWORD' });
  await deletePerson(deps, accountId);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
