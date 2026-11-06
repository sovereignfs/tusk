import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { boardsIndex } from '@/src/workspaces/reads';

// The boards index (DESIGN.md §17.3): for each workspace the person is in, the boards they can see and a few of its people, and the sort they chose. Every
// statement names the account, so a private board that is not theirs is not in it.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId }) => {
  const index = await boardsIndex(
    await getDatabase(),
    authDirectory(await getAuthDatabase()),
    accountId,
  );
  return new Response(JSON.stringify(index), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
