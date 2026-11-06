import { accountRoute } from '@/src/access/route';
import { getConfig } from '@/src/config/current';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { type EncryptionDeps, encryptionStatus } from '@/src/encryption/endpoint';

// Whether the Desk has a key of its own (DESIGN.md §9.1). The account is the session's; only a public key is ever held.
export const dynamic = 'force-dynamic';

async function deps(): Promise<EncryptionDeps> {
  const database = await getDatabase();
  return {
    database,
    limiter: new RateLimiter(database),
    now: Date.now,
    operatorEncryption: getConfig().operatorEncryption,
  };
}

export const GET = accountRoute(async ({ accountId }) => encryptionStatus(accountId, await deps()));
