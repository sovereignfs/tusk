import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { getPlanned } from '@/src/planner/endpoint';

// The boards' part of the Planner (DESIGN.md §25.1): the open cards assigned to the signed-in person with a due date in `from` to `to` (at most nine weeks).
// The account is the session's, and the statement names it and the boards it can see. Nothing is written.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ request, accountId }) =>
  getPlanned(request, accountId, await getDatabase()),
);
