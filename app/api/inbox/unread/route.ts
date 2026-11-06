import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { unreadCount } from '@/src/workspaces/inbox';

// How many notices are unread (DESIGN.md §16), up to 100, for the sidebar's Inbox entry: small, fetched with the shell and when the person comes back.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId }) => {
  const unread = await unreadCount(await getDatabase(), accountId);
  return new Response(JSON.stringify({ unread }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
});
