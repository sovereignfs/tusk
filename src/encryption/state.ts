import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import { TABLES } from '../sync/format';
import { tableOf } from '../sync/tables';
import { STRUCTURAL_FIELDS, decodeFields } from '../sync/validate';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';

/**
 * Whether a person's Desk has a key of its own (DESIGN.md §9.1), as the server knows it: `none`, `moving` or `personal`, the age **public** key the list
 * keys are wrapped to, and whether the person has been offered and chose. **The secret is never here, and the server cannot check that a recipient is the
 * one for the key a person saved** (it has no way to): what it does is hold it, and keep a Desk from being offered a key twice. Setting one up is
 * **one way**: a Desk that has a key does not go back to plain (a person who wants that exports and starts again, §9.1).
 */
export type EncryptionMode = 'none' | 'moving' | 'personal';

export interface EncryptionState {
  readonly mode: EncryptionMode;
  readonly recipient: string | null;
  /** Whether the person has chosen (a key made, a key brought, or Skip), so that they are not asked again. */
  readonly offered: boolean;
}

const table = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;

const isMode = (value: unknown): value is EncryptionMode =>
  value === 'none' || value === 'moving' || value === 'personal';

/** An age X25519 recipient: `age1` and 58 characters of the bech32 alphabet. The checksum is not checked here, since the browser made it. */
export const RECIPIENT = /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/;

export async function readEncryption(
  database: Database,
  accountId: string,
): Promise<EncryptionState> {
  const row = await dbGet<{
    mode: string;
    recipient: string | null;
    offeredAt: number | string | null;
  }>(
    database,
    sql`SELECT encryption AS mode, recipient, key_offered_at AS "offeredAt" FROM ${table(database)} WHERE account_id = ${accountId}`,
  );
  return {
    mode: row && isMode(row.mode) ? row.mode : 'none',
    recipient: row?.recipient ?? null,
    offered: row?.offeredAt != null,
  };
}

/** Makes sure the account has a settings row to update; the rows are made on first use, as everything of an account is. */
async function ensureRow(database: Database, accountId: string, now: number): Promise<void> {
  await dbAll(
    database,
    sql`INSERT INTO ${table(database)} (account_id, created_at) VALUES (${accountId}, ${now})
        ON CONFLICT (account_id) DO NOTHING RETURNING account_id`,
  );
}

export type SetupResult =
  | { readonly ok: true; readonly state: EncryptionState }
  /** The recipient is not an age public key. */
  | { readonly ok: false; readonly reason: 'invalid' }
  /** This Desk already has a key (the same recipient again is let through, so that a request repeated is not an error). */
  | { readonly ok: false; readonly reason: 'already' };

/**
 * Records that the Desk is to be sealed to `recipient`, from `none` and only from `none`: a conditional update, so that two devices setting up at once end
 * with one key and the other is told. Asking again with the recipient that is already set is the same success.
 */
export async function setUpPersonalKey(
  database: Database,
  accountId: string,
  recipient: string,
  now: number,
): Promise<SetupResult> {
  if (!RECIPIENT.test(recipient)) return { ok: false, reason: 'invalid' };
  await ensureRow(database, accountId, now);
  const won = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${table(database)} SET encryption = 'personal', recipient = ${recipient}, key_offered_at = ${now}
        WHERE account_id = ${accountId} AND encryption = 'none' RETURNING account_id AS id`,
  );
  const state = await readEncryption(database, accountId);
  if (won.length > 0 || (state.mode === 'personal' && state.recipient === recipient))
    return { ok: true, state };
  return { ok: false, reason: 'already' };
}

/** Records that the person chose to keep the Desk plain, once. Their Desk stays plain, and Settings > Data can still turn a key on (§9.3). */
export async function skipKeyOffer(
  database: Database,
  accountId: string,
  now: number,
): Promise<EncryptionState> {
  await ensureRow(database, accountId, now);
  await dbAll(
    database,
    sql`UPDATE ${table(database)} SET key_offered_at = ${now}
        WHERE account_id = ${accountId} AND key_offered_at IS NULL RETURNING account_id`,
  );
  return readEncryption(database, accountId);
}

/** What the sync endpoint takes of an account in this mode (DESIGN.md §9.4): an account with a key of its own sends no plain content, and one being moved to it sends both. */
export const plainFor = (mode: EncryptionMode): 'check' | 'refuse' =>
  mode === 'personal' ? 'refuse' : 'check';

export type MoveResult =
  | { readonly ok: true; readonly state: EncryptionState }
  | { readonly ok: false; readonly reason: 'invalid' | 'already' };

/**
 * A Desk that has things in it starts to move to a key of its own (DESIGN.md §9.3): `none` to `moving`, by a conditional update, with the public key. From
 * then until it is finished the server takes plain content and ciphertext alike, so that a device that has not heard can still be heard; the browser that has
 * the key seals everything it finds in the clear. The same key again is the same success, so that a request repeated, or a device that came back, is no error.
 */
export async function beginMove(
  database: Database,
  accountId: string,
  recipient: string,
  now: number,
): Promise<MoveResult> {
  if (!RECIPIENT.test(recipient)) return { ok: false, reason: 'invalid' };
  await ensureRow(database, accountId, now);
  const won = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${table(database)} SET encryption = 'moving', recipient = ${recipient}, key_offered_at = ${now}
        WHERE account_id = ${accountId} AND encryption = 'none' RETURNING account_id AS id`,
  );
  const state = await readEncryption(database, accountId);
  if (won.length > 0 || (state.mode !== 'none' && state.recipient === recipient))
    return { ok: true, state };
  return { ok: false, reason: 'already' };
}

/** Whether a field is content (and so is sealed) rather than structure the server reads. */
const isContent = (name: string, tableName: (typeof TABLES)[number]) =>
  !(STRUCTURAL_FIELDS[tableName] ?? []).includes(name);

/**
 * How many rows of the account still have a field in the clear. **This is what lets a move finish:** the server cannot read the fields, but it can see which
 * are ciphertext, and a Desk with a plain one left is not yet the person's alone.
 */
export async function plainRemaining(database: Database, accountId: string): Promise<number> {
  let count = 0;
  for (const name of TABLES) {
    const rows = await dbAll<{ fields: string }>(
      database,
      sql`SELECT fields FROM ${tableOf(database, name)} WHERE owner_id = ${accountId} AND fields LIKE '%"v"%'`,
    );
    for (const row of rows) {
      const decoded = decodeFields(row.fields);
      if (
        decoded.ok &&
        Object.entries(decoded.value).some(
          ([field, value]) => 'v' in value && isContent(field, name),
        )
      )
        count += 1;
    }
  }
  return count;
}

export type FinishResult =
  | { readonly ok: true; readonly state: EncryptionState }
  | {
      readonly ok: false;
      readonly reason: 'not_moving' | 'plain_remains';
      readonly remaining?: number;
    };

/**
 * `moving` to `personal`, once nothing of the Desk is left in the clear, and not before (the conditional update holds only while it is still `moving`).
 * After it the server refuses plain content for the account (§9.4). Asked again when it is done, it is the same success.
 */
export async function finishMove(database: Database, accountId: string): Promise<FinishResult> {
  const before = await readEncryption(database, accountId);
  if (before.mode === 'personal') return { ok: true, state: before };
  if (before.mode !== 'moving') return { ok: false, reason: 'not_moving' };
  const remaining = await plainRemaining(database, accountId);
  if (remaining > 0) return { ok: false, reason: 'plain_remains', remaining };
  await dbAll(
    database,
    sql`UPDATE ${table(database)} SET encryption = 'personal'
        WHERE account_id = ${accountId} AND encryption = 'moving' RETURNING account_id`,
  );
  // A device that had not heard could write in the clear between the count and the switch. From the switch the server refuses that, so a second count is
  // final: if something got in, the move goes back to moving and the browser seals it.
  const late = await plainRemaining(database, accountId);
  if (late > 0) {
    await dbAll(
      database,
      sql`UPDATE ${table(database)} SET encryption = 'moving'
          WHERE account_id = ${accountId} AND encryption = 'personal' RETURNING account_id`,
    );
    return { ok: false, reason: 'plain_remains', remaining: late };
  }
  const state = await readEncryption(database, accountId);
  return state.mode === 'personal' ? { ok: true, state } : { ok: false, reason: 'not_moving' };
}
