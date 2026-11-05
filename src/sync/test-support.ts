import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { runMigrations } from '../db/migrate';
import { freshDatabase } from '../db/test-support';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { type Change, type Mutation, type SyncTable } from './format';

/**
 * What the tests of the server's side of sync share: a migrated app store, accounts to be, and the shapes of the mutations a device sends.
 */
export async function makeStore(): Promise<{ database: Database; close(): Promise<void> }> {
  const { database } = await freshDatabase('app');
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
): Change & { table: 'list' } => {
  const { title = 'Home', ...rest } = extra as { title?: string } & Record<string, unknown>;
  return {
    table: 'list',
    id: id(),
    position: 'a0',
    fields: { title: { v: title } },
    ...rest,
  } as Change & { table: 'list' };
};

export const task = (
  listId: string,
  extra: Record<string, unknown> = {},
): Change & { table: 'task' } =>
  ({
    table: 'task',
    id: id(),
    listId,
    position: 'a0',
    fields: { title: { v: 'Buy milk' } },
    ...extra,
  }) as Change & { table: 'task' };

export const series = (
  listId: string,
  extra: Record<string, unknown> = {},
): Change & { table: 'series' } =>
  ({
    table: 'series',
    id: id(),
    listId,
    fields: { rule: { v: 'FREQ=DAILY' }, anchor: { v: '2026-11-05' } },
    ...extra,
  }) as Change & { table: 'series' };

const tables = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

/** Everything an account has on the three tables, as the database holds it, in a fixed order: to compare before and after. */
export async function snapshot(
  database: Database,
  owner: string,
): Promise<Record<SyncTable, unknown[]>> {
  const t = tables(database);
  const read = (table: unknown) =>
    dbAll<Record<string, unknown>>(
      database,
      sql`SELECT * FROM ${table as never} WHERE owner_id = ${owner} ORDER BY id`,
    );
  return { list: await read(t.list), task: await read(t.task), series: await read(t.series) };
}

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
    sql`SELECT * FROM ${tables(database)[table]} WHERE id = ${rowId}`,
  );
  return rows[0];
}
