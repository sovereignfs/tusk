import { sql } from 'drizzle-orm';
import { deleteCredentialsOf } from '../crypto/store';
import type { Database as AuthStore } from '@sovereignfs/auth/database';
import type { Database } from '../db/client';
import { dbAll, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { TABLES } from '../sync/format';
import { tableOf } from '../sync/tables';
import { leaveAllWorkspaces } from '../workspaces/person';

/**
 * **Everything of an account is deleted by this, and only this** (DESIGN.md §22). One routine, in a fixed order, **safe to run again**: the two stores (the
 * app's and the sign-in store) cannot share a transaction, so a run that stopped part way is finished by running it again, and the row that makes the
 * account findable (the account itself, and later the link to a Sovereign identity) goes **last**, so that a run that stopped can still find it.
 *
 *  1. The shared work is left to the people still using it (`leaveAllWorkspaces`): what they alone own passes to the member who has been in it longest, who is
 *     told, or is deleted if nobody else is in it; they are taken out of the rest and unassigned. Their comments, cards and activity stay, as "Deleted account".
 *  2. The Desk: every list, card, item and series, deleted ones included, and the tombstones and the record of applied mutations.
 *  3. What was kept for them: the backup connection and the token sealed for it, the rate counters, the account's settings. **The backup repository is left
 *     alone**, as a repository is its owner's.
 *  4. The sign-in store: sessions, sign-ins (password, and later passkeys, second factors and a Sovereign identity), pending verifications, and then the account.
 *
 * `people.test.ts` seeds a row in every table for the person and for a second person who shares work with them, finds nothing of the first after, and the
 * second's work intact, and fails for a table that is in neither list in it: **a new table that holds something of a person is deleted here**.
 */
export interface PeopleDeps {
  /** The app's store. */
  readonly database: Database;
  /** The sign-in store (the same database as the app's, or another). */
  readonly authDatabase: AuthStore;
  readonly now: () => number;
}

export interface Deleted {
  readonly workspacesPassed: number;
  readonly workspacesDeleted: number;
  readonly workspacesLeft: number;
}

const appSchema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export async function deletePerson(deps: PeopleDeps, accountId: string): Promise<Deleted> {
  const { database, authDatabase } = deps;
  const app = appSchema(database);

  // 1. Shared work.
  const shared = await leaveAllWorkspaces(database, accountId, deps.now());

  // 2 and 3. The Desk and what was kept for them, in one transaction of the app's store.
  await transaction(database, async (tx) => {
    for (const name of TABLES)
      await dbAll(
        tx,
        sql`DELETE FROM ${tableOf(tx, name)} WHERE owner_id = ${accountId} RETURNING id`,
      );
    await dbAll(tx, sql`DELETE FROM ${app.tombstone} WHERE account_id = ${accountId} RETURNING id`);
    await dbAll(
      tx,
      sql`DELETE FROM ${app.appliedMutation} WHERE account_id = ${accountId} RETURNING id`,
    );
    await dbAll(
      tx,
      sql`DELETE FROM ${app.backupConnection} WHERE account_id = ${accountId} RETURNING account_id`,
    );
    // The devices that were sent Web Push; the keys sealed for them go with the credentials below.
    await dbAll(
      tx,
      sql`DELETE FROM ${app.pushSubscription} WHERE account_id = ${accountId} RETURNING id`,
    );
    // The times a device said something was due, for a Desk the server cannot read (task 14.6).
    await dbAll(
      tx,
      sql`DELETE FROM ${app.reminderSlot} WHERE account_id = ${accountId} RETURNING at`,
    );
    // Counters are keyed `kind:account`.
    await dbAll(
      tx,
      sql`DELETE FROM ${app.rateBucket} WHERE "key" LIKE ${`%:${accountId}`} RETURNING "key"`,
    );
  });
  await deleteCredentialsOf(database, accountId);

  // The account's settings carry its counter; they go once what they counted has.
  await dbAll(
    database,
    sql`DELETE FROM ${app.accountSettings} WHERE account_id = ${accountId} RETURNING account_id`,
  );

  // 4. The sign-in store, `@sovereignfs/auth`'s tables. The address is read first, for the verifications that are named by it; the account goes
  // last. Each table is deleted by name rather than left to a cascade, which sqld does not promise to enforce.
  const user = (await authDatabase.run('SELECT email FROM users WHERE id = ?', [accountId]))
    .rows[0];
  for (const table of ['sv_key_secrets', 'sv_core_sign_ins'])
    await authDatabase.run(
      `DELETE FROM ${table} WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)`,
      [accountId],
    );
  await authDatabase.run('DELETE FROM sessions WHERE user_id = ?', [accountId]);
  // Sign-ins (a password, a Sovereign identity), second factors and passkeys, and a password still to move, before the account.
  for (const table of ['accounts', 'two_factors', 'passkeys', 'sv_legacy_passwords'])
    await authDatabase.run(`DELETE FROM ${table} WHERE user_id = ?`, [accountId]);
  if (user)
    await authDatabase.run('DELETE FROM verifications WHERE LOWER(identifier) = ?', [
      String(user.email).toLowerCase(),
    ]);
  await authDatabase.run('DELETE FROM users WHERE id = ?', [accountId]);

  return {
    workspacesPassed: shared.passed,
    workspacesDeleted: shared.deleted,
    workspacesLeft: shared.left,
  };
}
