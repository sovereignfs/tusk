import { type SQL, sql } from 'drizzle-orm';
import type { Directory } from '../auth/directory';
import type { Database } from '../db/client';
import { dbAll, dbGet, dbRun } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import { boardsVisibleTo, workspacesOf } from './can';
import {
  NOTICE_KINDS,
  NOTICE_LIMITS,
  type NoticeKind,
  type NoticeRow,
  type NotificationsPage,
} from './format';
import { tablesOf } from './tables';
import { openText } from './content';

/**
 * What a person is told (DESIGN.md §16, tasks 8.1 and 8.7). **Every statement names the account, and holds a notice to what the person can still see and has not
 * dismissed**: a notice about a board they have left, or that was made private to them or deleted, or about a workspace they are not in now, is not shown however it
 * is asked for. Names of people are read from the accounts when shown.
 *
 * **Read is for each notice.** A notice is read when it has a `read_at`, or was made at or before `account_settings.inbox_seen_at`, which is what "Mark all read" moves on
 * (one write, whatever the number, and the state every notice had before there was a `read_at`). A dismissed notice is shown nowhere and counts for nothing. Each change
 * is one update that names the account, so a notice of someone else's is never touched, and doing it twice does nothing more.
 */
const settingsTable = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;

const visible = (database: Database, accountId: string) => sql`
  n.account_id = ${accountId}
  AND n.dismissed_at IS NULL
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

/** When the person last said "Mark all read", or 0 (or opened the Inbox, before there was a bell). */
async function seenAt(database: Database, accountId: string): Promise<number> {
  const row = await dbGet<{ seen: number | string }>(
    database,
    sql`SELECT inbox_seen_at AS seen FROM ${settingsTable(database)} WHERE account_id = ${accountId}`,
  );
  return Number(row?.seen ?? 0);
}

/** How many notices are unread, up to 100: the bell says "99+" for the last. */
export async function unreadCount(database: Database, accountId: string): Promise<number> {
  const t = tablesOf(database);
  const seen = await seenAt(database, accountId);
  const row = await dbGet<{ n: number | string }>(
    database,
    sql`SELECT COUNT(*) AS n FROM (
          SELECT 1 FROM ${t.notice} n
          WHERE ${visible(database, accountId)} AND n.read_at IS NULL AND n.created_at > ${seen} LIMIT 100
        ) counted`,
  );
  return Number(row?.n ?? 0);
}

/** Which notices: the ones named (at most `MAX_IDS`), or all of the person's. */
export type Which = { readonly ids: readonly string[] } | { readonly all: true };
export const MAX_IDS = 200;

const idList = (ids: readonly string[]): SQL =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

/** Moves "last read all" on to `now`, never back, making the person's settings row if they have none. */
async function readAllBefore(database: Database, accountId: string, now: number): Promise<void> {
  await dbRun(
    database,
    // The target is named (`AS s`) because PostgreSQL finds a bare column in the update ambiguous between it and the row that was refused.
    sql`INSERT INTO ${settingsTable(database)} AS s (account_id, seq, created_at, inbox_seen_at) VALUES (${accountId}, 0, ${now}, ${now})
        ON CONFLICT (account_id) DO UPDATE SET inbox_seen_at = CASE WHEN s.inbox_seen_at < ${now} THEN ${now} ELSE s.inbox_seen_at END`,
  );
}

/** Reads the notices named, or all of them. Only the person's own are touched, and one already read keeps the time it was read. */
export async function markRead(
  database: Database,
  accountId: string,
  which: Which,
  now: number,
): Promise<void> {
  if ('all' in which) return readAllBefore(database, accountId, now);
  if (which.ids.length === 0) return;
  const t = tablesOf(database);
  await dbRun(
    database,
    sql`UPDATE ${t.notice} SET read_at = ${now}
        WHERE account_id = ${accountId} AND read_at IS NULL AND id IN (${idList(which.ids)})`,
  );
}

/** Dismisses the notices named, or all of them. Only the person's own are touched, and one already dismissed keeps the time it was. */
export async function dismiss(
  database: Database,
  accountId: string,
  which: Which,
  now: number,
): Promise<void> {
  const t = tablesOf(database);
  if ('all' in which) {
    await dbRun(
      database,
      sql`UPDATE ${t.notice} SET dismissed_at = ${now} WHERE account_id = ${accountId} AND dismissed_at IS NULL`,
    );
    return;
  }
  if (which.ids.length === 0) return;
  await dbRun(
    database,
    sql`UPDATE ${t.notice} SET dismissed_at = ${now}
        WHERE account_id = ${accountId} AND dismissed_at IS NULL AND id IN (${idList(which.ids)})`,
  );
}

/**
 * A page of notices, newest first, after a cursor of time and id (so that a page never skips or repeats one when notices arrive between pages), each with whether it is
 * read, and how many are unread on the first page.
 */
export async function noticesOf(
  database: Database,
  directory: Pick<Directory, 'profiles'>,
  accountId: string,
  before?: { createdAt: number; id: string },
): Promise<NotificationsPage> {
  const t = tablesOf(database);
  const page = NOTICE_LIMITS.page;
  const seen = await seenAt(database, accountId);
  const rows = await dbAll<{
    id: string;
    kind: string;
    actorId: string | null;
    workspaceId: string | null;
    boardId: string | null;
    cardId: string | null;
    details: string;
    createdAt: number | string;
    readAt: number | string | null;
  }>(
    database,
    sql`SELECT n.id AS id, n.kind AS kind, n.actor_id AS "actorId", n.workspace_id AS "workspaceId", n.board_id AS "boardId",
               n.card_id AS "cardId", n.details AS details, n.created_at AS "createdAt", n.read_at AS "readAt"
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
      subject: subjectOf(openText('notice', row.id, 'details', row.details)),
      createdAt: Number(row.createdAt),
      read: row.readAt !== null || Number(row.createdAt) <= seen,
    }));
  return {
    notices,
    more: rows.length > page,
    unread: before ? 0 : await unreadCount(database, accountId),
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
