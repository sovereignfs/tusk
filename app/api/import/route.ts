import { uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { edgeSettings } from '@/src/config/edge';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { MAX_FILE_BYTES, validateFile } from '@/src/portability/validate';
import { importBoard, importWorkspaces } from '@/src/workspaces/import';
import { HSTS } from '@/src/security/csp';

/**
 * The server's part of an import (DESIGN.md §20.2): **one request, one transaction.** The body is the file as the browser read it, at most 50 MB, counted as
 * it arrives and refused the moment it is over, and **checked again here** with the same `validateFile` the browser used, since a browser's word is not taken.
 * A board file goes into the workspace named in `?workspace=` that the person is in; a workspace file, or the workspaces of an "everything" file, are created
 * with the person as owner. A Desk is imported by the browser, through sync, and is not asked of here. A file that fails changes nothing.
 *
 * It is not behind the proxy (`proxy.ts` leaves it out): the proxy buffers a request's body to let it be read twice, up to a limit far below this, and
 * an API answer has no page to put a policy on. The one header the proxy would add, HSTS, is added here.
 */
export const dynamic = 'force-dynamic';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...(edgeSettings().secure ? { 'strict-transport-security': HSTS } : {}),
    },
  });

/** The body as text, read as it arrives, and `undefined` the moment it is more than the limit. */
async function bounded(request: Request): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) return undefined;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FILE_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const POST = accountRoute(async ({ request, accountId }) => {
  const source = await bounded(request);
  if (source === undefined) return json(413, { error: 'the file is over 50 MB' });
  const read = validateFile(source);
  if (!read.ok) return json(400, { error: read.error });
  const { file } = read;
  const database = await getDatabase();
  const directory = authDirectory(await getAuthDatabase());
  const now = Date.now();

  let result;
  if (file.scope === 'board' && file.board) {
    const workspace = uuid(new URL(request.url).searchParams.get('workspace'));
    if (!workspace.ok) return json(400, { error: 'a board is imported into a workspace' });
    result = await importBoard(database, directory, accountId, workspace.value, file.board, now);
  } else if (file.scope === 'workspace' && file.workspace) {
    result = await importWorkspaces(database, directory, accountId, [file.workspace], now);
  } else if (file.scope === 'everything') {
    result = await importWorkspaces(database, directory, accountId, file.workspaces ?? [], now);
  } else {
    return json(400, { error: 'a Desk is imported on the device, not here' });
  }
  if (!result.ok)
    return result.reason === 'not_found'
      ? json(404, { error: 'not found' })
      : json(422, { error: 'that would take the account over a limit' });
  return json(200, result.imported);
});
