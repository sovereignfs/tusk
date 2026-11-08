import { accountRoute } from '@/src/access/route';
import { getConfig } from '@/src/config/current';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { pushSubscribe, pushUnsubscribe } from '@/src/push/endpoint';

// A device turns Web Push on or off for the signed-in account (DESIGN.md §25.2): the account is the session's, and what a device gives is sealed.
export const dynamic = 'force-dynamic';

async function deps() {
  const config = getConfig();
  const database = await getDatabase();
  return {
    database,
    limiter: new RateLimiter(database),
    ring: config.encryption,
    configured: config.push !== undefined,
    now: Date.now,
  };
}

export const POST = accountRoute(async ({ request, accountId }) =>
  pushSubscribe(request, accountId, await deps()),
);

export const DELETE = accountRoute(async ({ request, accountId }) =>
  pushUnsubscribe(request, accountId, await deps()),
);
