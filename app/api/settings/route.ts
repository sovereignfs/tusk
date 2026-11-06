import { accountRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { readCapped } from '@/src/sync/endpoint';
import { parseSettingsChange, saveSettings } from '@/src/settings/account-settings';

// What the account keeps with the account (DESIGN.md §19). The account is the session's; a body names a setting that exists or is refused, and it is limited.
export const dynamic = 'force-dynamic';

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
  const change = parseSettingsChange(value);
  if (!change.ok) return json(400, { code: 'BAD_REQUEST' });
  await saveSettings(database, accountId, change.value, Date.now());
  return json(200, change.value);
});
