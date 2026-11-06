import { uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { inboxOf } from '@/src/workspaces/inbox';

// The signed-in person's Inbox (DESIGN.md §16): a page of notices, newest first, after the one named by `beforeAt` and `beforeId` when they are given, and on the
// first page what is assigned to them. The account is the session's, and every statement names it.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ request, accountId }) => {
  const url = new URL(request.url);
  const at = url.searchParams.get('beforeAt');
  const id = uuid(url.searchParams.get('beforeId'));
  let before: { createdAt: number; id: string } | undefined;
  if (at !== null || url.searchParams.has('beforeId')) {
    if (at === null || !/^\d{1,16}$/.test(at) || !id.ok) return new Response(null, { status: 400 });
    before = { createdAt: Number(at), id: id.value };
  }
  const inbox = await inboxOf(
    await getDatabase(),
    authDirectory(await getAuthDatabase()),
    accountId,
    before,
  );
  return new Response(JSON.stringify(inbox), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
