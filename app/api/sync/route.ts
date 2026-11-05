import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { syncResponse } from '@/src/sync/endpoint';

// The one door nearly every write comes through (DESIGN.md §8.3). The wrapper has found the session and checked `Origin`; the account it hands over
// is the only owner there is.
export const dynamic = 'force-dynamic';

export const POST = accountRoute(async ({ request, accountId }) => {
  const database = await getDatabase();
  return syncResponse(request, accountId, {
    database,
    limiter: new RateLimiter(database),
    now: Date.now,
  });
});
