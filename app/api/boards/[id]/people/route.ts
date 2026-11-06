import { uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { boardPeople } from '@/src/workspaces/reads';

// A board's people (DESIGN.md §14.3), for the avatars in its header and its Share dialog. The same 404 as the board itself for what is not theirs.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId, params }) => {
  const id = uuid(params.id);
  const people = id.ok
    ? await boardPeople(
        await getDatabase(),
        authDirectory(await getAuthDatabase()),
        accountId,
        id.value,
      )
    : undefined;
  if (!people) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(people), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
