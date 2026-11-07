import { sql } from 'drizzle-orm';
import { type Database, openDatabase } from '../db/client';
import { dbAll } from '../db/exec';
import { runMigrations } from '../db/migrate';
import { freshDatabase, testTarget } from '../db/test-support';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { type Change, type Mutation, type SyncTable } from './format';
import { tableOf } from './tables';

/**
 * What the tests of the server's side of sync share: a migrated app store, accounts to be, and the shapes of the mutations a device sends.
 */
export async function makeStore(): Promise<{ database: Database; close(): Promise<void> }> {
  const { database } = await freshDatabase('app');
  await runMigrations(database);
  return { database, close: () => database.close() };
}

/**
 * The app's store beside an auth store that is already there, migrated, and **not reset**. A test that needs sessions and the app's tables calls `twoAccounts()`
 * first, which starts both stores from empty, and then this: `makeStore()` resets both, so after the sessions it would take them away on sqld and PostgreSQL, where
 * the stores are shared (a `file:` database has a file each, which is why that leg alone would not show it).
 */
export async function openStoreBesideAuth(): Promise<{
  database: Database;
  close(): Promise<void>;
}> {
  const database = await openDatabase(testTarget().config, 'app');
  await runMigrations(database);
  return { database, close: () => database.close() };
}

/** An account id. A real one is better-auth's user id; to the sync tables it is only text, so these need no sign-in. */
export const account = (): string => crypto.randomUUID();

export const id = (): string => crypto.randomUUID();

/** A mutation of the changes, with an id of its own. */
export const mutation = (...changes: Change[]): Mutation => ({ mutationId: id(), changes });

export const list = (
  extra: Partial<Change> & { title?: string } = {},
): Change & { table: 'desk_list' } => {
  const { title = 'Home', ...rest } = extra as { title?: string } & Record<string, unknown>;
  return {
    table: 'desk_list',
    id: id(),
    position: 'a0',
    fields: { title: { v: title } },
    ...rest,
  } as Change & { table: 'desk_list' };
};

export const card = (
  listId: string,
  extra: Record<string, unknown> = {},
): Change & { table: 'desk_card' } =>
  ({
    table: 'desk_card',
    id: id(),
    listId,
    position: 'a0',
    fields: { title: { v: 'Buy milk' } },
    ...extra,
  }) as Change & { table: 'desk_card' };

/** An item of a card's checklist. */
export const check = (
  cardId: string,
  extra: Record<string, unknown> = {},
): Change & { table: 'desk_check' } =>
  ({
    table: 'desk_check',
    id: id(),
    cardId,
    position: 'a0',
    fields: { title: { v: 'Oat milk' } },
    ...extra,
  }) as Change & { table: 'desk_check' };

export const series = (
  listId: string,
  extra: Record<string, unknown> = {},
): Change & { table: 'desk_series' } =>
  ({
    table: 'desk_series',
    id: id(),
    listId,
    fields: { rule: { v: 'FREQ=DAILY' }, anchor: { v: '2026-11-05' } },
    ...extra,
  }) as Change & { table: 'desk_series' };

/** Everything an account has on the four tables, as the database holds it, in a fixed order: to compare before and after. */
export async function snapshot(
  database: Database,
  owner: string,
): Promise<Record<SyncTable, unknown[]>> {
  const read = (table: SyncTable) =>
    dbAll<Record<string, unknown>>(
      database,
      sql`SELECT * FROM ${tableOf(database, table)} WHERE owner_id = ${owner} ORDER BY id`,
    );
  return {
    desk_list: await read('desk_list'),
    desk_card: await read('desk_card'),
    desk_check: await read('desk_check'),
    desk_series: await read('desk_series'),
  };
}

const tables = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export async function accountSeq(database: Database, owner: string): Promise<number | undefined> {
  const rows = await dbAll<{ seq: number | string }>(
    database,
    sql`SELECT seq FROM ${tables(database).accountSettings} WHERE account_id = ${owner}`,
  );
  return rows[0] ? Number(rows[0].seq) : undefined;
}

export async function rowOf(
  database: Database,
  table: SyncTable,
  rowId: string,
): Promise<Record<string, unknown> | undefined> {
  const rows = await dbAll<Record<string, unknown>>(
    database,
    sql`SELECT * FROM ${tableOf(database, table)} WHERE id = ${rowId}`,
  );
  return rows[0];
}
