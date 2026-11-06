import type { Directory } from '../auth/directory';
import type { Database } from '../db/client';
import type { Limiter, Rule } from '../limits/rate';
import { readCapped } from '../sync/endpoint';
import { applyOp } from './apply';
import { WORKSPACE_LIMITS } from './format';
import { parseOp } from './validate';

/**
 * `POST /api/ops` (DESIGN.md §7.3): one operation on a workspace, from a person who is signed in. The route (`app/api/ops/route.ts`) is wrapped in
 * `accountRoute`, which has found the session and checked `Origin`; this is what runs for the account it names, with everything it needs given to it, so
 * that a test runs it as each role.
 *
 * **The status line is for the request, and the body for the operation.** A request is refused whole when it is not one (400), is too big (413) or
 * comes too often (429). An operation that is refused is answered `200` with its refusal, which says no more than `not_found` for what is not theirs.
 */
export interface OpsDeps {
  database: Database;
  limiter: Limiter;
  now(): number;
  /** The accounts, to find the one an address belongs to. */
  directory: Pick<Directory, 'idOfEmail'>;
}

export const OPS_RATE: Rule = { limit: 240, windowMs: 60_000 };

/** Adding a person by address tells an owner whether the address has an account, so it is counted on its own, by account (DESIGN.md §13.2). */
export const ADD_RATE: Rule = { limit: WORKSPACE_LIMITS.addsPerHour, windowMs: 60 * 60_000 };

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

export async function handleOp(body: string, accountId: string, deps: OpsDeps): Promise<Response> {
  const taken = await deps.limiter.take(`ops:${accountId}`, OPS_RATE);
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
  const parsed = parseOp(request);
  // Not an operation: the request is refused, and says nothing of why that a device did not already know.
  if (!parsed.ok) return json(400, { code: 'BAD_REQUEST' });
  if (parsed.value.op === 'member.add') {
    const added = await deps.limiter.take(`member-add:${accountId}`, ADD_RATE);
    if (!added.ok) {
      return json(
        429,
        { code: 'RATE_LIMITED' },
        { 'retry-after': String(Math.max(1, Math.ceil(added.retryAfterMs / 1000))) },
      );
    }
  }
  const result = await applyOp(deps.database, accountId, parsed.value, {
    now: deps.now(),
    directory: deps.directory,
  });
  return json(200, result);
}

export async function opsResponse(
  request: Request,
  accountId: string,
  deps: OpsDeps,
): Promise<Response> {
  const body = await readCapped(request, WORKSPACE_LIMITS.bodyBytes);
  if (body === null) return json(413, { code: 'TOO_LARGE' });
  return handleOp(body, accountId, deps);
}
