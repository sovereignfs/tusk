import { getConfig } from '@/src/config/current';
import { getDatabase } from '@/src/db/boot';
import { webhook } from '@/src/github-app/endpoint';
import { installationTokens } from '@/src/github-app/server';

// What GitHub tells Tusk about the App (DESIGN.md §21.2): an installation, or a repository in one, was removed. The signature over the body is the whole of the
// authentication: no session, no cookie, no `Origin`. Not found where no App is set up.
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const app = getConfig().githubApp;
  if (!app) return new Response(null, { status: 404 });
  const tokens = installationTokens();
  return webhook(request, {
    database: await getDatabase(),
    secret: app.webhookSecret,
    log: (line) => console.info(line),
    forget: (id) => tokens?.forget(id),
  });
}
