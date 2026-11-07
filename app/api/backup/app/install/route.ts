import { accountRoute } from '@/src/access/route';
import { appDeps } from '@/src/github-app/deps';
import { appInstall } from '@/src/github-app/endpoint';

// To GitHub, to install the App on one repository (DESIGN.md §21.2). Not found where no App is set up.
export const dynamic = 'force-dynamic';

export const GET = accountRoute(async () => {
  const deps = await appDeps();
  return deps ? appInstall(deps) : new Response(null, { status: 404 });
});
