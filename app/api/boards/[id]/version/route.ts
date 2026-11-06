import { uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { boardVersion } from '@/src/workspaces/reads';

// A board's version, asked every twenty seconds while it is open (DESIGN.md §14.7): small, and the same 404 as the board itself for what is not theirs.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId, params }) => {
  const id = uuid(params.id);
  const version = id.ok ? await boardVersion(await getDatabase(), accountId, id.value) : undefined;
  if (version === undefined) return new Response(null, { status: 404 });
  return new Response(JSON.stringify({ version }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
