import { uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { exportBoard, exportOwned, exportWorkspace } from '@/src/workspaces/export';
import { envelope, fileNameOf, serialise } from '@/src/portability/format';

// The server's part of an export (DESIGN.md §20.1): a board for anyone who can see it, a workspace for its owners, and `owned` (every workspace the person
// owns, the server's half of "everything", which the browser joins to its own Desk). What is not theirs is the same 404 as what is not there. The Desk is
// made in the browser and never asked of here.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ request, accountId }) => {
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope');
  const database = await getDatabase();
  const directory = authDirectory(await getAuthDatabase());
  const now = new Date();

  let file: ReturnType<typeof envelope> | undefined;
  if (scope === 'owned') {
    file = envelope(
      'everything',
      { workspaces: await exportOwned(database, directory, accountId) },
      now,
    );
  } else if (scope === 'board' || scope === 'workspace') {
    const id = uuid(url.searchParams.get('id'));
    if (!id.ok) return new Response(null, { status: 404 });
    if (scope === 'board') {
      const board = await exportBoard(database, directory, accountId, id.value);
      if (board) file = envelope('board', { board }, now);
    } else {
      const workspace = await exportWorkspace(database, directory, accountId, id.value);
      if (workspace) file = envelope('workspace', { workspace }, now);
    }
  } else {
    return new Response(null, { status: 400 });
  }
  if (!file) return new Response(null, { status: 404 });
  return new Response(serialise(file), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${fileNameOf(file.scope, now)}"`,
    },
  });
});
