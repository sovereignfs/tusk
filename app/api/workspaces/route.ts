import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { listWorkspaces } from '@/src/workspaces/reads';

// The workspaces the signed-in person is in (DESIGN.md §7.3, §17.2), for the sidebar and the boards index. The account is the session's, and is named in
// the statement that reads.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId }) => {
  const workspaces = await listWorkspaces(await getDatabase(), accountId);
  return new Response(JSON.stringify({ workspaces }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
