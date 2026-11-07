import { accountRoute } from '@/src/access/route';
import { connectionConfirmKey } from '@/src/backup/endpoint';
import { getConfig } from '@/src/config/current';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';

// The person confirms that backups go on now that the Desk has a key of its own (DESIGN.md §21.3).
export const dynamic = 'force-dynamic';

export const POST = accountRoute(async ({ accountId }) => {
  const database = await getDatabase();
  const config = getConfig();
  return connectionConfirmKey(accountId, {
    database,
    ring: config.encryption,
    apiUrl: config.githubApiUrl,
    now: Date.now,
    limiter: new RateLimiter(database),
  });
});
