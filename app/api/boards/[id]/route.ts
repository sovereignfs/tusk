import { uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { readBoard } from '@/src/workspaces/reads';

// A board whole and light (DESIGN.md §14.7), for someone who can see it. A board that is not theirs (private, another workspace's, never there, or not an
// id) is the same 404.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId, params }) => {
  const id = uuid(params.id);
  const view = id.ok ? await readBoard(await getDatabase(), accountId, id.value) : undefined;
  if (!view) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(view), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
