import { type Parsed, uuid } from '@/src/access/parse';
import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { commentsOf } from '@/src/workspaces/reads';

// A page of a card's comments, newest first (DESIGN.md §15.5), after the comment named by `beforeAt` and `beforeId` when they are given. The same 404 as the
// card itself for what is not theirs.
export const dynamic = 'force-dynamic';

const timeOf = (value: string | null): Parsed<number> =>
  value !== null && /^\d{1,16}$/.test(value)
    ? { ok: true, value: Number(value) }
    : { ok: false, reason: 'not a time' };

export const GET = accountRoute(async ({ request, accountId, params }) => {
  const id = uuid(params.id);
  if (!id.ok) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  const beforeAt = url.searchParams.get('beforeAt');
  const beforeId = uuid(url.searchParams.get('beforeId'));
  let before: { createdAt: number; id: string } | undefined;
  if (beforeAt !== null || url.searchParams.has('beforeId')) {
    const at = timeOf(beforeAt);
    if (!at.ok || !beforeId.ok) return new Response(null, { status: 400 });
    before = { createdAt: at.value, id: beforeId.value };
  }
  const page = await commentsOf(
    await getDatabase(),
    authDirectory(await getAuthDatabase()),
    accountId,
    id.value,
    before,
  );
  if (!page) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(page), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
