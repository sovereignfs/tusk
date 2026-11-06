import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
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
