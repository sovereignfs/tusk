import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { postDismiss } from '@/src/workspaces/notifications-endpoint';

// Dismisses the notices named, or all of them (DESIGN.md §16, task 8.7). The account is the session's and so are the notices: ids of another person's change nothing.
export const dynamic = 'force-dynamic';

export const POST = accountRoute(async ({ request, accountId }) =>
  postDismiss(request, accountId, {
    database: await getDatabase(),
    directory: authDirectory(await getAuthDatabase()),
    now: Date.now,
  }),
);
