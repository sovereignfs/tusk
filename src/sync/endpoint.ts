import type { Database } from '../db/client';
import { uuid } from '../access/parse';
import { type Limiter, type Rule } from '../limits/rate';
import { sql } from 'drizzle-orm';
import { dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { applyMutation } from './apply';
import { LIMITS, type MutationResult, PROTOCOL_VERSION, type SyncResponse } from './format';
import { pull } from './pull';
import { parseMutation } from './validate';

/**
 * `POST /api/sync` (DESIGN.md §8.3): a device sends the mutations it has not had answered, and how far it has pulled, and is answered with what
 * became of each mutation and what changed since. The route (`app/api/sync/route.ts`) is wrapped in `accountRoute`, which has found the session and
 * checked `Origin`; this is what runs for the account it names, with everything it needs given to it, so that a test runs it with two real accounts.
 *
 * **The status line is for the request, and the body for each mutation.** A request is refused whole when it is not one (400), is too big (413),
 * speaks another protocol (426, so that a device that is too old updates and keeps its outbox), or comes too often (429). A mutation that is refused
 * does not refuse the request: the others are applied, the pull is answered, and the device learns which was refused and why, which is the only
 * thing of all this that reaches a person (§8.4).
 */
export interface SyncDeps {
  database: Database;
  limiter: Limiter;
  now(): number;
  /** `refuse` for an account with a key of its own (§9.4). Until personal keys exist (task 14.2) every account is `check`. */
  plain?: 'check' | 'refuse';
  /** Smaller limits for a test. */
  limits?: { lists: number; cards: number; checks?: number };
}

/** A device syncs after a write, on focus and on a timer; this is enough for all of that, and not enough to be used to hammer the server. */
export const SYNC_RATE: Rule = { limit: 120, windowMs: 60_000 };

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

/** The body as text, or null if it is more than `max` bytes: counted as it arrives, so that a request that lies about its length reads no further. */
export async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > max) {
      await reader.cancel();
      return null;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

export async function handleSync(
  body: string,
  accountId: string,
  deps: SyncDeps,
): Promise<Response> {
  const taken = await deps.limiter.take(`sync:${accountId}`, SYNC_RATE);
  if (!taken.ok) {
    return json(
      429,
      { code: 'RATE_LIMITED' },
      { 'retry-after': String(Math.max(1, Math.ceil(taken.retryAfterMs / 1000))) },
    );
  }

  let request: unknown;
  try {
    request = JSON.parse(body);
  } catch {
    return json(400, { code: 'BAD_REQUEST' });
  }
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return json(400, { code: 'BAD_REQUEST' });
  }
  const { protocol, cursor, mutations, limit, ...rest } = request as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return json(400, { code: 'BAD_REQUEST' });

  // Before anything else is read of it: a device that is too old may be sending a shape we no longer know.
  if (protocol !== PROTOCOL_VERSION) {
    return json(426, { code: 'UPDATE_REQUIRED', protocol: PROTOCOL_VERSION });
  }
  if (
    typeof cursor !== 'number' ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    !Array.isArray(mutations) ||
    mutations.length > LIMITS.mutationsPerRequest ||
    (limit !== undefined &&
      (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1))
  ) {
    return json(400, { code: 'BAD_REQUEST' });
  }

  // A device whose cursor is behind what the server still remembers of the past (tombstones older than ninety days are gone) may have missed a purge,
  // and cannot be brought up to date by a pull. It is told so before anything else, and starts again from nothing: it keeps its outbox, and sends it with
  // the snapshot's first request, which is from zero and is let through (DESIGN.md §8.7).
  if (cursor > 0 && cursor < (await prunedThrough(deps.database, accountId))) {
    return json(410, { code: 'SNAPSHOT_REQUIRED' });
  }

  const results: MutationResult[] = [];
  for (const each of mutations as unknown[]) {
    const parsed = parseMutation(each, deps.plain ? { plain: deps.plain } : {});
    if (!parsed.ok) {
      // The id is echoed only if it is an id, which is nothing a device did not already know.
      const claimed = (each as { mutationId?: unknown } | null)?.mutationId;
      const id = uuid(claimed);
      results.push({ mutationId: id.ok ? id.value : null, status: 'refused', code: 'invalid' });
      continue;
    }
    const applied = await applyMutation(deps.database, accountId, parsed.value, {
      now: deps.now(),
      ...(deps.plain ? { plain: deps.plain } : {}),
      ...(deps.limits ? { limits: deps.limits } : {}),
    });
    results.push(
      applied.status === 'applied'
        ? { mutationId: parsed.value.mutationId, status: 'applied', seq: applied.seq }
        : { mutationId: parsed.value.mutationId, status: 'refused', code: applied.code },
    );
  }

  const answer: SyncResponse = {
    protocol: PROTOCOL_VERSION,
    results,
    pull: await pull(deps.database, accountId, cursor, limit === undefined ? {} : { limit }),
  };
  return json(200, answer);
}

/** The whole of the route for an account: the body is read to a limit, and then it is `handleSync`. The route is this with the server's own `deps`. */
export async function syncResponse(
  request: Request,
  accountId: string,
  deps: SyncDeps,
): Promise<Response> {
  const body = await readCapped(request, LIMITS.bodyBytes);
  if (body === null) return json(413, { code: 'TOO_LARGE' });
  return handleSync(body, accountId, deps);
}

/** The highest `seq` of any tombstone this account has had removed for being old. Zero for an account that never has. */
async function prunedThrough(database: SyncDeps['database'], accountId: string): Promise<number> {
  const settings =
    database.dialect === 'postgres' ? postgresSchema.accountSettings : sqliteSchema.accountSettings;
  const row = await dbGet<{ floor: number | string }>(
    database,
    sql`SELECT pruned_through AS floor FROM ${settings} WHERE account_id = ${accountId}`,
  );
  return Number(row?.floor ?? 0);
}
