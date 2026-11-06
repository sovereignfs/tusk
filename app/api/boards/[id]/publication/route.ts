import { uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { publicationOf } from '@/src/workspaces/published';

// The address a board is published at (DESIGN.md §14.6), for someone who administers it: the address is not shown to anyone else. The same 404 as the board
// for what is not theirs to administer.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId, params }) => {
  const id = uuid(params.id);
  const publication = id.ok
    ? await publicationOf(await getDatabase(), accountId, id.value)
    : undefined;
  if (!publication) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(publication), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
