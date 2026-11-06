import { accountRoute } from '@/src/access/route';
import { uuid } from '@/src/access/parse';
import { authDirectory } from '@/src/auth/directory';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { peopleOf } from '@/src/workspaces/reads';

// The people of a workspace the signed-in person is in (DESIGN.md §13.2). A workspace that is not theirs, or is not there, or is not an id, is the same 404.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId, params }) => {
  const id = uuid(params.id);
  const people = id.ok
    ? await peopleOf(
        await getDatabase(),
        authDirectory(await getAuthDatabase()),
        accountId,
        id.value,
      )
    : undefined;
  if (!people) return new Response(null, { status: 404 });
  return new Response(JSON.stringify({ people }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
