import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import type { Directory } from '../auth/directory';
import { boardsEditableBy, boardsAdministeredBy, boardsVisibleTo, workspacesOf } from './can';
import {
  type BoardRow,
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
    RawBoard & { workspaceName: string; canEdit: number | boolean; canAdmin: number | boolean }
  >(
    database,
    sql`SELECT ${sql.raw(BOARD_COLUMNS)}, w.name AS "workspaceName",
          (b.id IN ${boardsEditableBy(database, accountId)}) AS "canEdit",
          (b.id IN ${boardsAdministeredBy(database, accountId)}) AS "canAdmin"
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
  const board = toBoard(raw);
  return {
    board,
    workspace: { id: raw.workspaceId, name: raw.workspaceName },
    lists: lists.map((list) => ({ ...list, cards: Number(list.cards) })),
    can: {
      edit: Boolean(Number(raw.canEdit)) && !board.archived,
      admin: Boolean(Number(raw.canAdmin)),
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
