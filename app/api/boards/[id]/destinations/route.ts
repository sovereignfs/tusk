import { uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { moveTargets } from '@/src/workspaces/reads';

// Where a card of this board can be moved to (DESIGN.md §15.7): the other boards of its workspace that the person is a member of, with their lists and
// people. The same 404 as the board for what is not theirs.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId, params }) => {
  const id = uuid(params.id);
  const targets = id.ok ? await moveTargets(await getDatabase(), accountId, id.value) : undefined;
  if (!targets) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(targets), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
