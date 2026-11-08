import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { assignedOf } from '@/src/workspaces/inbox';

// The signed-in person's Inbox (DESIGN.md §16): the open cards assigned to them across their boards. What they are told is `/api/notifications`. The account is the
// session's, and every statement names it.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId }) => {
  const assigned = await assignedOf(await getDatabase(), accountId);
  return new Response(JSON.stringify({ assigned }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
