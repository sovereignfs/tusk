import { uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { cardDetail } from '@/src/workspaces/reads';

// A card whole (DESIGN.md §17.6), for someone who can see its board. A card on a board that is not theirs, never there, or not an id is the same 404.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId, params }) => {
  const id = uuid(params.id);
  const card = id.ok ? await cardDetail(await getDatabase(), accountId, id.value) : undefined;
  if (!card) return new Response(null, { status: 404 });
  return new Response(JSON.stringify({ card }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
