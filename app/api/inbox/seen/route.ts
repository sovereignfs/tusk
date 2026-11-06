import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { markSeen } from '@/src/workspaces/inbox';

// The Inbox has been opened (DESIGN.md §16): what came before now is read, on every device. Moves a time on and never back; the account is the session's.
export const dynamic = 'force-dynamic';

export const POST = accountRoute(async ({ accountId }) => {
  await markSeen(await getDatabase(), accountId, Date.now());
  return new Response(null, { status: 204 });
});
