import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import { fingerprintOfSealed, open, rewrap, seal } from './envelope';
import type { KeyRing } from './keys';
import { credentialTable } from './tables';

/**
 * The credentials a person gave Tusk, kept sealed (DESIGN.md §21.2). **This is the only place that reads or writes `credential.sealed`**, and it only ever
 * sees a secret on its way in (`put`) and on its way to the one call that uses it (`read`). Each is bound to its row and purpose by `src/crypto/envelope.ts`,
 * and **a read names the account**, in the statement, so that another account's credential is not found. A secret is in no message, log or error here.
 */
export interface Credential {
  readonly id: string;
  readonly accountId: string;
  /** What it is for, e.g. `github-token`: part of what it is sealed to. */
  readonly purpose: string;
}

/** Stores or replaces a credential. Without a key there is nothing to seal with, and the caller has not offered to keep one. */
export async function putCredential(
  database: Database,
  ring: KeyRing,
  credential: Credential,
  secret: string,
  now: number,
): Promise<void> {
  const t = credentialTable(database);
  const sealed = seal(secret, { id: credential.id, purpose: credential.purpose }, ring.current);
  const written = await dbAll<{ id: string }>(
    database,
    sql`INSERT INTO ${t} AS c (id, account_id, purpose, sealed, key_fingerprint, created_at, updated_at)
        VALUES (${credential.id}, ${credential.accountId}, ${credential.purpose}, ${sealed}, ${ring.current.fingerprint}, ${now}, ${now})
        ON CONFLICT (id) DO UPDATE SET sealed = ${sealed}, key_fingerprint = ${ring.current.fingerprint}, updated_at = ${now}
        WHERE c.account_id = ${credential.accountId} AND c.purpose = ${credential.purpose}
        RETURNING id`,
  );
  // The id is another account's, or another purpose's: nothing was written, and nothing says whose it is.
  if (written.length === 0)
    throw new Error('a credential with that id is not this account’s to replace');
}

/** A credential, opened, for the account and purpose it belongs to; `undefined` when there is none for them. */
export async function readCredential(
  database: Database,
  ring: KeyRing,
  credential: Credential,
): Promise<string | undefined> {
  const row = await dbGet<{ sealed: string }>(
    database,
    sql`SELECT sealed FROM ${credentialTable(database)}
        WHERE id = ${credential.id} AND account_id = ${credential.accountId} AND purpose = ${credential.purpose}`,
  );
  return row
    ? open(row.sealed, { id: credential.id, purpose: credential.purpose }, ring)
    : undefined;
}

export async function deleteCredential(database: Database, credential: Credential): Promise<void> {
  await dbAll(
    database,
    sql`DELETE FROM ${credentialTable(database)} WHERE id = ${credential.id} AND account_id = ${credential.accountId} RETURNING id`,
  );
}

/** Everything of an account's, for when the account goes (task 2.8). Safe to run twice. */
export async function deleteCredentialsOf(database: Database, accountId: string): Promise<number> {
  const gone = await dbAll<{ id: string }>(
    database,
    sql`DELETE FROM ${credentialTable(database)} WHERE account_id = ${accountId} RETURNING id`,
  );
  return gone.length;
}

/** Which keys the credentials that are kept stand under: the fingerprints, with how many rows each. */
export async function keysInUse(database: Database): Promise<Map<string, number>> {
  const rows = await dbAll<{ fingerprint: string; n: number | string }>(
    database,
    sql`SELECT key_fingerprint AS fingerprint, COUNT(*) AS n FROM ${credentialTable(database)} GROUP BY key_fingerprint`,
  );
  return new Map(rows.map((row) => [row.fingerprint, Number(row.n)]));
}

/** Said when credentials are kept under a key this server was not given. It names fingerprints, which are safe to say, and never a key. */
export class MissingKeys extends Error {
  constructor(readonly fingerprints: readonly string[]) {
    super(
      `credentials are sealed under keys that this server does not have: ${fingerprints.join(', ')}. ` +
        'Give the server TUSK_ENCRYPTION_KEY (and TUSK_ENCRYPTION_KEY_PREVIOUS while a key is being replaced), or disconnect what was connected with them.',
    );
    this.name = 'MissingKeys';
  }
}

/** Stops the start-up when what is kept cannot be opened: a key that was dropped would otherwise be found when a backup fails. */
export async function assertKeys(database: Database, ring: KeyRing | undefined): Promise<void> {
  const known = new Set([ring?.current.fingerprint, ring?.previous?.fingerprint]);
  const missing = [...(await keysInUse(database)).keys()].filter(
    (fingerprint) => !known.has(fingerprint),
  );
  if (missing.length > 0) throw new MissingKeys(missing.sort());
}

/** The most rows moved in one pass. */
const BATCH = 100;

/**
 * **Rotation, at start-up** (DESIGN.md §21.2): credentials wrapped under `previous` are wrapped again under `current`, and the payload is not touched. It may
 * run from every replica at once and twice over: each row is moved by a conditional update that holds only while the row is as it was read, so that exactly
 * one of them moves it and the others find it moved. Returns how many this run moved, and the fingerprints, for the one line it logs.
 */
export async function rotateCredentials(
  database: Database,
  ring: KeyRing,
  log: (line: string) => void = (line) => console.info(line),
): Promise<{ moved: number; from: string | undefined; to: string }> {
  const previous = ring.previous;
  const result = { moved: 0, from: previous?.fingerprint, to: ring.current.fingerprint };
  if (!previous) return result;
  const t = credentialTable(database);
  for (;;) {
    const rows = await dbAll<{ id: string; purpose: string; sealed: string }>(
      database,
      sql`SELECT id, purpose, sealed FROM ${t} WHERE key_fingerprint = ${previous.fingerprint} ORDER BY id LIMIT ${BATCH}`,
    );
    if (rows.length === 0) break;
    let movedThisPass = 0;
    for (const row of rows) {
      // A row whose wrapping does not name the previous key is not this run's to touch, whatever its column says.
      if (fingerprintOfSealed(row.sealed) !== previous.fingerprint) continue;
      const moved = rewrap(
        row.sealed,
        { id: row.id, purpose: row.purpose },
        previous,
        ring.current,
      );
      const done = await dbAll<{ id: string }>(
        database,
        sql`UPDATE ${t} SET sealed = ${moved}, key_fingerprint = ${ring.current.fingerprint}, updated_at = ${Date.now()}
            WHERE id = ${row.id} AND sealed = ${row.sealed} RETURNING id`,
      );
      movedThisPass += done.length;
    }
    result.moved += movedThisPass;
    // Another replica moved the rest while this one looked: nothing is left that this run can move.
    if (movedThisPass === 0) break;
  }
  if (result.moved > 0)
    log(
      `[tusk] credentials: ${result.moved} moved from key ${previous.fingerprint} to key ${ring.current.fingerprint}`,
    );
  return result;
}
