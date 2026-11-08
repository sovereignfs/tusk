import type { Database } from '../db/client';
import { plannedBoardCards } from '../workspaces/planned';
import { parseRange } from './range';

/**
 * `GET /api/planner` (DESIGN.md §25.1, task 19.1): the signed-in person's open assigned cards with a due date in `from` to `to`. The account is the session's,
 * given by `accountRoute`; a range that is not two dates in order, of at most nine weeks, is 400. Nothing is written.
 */
export async function getPlanned(
  request: Request,
  accountId: string,
  database: Database,
): Promise<Response> {
  const range = parseRange(new URL(request.url).searchParams);
  if (!range.ok) return new Response(null, { status: 400 });
  const cards = await plannedBoardCards(database, accountId, range.from, range.to);
  return new Response(JSON.stringify({ cards }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
