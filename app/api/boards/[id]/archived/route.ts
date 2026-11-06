import { uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { archivedCards } from '@/src/workspaces/reads';

// A board's archived cards (DESIGN.md §15.8), fetched when asked for. The same 404 as the board itself for what is not theirs.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId, params }) => {
  const id = uuid(params.id);
  const cards = id.ok ? await archivedCards(await getDatabase(), accountId, id.value) : undefined;
  if (!cards) return new Response(null, { status: 404 });
  return new Response(JSON.stringify({ cards }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
