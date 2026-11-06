import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { opsResponse } from '@/src/workspaces/endpoint';

// The one door every write to a workspace comes through (DESIGN.md §7.3). The wrapper has found the session and checked `Origin`; the account it hands
// over is the only one there is, and the permission is in the statement that does the work.
export const dynamic = 'force-dynamic';

export const POST = accountRoute(async ({ request, accountId }) => {
  const database = await getDatabase();
  return opsResponse(request, accountId, {
    database,
    limiter: new RateLimiter(database),
    now: Date.now,
  });
});
