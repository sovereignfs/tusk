import { accountRoute } from '@/src/access/route';
import { authDirectory } from '@/src/auth/directory';
import { runNow } from '@/src/backup/endpoint';
import { getConfig } from '@/src/config/current';
import { getAuthDatabase, getDatabase } from '@/src/db/boot';
import { installationTokens } from '@/src/github-app/server';
import { RateLimiter } from '@/src/limits/rate';
import { operatorOf } from '@/src/crypto/operator';

// Back up now (DESIGN.md §21.4). The account is the session's; the token is opened on the server and goes nowhere but the git host.
export const dynamic = 'force-dynamic';

export const POST = accountRoute(async ({ accountId }) => {
  const database = await getDatabase();
  const config = getConfig();
  return runNow(accountId, {
    database,
    directory: authDirectory(await getAuthDatabase()),
    ring: config.encryption,
    ...(operatorOf(config) ? { operator: operatorOf(config) } : {}),
    apiUrl: config.githubApiUrl,
    ...(installationTokens() ? { tokens: installationTokens() } : {}),
    now: Date.now,
    limiter: new RateLimiter(database),
  });
});
