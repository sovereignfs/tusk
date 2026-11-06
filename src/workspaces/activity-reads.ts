import { sql, type SQL } from 'drizzle-orm';
import type { Directory } from '../auth/directory';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { boardsVisibleTo } from './can';
import { type Details, describe } from './describe';
import { ACTIVITY_KINDS, ACTIVITY_PAGE, type ActivityKind, type ActivityPage } from './format';
import { tablesOf } from './tables';

/**
 * What can be read of the activity (DESIGN.md §15.6): a board's, a card's and a person's own, newest first, in pages of 50 after a cursor of time and id.
 * **Every statement holds the rows to boards the asker can see**, so an outsider reads nothing of a board's, and a person's own activity is only on the
 * boards they can still see. Each row is turned into its sentence here, by `describe.ts`, with the actor's name (and the name of any person it names)
 * read from the accounts when it is shown: "Deleted account" for one that is gone.
 */
interface Raw {
  id: string;
  boardId: string;
  boardName: string;
  cardId: string | null;
  actorId: string;
  kind: string;
  details: string;
  createdAt: number | string;
}

const parse = (text: string): Details => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as Details) : {};
  } catch {
    return {};
  }
};

async function page(
  database: Database,
  directory: Pick<Directory, 'profiles'>,
  where: SQL,
  before: { createdAt: number; id: string } | undefined,
  withBoard: boolean,
): Promise<ActivityPage> {
  const t = tablesOf(database);
  const rows = await dbAll<Raw>(
    database,
    sql`SELECT a.id AS id, a.board_id AS "boardId", COALESCE(b.name, '') AS "boardName", a.card_id AS "cardId", a.actor_id AS "actorId",
               a.kind AS kind, a.details AS details, a.created_at AS "createdAt"
        FROM ${t.activity} a LEFT JOIN ${t.board} b ON b.id = a.board_id
        WHERE ${where}
          ${before ? sql`AND (a.created_at < ${before.createdAt} OR (a.created_at = ${before.createdAt} AND a.id < ${before.id}))` : sql``}
        ORDER BY a.created_at DESC, a.id DESC LIMIT ${ACTIVITY_PAGE + 1}`,
  );
  const shown = rows.slice(0, ACTIVITY_PAGE);
  const details = shown.map((row) => parse(row.details));
  const ids = [
    ...shown.map((row) => row.actorId),
    ...details.flatMap((each) => (each.person ? [each.person] : [])),
  ];
  const profiles = await directory.profiles(ids);
  const name = (id: string) => profiles.get(id)?.name ?? 'Deleted account';
  return {
    activity: shown
      .filter((row) => (ACTIVITY_KINDS as readonly string[]).includes(row.kind))
      .map((row, index) => ({
        id: row.id,
        kind: row.kind as ActivityKind,
        actorName: name(row.actorId),
        text: describe(row.kind as ActivityKind, name(row.actorId), details[index] ?? {}, name),
        boardId: row.boardId,
        ...(withBoard ? { boardName: row.boardName } : {}),
        cardId: row.cardId,
        createdAt: Number(row.createdAt),
      })),
    more: rows.length > ACTIVITY_PAGE,
  };
}

/** A board's activity, for someone who can see the board; `undefined` for a board that is not theirs. */
export async function activityOfBoard(
  database: Database,
  directory: Pick<Directory, 'profiles'>,
  accountId: string,
  boardId: string,
  before?: { createdAt: number; id: string },
): Promise<ActivityPage | undefined> {
  const visible = await dbAll<{ id: string }>(
    database,
    sql`SELECT id FROM ${tablesOf(database).board} WHERE id = ${boardId} AND id IN ${boardsVisibleTo(database, accountId)}`,
  );
  if (visible.length === 0) return undefined;
  return page(database, directory, sql`a.board_id = ${boardId}`, before, false);
}

/**
 * A card's activity, for someone who can see its board. The card may be gone: its rows stay (§15.6), and what is asked is "this card's, on a board I can
 * see", which is true of a deleted card too. `undefined` when there is nothing of the card on any board the asker can see.
 */
export async function activityOfCard(
  database: Database,
  directory: Pick<Directory, 'profiles'>,
  accountId: string,
  cardId: string,
  before?: { createdAt: number; id: string },
): Promise<ActivityPage | undefined> {
  const seen = await dbAll<{ id: string }>(
    database,
    sql`SELECT a.id AS id FROM ${tablesOf(database).activity} a
        WHERE a.card_id = ${cardId} AND a.board_id IN ${boardsVisibleTo(database, accountId)} LIMIT 1`,
  );
  if (seen.length === 0) return undefined;
  return page(
    database,
    directory,
    sql`a.card_id = ${cardId} AND a.board_id IN ${boardsVisibleTo(database, accountId)}`,
    before,
    false,
  );
}

/** What the person did themselves, across the boards they can still see (Settings > Activity), with the board each was on. */
export async function activityOfPerson(
  database: Database,
  directory: Pick<Directory, 'profiles'>,
  accountId: string,
  before?: { createdAt: number; id: string },
): Promise<ActivityPage> {
  return page(
    database,
    directory,
    sql`a.actor_id = ${accountId} AND a.board_id IN ${boardsVisibleTo(database, accountId)}`,
    before,
    true,
  );
}
