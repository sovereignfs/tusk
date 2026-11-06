import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { publicationsOf } from '@/src/workspaces/published';

// The boards of the signed-in person that are published (DESIGN.md §14.6), for Settings > Data: they administer them, and so may see their addresses.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId }) => {
  const publications = await publicationsOf(await getDatabase(), accountId);
  return new Response(JSON.stringify({ publications }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
