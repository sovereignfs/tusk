import { accountRoute } from '@/src/access/route';
import { getConfig } from '@/src/config/current';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { encryptionSetup } from '@/src/encryption/endpoint';

// Setting up a key of the person's own (DESIGN.md §9.1): the body is the public key. One way.
export const dynamic = 'force-dynamic';

export const POST = accountRoute(async ({ request, accountId }) => {
  const database = await getDatabase();
  return encryptionSetup(request, accountId, {
    database,
    limiter: new RateLimiter(database),
    now: Date.now,
    operatorEncryption: getConfig().operatorEncryption,
  });
});
