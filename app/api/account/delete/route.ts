import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { getAuth } from '@/src/auth/server';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { deleteAccount, deletionPreview, type DeleteDeps } from '@/src/sovereign/delete-account';

// Deleting the account (DESIGN.md §22): what it would do, and doing it with the password. The account is the session's.
export const dynamic = 'force-dynamic';

async function deps(): Promise<DeleteDeps> {
  const database = await getDatabase();
  const authDatabase = await getAuthDatabase();
  return {
    database,
    authDatabase,
    directory: authDirectory(authDatabase),
    limiter: new RateLimiter(database),
    now: Date.now,
    verify: async (request, password) => {
      const auth = await getAuth();
      if (!auth) return false;
      try {
        const result = await auth.api.verifyPassword({
          body: { password },
          headers: request.headers,
        });
        return result.status === true;
      } catch {
        return false;
      }
    },
  };
}

export const GET = accountRoute(async ({ accountId }) => deletionPreview(accountId, await deps()));
export const POST = accountRoute(async ({ request, accountId }) =>
  deleteAccount(request, accountId, await deps()),
);
