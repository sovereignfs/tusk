import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import { boardsAdministeredBy } from './can';
import { type Publication, TOKEN_PATTERN, WORKSPACE_LIMITS } from './format';
import { inNameOrder, nameOrderSql, open, openText, operatorRing } from './content';
import { tablesOf } from './tables';

/**
 * A published board (DESIGN.md §14.6): what anyone with the address can read, and how its owners find the address. **The public read has no account in
 * it and carries no person**: no member, assignee, address, comment or activity is selected anywhere in it, so none can be in what it returns. It is the
 * board as it is now, archived or not, and an unknown token, a token that has been taken away, and a board that was deleted are one answer: nothing.
 */
export interface PublishedBoard {
  readonly name: string;
  readonly color: string;
  readonly description: string | null;
  readonly archived: boolean;
  readonly labels: readonly {
    readonly id: string;
    readonly name: string;
    readonly color: string;
  }[];
  readonly lists: readonly {
    readonly id: string;
    readonly name: string;
    readonly cards: readonly PublishedCard[];
  }[];
}

export interface PublishedCard {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly dueDate: string | null;
  readonly dueTime: string | null;
  readonly labels: readonly string[];
  readonly checklist: readonly { readonly title: string; readonly done: boolean }[];
}

export async function readPublished(
  database: Database,
  token: string,
): Promise<PublishedBoard | undefined> {
  if (!TOKEN_PATTERN.test(token)) return undefined;
  const t = tablesOf(database);
  const board = await dbGet<{
    id: string;
    name: string;
    color: string;
    description: string | null;
    archivedAt: number | string | null;
  }>(
    database,
    sql`SELECT b.id AS id, b.name AS name, b.color AS color, b.description AS description, b.archived_at AS "archivedAt"
        FROM ${t.publication} p JOIN ${t.board} b ON b.id = p.board_id WHERE p.token = ${token}`,
  );
  if (!board) return undefined;
  const [labels, lists, cards, carried, items] = await Promise.all([
    dbAll<{ id: string; name: string; color: string }>(
      database,
      sql`SELECT id, name, color FROM ${t.label} WHERE board_id = ${board.id} ORDER BY created_at, id LIMIT ${WORKSPACE_LIMITS.labelsPerBoard}`,
    ),
    dbAll<{ id: string; name: string }>(
      database,
      sql`SELECT id, name FROM ${t.boardList} WHERE board_id = ${board.id} ORDER BY position, id LIMIT ${WORKSPACE_LIMITS.listsPerBoard}`,
    ),
    dbAll<{
      id: string;
      listId: string;
      title: string;
      description: string | null;
      dueDate: string | null;
      dueTime: string | null;
    }>(
      database,
      sql`SELECT id, list_id AS "listId", title, description, due_date AS "dueDate", due_time AS "dueTime" FROM ${t.card}
          WHERE board_id = ${board.id} AND archived_at IS NULL ORDER BY position, id LIMIT ${WORKSPACE_LIMITS.cardsPerBoard}`,
    ),
    dbAll<{ cardId: string; labelId: string }>(
      database,
      sql`SELECT cl.card_id AS "cardId", cl.label_id AS "labelId" FROM ${t.cardLabel} cl JOIN ${t.label} l ON l.id = cl.label_id
          WHERE cl.board_id = ${board.id} ORDER BY l.created_at, l.id`,
    ),
    dbAll<{ id: string; cardId: string; title: string; done: number | boolean }>(
      database,
      sql`SELECT id, card_id AS "cardId", title, (completed_at IS NOT NULL) AS done FROM ${t.checklistItem}
          WHERE board_id = ${board.id} ORDER BY position, id`,
    ),
  ]);
  const labelsOf = new Map<string, string[]>();
  for (const row of carried)
    labelsOf.set(row.cardId, [...(labelsOf.get(row.cardId) ?? []), row.labelId]);
  const itemsOf = new Map<string, { title: string; done: boolean }[]>();
  for (const row of items)
    itemsOf.set(row.cardId, [
      ...(itemsOf.get(row.cardId) ?? []),
      {
        title: openText('checklist_item', row.id, 'title', row.title),
        done: row.done === true || Number(row.done) === 1,
      },
    ]);
  return {
    name: openText('board', board.id, 'name', board.name),
    color: board.color,
    description: open('board', board.id, 'description', board.description),
    archived: board.archivedAt !== null,
    labels: labels.map((label) => ({
      ...label,
      name: openText('label', label.id, 'name', label.name),
    })),
    lists: lists.map((list) => ({
      id: list.id,
      name: openText('board_list', list.id, 'name', list.name),
      cards: cards
        .filter((card) => card.listId === list.id)
        .map((card) => ({
          id: card.id,
          title: openText('card', card.id, 'title', card.title),
          description: open('card', card.id, 'description', card.description),
          dueDate: card.dueDate,
          dueTime: card.dueTime,
          labels: labelsOf.get(card.id) ?? [],
          checklist: itemsOf.get(card.id) ?? [],
        })),
    })),
  };
}

/** The address of a board, for someone who administers it: the token, or `null` if it is not published; `undefined` for a board that is not theirs to administer. */
export async function publicationOf(
  database: Database,
  accountId: string,
  boardId: string,
): Promise<{ token: string | null } | undefined> {
  const t = tablesOf(database);
  const allowed = await dbGet<{ one: number }>(
    database,
    sql`SELECT 1 AS one FROM ${t.board} WHERE id = ${boardId} AND id IN ${boardsAdministeredBy(database, accountId)}`,
  );
  if (!allowed) return undefined;
  const row = await dbGet<{ token: string }>(
    database,
    sql`SELECT token FROM ${t.publication} WHERE board_id = ${boardId}`,
  );
  return { token: row?.token ?? null };
}

/** Every published board that the person administers, by name: what Settings > Data lists, so that a person can see what of theirs is public. */
export async function publicationsOf(
  database: Database,
  accountId: string,
): Promise<Publication[]> {
  const t = tablesOf(database);
  const rows = await dbAll<Publication>(
    database,
    sql`SELECT p.board_id AS "boardId", b.name AS "boardName", p.token AS token FROM ${t.publication} p JOIN ${t.board} b ON b.id = p.board_id
        WHERE p.board_id IN ${boardsAdministeredBy(database, accountId)} ${sql.raw(nameOrderSql('b.name', 'b.id'))} ${operatorRing() ? sql`` : sql`LIMIT ${WORKSPACE_LIMITS.boardsPerWorkspace}`}`,
  );
  return inNameOrder(
    rows.map((row) => ({
      ...row,
      id: row.boardId,
      boardName: openText('board', row.boardId, 'name', row.boardName),
    })),
    (row) => row.boardName,
    WORKSPACE_LIMITS.boardsPerWorkspace,
  ).map(({ id: _id, ...row }) => row);
}
