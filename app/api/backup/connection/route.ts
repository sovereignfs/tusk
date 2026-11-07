import { accountRoute } from '@/src/access/route';
import {
  connectionConnect,
  connectionDisconnect,
  connectionSchedule,
  connectionStatus,
  type ConnectionDeps,
} from '@/src/backup/endpoint';
import { getConfig } from '@/src/config/current';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';

// The repository an account backs up to (DESIGN.md §21.2). The account is the session's; the token is in the body of one request and in no response.
export const dynamic = 'force-dynamic';

async function deps(): Promise<ConnectionDeps> {
  const database = await getDatabase();
  const config = getConfig();
  return {
    database,
    ring: config.encryption,
    apiUrl: config.githubApiUrl,
    now: Date.now,
    limiter: new RateLimiter(database),
    appAvailable: config.githubApp !== undefined,
  };
}

export const GET = accountRoute(async ({ accountId }) => connectionStatus(accountId, await deps()));
export const POST = accountRoute(async ({ request, accountId }) =>
  connectionConnect(request, accountId, await deps()),
);
export const PATCH = accountRoute(async ({ request, accountId }) =>
  connectionSchedule(request, accountId, await deps()),
);
export const DELETE = accountRoute(async ({ accountId }) =>
  connectionDisconnect(accountId, await deps()),
);
