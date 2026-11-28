import { accountRoute } from '@/src/access/route';
import { getAuth } from '@/src/auth/server';
import { getAuthStore } from '@/src/db/boot';
import { unlinkSovereign } from '@/src/sovereign/unlink';

// Unlinking Sovereign from the session's own account (DESIGN.md §6), after the password. The account is the session's.
export const dynamic = 'force-dynamic';

export const POST = accountRoute(async ({ request, accountId }) => {
  const auth = await getAuth();
  if (!auth) return new Response(null, { status: 404 });
  return unlinkSovereign(request, accountId, { auth, store: await getAuthStore() });
});
