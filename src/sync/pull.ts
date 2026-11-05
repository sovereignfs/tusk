import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import {
  LIMITS,
  type Pull,
  type PulledRow,
  type PulledTombstone,
  type SyncTable,
  TABLES,
} from './format';
import { tableOf } from './tables';
import { decodeFields } from './validate';

/**
 * What changed for an account since a cursor (DESIGN.md §8.3): the rows and the tombstones whose `seq` is past it, in pages.
 *
 * **A cursor must never skip a row.** Rows of one mutation share a `seq`, and a mutation commits after it takes its `seq`, so two things could go
 * wrong, and both are closed here:
 *
 *  1. A page that ends in the middle of a `seq` would leave the rest of its rows behind the cursor. So a page ends **at** a `seq`: the pages are cut
 *     by asking for the `seq` of the row that would be the limit-th and taking everything up to and including it. A page may carry a few more than
 *     the limit, by as much as the last mutation had rows, and never fewer for that reason.
 *  2. Tables read one after the other could see a later commit in one and miss an earlier one in another. So the upper bound is **one number, found
 *     first**, and every table is read up to it. It names a row that is committed, and an account's mutations commit in `seq` order (applying one holds
 *     the account's counter until it ends, `apply.ts`), so everything at or below it is committed too.
 *
 * Every statement names the account, so another account's rows are not in the result however the cursor is chosen.
 */
export interface PullOptions {
  /** About how many rows the page carries. */
  limit?: number;
}

const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export async function pull(
  database: Database,
  accountId: string,
  cursor: number,
  options: PullOptions = {},
): Promise<Pull> {
  const limit = Math.min(Math.max(1, options.limit ?? LIMITS.pullDefault), LIMITS.pullMax);
  const { tombstone } = schema(database);

  // The `seq`s of everything pending, from all five tables, as one list.
  const pending = sql.join(
    [
      ...TABLES.map(
        (name) =>
          sql`SELECT seq FROM ${tableOf(database, name)} WHERE owner_id = ${accountId} AND seq > ${cursor}`,
      ),
      sql`SELECT seq FROM ${tombstone} WHERE account_id = ${accountId} AND seq > ${cursor}`,
    ],
    sql` UNION ALL `,
  );

  // The `seq` of the limit-th pending row, if there are that many: where this page ends, and there may be more.
  const edge = await dbGet<{ seq: number | string }>(
    database,
    sql`SELECT seq FROM (${pending}) AS pending ORDER BY seq LIMIT 1 OFFSET ${limit - 1}`,
  );
  let end: number;
  let more: boolean;
  if (edge) {
    end = Number(edge.seq);
    // The page ends at a `seq`, so the limit-th row may have been the last of its mutation: more only if something is past it.
    more =
      (await dbGet(
        database,
        sql`SELECT 1 AS one FROM (${pending}) AS pending WHERE seq > ${end} LIMIT 1`,
      )) !== undefined;
  } else {
    // Fewer than a page is pending: it all fits, up to the newest.
    const newest = await dbGet<{ seq: number | string | null }>(
      database,
      sql`SELECT MAX(seq) AS seq FROM (${pending}) AS pending`,
    );
    if (newest?.seq === null || newest?.seq === undefined) {
      return { cursor, more: false, rows: [], tombstones: [] };
    }
    end = Number(newest.seq);
    more = false;
  }

  const rows: PulledRow[] = [];
  for (const name of TABLES) {
    rows.push(...(await rowsOf(database, accountId, name, cursor, end)));
  }
  rows.sort(
    (a, b) =>
      a.seq - b.seq || (a.table < b.table ? -1 : a.table > b.table ? 1 : a.id < b.id ? -1 : 1),
  );

  const tombstones = (
    await dbAll<{ table: SyncTable; id: string; seq: number | string }>(
      database,
      sql`SELECT table_name AS "table", id, seq FROM ${tombstone}
          WHERE account_id = ${accountId} AND seq > ${cursor} AND seq <= ${end} ORDER BY seq, id`,
    )
  ).map((row): PulledTombstone => ({ table: row.table, id: row.id, seq: Number(row.seq) }));

  return { cursor: end, more, rows, tombstones };
}

interface RawRow {
  id: string;
  position?: string;
  listId?: string;
  cardId?: string;
  deletedAt: number | string | null;
  seq: number | string;
  createdAt: number | string;
  fields: string;
}

async function rowsOf(
  database: Database,
  accountId: string,
  name: SyncTable,
  cursor: number,
  end: number,
): Promise<PulledRow[]> {
  const target = tableOf(database, name);
  const columns =
    name === 'desk_list'
      ? sql`position`
      : name === 'desk_card'
        ? sql`list_id AS "listId", position`
        : name === 'desk_check'
          ? sql`card_id AS "cardId", position`
          : sql`list_id AS "listId"`;
  const raw = await dbAll<RawRow>(
    database,
    sql`SELECT id, ${columns}, deleted_at AS "deletedAt", seq, created_at AS "createdAt", fields
        FROM ${target} WHERE owner_id = ${accountId} AND seq > ${cursor} AND seq <= ${end} ORDER BY seq, id`,
  );
  return raw.map((row) => {
    const decoded = decodeFields(row.fields);
    // A row the server wrote is trusted, but not so far that a bad one stops a person's whole pull.
    const fields = decoded.ok ? decoded.value : {};
    const base = {
      id: row.id,
      deletedAt: row.deletedAt === null ? null : Number(row.deletedAt),
      seq: Number(row.seq),
      createdAt: Number(row.createdAt),
      fields,
    };
    if (name === 'desk_list')
      return { table: 'desk_list', ...base, position: row.position as string };
    if (name === 'desk_series')
      return { table: 'desk_series', ...base, listId: row.listId as string };
    if (name === 'desk_check') {
      return {
        table: 'desk_check',
        ...base,
        cardId: row.cardId as string,
        position: row.position as string,
      };
    }
    return {
      table: 'desk_card',
      ...base,
      listId: row.listId as string,
      position: row.position as string,
    };
  });
}
