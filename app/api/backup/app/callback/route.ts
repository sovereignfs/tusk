import { accountRoute } from '@/src/access/route';
import { appDeps } from '@/src/github-app/deps';
import { appCallback } from '@/src/github-app/endpoint';

// Where GitHub sends the person back after installing the App (DESIGN.md §21.2): the account is the session's, the `state` must be the cookie's, and the
// installation must be one the person can reach. Not found where no App is set up.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async ({ request, accountId }) => {
  const deps = await appDeps();
  return deps ? appCallback(request, accountId, deps) : new Response(null, { status: 404 });
});
