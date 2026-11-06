import { parseCursor } from '@/src/access/cursor';
import { uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { activityOfCard } from '@/src/workspaces/activity-reads';

// A card's activity (DESIGN.md §15.6), newest first in pages of 50, for someone who can see its board. It outlives the card, so this is true of a card that
// has been deleted; the same 404 for what is not theirs.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ request, accountId, params }) => {
  const id = uuid(params.id);
  if (!id.ok) return new Response(null, { status: 404 });
  const cursor = parseCursor(new URL(request.url).searchParams);
  if (!cursor.ok) return new Response(null, { status: 400 });
  const page = await activityOfCard(
    await getDatabase(),
    authDirectory(await getAuthDatabase()),
    accountId,
    id.value,
    cursor.before,
  );
  if (!page) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(page), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
