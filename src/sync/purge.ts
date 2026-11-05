import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, dbRun, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import type { SyncTable } from './format';

/**
 * Keeping the history small (DESIGN.md §8.7, §11.5): **deleted rows are removed for good after seven days**, and leave a tombstone of their id and a
 * `seq`, so that a device that was offline when it happened learns of it from its next pull. Tombstones and the record of applied mutations go after
 * ninety days; a device that has been away longer than that has missed tombstones that are gone, and takes a fresh snapshot instead (`pruned_through`).
 *
 * What goes with a deleted row:
 *  - a deleted **list** takes its tasks, their subtasks and its series, since deleting a list marks only the list (task 3.3);
 *  - a deleted **task** takes its subtasks;
 *  - a deleted **series** goes alone: a recurring task's occurrences are ordinary tasks, which are deleted or not on their own.
 *
 * It is safe to run from any process at any time, and twice: each account's purge is one transaction that takes the account's counter first, as a
 * mutation does (`apply.ts`), so two runs take turns, and the second finds nothing left. A run does at most `BATCH` rows of an account, and the next
 * finishes it, so that one huge account cannot hold the job's turn for long.
 */
export const PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const KEEP_TOMBSTONES_MS = 90 * 24 * 60 * 60 * 1000;
const BATCH = 2000;

const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export interface PurgeResult {
  /** Rows removed, by table. */
  purged: Record<SyncTable, number>;
  accounts: number;
  tombstonesRemoved: number;
  mutationsForgotten: number;
}

export async function purge(database: Database, now: number): Promise<PurgeResult> {
  const result: PurgeResult = {
    purged: { list: 0, task: 0, series: 0 },
    accounts: 0,
    tombstonesRemoved: 0,
    mutationsForgotten: 0,
  };
  const cutoff = now - PURGE_AFTER_MS;
  const { list, task, series } = schema(database);

  // Whose rows are due: any account with a row deleted before the cutoff, in any of the three tables.
  const due = await dbAll<{ owner: string }>(
    database,
    sql`SELECT owner_id AS owner FROM ${list} WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
        UNION SELECT owner_id FROM ${task} WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
        UNION SELECT owner_id FROM ${series} WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`,
  );
  for (const { owner } of due) {
    const done = await purgeAccount(database, owner, cutoff, now);
    if (done.list + done.task + done.series > 0) result.accounts += 1;
    result.purged.list += done.list;
    result.purged.task += done.task;
    result.purged.series += done.series;
  }

  const old = now - KEEP_TOMBSTONES_MS;
  const pruned = await pruneTombstones(database, old);
  result.tombstonesRemoved = pruned;
  const forgotten = await dbAll<{ id: string }>(
    database,
    sql`DELETE FROM ${schema(database).appliedMutation} WHERE applied_at < ${old} RETURNING id`,
  );
  result.mutationsForgotten = forgotten.length;
  return result;
}

async function purgeAccount(
  database: Database,
  owner: string,
  cutoff: number,
  now: number,
): Promise<Record<SyncTable, number>> {
  return transaction(database, async (tx) => {
    const t = schema(tx);
    // The account's counter first, which holds its mutations off until this ends, as in `apply.ts`: so a row cannot be restored or edited while it is
    // being removed, and a second run waits for this one and finds nothing.
    const row = await dbGet<{ seq: number | string }>(
      tx,
      sql`INSERT INTO ${t.accountSettings} AS s (account_id, seq, created_at) VALUES (${owner}, 1, ${now})
          ON CONFLICT (account_id) DO UPDATE SET seq = s.seq + 1 RETURNING seq`,
    );
    const seq = Number(row?.seq);

    // What is due, decided now that the account is held, and not before: a row deleted and then restored since the look in `purge` is not due.
    const lists = await ids(
      tx,
      sql`SELECT id FROM ${t.list} WHERE owner_id = ${owner} AND deleted_at IS NOT NULL AND deleted_at < ${cutoff} LIMIT ${BATCH}`,
    );
    const parents = await ids(
      tx,
      sql`SELECT id FROM ${t.task} WHERE owner_id = ${owner} AND deleted_at IS NOT NULL AND deleted_at < ${cutoff} AND parent_id IS NULL LIMIT ${BATCH}`,
    );
    const tasks = new Set<string>(parents);
    // Every task of a list that goes, and of a parent that goes, and the subtasks that were deleted on their own long enough ago.
    for (const listId of lists) {
      for (const id of await ids(
        tx,
        sql`SELECT id FROM ${t.task} WHERE owner_id = ${owner} AND list_id = ${listId} LIMIT ${BATCH}`,
      ))
        tasks.add(id);
    }
    for (const parentId of parents) {
      for (const id of await ids(
        tx,
        sql`SELECT id FROM ${t.task} WHERE owner_id = ${owner} AND parent_id = ${parentId} LIMIT ${BATCH}`,
      ))
        tasks.add(id);
    }
    for (const id of await ids(
      tx,
      sql`SELECT id FROM ${t.task} WHERE owner_id = ${owner} AND deleted_at IS NOT NULL AND deleted_at < ${cutoff} AND parent_id IS NOT NULL LIMIT ${BATCH}`,
    ))
      tasks.add(id);
    const seriesIds = new Set<string>(
      await ids(
        tx,
        sql`SELECT id FROM ${t.series} WHERE owner_id = ${owner} AND deleted_at IS NOT NULL AND deleted_at < ${cutoff} LIMIT ${BATCH}`,
      ),
    );
    for (const listId of lists) {
      for (const id of await ids(
        tx,
        sql`SELECT id FROM ${t.series} WHERE owner_id = ${owner} AND list_id = ${listId} LIMIT ${BATCH}`,
      ))
        seriesIds.add(id);
    }

    const removed: Record<SyncTable, string[]> = {
      list: lists,
      task: [...tasks],
      series: [...seriesIds],
    };
    for (const table of ['task', 'series', 'list'] as const) {
      for (const id of removed[table]) {
        await dbRun(
          tx,
          sql`INSERT INTO ${t.tombstone} (table_name, id, account_id, seq, deleted_at) VALUES (${table}, ${id}, ${owner}, ${seq}, ${now}) ON CONFLICT (table_name, id) DO NOTHING`,
        );
        await dbRun(tx, sql`DELETE FROM ${t[table]} WHERE id = ${id} AND owner_id = ${owner}`);
      }
    }
    return { list: lists.length, task: tasks.size, series: seriesIds.size };
  });
}

async function ids(database: Database, query: ReturnType<typeof sql>): Promise<string[]> {
  return (await dbAll<{ id: string }>(database, query)).map((row) => row.id);
}

/**
 * Removes tombstones older than `before`, and remembers, per account, the highest `seq` of what was removed: a device whose cursor is below that
 * may have missed one of them. Returns how many.
 */
async function pruneTombstones(database: Database, before: number): Promise<number> {
  const t = schema(database);
  const floors = await dbAll<{ account: string; top: number | string }>(
    database,
    sql`SELECT account_id AS account, MAX(seq) AS top FROM ${t.tombstone} WHERE deleted_at < ${before} GROUP BY account_id`,
  );
  let removed = 0;
  for (const { account, top } of floors) {
    await transaction(database, async (tx) => {
      const s = schema(tx);
      const floor = Number(top);
      await dbRun(
        tx,
        sql`UPDATE ${s.accountSettings} SET pruned_through = CASE WHEN pruned_through < ${floor} THEN ${floor} ELSE pruned_through END WHERE account_id = ${account}`,
      );
      const gone = await dbAll<{ id: string }>(
        tx,
        sql`DELETE FROM ${s.tombstone} WHERE account_id = ${account} AND deleted_at < ${before} RETURNING id`,
      );
      removed += gone.length;
    });
  }
  return removed;
}
