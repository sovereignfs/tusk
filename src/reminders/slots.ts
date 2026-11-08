import { sql } from 'drizzle-orm';
import type { Parsed } from '../access/parse';
import type { Database } from '../db/client';
import { dbAll, dbRun, transaction } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import { readEncryption } from '../encryption/state';

/**
 * The times a device says something is due, for a Desk the server cannot read (DESIGN.md §25.2, task 14.6). **A slot is an instant to the minute and nothing else:** no card,
 * no list, no count (two cards due together are one row), so the table cannot be walked back to a card, and the notice the job writes for a claimed one says only that
 * cards are due. The browser works the instants out from the opened cards and the account's zone, for the next fourteen days, and sends the whole set again when it changes.
 */
export const SLOT_DAYS = 14;
/** The most instants one account may hold: a fortnight of a slot every half hour, with room over. */
export const MAX_SLOTS = 700;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** A slot this far past is too late to be worth a notice, as for any reminder (task 8.6). */
export const SLOT_LATE_MS = 30 * MINUTE;

const slots = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.reminderSlot : sqliteApp.reminderSlot;
const settings = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;

/** The body of `PUT /api/reminders/slots`: `{ "slots": [epoch ms, …] }`, closed, each to the minute and within the fortnight (a little behind is allowed, for a clock). */
export function parseSlots(value: unknown, now: number): Parsed<number[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { ok: false, reason: 'not an object' };
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'slots') return { ok: false, reason: 'only slots' };
  const list = (value as { slots: unknown }).slots;
  if (!Array.isArray(list) || list.length > MAX_SLOTS) return { ok: false, reason: 'bad slots' };
  const seen = new Set<number>();
  for (const each of list) {
    if (
      typeof each !== 'number' ||
      !Number.isSafeInteger(each) ||
      each % MINUTE !== 0 ||
      each < now - SLOT_LATE_MS ||
      each > now + (SLOT_DAYS + 1) * DAY
    )
      return { ok: false, reason: 'bad slot' };
    seen.add(each);
  }
  return { ok: true, value: [...seen].sort((a, b) => a - b) };
}

export type Replaced = 'replaced' | 'not_personal';

/**
 * Makes the account's coming slots these. **Only for a Desk with a key of its own**: for any other the server counts the cards itself, and a slot would be a second way to
 * the same reminder. A slot already claimed is kept as it is (so replacing the set does not arm it again); a slot not claimed and not in the new set is dropped.
 */
export async function replaceSlots(
  database: Database,
  accountId: string,
  list: readonly number[],
): Promise<Replaced> {
  if ((await readEncryption(database, accountId)).mode !== 'personal') return 'not_personal';
  await transaction(database, async (tx) => {
    await dbRun(
      tx,
      sql`DELETE FROM ${slots(tx)} WHERE account_id = ${accountId} AND claimed_at IS NULL`,
    );
    for (const at of list)
      await dbRun(
        tx,
        sql`INSERT INTO ${slots(tx)} (account_id, at, claimed_at) VALUES (${accountId}, ${at}, NULL) ON CONFLICT (account_id, at) DO NOTHING`,
      );
  });
  return 'replaced';
}

/** Everything of the account's: a person's deletion (`People.deletePerson`) and a Desk that is no longer sealed. */
export async function forgetSlots(database: Database, accountId: string): Promise<number> {
  const gone = await dbAll<{ at: number }>(
    database,
    sql`DELETE FROM ${slots(database)} WHERE account_id = ${accountId} RETURNING at`,
  );
  return gone.length;
}

export interface DueSlot {
  readonly accountId: string;
  readonly at: number;
}

/**
 * The slots to claim now: not yet claimed, at or before `now` and not more than `SLOT_LATE_MS` behind it, of an account that has reminders on and a Desk with a key of its own.
 * `room` of them at most, oldest first.
 */
export async function dueSlots(database: Database, now: number, room: number): Promise<DueSlot[]> {
  if (room <= 0) return [];
  const rows = await dbAll<{ accountId: string; at: number | string }>(
    database,
    sql`SELECT s.account_id AS "accountId", s.at AS at FROM ${slots(database)} s JOIN ${settings(database)} a ON a.account_id = s.account_id
        WHERE s.claimed_at IS NULL AND s.at <= ${now} AND s.at >= ${now - SLOT_LATE_MS}
          AND a.reminders_on = ${database.dialect === 'postgres' ? true : 1} AND a.encryption = 'personal'
        ORDER BY s.at, s.account_id LIMIT ${room}`,
  );
  return rows.map((row) => ({ accountId: row.accountId, at: Number(row.at) }));
}

/** Claims one slot: true for the one process that gets it. **The database decides who sends**, as for every reminder. */
export async function claimSlot(
  tx: Database,
  accountId: string,
  at: number,
  now: number,
): Promise<boolean> {
  const claimed = await dbAll<{ at: number }>(
    tx,
    sql`UPDATE ${slots(tx)} SET claimed_at = ${now} WHERE account_id = ${accountId} AND at = ${at} AND claimed_at IS NULL RETURNING at`,
  );
  return claimed.length > 0;
}

/**
 * Removes what will not be claimed any more: a slot more than a day behind, claimed or not. A day, so that a stale device cannot arm it again (it is refused as too late) and the
 * claim that kept it from being armed twice outlasts the lateness it is held to.
 */
export async function pruneSlots(database: Database, now: number): Promise<void> {
  await dbRun(database, sql`DELETE FROM ${slots(database)} WHERE at < ${now - DAY}`);
}
