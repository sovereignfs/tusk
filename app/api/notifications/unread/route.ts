import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { getUnread } from '@/src/workspaces/notifications-endpoint';

// How many notices are unread (DESIGN.md §16), up to 100, for the bell: small, fetched with the shell and when the person comes back.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ accountId }) =>
  getUnread(accountId, {
    database: await getDatabase(),
    directory: authDirectory(await getAuthDatabase()),
    now: Date.now,
  }),
);
