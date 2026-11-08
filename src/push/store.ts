import { sql } from 'drizzle-orm';
import { type Parsed } from '../access/parse';
import { deleteCredential, putCredential, readCredential } from '../crypto/store';
import type { KeyRing } from '../crypto/keys';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';

/**
 * The devices that are sent Web Push (DESIGN.md §25.2, task 8.4): one row for each, **turned on from that device and for the account that is signed in on it**. The
 * row has the push service's address for the device (`endpoint`, unique: a device is known by it), and **the keys that encrypt to it are sealed in `credential`**
 * (`src/crypto/`, the instance key; so Web Push needs one), never as text in a column. A person has at most `MOST_DEVICES`.
 *
 * Every statement names the account, as everywhere: another account's device is not found, removed or listed. An address that another account had (the same browser,
 * signed in as someone else before) is taken over by the one who subscribes now, whose it then is.
 */
export const MOST_DEVICES = 10;
const PURPOSE = 'push-keys';

const table = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.pushSubscription : sqliteApp.pushSubscription;

export interface Subscription {
  readonly endpoint: string;
  /** The device's public key, base64url, 65 bytes. */
  readonly p256dh: string;
  /** The shared secret of this subscription, base64url, 16 bytes. */
  readonly auth: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A subscription as a browser gives it (`PushSubscription.toJSON()`): an https address and the two keys, in their shapes, and nothing else. */
export function parseSubscription(value: unknown): Parsed<Subscription> {
  if (!isRecord(value)) return { ok: false, reason: 'not a subscription' };
  const { endpoint, keys, ...rest } = value;
  if (Object.keys(rest).some((key) => key !== 'expirationTime'))
    return { ok: false, reason: 'names what a subscription does not have' };
  if (typeof endpoint !== 'string' || endpoint.length > 2048)
    return { ok: false, reason: 'endpoint: not an address' };
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: 'endpoint: not an address' };
  }
  // Push services are https, and an address with a user or a password in it is a credential in a URL, which is never kept.
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '')
    return { ok: false, reason: 'endpoint: an https address with no user' };
  if (!isRecord(keys)) return { ok: false, reason: 'keys: not the keys' };
  const { p256dh, auth, ...more } = keys;
  if (Object.keys(more).length > 0) return { ok: false, reason: 'keys: more than two' };
  if (typeof p256dh !== 'string' || !/^[A-Za-z0-9_-]{86,88}$/.test(p256dh))
    return { ok: false, reason: 'keys.p256dh: not a public key' };
  if (typeof auth !== 'string' || !/^[A-Za-z0-9_-]{22,24}$/.test(auth))
    return { ok: false, reason: 'keys.auth: not an auth secret' };
  return { ok: true, value: { endpoint, p256dh, auth } };
}

/** Turns Push on for a device, for this account: a new row and its sealed keys, replacing a row for the same address. `limit` when the account has as many as it may. */
export async function saveSubscription(
  database: Database,
  ring: KeyRing,
  accountId: string,
  subscription: Subscription,
  now: number,
): Promise<'saved' | 'limit'> {
  const t = table(database);
  const there = await dbGet<{ id: string; accountId: string }>(
    database,
    sql`SELECT id, account_id AS "accountId" FROM ${t} WHERE endpoint = ${subscription.endpoint}`,
  );
  if (!there) {
    const count = await dbGet<{ n: number | string }>(
      database,
      sql`SELECT COUNT(*) AS n FROM ${t} WHERE account_id = ${accountId}`,
    );
    if (Number(count?.n ?? 0) >= MOST_DEVICES) return 'limit';
  }
  const id = crypto.randomUUID();
  await putCredential(
    database,
    ring,
    { id: `push:${id}`, accountId, purpose: PURPOSE },
    JSON.stringify({ p256dh: subscription.p256dh, auth: subscription.auth }),
    now,
  );
  await transaction(database, async (tx) => {
    await dbAll(tx, sql`DELETE FROM ${t} WHERE endpoint = ${subscription.endpoint} RETURNING id`);
    await dbAll(
      tx,
      sql`INSERT INTO ${t} (id, account_id, endpoint, credential_id, created_at)
          VALUES (${id}, ${accountId}, ${subscription.endpoint}, ${`push:${id}`}, ${now}) RETURNING id`,
    );
  });
  // The keys of the row it replaced: its credential is no longer named.
  if (there) {
    await deleteCredential(database, {
      id: `push:${there.id}`,
      accountId: there.accountId,
      purpose: PURPOSE,
    });
  }
  return 'saved';
}

/** Turns Push off for a device, for this account: the row and its keys. Another account's device is not found. */
export async function removeSubscription(
  database: Database,
  accountId: string,
  endpoint: string,
): Promise<boolean> {
  const gone = await dbAll<{ id: string }>(
    database,
    sql`DELETE FROM ${table(database)} WHERE endpoint = ${endpoint} AND account_id = ${accountId} RETURNING id`,
  );
  for (const row of gone)
    await deleteCredential(database, { id: `push:${row.id}`, accountId, purpose: PURPOSE });
  return gone.length > 0;
}

export interface Device extends Subscription {
  readonly id: string;
}

/** The account's devices, with their keys opened: for the one call that sends to them. */
export async function devicesOf(
  database: Database,
  ring: KeyRing,
  accountId: string,
): Promise<Device[]> {
  const rows = await dbAll<{ id: string; endpoint: string }>(
    database,
    sql`SELECT id, endpoint FROM ${table(database)} WHERE account_id = ${accountId} ORDER BY created_at, id`,
  );
  const out: Device[] = [];
  for (const row of rows) {
    const sealed = await readCredential(database, ring, {
      id: `push:${row.id}`,
      accountId,
      purpose: PURPOSE,
    });
    if (!sealed) continue;
    try {
      const keys = JSON.parse(sealed) as { p256dh: string; auth: string };
      out.push({ id: row.id, endpoint: row.endpoint, p256dh: keys.p256dh, auth: keys.auth });
    } catch {
      // Keys that cannot be read are not a device that can be sent to.
    }
  }
  return out;
}

/** Removes a device the push service says is gone (404 or 410): by its own id and the account's. */
export async function removeDevice(
  database: Database,
  accountId: string,
  id: string,
): Promise<void> {
  const gone = await dbAll<{ id: string }>(
    database,
    sql`DELETE FROM ${table(database)} WHERE id = ${id} AND account_id = ${accountId} RETURNING id`,
  );
  for (const row of gone)
    await deleteCredential(database, { id: `push:${row.id}`, accountId, purpose: PURPOSE });
}

/** How many devices an account has. */
export async function deviceCount(database: Database, accountId: string): Promise<number> {
  const row = await dbGet<{ n: number | string }>(
    database,
    sql`SELECT COUNT(*) AS n FROM ${table(database)} WHERE account_id = ${accountId}`,
  );
  return Number(row?.n ?? 0);
}
