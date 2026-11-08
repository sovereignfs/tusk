import { sql } from 'drizzle-orm';
import type { Directory } from '../auth/directory';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import type {
  BoardPart,
  ExportedBoardCard,
  ExportedChecklistItem,
  ExportedPerson,
  WorkspacePart,
} from '../portability/format';
import { boardsVisibleTo, workspacesOwnedBy } from './can';
import { inNameOrder, nameOrderSql, open, openText, operatorRing } from './content';
import { tablesOf } from './tables';

/**
 * What a board and a workspace export, made on the server since that is where they are (DESIGN.md §20.1). **Every statement names the asker**, as every
 * read does: a board is read only if it is one they may see, and a workspace only if they own it, and anything else is `undefined`, the same answer as for
 * one that is not there. What is written is what is there and not what was deleted, archived cards and boards included; people are named by what they are
 * called and the address they sign in with and never by id, and a person whose account is gone is named so; and **no publication token, key, connection
 * or credential is read at all**. Everything is in order by position, then id, so that two exports of unchanged data are the same text.
 */
const CAP = 200_000;

type Directory_ = Pick<Directory, 'profiles'>;

const personOf = (
  profiles: Awaited<ReturnType<Directory['profiles']>>,
  accountId: string,
): ExportedPerson => {
  const profile = profiles.get(accountId);
  return profile
    ? { name: profile.name, email: profile.email }
    : { name: 'Deleted account', email: '' };
};
const byPerson = (a: ExportedPerson, b: ExportedPerson) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : a.email < b.email ? -1 : a.email > b.email ? 1 : 0;
const iso = (ms: number | string) => new Date(Number(ms)).toISOString();

/**
 * Takes any id of a person out of what an activity row kept (it holds the names its sentence needs, as they were, and may also hold ids): a key that is
 * an id, or ends in `Id`, is dropped at any depth. The file names people and never numbers them.
 */
export function withoutIds(value: unknown): Record<string, unknown> {
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (typeof v === 'object' && v !== null) {
      return Object.fromEntries(
        Object.entries(v)
          .filter(([key]) => key !== 'id' && !/Id$/.test(key))
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([key, inner]) => [key, clean(inner)]),
      );
    }
    return v;
  };
  const out = clean(value);
  return typeof out === 'object' && out !== null && !Array.isArray(out)
    ? (out as Record<string, unknown>)
    : {};
}

/** A board, for someone who can see it; `undefined` for one that is not theirs. */
export async function exportBoard(
  database: Database,
  directory: Directory_,
  accountId: string,
  boardId: string,
): Promise<BoardPart | undefined> {
  const t = tablesOf(database);
  const board = await dbGet<{
    id: string;
    name: string;
    color: string;
    description: string | null;
    visibility: string;
    archivedAt: number | string | null;
  }>(
    database,
    sql`SELECT b.id AS id, b.name AS name, b.color AS color, b.description AS description, b.visibility AS visibility, b.archived_at AS "archivedAt"
        FROM ${t.board} b WHERE b.id = ${boardId} AND b.id IN ${boardsVisibleTo(database, accountId)}`,
  );
  if (!board) return undefined;
  const boardName = openText('board', board.id, 'name', board.name);
  const boardDescription = open('board', board.id, 'description', board.description);

  const lists = await dbAll<{ id: string; name: string; position: string }>(
    database,
    sql`SELECT id, name, position FROM ${t.boardList} WHERE board_id = ${boardId} ORDER BY position, id LIMIT ${CAP}`,
  );
  const cards = await dbAll<{
    id: string;
    listId: string;
    title: string;
    description: string | null;
    dueDate: string | null;
    dueTime: string | null;
    position: string;
    archivedAt: number | string | null;
  }>(
    database,
    sql`SELECT id, list_id AS "listId", title, description, due_date AS "dueDate", due_time AS "dueTime", position, archived_at AS "archivedAt"
        FROM ${t.card} WHERE board_id = ${boardId} ORDER BY list_id, position, id LIMIT ${CAP}`,
  );
  const labels = await dbAll<{ id: string; name: string; color: string }>(
    database,
    sql`SELECT id, name, color FROM ${t.label} WHERE board_id = ${boardId} ORDER BY created_at, id LIMIT ${CAP}`,
  );
  const carried = await dbAll<{ cardId: string; labelId: string }>(
    database,
    sql`SELECT card_id AS "cardId", label_id AS "labelId" FROM ${t.cardLabel} WHERE board_id = ${boardId} ORDER BY card_id, label_id LIMIT ${CAP}`,
  );
  const assigned = await dbAll<{ cardId: string; accountId: string }>(
    database,
    sql`SELECT card_id AS "cardId", account_id AS "accountId" FROM ${t.cardAssignee} WHERE board_id = ${boardId} ORDER BY card_id, account_id LIMIT ${CAP}`,
  );
  const items = await dbAll<{
    id: string;
    cardId: string;
    title: string;
    completedAt: number | string | null;
    position: string;
  }>(
    database,
    sql`SELECT id, card_id AS "cardId", title, completed_at AS "completedAt", position FROM ${t.checklistItem}
        WHERE board_id = ${boardId} ORDER BY card_id, position, id LIMIT ${CAP}`,
  );
  const comments = await dbAll<{
    cardId: string;
    authorId: string;
    body: string;
    createdAt: number | string;
    editedAt: number | string | null;
    id: string;
  }>(
    database,
    sql`SELECT id, card_id AS "cardId", author_id AS "authorId", body, created_at AS "createdAt", edited_at AS "editedAt" FROM ${t.comment}
        WHERE board_id = ${boardId} ORDER BY card_id, created_at, id LIMIT ${CAP}`,
  );
  const activity = await dbAll<{
    kind: string;
    cardId: string | null;
    actorId: string;
    details: string;
    createdAt: number | string;
    id: string;
  }>(
    database,
    sql`SELECT id, kind, card_id AS "cardId", actor_id AS "actorId", details, created_at AS "createdAt" FROM ${t.activity}
        WHERE board_id = ${boardId} ORDER BY created_at, id LIMIT ${CAP}`,
  );

  const profiles = await directory.profiles([
    ...assigned.map((row) => row.accountId),
    ...comments.map((row) => row.authorId),
    ...activity.map((row) => row.actorId),
  ]);

  const group = <T extends { cardId: string }>(rows: readonly T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) map.set(row.cardId, [...(map.get(row.cardId) ?? []), row]);
    return map;
  };
  const labelsOf = group(carried);
  const assigneesOf = group(assigned);
  const itemsOf = group(items);
  const commentsOf = group(comments);

  const cardPart = (card: (typeof cards)[number]): ExportedBoardCard => ({
    id: card.id,
    title: openText('card', card.id, 'title', card.title),
    description: open('card', card.id, 'description', card.description) ?? '',
    dueDate: card.dueDate,
    dueTime: card.dueTime,
    position: card.position,
    archived: card.archivedAt !== null,
    labels: (labelsOf.get(card.id) ?? []).map((row) => row.labelId).sort(),
    assignees: (assigneesOf.get(card.id) ?? [])
      .map((row) => personOf(profiles, row.accountId))
      .sort(byPerson),
    checklist: (itemsOf.get(card.id) ?? []).map((item): ExportedChecklistItem => ({
      id: item.id,
      title: openText('checklist_item', item.id, 'title', item.title),
      completedAt: item.completedAt === null ? null : Number(item.completedAt),
      position: item.position,
    })),
    comments: (commentsOf.get(card.id) ?? []).map((row) => ({
      author: personOf(profiles, row.authorId),
      body: openText('comment', row.id, 'body', row.body),
      createdAt: iso(row.createdAt),
      editedAt: row.editedAt === null ? null : iso(row.editedAt),
    })),
  });

  return {
    id: board.id,
    name: boardName,
    color: board.color,
    description: boardDescription,
    visibility: board.visibility === 'private' ? 'private' : 'public',
    archived: board.archivedAt !== null,
    lists: lists.map((list) => ({
      id: list.id,
      name: openText('board_list', list.id, 'name', list.name),
      position: list.position,
      cards: cards.filter((card) => card.listId === list.id).map(cardPart),
    })),
    labels: labels.map((label) => ({
      ...label,
      name: openText('label', label.id, 'name', label.name),
    })),
    activity: activity.map((row) => {
      let details: unknown = {};
      try {
        details = JSON.parse(openText('activity', row.id, 'details', row.details));
      } catch {
        // A row whose details cannot be read says what it was and nothing more.
      }
      return {
        kind: row.kind,
        actor: personOf(profiles, row.actorId),
        cardId: row.cardId,
        details: withoutIds(details),
        createdAt: iso(row.createdAt),
      };
    }),
  };
}

/** A workspace and its boards, for someone who owns it; `undefined` for one that is not theirs, or that they are only a member of. */
export async function exportWorkspace(
  database: Database,
  directory: Directory_,
  accountId: string,
  workspaceId: string,
): Promise<WorkspacePart | undefined> {
  const t = tablesOf(database);
  const workspace = await dbGet<{ id: string; name: string }>(
    database,
    sql`SELECT id, name FROM ${t.workspace} WHERE id = ${workspaceId} AND id IN ${workspacesOwnedBy(database, accountId)}`,
  );
  if (!workspace) return undefined;
  const members = await dbAll<{ accountId: string; role: string }>(
    database,
    sql`SELECT account_id AS "accountId", role FROM ${t.workspaceMember} WHERE workspace_id = ${workspaceId} ORDER BY created_at, account_id LIMIT ${CAP}`,
  );
  const profiles = await directory.profiles(members.map((member) => member.accountId));
  const people = members
    .map((member) => ({
      ...personOf(profiles, member.accountId),
      role: member.role === 'owner' ? ('owner' as const) : ('member' as const),
    }))
    .sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner') || byPerson(a, b));

  const boardRows = await dbAll<{ id: string; name: string }>(
    database,
    sql`SELECT id, name FROM ${t.board} WHERE workspace_id = ${workspaceId} ${sql.raw(nameOrderSql('name', 'id'))} ${operatorRing() ? sql`` : sql`LIMIT ${CAP}`}`,
  );
  const boardIds = inNameOrder(
    boardRows,
    (row) => openText('board', row.id, 'name', row.name),
    CAP,
  );
  const boards: BoardPart[] = [];
  for (const { id } of boardIds) {
    const part = await exportBoard(database, directory, accountId, id);
    if (part) boards.push(part);
  }
  return {
    id: workspace.id,
    name: openText('workspace', workspace.id, 'name', workspace.name),
    people,
    boards,
  };
}

/** Every workspace the account owns, as `exportWorkspace` makes each: the server's part of "everything". */
export async function exportOwned(
  database: Database,
  directory: Directory_,
  accountId: string,
): Promise<WorkspacePart[]> {
  const t = tablesOf(database);
  const ownedRows = await dbAll<{ id: string; name: string }>(
    database,
    sql`SELECT w.id AS id, w.name AS name FROM ${t.workspace} w WHERE w.id IN ${workspacesOwnedBy(database, accountId)} ${sql.raw(nameOrderSql('w.name', 'w.id'))} ${operatorRing() ? sql`` : sql`LIMIT ${CAP}`}`,
  );
  const owned = inNameOrder(
    ownedRows,
    (row) => openText('workspace', row.id, 'name', row.name),
    CAP,
  );
  const out: WorkspacePart[] = [];
  for (const { id } of owned) {
    const part = await exportWorkspace(database, directory, accountId, id);
    if (part) out.push(part);
  }
  return out;
}

/**
 * A stamp for each thing of the workspaces an account owns that an export holds and that moves when it changes: the workspace (its name and time), each
 * board (its version, which every operation on it moves, and when it was archived) and each person in it with their role. For `backupFingerprint`, so
 * they are read as text and are never exported. Every statement names the account, as every read here does.
 */
export async function ownedStamps(database: Database, accountId: string): Promise<string[]> {
  const t = tablesOf(database);
  const owned = workspacesOwnedBy(database, accountId);
  const workspaces = await dbAll<{ id: string; updatedAt: number | string }>(
    database,
    sql`SELECT id, updated_at AS "updatedAt" FROM ${t.workspace} WHERE id IN ${owned}`,
  );
  const boards = await dbAll<{
    id: string;
    version: number | string;
    updatedAt: number | string;
    archivedAt: number | string | null;
  }>(
    database,
    sql`SELECT id, version, updated_at AS "updatedAt", archived_at AS "archivedAt" FROM ${t.board} WHERE workspace_id IN ${owned}`,
  );
  const people = await dbAll<{ workspaceId: string; accountId: string; role: string }>(
    database,
    sql`SELECT workspace_id AS "workspaceId", account_id AS "accountId", role FROM ${t.workspaceMember} WHERE workspace_id IN ${owned}`,
  );
  return [
    ...workspaces.map((row) => `w:${row.id}:${Number(row.updatedAt)}`),
    ...boards.map(
      (row) =>
        `b:${row.id}:${Number(row.version)}:${Number(row.updatedAt)}:${row.archivedAt === null ? '' : Number(row.archivedAt)}`,
    ),
    ...people.map((row) => `m:${row.workspaceId}:${row.accountId}:${row.role}`),
  ];
}
