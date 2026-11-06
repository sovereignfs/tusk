import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import type { Directory } from '../auth/directory';
import {
  boardsAdministeredBy,
  boardsEditableBy,
  boardsOwnedBy,
  boardsVisibleTo,
  workspacesOf,
  workspacesOwnedBy,
} from './can';
import {
  type ArchivedCard,
  type CommentPage,
  type CommentRow,
  type ChecklistItem,
  type LabelRow,
  type BoardPeople,
  type BoardPerson,
  type CardDetail,
  type CardTile,
  type BoardRow,
  type BoardsIndex,
  type IndexWorkspace,
  INDEX_AVATARS,
  WORKSPACE_SORTS,
  type WorkspaceSort,
  type BoardView,
  type ListRow,
  type Person,
  type Role,
  WORKSPACE_LIMITS,
  type WorkspaceRow,
} from './format';
import { tablesOf } from './tables';

/**
 * What a person can read of their workspaces (DESIGN.md §7.3): every read names the account in its statement, as every write does, so that a workspace
 * that is not theirs is not in the answer however its id is asked for.
 */
interface Raw {
  id: string;
  name: string;
  role: string;
  createdAt: number | string;
  updatedAt: number | string;
}

const toRow = (raw: Raw): WorkspaceRow => ({
  id: raw.id,
  name: raw.name,
  role: raw.role === 'owner' ? 'owner' : 'member',
  createdAt: Number(raw.createdAt),
  updatedAt: Number(raw.updatedAt),
});

/** The workspaces an account is in, by name, each with the account's own role. */
export async function listWorkspaces(
  database: Database,
  accountId: string,
): Promise<WorkspaceRow[]> {
  const t = tablesOf(database);
  const rows = await dbAll<Raw>(
    database,
    sql`SELECT w.id AS id, w.name AS name, m.role AS role, w.created_at AS "createdAt", w.updated_at AS "updatedAt"
        FROM ${t.workspace} w JOIN ${t.workspaceMember} m ON m.workspace_id = w.id
        WHERE m.account_id = ${accountId} AND w.id IN ${workspacesOf(database, accountId)}
        ORDER BY w.name, w.id LIMIT ${WORKSPACE_LIMITS.workspacesListed}`,
  );
  return rows.map(toRow);
}

/** One workspace, if the account is in it: the same answer for one that is not there and one that is not theirs. */
export async function workspaceOf(
  database: Database,
  accountId: string,
  workspaceId: string,
): Promise<WorkspaceRow | undefined> {
  const t = tablesOf(database);
  const raw = await dbGet<Raw>(
    database,
    sql`SELECT w.id AS id, w.name AS name, m.role AS role, w.created_at AS "createdAt", w.updated_at AS "updatedAt"
        FROM ${t.workspace} w JOIN ${t.workspaceMember} m ON m.workspace_id = w.id
        WHERE w.id = ${workspaceId} AND m.account_id = ${accountId}`,
  );
  return raw ? toRow(raw) : undefined;
}

/**
 * The people of a workspace (DESIGN.md §13.2), for someone who is in it: owners first, then by name. **The statement names the asker**, so that a workspace
 * that is not theirs gives `undefined`, the same as one that is not there. A name and a picture are read from the account now and not kept here; the
 * address is shown to an owner only, who needs it to tell two people apart. An account that no longer exists is shown as nobody in particular.
 */
export async function peopleOf(
  database: Database,
  directory: Pick<Directory, 'profiles'>,
  accountId: string,
  workspaceId: string,
): Promise<Person[] | undefined> {
  const t = tablesOf(database);
  const rows = await dbAll<{ accountId: string; role: string }>(
    database,
    sql`SELECT m.account_id AS "accountId", m.role AS role FROM ${t.workspaceMember} m
        WHERE m.workspace_id = ${workspaceId} AND m.workspace_id IN ${workspacesOf(database, accountId)}
        ORDER BY m.created_at, m.account_id LIMIT ${WORKSPACE_LIMITS.membersPerWorkspace}`,
  );
  if (rows.length === 0) return undefined;
  const asker = rows.find((row) => row.accountId === accountId);
  const owner = asker?.role === 'owner';
  const profiles = await directory.profiles(rows.map((row) => row.accountId));
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return rows
    .map((row): Person => {
      const profile = profiles.get(row.accountId);
      const role: Role = row.role === 'owner' ? 'owner' : 'member';
      return {
        accountId: row.accountId,
        name: profile?.name ?? 'Someone',
        ...(owner && profile ? { email: profile.email } : {}),
        role,
        you: row.accountId === accountId,
      };
    })
    .sort(
      (a, b) =>
        Number(b.role === 'owner') - Number(a.role === 'owner') ||
        collator.compare(a.name, b.name) ||
        (a.accountId < b.accountId ? -1 : 1),
    );
}

interface RawBoard {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  description: string | null;
  visibility: string;
  archivedAt: number | string | null;
  version: number | string;
  createdAt: number | string;
  updatedAt: number | string;
}

const BOARD_COLUMNS = `b.id AS id, b.workspace_id AS "workspaceId", b.name AS name, b.color AS color, b.description AS description,
  b.visibility AS visibility, b.archived_at AS "archivedAt", b.version AS version, b.created_at AS "createdAt", b.updated_at AS "updatedAt"`;

const toBoard = (raw: RawBoard): BoardRow => ({
  id: raw.id,
  workspaceId: raw.workspaceId,
  name: raw.name,
  color: raw.color,
  description: raw.description,
  visibility: raw.visibility === 'private' ? 'private' : 'public',
  archived: raw.archivedAt !== null,
  version: Number(raw.version),
  createdAt: Number(raw.createdAt),
  updatedAt: Number(raw.updatedAt),
});

/**
 * A board whole and light (DESIGN.md §14.7), for someone who can see it: **the statement names the asker**, so that a board that is not theirs (a private
 * one, or one of another workspace) is `undefined`, the same as one that is not there. What the asker may do is read in the same go.
 */
export async function readBoard(
  database: Database,
  accountId: string,
  boardId: string,
): Promise<BoardView | undefined> {
  const t = tablesOf(database);
  const raw = await dbGet<
    RawBoard & {
      workspaceName: string;
      canEdit: number | boolean;
      canAdmin: number | boolean;
      canJoin: number | boolean;
    }
  >(
    database,
    sql`SELECT ${sql.raw(BOARD_COLUMNS)}, w.name AS "workspaceName",
          (b.id IN ${boardsEditableBy(database, accountId)}) AS "canEdit",
          (b.id IN ${boardsAdministeredBy(database, accountId)}) AS "canAdmin",
          (b.archived_at IS NULL
            AND b.id NOT IN (SELECT board_id FROM ${t.boardMember} WHERE account_id = ${accountId})
            AND ((b.visibility = 'public' AND b.workspace_id IN ${workspacesOf(database, accountId)})
                 OR b.workspace_id IN ${workspacesOwnedBy(database, accountId)})) AS "canJoin"
        FROM ${t.board} b JOIN ${t.workspace} w ON w.id = b.workspace_id
        WHERE b.id = ${boardId} AND b.id IN ${boardsVisibleTo(database, accountId)}`,
  );
  if (!raw) return undefined;
  const lists = await dbAll<Omit<ListRow, 'cards'> & { cards: number | string }>(
    database,
    sql`SELECT l.id AS id, l.board_id AS "boardId", l.name AS name, l.position AS position,
          (SELECT COUNT(*) FROM ${t.card} c WHERE c.list_id = l.id AND c.archived_at IS NULL) AS cards
        FROM ${t.boardList} l WHERE l.board_id = ${boardId} ORDER BY l.position, l.id LIMIT ${WORKSPACE_LIMITS.listsPerBoard}`,
  );
  const cards = await dbAll<Omit<CardTile, 'hasDescription'> & { hasDescription: unknown }>(
    database,
    sql`SELECT id, board_id AS "boardId", list_id AS "listId", title, position, due_date AS "dueDate", due_time AS "dueTime",
          (description IS NOT NULL AND description <> '') AS "hasDescription"
        FROM ${t.card} WHERE board_id = ${boardId} AND archived_at IS NULL
        ORDER BY list_id, position, id LIMIT ${WORKSPACE_LIMITS.cardsPerBoard}`,
  );
  const labels = await dbAll<LabelRow>(
    database,
    sql`SELECT id, board_id AS "boardId", name, color FROM ${t.label} WHERE board_id = ${boardId}
        ORDER BY created_at, id LIMIT ${WORKSPACE_LIMITS.labelsPerBoard}`,
  );
  const carried = await dbAll<{ cardId: string; labelId: string }>(
    database,
    sql`SELECT cl.card_id AS "cardId", cl.label_id AS "labelId" FROM ${t.cardLabel} cl JOIN ${t.label} l ON l.id = cl.label_id
        WHERE cl.board_id = ${boardId} ORDER BY l.created_at, l.id`,
  );
  const byCard = new Map<string, string[]>();
  for (const row of carried)
    byCard.set(row.cardId, [...(byCard.get(row.cardId) ?? []), row.labelId]);
  const assigned = await dbAll<{ cardId: string; accountId: string }>(
    database,
    sql`SELECT card_id AS "cardId", account_id AS "accountId" FROM ${t.cardAssignee} WHERE board_id = ${boardId} ORDER BY created_at, account_id`,
  );
  const counts = await dbAll<{
    cardId: string;
    total: number | string;
    done: number | string | null;
  }>(
    database,
    sql`SELECT card_id AS "cardId", COUNT(*) AS total, SUM(CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END) AS done
        FROM ${t.checklistItem} WHERE board_id = ${boardId} GROUP BY card_id`,
  );
  const commentCounts = await dbAll<{ cardId: string; n: number | string }>(
    database,
    sql`SELECT card_id AS "cardId", COUNT(*) AS n FROM ${t.comment} WHERE board_id = ${boardId} GROUP BY card_id`,
  );
  const commentsOf = new Map(commentCounts.map((row) => [row.cardId, Number(row.n)]));
  const progressOf = new Map(
    counts.map((row) => [row.cardId, { done: Number(row.done ?? 0), total: Number(row.total) }]),
  );
  const assigneesOf = new Map<string, string[]>();
  for (const row of assigned)
    assigneesOf.set(row.cardId, [...(assigneesOf.get(row.cardId) ?? []), row.accountId]);
  const board = toBoard(raw);
  return {
    board,
    labels,
    cards: cards.map((card) => ({
      ...card,
      hasDescription: card.hasDescription === true || Number(card.hasDescription) === 1,
      labels: byCard.get(card.id) ?? [],
      assignees: assigneesOf.get(card.id) ?? [],
      checklist: progressOf.get(card.id) ?? { done: 0, total: 0 },
      comments: commentsOf.get(card.id) ?? 0,
    })),
    workspace: { id: raw.workspaceId, name: raw.workspaceName },
    lists: lists.map((list) => ({ ...list, cards: Number(list.cards) })),
    can: {
      edit: Boolean(Number(raw.canEdit)) && !board.archived,
      admin: Boolean(Number(raw.canAdmin)),
      join: Boolean(Number(raw.canJoin)),
    },
  };
}

/** A board's version, for the browser that has it open to ask every twenty seconds (DESIGN.md §14.7). The same answer for a board that is not theirs. */
export async function boardVersion(
  database: Database,
  accountId: string,
  boardId: string,
): Promise<number | undefined> {
  const raw = await dbGet<{ version: number | string }>(
    database,
    sql`SELECT version FROM ${tablesOf(database).board}
        WHERE id = ${boardId} AND id IN ${boardsVisibleTo(database, accountId)}`,
  );
  return raw ? Number(raw.version) : undefined;
}

/** The boards of a workspace that the asker can see (a private one only for its members and the workspace's owners), by name; `undefined` unless they are in it. */
export async function boardsOfWorkspace(
  database: Database,
  accountId: string,
  workspaceId: string,
): Promise<BoardRow[] | undefined> {
  const t = tablesOf(database);
  if (!(await workspaceOf(database, accountId, workspaceId))) return undefined;
  const rows = await dbAll<RawBoard>(
    database,
    sql`SELECT ${sql.raw(BOARD_COLUMNS)} FROM ${t.board} b
        WHERE b.workspace_id = ${workspaceId} AND b.id IN ${boardsVisibleTo(database, accountId)}
        ORDER BY b.name, b.id LIMIT ${WORKSPACE_LIMITS.boardsPerWorkspace}`,
  );
  return rows.map(toBoard);
}

const toSort = (value: unknown): WorkspaceSort =>
  (WORKSPACE_SORTS as readonly unknown[]).includes(value) ? (value as WorkspaceSort) : 'name';

/**
 * The boards index (DESIGN.md §17.3): for every workspace the asker is in, the boards they can see and a few of its people, and the sort they chose.
 * **Light, and one statement for each kind of thing** (boards, a few people each, how many people, the sort), whatever the number of workspaces; every one
 * names the asker, so that nothing of a workspace that is not theirs, nor a private board that is not, can be in it.
 */
export async function boardsIndex(
  database: Database,
  directory: Pick<Directory, 'profiles'>,
  accountId: string,
): Promise<BoardsIndex> {
  const t = tablesOf(database);
  const mine = workspacesOf(database, accountId);
  const [setting, boards, people, counts] = await Promise.all([
    dbGet<{ sort: string }>(
      database,
      sql`SELECT workspace_sort AS sort FROM ${database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings} WHERE account_id = ${accountId}`,
    ),
    dbAll<RawBoard>(
      database,
      sql`SELECT ${sql.raw(BOARD_COLUMNS)} FROM ${t.board} b
          WHERE b.workspace_id IN ${mine} AND b.id IN ${boardsVisibleTo(database, accountId)}
          ORDER BY b.name, b.id`,
    ),
    dbAll<{ workspaceId: string; accountId: string }>(
      database,
      sql`SELECT x.workspace_id AS "workspaceId", x.account_id AS "accountId" FROM (
            SELECT m.workspace_id, m.account_id, ROW_NUMBER() OVER (
              PARTITION BY m.workspace_id
              ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, m.created_at, m.account_id
            ) AS rn
            FROM ${t.workspaceMember} m WHERE m.workspace_id IN ${mine}
          ) x WHERE x.rn <= ${INDEX_AVATARS} ORDER BY x.workspace_id, x.rn`,
    ),
    dbAll<{ workspaceId: string; n: number | string }>(
      database,
      sql`SELECT workspace_id AS "workspaceId", COUNT(*) AS n FROM ${t.workspaceMember}
          WHERE workspace_id IN ${mine} GROUP BY workspace_id`,
    ),
  ]);
  const profiles = await directory.profiles(people.map((row) => row.accountId));
  const workspaces = new Map<
    string,
    { boards: BoardRow[]; people: IndexWorkspace['people'][number][]; count: number }
  >();
  const entry = (id: string) => {
    let found = workspaces.get(id);
    if (!found) workspaces.set(id, (found = { boards: [], people: [], count: 0 }));
    return found;
  };
  for (const row of counts) entry(row.workspaceId).count = Number(row.n);
  for (const row of boards) entry(row.workspaceId).boards.push(toBoard(row));
  for (const row of people)
    entry(row.workspaceId).people.push({
      accountId: row.accountId,
      name: profiles.get(row.accountId)?.name ?? 'Someone',
    });
  return {
    sort: toSort(setting?.sort),
    workspaces: [...workspaces].map(([id, found]) => ({
      id,
      boards: found.boards,
      people: found.people,
      peopleCount: found.count,
    })),
  };
}

/** A board's archived cards, newest archived first, for someone who can see the board (DESIGN.md §15.8); `undefined` for a board that is not theirs. */
export async function archivedCards(
  database: Database,
  accountId: string,
  boardId: string,
): Promise<ArchivedCard[] | undefined> {
  const t = tablesOf(database);
  if (!(await boardVersion(database, accountId, boardId))) return undefined;
  const rows = await dbAll<{
    id: string;
    listId: string;
    title: string;
    archivedAt: number | string;
  }>(
    database,
    sql`SELECT id, list_id AS "listId", title, archived_at AS "archivedAt" FROM ${t.card}
        WHERE board_id = ${boardId} AND board_id IN ${boardsVisibleTo(database, accountId)} AND archived_at IS NOT NULL
        ORDER BY archived_at DESC, id LIMIT ${WORKSPACE_LIMITS.cardsPerBoard}`,
  );
  return rows.map((row) => ({ ...row, archivedAt: Number(row.archivedAt) }));
}

/**
 * A card whole, for its dialog (DESIGN.md §17.6), for someone who can see its board: **the statement names the asker**, so a card on a board that is not
 * theirs is `undefined`, the same as one that is not there. An archived card is read too, since a link to it may be followed.
 */
export async function cardDetail(
  database: Database,
  accountId: string,
  cardId: string,
): Promise<CardDetail | undefined> {
  const t = tablesOf(database);
  const row = await dbGet<{
    id: string;
    boardId: string;
    listId: string;
    listName: string;
    title: string;
    position: string;
    description: string | null;
    dueDate: string | null;
    dueTime: string | null;
    archivedAt: number | string | null;
    createdAt: number | string;
    updatedAt: number | string;
  }>(
    database,
    sql`SELECT c.id AS id, c.board_id AS "boardId", c.list_id AS "listId", l.name AS "listName", c.title AS title, c.position AS position,
          c.description AS description, c.due_date AS "dueDate", c.due_time AS "dueTime", c.archived_at AS "archivedAt",
          c.created_at AS "createdAt", c.updated_at AS "updatedAt"
        FROM ${t.card} c JOIN ${t.boardList} l ON l.id = c.list_id
        WHERE c.id = ${cardId} AND c.board_id IN ${boardsVisibleTo(database, accountId)}`,
  );
  if (!row) return undefined;
  const carried = await dbAll<{ id: string }>(
    database,
    sql`SELECT cl.label_id AS id FROM ${t.cardLabel} cl JOIN ${t.label} l ON l.id = cl.label_id
        WHERE cl.card_id = ${cardId} ORDER BY l.created_at, l.id`,
  );
  const assignedTo = await dbAll<{ id: string }>(
    database,
    sql`SELECT account_id AS id FROM ${t.cardAssignee} WHERE card_id = ${cardId} ORDER BY created_at, account_id`,
  );
  const itemRows = await dbAll<{
    id: string;
    cardId: string;
    title: string;
    completedAt: number | string | null;
    position: string;
  }>(
    database,
    sql`SELECT id, card_id AS "cardId", title, completed_at AS "completedAt", position FROM ${t.checklistItem}
        WHERE card_id = ${cardId} ORDER BY position, id LIMIT ${WORKSPACE_LIMITS.itemsPerCard}`,
  );
  const items: ChecklistItem[] = itemRows.map((each) => ({
    id: each.id,
    cardId: each.cardId,
    title: each.title,
    done: each.completedAt !== null,
    position: each.position,
  }));
  return {
    id: row.id,
    items,
    checklist: { done: items.filter((each) => each.done).length, total: items.length },
    comments: Number(
      (
        await dbGet<{ n: number | string }>(
          database,
          sql`SELECT COUNT(*) AS n FROM ${t.comment} WHERE card_id = ${cardId}`,
        )
      )?.n ?? 0,
    ),
    labels: carried.map((each) => each.id),
    assignees: assignedTo.map((each) => each.id),
    boardId: row.boardId,
    listId: row.listId,
    listName: row.listName,
    title: row.title,
    position: row.position,
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    hasDescription: row.description !== null && row.description !== '',
    description: row.description,
    archived: row.archivedAt !== null,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

/**
 * A board's row as the database now has it, **without asking who is looking**: for a transaction that has already carried the permission in its own
 * statement and wants to answer with the row. Not for a route.
 */
export async function boardRowOf(
  database: Database,
  boardId: string,
): Promise<BoardRow | undefined> {
  const raw = await dbGet<RawBoard>(
    database,
    sql`SELECT ${sql.raw(BOARD_COLUMNS)} FROM ${tablesOf(database).board} b WHERE b.id = ${boardId}`,
  );
  return raw ? toBoard(raw) : undefined;
}

/**
 * A board's people (DESIGN.md §14.3), for someone who can see the board: its members, owners first, and, for an administrator, the workspace's people who
 * are not on it yet, for the picker. **The statement names the asker.** A name is read from the account when it is shown and never kept; the address is
 * shown to an administrator only. `undefined` for a board that is not theirs.
 */
export async function boardPeople(
  database: Database,
  directory: Pick<Directory, 'profiles'>,
  accountId: string,
  boardId: string,
): Promise<BoardPeople | undefined> {
  const t = tablesOf(database);
  const board = await dbGet<{ admin: number | boolean }>(
    database,
    sql`SELECT (b.id IN ${boardsAdministeredBy(database, accountId)}) AS admin FROM ${t.board} b
        WHERE b.id = ${boardId} AND b.id IN ${boardsVisibleTo(database, accountId)}`,
  );
  if (!board) return undefined;
  const admin = Boolean(Number(board.admin));
  const members = await dbAll<{ accountId: string; role: string }>(
    database,
    sql`SELECT account_id AS "accountId", role FROM ${t.boardMember} WHERE board_id = ${boardId} ORDER BY created_at, account_id`,
  );
  const candidates = admin
    ? await dbAll<{ accountId: string }>(
        database,
        sql`SELECT wm.account_id AS "accountId" FROM ${t.workspaceMember} wm JOIN ${t.board} b ON b.workspace_id = wm.workspace_id
            WHERE b.id = ${boardId}
              AND wm.account_id NOT IN (SELECT account_id FROM ${t.boardMember} WHERE board_id = ${boardId})
            ORDER BY wm.created_at, wm.account_id LIMIT ${WORKSPACE_LIMITS.membersPerWorkspace}`,
      )
    : [];
  const profiles = await directory.profiles(
    [...members, ...candidates].map((row) => row.accountId),
  );
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const named = (id: string) => profiles.get(id)?.name ?? 'Someone';
  const people = members
    .map((row): BoardPerson => {
      const profile = profiles.get(row.accountId);
      return {
        accountId: row.accountId,
        name: named(row.accountId),
        ...(admin && profile ? { email: profile.email } : {}),
        role: row.role === 'owner' ? 'owner' : 'member',
        you: row.accountId === accountId,
      };
    })
    .sort(
      (a, b) =>
        Number(b.role === 'owner') - Number(a.role === 'owner') ||
        collator.compare(a.name, b.name) ||
        (a.accountId < b.accountId ? -1 : 1),
    );
  return {
    members: people,
    candidates: candidates
      .map((row) => ({ accountId: row.accountId, name: named(row.accountId) }))
      .sort((a, b) => collator.compare(a.name, b.name) || (a.accountId < b.accountId ? -1 : 1)),
  };
}

/**
 * A page of a card's comments, newest first (DESIGN.md §15.5), for someone who can see its board: **the statement names the asker**, so a card that is
 * not theirs is `undefined`. `before` is the last comment of the page before this one, as its time and id, so that a page never skips or repeats one
 * when comments are added in between. The author's name is read from the account when it is shown. What the asker may do to each comment is worked out here.
 */
export async function commentsOf(
  database: Database,
  directory: Pick<Directory, 'profiles'>,
  accountId: string,
  cardId: string,
  before?: { createdAt: number; id: string },
): Promise<CommentPage | undefined> {
  const t = tablesOf(database);
  const card = await dbGet<{ editable: number | boolean; owned: number | boolean }>(
    database,
    sql`SELECT (c.board_id IN ${boardsEditableBy(database, accountId)}) AS editable,
               (c.board_id IN ${boardsOwnedBy(database, accountId)}) AS owned
        FROM ${t.card} c WHERE c.id = ${cardId} AND c.board_id IN ${boardsVisibleTo(database, accountId)}`,
  );
  if (!card) return undefined;
  const editable = Boolean(Number(card.editable));
  const owned = Boolean(Number(card.owned));
  const page = WORKSPACE_LIMITS.commentsPage;
  const rows = await dbAll<{
    id: string;
    authorId: string;
    body: string;
    createdAt: number | string;
    editedAt: number | string | null;
  }>(
    database,
    sql`SELECT id, author_id AS "authorId", body, created_at AS "createdAt", edited_at AS "editedAt" FROM ${t.comment}
        WHERE card_id = ${cardId}
          ${before ? sql`AND (created_at < ${before.createdAt} OR (created_at = ${before.createdAt} AND id < ${before.id}))` : sql``}
        ORDER BY created_at DESC, id DESC LIMIT ${page + 1}`,
  );
  const profiles = await directory.profiles(rows.map((row) => row.authorId));
  const comments: CommentRow[] = rows.slice(0, page).map((row) => ({
    id: row.id,
    cardId,
    authorId: row.authorId,
    authorName: profiles.get(row.authorId)?.name ?? 'Someone',
    body: row.body,
    createdAt: Number(row.createdAt),
    editedAt: row.editedAt === null ? null : Number(row.editedAt),
    canEdit: editable && row.authorId === accountId,
    canDelete: editable && (row.authorId === accountId || owned),
  }));
  return { comments, more: rows.length > page };
}
