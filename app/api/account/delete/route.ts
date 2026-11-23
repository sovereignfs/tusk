import { confirmPassword, readSession } from '@sovereignfs/auth/server';
import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { FRESH_SESSION_SECONDS } from '@/src/auth/auth';
import { getAuth } from '@/src/auth/server';
import { getAuthStore, getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { deleteAccount, deletionPreview, type DeleteDeps } from '@/src/sovereign/delete-account';

// Deleting the account (DESIGN.md §22): what it would do, and doing it with the password. The account is the session's.
export const dynamic = 'force-dynamic';

async function deps(): Promise<DeleteDeps> {
  const database = await getDatabase();
  const authDatabase = await getAuthStore();
  return {
    database,
    authDatabase,
    directory: authDirectory(authDatabase),
    limiter: new RateLimiter(database),
    now: Date.now,
    // The password again (its sign-in value), through the package, which counts wrong answers per account (auth.md §4, rule 3).
    verify: async (request, password) => {
      const auth = await getAuth();
      if (!auth) return false;
      const session = await readSession(auth, request.headers);
      if (!session) return false;
      return (await confirmPassword(authDatabase, auth, session.user.id, password)) === 'ok';
    },
    hasPassword: async (accountId) => {
      const auth = await getAuth();
      if (!auth) return true; // nothing could be proved, so a password is what is asked for
      const context = await auth.$context;
      return (await context.internalAdapter.findAccounts(accountId)).some(
        (account) => account.providerId === 'credential',
      );
    },
    fresh: async (request) => {
      const auth = await getAuth();
      const session = auth ? await readSession(auth, request.headers) : null;
      if (!session) return false;
      return (
        Date.now() - new Date(session.session.createdAt).getTime() < FRESH_SESSION_SECONDS * 1000
      );
    },
  };
}

export const GET = accountRoute(async ({ accountId }) => deletionPreview(accountId, await deps()));
export const POST = accountRoute(async ({ request, accountId }) =>
  deleteAccount(request, accountId, await deps()),
);
