import { coreSignOutUrl } from '@sovereignfs/auth/core';
import { accountRoute } from '@/src/access/route';
import { getAuth, sovereignClient } from '@/src/auth/server';
import { getAuthStore } from '@/src/db/boot';
import { readSession } from '@sovereignfs/auth/server';

// Where signing out goes once this device has let go (auth.md §8): core's sign-out for a session that came from core,
// which decides whether it ends core's session too (core-app §3.6.5), or nowhere further. Asked before the session ends, since the address
// goes with it.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ request }) => {
  const auth = await getAuth();
  const client = sovereignClient();
  const session = auth ? await readSession(auth, request.headers) : null;
  const url =
    session && client
      ? await coreSignOutUrl(await getAuthStore(), client, session.session.id).catch(
          () => undefined,
        )
      : undefined;
  return Response.json({ url: url ?? null }, { headers: { 'cache-control': 'no-store' } });
});
