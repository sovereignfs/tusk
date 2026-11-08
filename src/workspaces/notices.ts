import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import type { NoticeKind } from './format';
import { sealText } from './content';
import { tablesOf } from './tables';

/**
 * The one way an operation tells a person something (DESIGN.md §16), called **inside the operation's transaction** so that the notice exists if and
 * only if the change does. It is never for the one who did it, and never for a kind the person has turned off in Settings (`account_settings.notices_off`):
 * a notice that is not wanted is not written at all. `details` is JSON with the name of what it is about as it was then (a card's title, a board's or a
 * workspace's name), so that a notice reads as it was written even when the card is later renamed.
 */
export interface Notice {
  /** Who is told. */
  readonly recipient: string;
  readonly kind: NoticeKind;
  /** Who did it. */
  readonly actor: string;
  readonly workspaceId: string;
  readonly boardId?: string;
  readonly cardId?: string;
  /** The name of the card, board or workspace it is about. */
  readonly subject: string;
}

const settingsTable = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;

/** The kinds a person has turned off. */
export async function kindsOff(database: Database, accountId: string): Promise<string[]> {
  const row = await dbGet<{ off: string }>(
    database,
    sql`SELECT notices_off AS off FROM ${settingsTable(database)} WHERE account_id = ${accountId}`,
  );
  return (row?.off ?? '').split(',').filter((each) => each !== '');
}

/** Writes the notice, or says why not by writing nothing. Returns whether it was written. */
export async function raise(tx: Database, notice: Notice, now: number): Promise<boolean> {
  if (notice.recipient === notice.actor) return false;
  if ((await kindsOff(tx, notice.recipient)).includes(notice.kind)) return false;
  const t = tablesOf(tx);
  const id = crypto.randomUUID();
  await dbAll(
    tx,
    sql`INSERT INTO ${t.notice} (id, account_id, kind, actor_id, workspace_id, board_id, card_id, details, created_at)
        VALUES (${id}, ${notice.recipient}, ${notice.kind}, ${notice.actor}, ${notice.workspaceId},
                ${notice.boardId ?? null}, ${notice.cardId ?? null}, ${sealText('notice', id, 'details', JSON.stringify({ title: notice.subject }))}, ${now})
        RETURNING id`,
  );
  return true;
}

/**
 * A notice from the app itself, with no one who did it and nothing of a workspace: a backup that stopped (DESIGN.md §21.4), a workspace passed on because its owner deleted their account (§22). `subject` is a word of ours for
 * what it is about (the kind of failure), never text from outside. A kind the person turned off is not written. Called inside the transaction of what
 * it is about.
 */
export async function raiseSystem(
  tx: Database,
  notice: { recipient: string; kind: NoticeKind; subject: string; workspaceId?: string },
  now: number,
): Promise<boolean> {
  if ((await kindsOff(tx, notice.recipient)).includes(notice.kind)) return false;
  const id = crypto.randomUUID();
  await dbAll(
    tx,
    sql`INSERT INTO ${tablesOf(tx).notice} (id, account_id, kind, actor_id, workspace_id, board_id, card_id, details, created_at)
        VALUES (${id}, ${notice.recipient}, ${notice.kind}, NULL, ${notice.workspaceId ?? null}, NULL, NULL, ${sealText('notice', id, 'details', JSON.stringify({ title: notice.subject }))}, ${now})
        RETURNING id`,
  );
  return true;
}

/** A notice a process has claimed to send outside the app. */
export interface Claimed {
  readonly id: string;
  readonly accountId: string;
  readonly kind: string;
  /** As stored: sealed under the operator key, when that is on. */
  readonly details: string;
}

/**
 * **The one claim** on notices to be sent outside the app (DESIGN.md §25.2): a conditional update that stamps `sent_at` on up to `limit` of the notices not yet
 * stamped that are newer than `since`, and answers the ones it stamped. Any number of processes may run it at once, and each notice is answered to one of them:
 * the update only takes a row that is still unstamped when it is reached. Everything about who is sent what is the caller's, after the claim.
 */
export async function claimUnsent(
  database: Database,
  now: number,
  since: number,
  limit: number,
): Promise<Claimed[]> {
  const t = tablesOf(database);
  return dbAll<Claimed>(
    database,
    sql`UPDATE ${t.notice} SET sent_at = ${now}
        WHERE sent_at IS NULL AND id IN (
          SELECT id FROM ${t.notice} WHERE sent_at IS NULL AND created_at >= ${since} ORDER BY created_at, id LIMIT ${limit}
        )
        RETURNING id, account_id AS "accountId", kind, details`,
  );
}
