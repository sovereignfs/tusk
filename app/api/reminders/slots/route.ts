import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { putSlots } from '@/src/reminders/endpoint';

// A device says when something is due, for a Desk the server cannot read (DESIGN.md §25.2): the account is the session's, and the body is instants and nothing else.
export const dynamic = 'force-dynamic';

export const PUT = accountRoute(async ({ request, accountId }) => {
  const database = await getDatabase();
  return putSlots(request, accountId, {
    database,
    limiter: new RateLimiter(database),
    now: Date.now,
  });
});
