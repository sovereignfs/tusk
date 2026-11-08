import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import { openText } from './content';
import { tablesOf } from './tables';

/**
 * What the daily brief and the reminders (`src/notifications/job.ts`, DESIGN.md §25.2) read of a board's cards: **the work and nobody's words but a title**, in this
 * module because everything that reads a workspace's tables does. A card's reminder is claimed once, by a conditional update on `reminded_for`.
 */
const settings = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;
const flag = (database: Database, value: boolean) =>
  database.dialect === 'postgres' ? value : value ? 1 : 0;

/** How many open cards assigned to the account are due on `date` and before it. */
export async function assignedDueCounts(
  tx: Database,
  accountId: string,
  date: string,
): Promise<{ today: number; overdue: number }> {
  const t = tablesOf(tx);
  const row = await dbGet<{ today: number | string | null; overdue: number | string | null }>(
    tx,
    sql`SELECT SUM(CASE WHEN c.due_date = ${date} THEN 1 ELSE 0 END) AS today, SUM(CASE WHEN c.due_date < ${date} THEN 1 ELSE 0 END) AS overdue
        FROM ${t.cardAssignee} a JOIN ${t.card} c ON c.id = a.card_id
        WHERE a.account_id = ${accountId} AND c.archived_at IS NULL AND c.due_date IS NOT NULL AND c.due_date <= ${date}`,
  );
  return { today: Number(row?.today ?? 0), overdue: Number(row?.overdue ?? 0) };
}

export interface DueCard {
  readonly id: string;
  readonly boardId: string;
  readonly workspaceId: string;
  readonly title: string;
}

/** Cards of open boards due now (today, at or before `time` and not before `since`), not yet reminded for the time they are due, that someone in `zone` with reminders on is assigned to. */
export async function dueBoardCards(
  database: Database,
  zone: string,
  local: { date: string; time: string },
  since: string,
  limit: number,
): Promise<DueCard[]> {
  const t = tablesOf(database);
  const rows = await dbAll<{ id: string; boardId: string; workspaceId: string; title: string }>(
    database,
    sql`SELECT c.id AS id, c.board_id AS "boardId", b.workspace_id AS "workspaceId", c.title AS title
        FROM ${t.card} c JOIN ${t.board} b ON b.id = c.board_id
        WHERE c.archived_at IS NULL AND b.archived_at IS NULL
          AND c.due_date = ${local.date} AND c.due_time IS NOT NULL AND c.due_time <= ${local.time} AND c.due_time >= ${since}
          AND (c.reminded_for IS NULL OR c.reminded_for <> c.due_date || ' ' || c.due_time)
          AND EXISTS (SELECT 1 FROM ${t.cardAssignee} a JOIN ${settings(database)} s ON s.account_id = a.account_id
                      WHERE a.card_id = c.id AND s.reminders_on = ${flag(database, true)} AND s.time_zone = ${zone})
        ORDER BY c.due_time, c.id LIMIT ${limit}`,
  );
  return rows.map((row) => ({ ...row, title: openText('card', row.id, 'title', row.title) }));
}

/** Claims the card's reminder for the time it is due: true only for the one that does. */
export async function claimBoardReminder(
  tx: Database,
  cardId: string,
  local: { date: string; time: string },
): Promise<boolean> {
  const t = tablesOf(tx);
  const claimed = await dbAll<{ id: string }>(
    tx,
    sql`UPDATE ${t.card} SET reminded_for = due_date || ' ' || due_time
        WHERE id = ${cardId} AND due_date = ${local.date} AND due_time IS NOT NULL AND due_time <= ${local.time}
          AND archived_at IS NULL AND (reminded_for IS NULL OR reminded_for <> due_date || ' ' || due_time)
        RETURNING id`,
  );
  return claimed.length > 0;
}

/** The people assigned to the card who have reminders on and are in `zone`. */
export async function peopleToRemind(
  tx: Database,
  cardId: string,
  zone: string,
): Promise<string[]> {
  const t = tablesOf(tx);
  const rows = await dbAll<{ accountId: string }>(
    tx,
    sql`SELECT a.account_id AS "accountId" FROM ${t.cardAssignee} a JOIN ${settings(tx)} s ON s.account_id = a.account_id
        WHERE a.card_id = ${cardId} AND s.reminders_on = ${flag(tx, true)} AND s.time_zone = ${zone}`,
  );
  return rows.map((row) => row.accountId);
}
