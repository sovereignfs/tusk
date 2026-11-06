import { uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { boardsOfWorkspace } from '@/src/workspaces/reads';

// The boards of a workspace that the signed-in person can see (DESIGN.md §13.3). A workspace that is not theirs is the same 404.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId, params }) => {
  const id = uuid(params.id);
  const boards = id.ok
    ? await boardsOfWorkspace(await getDatabase(), accountId, id.value)
    : undefined;
  if (!boards) return new Response(null, { status: 404 });
  return new Response(JSON.stringify({ boards }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
