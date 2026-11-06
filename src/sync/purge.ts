import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, dbRun, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { TABLES, type SyncTable } from './format';
import { tableOf } from './tables';

/**
 * Keeping the history small (DESIGN.md §8.7, §10.6): **deleted rows are removed for good after seven days**, and leave a tombstone of their id and a
 * `seq`, so that a device that was offline when it happened learns of it from its next pull. Tombstones and the record of applied mutations go after
 * ninety days; a device that has been away longer than that has missed tombstones that are gone, and takes a fresh snapshot instead (`pruned_through`).
 *
 * What goes with a deleted row:
 *  - a deleted **list** takes its cards, their checklist items and its series, since deleting a list marks only the list (task 3.3);
 *  - a deleted **card** takes its checklist items;
 *  - a deleted **series** goes alone: a repeating card's occurrences are ordinary cards, which are deleted or not on their own;
 *  - a **series nothing points at** goes too, once it is a week old (DESIGN.md §12.5): when the card that repeated has been made a one-off, or the
 *    cards that were its occurrences are gone, no card has its id, and it is of no use. A card keeps a series alive by its `seriesId`, deleted or not,
 *    so a card brought back by Undo still has its series, and the server never finds a card pointing at one that is gone.
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
    purged: { desk_list: 0, desk_card: 0, desk_check: 0, desk_series: 0 },
    accounts: 0,
    tombstonesRemoved: 0,
    mutationsForgotten: 0,
  };
  const cutoff = now - PURGE_AFTER_MS;

  // Whose rows are due: any account with a row deleted before the cutoff, in any of the four tables.
  const due = await dbAll<{ owner: string }>(
    database,
    sql.join(
      TABLES.map(
        (name) =>
          sql`SELECT owner_id AS owner FROM ${tableOf(database, name)} WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`,
      ),
      sql` UNION `,
    ),
  );
  // And any account with a series that nothing points at.
  const lonely = await dbAll<{ owner: string }>(
    database,
    sql`SELECT DISTINCT s.owner_id AS owner FROM ${tableOf(database, 'desk_series')} s
        WHERE s.created_at < ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM ${tableOf(database, 'desk_card')} c
            WHERE c.owner_id = s.owner_id AND c.fields LIKE '%' || s.id || '%'
          )`,
  );
  const owners = new Set([...due, ...lonely].map((row) => row.owner));
  for (const owner of owners) {
    const done = await purgeAccount(database, owner, cutoff, now);
    if (TABLES.some((name) => done[name] > 0)) result.accounts += 1;
    for (const name of TABLES) result.purged[name] += done[name];
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
    const due = (name: SyncTable) =>
      ids(
        tx,
        sql`SELECT id FROM ${tableOf(tx, name)} WHERE owner_id = ${owner} AND deleted_at IS NOT NULL AND deleted_at < ${cutoff} LIMIT ${BATCH}`,
      );
    const lists = await due('desk_list');
    const cards = new Set<string>(await due('desk_card'));
    // Every card of a list that goes.
    for (const listId of lists) {
      for (const id of await ids(
        tx,
        sql`SELECT id FROM ${tableOf(tx, 'desk_card')} WHERE owner_id = ${owner} AND list_id = ${listId} LIMIT ${BATCH}`,
      ))
        cards.add(id);
    }
    // Every item of a card that goes, and the items that were deleted on their own long enough ago.
    const checks = new Set<string>(await due('desk_check'));
    for (const cardId of cards) {
      for (const id of await ids(
        tx,
        sql`SELECT id FROM ${tableOf(tx, 'desk_check')} WHERE owner_id = ${owner} AND card_id = ${cardId} LIMIT ${BATCH}`,
      ))
        checks.add(id);
    }
    const seriesIds = new Set<string>(await due('desk_series'));
    for (const listId of lists) {
      for (const id of await ids(
        tx,
        sql`SELECT id FROM ${tableOf(tx, 'desk_series')} WHERE owner_id = ${owner} AND list_id = ${listId} LIMIT ${BATCH}`,
      ))
        seriesIds.add(id);
    }

    const removed: Record<SyncTable, string[]> = {
      desk_list: lists,
      desk_card: [...cards],
      desk_check: [...checks],
      desk_series: [...seriesIds],
    };
    // Children first, so that a run that stopped never leaves an item whose card is gone.
    for (const table of ['desk_check', 'desk_card', 'desk_series', 'desk_list'] as const) {
      // Once the cards that go are gone, a series nothing names goes too.
      if (table === 'desk_series') {
        for (const id of await orphans(tx, owner, cutoff)) seriesIds.add(id);
        removed.desk_series = [...seriesIds];
      }
      for (const id of removed[table]) {
        await dbRun(
          tx,
          sql`INSERT INTO ${t.tombstone} (table_name, id, account_id, seq, deleted_at) VALUES (${table}, ${id}, ${owner}, ${seq}, ${now}) ON CONFLICT (table_name, id) DO NOTHING`,
        );
        await dbRun(
          tx,
          sql`DELETE FROM ${tableOf(tx, table)} WHERE id = ${id} AND owner_id = ${owner}`,
        );
      }
    }
    return {
      desk_list: lists.length,
      desk_card: cards.size,
      desk_check: checks.size,
      desk_series: seriesIds.size,
    };
  });
}

/**
 * The series of an account that no card names, and that are old enough not to be one being made. A card names its series in its `seriesId` field, which
 * is text in a column, so the card is looked for by the series' id appearing in its fields: an id is 36 characters of a kind that nothing else a person
 * writes is likely to hold, and a card that has it by chance only keeps a useless series a while longer.
 */
const orphans = (database: Database, owner: string, cutoff: number) =>
  ids(
    database,
    sql`SELECT s.id AS id FROM ${tableOf(database, 'desk_series')} s
        WHERE s.owner_id = ${owner} AND s.created_at < ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM ${tableOf(database, 'desk_card')} c
            WHERE c.owner_id = s.owner_id AND c.fields LIKE '%' || s.id || '%'
          )
        LIMIT ${BATCH}`,
  );

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
