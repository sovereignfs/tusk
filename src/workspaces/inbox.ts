import { sql } from 'drizzle-orm';
import type { Directory } from '../auth/directory';
import type { Database } from '../db/client';
import { dbAll, dbGet, dbRun } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import { boardsVisibleTo, workspacesOf } from './can';
import {
  type AssignedCard,
  type Inbox,
  NOTICE_KINDS,
  NOTICE_LIMITS,
  type NoticeKind,
  type NoticeRow,
} from './format';
import { tablesOf } from './tables';

/**
 * The Inbox (DESIGN.md §16): what a person has been told, and what is assigned to them. **Every statement names the account and holds a notice to what the
 * person can still see**: a notice about a board they have left, or that was made private to them or deleted, or about a workspace they are not in now,
 * is not shown, however it is asked for. Names of people are read from the accounts when shown. Unread is one time per person, so it is the same on
 * every device.
 */
const settingsTable = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;

const visible = (database: Database, accountId: string) => sql`
  n.account_id = ${accountId}
  AND (n.board_id IS NULL OR n.board_id IN ${boardsVisibleTo(database, accountId)})
  AND (n.workspace_id IS NULL OR n.workspace_id IN ${workspacesOf(database, accountId)})`;

const isKind = (value: string): value is NoticeKind =>
  (NOTICE_KINDS as readonly string[]).includes(value);

const subjectOf = (details: string): string => {
  try {
    const parsed: unknown = JSON.parse(details);
    return typeof parsed === 'object' && parsed !== null && 'title' in parsed
      ? String((parsed as { title: unknown }).title)
      : '';
  } catch {
    return '';
  }
};

/** When the person last opened the Inbox, or 0. */
async function seenAt(database: Database, accountId: string): Promise<number> {
  const row = await dbGet<{ seen: number | string }>(
    database,
    sql`SELECT inbox_seen_at AS seen FROM ${settingsTable(database)} WHERE account_id = ${accountId}`,
  );
  return Number(row?.seen ?? 0);
}

/** How many notices are newer than the last time the Inbox was opened, up to 100: the sidebar says "99+" for the last. */
export async function unreadCount(database: Database, accountId: string): Promise<number> {
  const t = tablesOf(database);
  const seen = await seenAt(database, accountId);
  const row = await dbGet<{ n: number | string }>(
    database,
    sql`SELECT COUNT(*) AS n FROM (
          SELECT 1 FROM ${t.notice} n WHERE ${visible(database, accountId)} AND n.created_at > ${seen} LIMIT 100
        ) counted`,
  );
  return Number(row?.n ?? 0);
}

/** Moves "last opened" on to `now`, never back, making the person's settings row if they have none. */
export async function markSeen(database: Database, accountId: string, now: number): Promise<void> {
  await dbRun(
    database,
    // The target is named (`AS s`) because PostgreSQL finds a bare column in the update ambiguous between it and the row that was refused.
    sql`INSERT INTO ${settingsTable(database)} AS s (account_id, seq, created_at, inbox_seen_at) VALUES (${accountId}, 0, ${now}, ${now})
        ON CONFLICT (account_id) DO UPDATE SET inbox_seen_at = CASE WHEN s.inbox_seen_at < ${now} THEN ${now} ELSE s.inbox_seen_at END`,
  );
}

/**
 * A page of notices, newest first, after a cursor of time and id (so that a page never skips or repeats one when notices arrive between pages), with the
 * number unread and, on the first page, the open cards assigned to the person on boards they can see, by due date, undated last.
 */
export async function inboxOf(
  database: Database,
  directory: Pick<Directory, 'profiles'>,
  accountId: string,
  before?: { createdAt: number; id: string },
): Promise<Inbox> {
  const t = tablesOf(database);
  const page = NOTICE_LIMITS.page;
  const rows = await dbAll<{
    id: string;
    kind: string;
    actorId: string | null;
    workspaceId: string | null;
    boardId: string | null;
    cardId: string | null;
    details: string;
    createdAt: number | string;
  }>(
    database,
    sql`SELECT n.id AS id, n.kind AS kind, n.actor_id AS "actorId", n.workspace_id AS "workspaceId", n.board_id AS "boardId",
               n.card_id AS "cardId", n.details AS details, n.created_at AS "createdAt"
        FROM ${t.notice} n
        WHERE ${visible(database, accountId)}
          ${before ? sql`AND (n.created_at < ${before.createdAt} OR (n.created_at = ${before.createdAt} AND n.id < ${before.id}))` : sql``}
        ORDER BY n.created_at DESC, n.id DESC LIMIT ${page + 1}`,
  );
  const profiles = await directory.profiles(
    rows.flatMap((row) => (row.actorId ? [row.actorId] : [])),
  );
  const notices: NoticeRow[] = rows
    .slice(0, page)
    .filter((row) => isKind(row.kind))
    .map((row) => ({
      id: row.id,
      kind: row.kind as NoticeKind,
      actorName: row.actorId ? (profiles.get(row.actorId)?.name ?? 'Someone') : null,
      workspaceId: row.workspaceId,
      boardId: row.boardId,
      cardId: row.cardId,
      subject: subjectOf(row.details),
      createdAt: Number(row.createdAt),
    }));
  const assigned: AssignedCard[] = before
    ? []
    : (
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
      ).map((row) => row);
  return {
    notices,
    more: rows.length > page,
    unread: before ? 0 : await unreadCount(database, accountId),
    assigned,
  };
}

/**
 * The purge's part (DESIGN.md §16): notices older than 90 days go, and each person keeps the latest 500. Safe to run from any process at any time. Returns
 * how many it removed.
 */
export async function trimNotices(database: Database, now: number): Promise<number> {
  const t = tablesOf(database);
  const old = await dbAll<{ id: string }>(
    database,
    sql`DELETE FROM ${t.notice} WHERE created_at < ${now - NOTICE_LIMITS.keptMs} RETURNING id`,
  );
  const extra = await dbAll<{ id: string }>(
    database,
    sql`DELETE FROM ${t.notice} WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY created_at DESC, id DESC) AS rn FROM ${t.notice}
          ) ranked WHERE rn > ${NOTICE_LIMITS.perPerson}
        ) RETURNING id`,
  );
  return old.length + extra.length;
}
