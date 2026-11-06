import { accountRoute } from '@/src/access/route';
import { getConfig } from '@/src/config/current';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { encryptionSkip } from '@/src/encryption/endpoint';

// The person chose to keep the Desk plain (DESIGN.md §9.1).
export const dynamic = 'force-dynamic';

export const POST = accountRoute(async ({ accountId }) => {
  const database = await getDatabase();
  return encryptionSkip(accountId, {
    database,
    limiter: new RateLimiter(database),
    now: Date.now,
    operatorEncryption: getConfig().operatorEncryption,
  });
});
