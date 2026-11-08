import { accountRoute } from '@/src/access/route';
import { getConfig } from '@/src/config/current';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { readCapped } from '@/src/sync/endpoint';
import {
  type Capabilities,
  parseSettingsChange,
  readSettings,
  saveSettings,
} from '@/src/settings/account-settings';

// What the account keeps with the account (DESIGN.md §19). The account is the session's; a body names a setting that exists or is refused, and it is limited.
export const dynamic = 'force-dynamic';

/** What this server can deliver (DESIGN.md §19): the screen offers only these, and a change that needs one it lacks is refused. */
const capabilities = (): Capabilities => {
  const config = getConfig();
  return {
    email: config.mail !== undefined,
    // Push needs the VAPID keys and the instance key that seals what a device gives.
    push: config.push !== undefined && config.encryption !== undefined,
    core: config.auth?.sovereign !== undefined,
  };
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export const PATCH = accountRoute(async ({ request, accountId }) => {
  const database = await getDatabase();
  const taken = await new RateLimiter(database).take(`settings:${accountId}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!taken.ok) return json(429, { code: 'RATE_LIMITED' });
  const body = await readCapped(request, 1024);
  if (body === null) return json(413, { code: 'TOO_LARGE' });
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return json(400, { code: 'BAD_REQUEST' });
  }
  const change = parseSettingsChange(value, capabilities());
  if (!change.ok) return json(400, { code: 'BAD_REQUEST' });
  await saveSettings(database, accountId, change.value, Date.now());
  return json(200, change.value);
});

// What the account keeps, with the defaults for what it has not set.
export const GET = accountRoute(async ({ accountId }) => {
  return json(200, {
    ...(await readSettings(await getDatabase(), accountId)),
    can: capabilities(),
    // The public key a device subscribes with: public by its nature, and given only where Push can work.
    pushKey: capabilities().push ? getConfig().push?.publicKey : undefined,
  });
});
