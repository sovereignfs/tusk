import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { getNotifications } from '@/src/workspaces/notifications-endpoint';

// What the signed-in person is told (DESIGN.md §16): a page of notices, newest first, after the one named by `beforeAt` and `beforeId` when they are given, each with
// whether it is read, and on the first page how many are unread. The account is the session's, and every statement names it.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ request, accountId }) =>
  getNotifications(request, accountId, {
    database: await getDatabase(),
    directory: authDirectory(await getAuthDatabase()),
    now: Date.now,
  }),
);
