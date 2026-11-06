import { accountRoute } from '@/src/access/route';
import { getConfig } from '@/src/config/current';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { encryptionBegin } from '@/src/encryption/endpoint';

// Moving a Desk that has things in it to a key of the person's own (DESIGN.md §9.3).
export const dynamic = 'force-dynamic';

export const POST = accountRoute(async ({ request, accountId }) => {
  const database = await getDatabase();
  return encryptionBegin(request, accountId, {
    database,
    limiter: new RateLimiter(database),
    now: Date.now,
    operatorEncryption: getConfig().operatorEncryption,
  });
});
