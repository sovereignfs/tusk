import { parseCursor } from '../access/cursor';
import { uuid } from '../access/parse';
import type { Directory } from '../auth/directory';
import type { Database } from '../db/client';
import { readCapped } from '../sync/endpoint';
import { MAX_IDS, type Which, dismiss, markRead, noticesOf, unreadCount } from './notifications';

/**
 * The routes of what a person is told (DESIGN.md §16, task 8.7): a page of notices, how many are unread, and reading and dismissing them. **The account is the session's**
 * (`accountRoute`), and every statement names it, so the ids a body gives can only ever be the person's own: another person's are not touched and the answer is the same
 * as for ids that are not there. A body is closed: `{ ids }` of at most 200 ids, or `{ all: true }`, and nothing else.
 */
export interface NotificationsDeps {
  readonly database: Database;
  readonly directory: Pick<Directory, 'profiles'>;
  now(): number;
}

const MAX_BODY = 16 * 1024;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export async function getNotifications(
  request: Request,
  accountId: string,
  deps: NotificationsDeps,
): Promise<Response> {
  const cursor = parseCursor(new URL(request.url).searchParams);
  if (!cursor.ok) return new Response(null, { status: 400 });
  return json(200, await noticesOf(deps.database, deps.directory, accountId, cursor.before));
}

export async function getUnread(accountId: string, deps: NotificationsDeps): Promise<Response> {
  return json(200, { unread: await unreadCount(deps.database, accountId) });
}

/** The notices a body names: `{ ids }` of ids, or `{ all: true }`; anything else is not one. */
export function parseWhich(value: unknown): { ok: true; which: Which } | { ok: false } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false };
  const keys = Object.keys(value);
  if (keys.length !== 1) return { ok: false };
  const body = value as Record<string, unknown>;
  if (keys[0] === 'all')
    return body.all === true ? { ok: true, which: { all: true } } : { ok: false };
  if (keys[0] !== 'ids' || !Array.isArray(body.ids) || body.ids.length > MAX_IDS)
    return { ok: false };
  const ids: string[] = [];
  for (const each of body.ids) {
    const parsed = uuid(each);
    if (!parsed.ok) return { ok: false };
    ids.push(parsed.value);
  }
  return { ok: true, which: { ids: [...new Set(ids)] } };
}

async function change(
  request: Request,
  accountId: string,
  deps: NotificationsDeps,
  apply: (database: Database, accountId: string, which: Which, now: number) => Promise<void>,
): Promise<Response> {
  const body = await readCapped(request, MAX_BODY);
  let value: unknown;
  try {
    value = body === null ? undefined : JSON.parse(body);
  } catch {
    value = undefined;
  }
  const parsed = parseWhich(value);
  if (!parsed.ok) return json(400, { code: 'BAD_REQUEST' });
  await apply(deps.database, accountId, parsed.which, deps.now());
  return new Response(null, { status: 204 });
}

export const postRead = (request: Request, accountId: string, deps: NotificationsDeps) =>
  change(request, accountId, deps, markRead);

export const postDismiss = (request: Request, accountId: string, deps: NotificationsDeps) =>
  change(request, accountId, deps, dismiss);
