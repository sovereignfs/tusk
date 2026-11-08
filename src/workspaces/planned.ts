import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import type { PlannedBoardCard } from '../planner/format';
import { boardsVisibleTo } from './can';
import { openText } from './content';
import { tablesOf } from './tables';

/** The most cards one read returns: a range of nine weeks is never more than a person is assigned in a day. */
export const PLANNED_LIMIT = 1000;

/**
 * The Planner's part from the boards (DESIGN.md §25.1, task 19.1): the open cards **assigned to this account**, on boards they can still see, whose due date is in
 * `[from, to]`. The account is named in the statement and so is its membership (`boardsVisibleTo`): a card of a board the person has left, or that was made private
 * to them or archived, is not here. Nothing is written. Dates are the card's own, floating (§11), so they are compared as text. Titles and names are content,
 * opened through `content.ts`.
 */
export async function plannedBoardCards(
  database: Database,
  accountId: string,
  from: string,
  to: string,
): Promise<PlannedBoardCard[]> {
  const t = tablesOf(database);
  const rows = await dbAll<{
    cardId: string;
    boardId: string;
    boardName: string;
    boardColor: string;
    listId: string;
    listName: string;
    title: string;
    dueDate: string;
    dueTime: string | null;
    dueEnd: string | null;
  }>(
    database,
    sql`SELECT c.id AS "cardId", c.board_id AS "boardId", b.name AS "boardName", b.color AS "boardColor",
               c.list_id AS "listId", l.name AS "listName", c.title AS title, c.due_date AS "dueDate", c.due_time AS "dueTime", c.due_end AS "dueEnd"
        FROM ${t.cardAssignee} ca
        JOIN ${t.card} c ON c.id = ca.card_id
        JOIN ${t.board} b ON b.id = c.board_id
        JOIN ${t.boardList} l ON l.id = c.list_id
        WHERE ca.account_id = ${accountId} AND c.archived_at IS NULL AND b.archived_at IS NULL
          AND c.due_date >= ${from} AND c.due_date <= ${to}
          AND c.board_id IN ${boardsVisibleTo(database, accountId)}
        ORDER BY c.due_date, CASE WHEN c.due_time IS NULL THEN 0 ELSE 1 END, c.due_time, c.position, c.id
        LIMIT ${PLANNED_LIMIT}`,
  );
  return rows.map((row) => ({
    cardId: row.cardId,
    boardId: row.boardId,
    boardName: openText('board', row.boardId, 'name', row.boardName),
    boardColor: row.boardColor,
    listName: openText('board_list', row.listId, 'name', row.listName),
    title: openText('card', row.cardId, 'title', row.title),
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    dueEnd: row.dueTime === null ? null : row.dueEnd,
  }));
}
