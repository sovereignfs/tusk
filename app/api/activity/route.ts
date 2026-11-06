import { parseCursor } from '@/src/access/cursor';
import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { activityOfPerson } from '@/src/workspaces/activity-reads';

// What the signed-in person did themselves (DESIGN.md §15.6, §19), across the boards they can still see, newest first in pages of 50.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ request, accountId }) => {
  const cursor = parseCursor(new URL(request.url).searchParams);
  if (!cursor.ok) return new Response(null, { status: 400 });
  const page = await activityOfPerson(
    await getDatabase(),
    authDirectory(await getAuthDatabase()),
    accountId,
    cursor.before,
  );
  return new Response(JSON.stringify(page), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
