import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { boardsVisibleTo } from './can';
import { type AssignedCard, NOTICE_LIMITS } from './format';
import { tablesOf } from './tables';
import { openText } from './content';

/**
 * The Inbox (DESIGN.md §16, task 8.9): **every open card assigned to the person, across the boards they can see**, by due date, undated last. What a person is told is
 * `notifications.ts`'s. The account and the boards it can see are in the statement.
 */
export async function assignedOf(database: Database, accountId: string): Promise<AssignedCard[]> {
  const t = tablesOf(database);
  return (
    await dbAll<{
      cardId: string;
      boardId: string;
      boardName: string;
      title: string;
      dueDate: string | null;
      dueTime: string | null;
    }>(
      database,
      sql`SELECT c.id AS "cardId", c.board_id AS "boardId", b.name AS "boardName", c.title AS title,
                 c.due_date AS "dueDate", c.due_time AS "dueTime"
          FROM ${t.cardAssignee} ca JOIN ${t.card} c ON c.id = ca.card_id JOIN ${t.board} b ON b.id = c.board_id
          WHERE ca.account_id = ${accountId} AND c.archived_at IS NULL AND b.archived_at IS NULL
            AND c.board_id IN ${boardsVisibleTo(database, accountId)}
          ORDER BY CASE WHEN c.due_date IS NULL THEN 1 ELSE 0 END, c.due_date, c.due_time, c.created_at, c.id
          LIMIT ${NOTICE_LIMITS.assignedListed}`,
    )
  ).map((row) => ({
    ...row,
    boardName: openText('board', row.boardId, 'name', row.boardName),
    title: openText('card', row.cardId, 'title', row.title),
  }));
}
