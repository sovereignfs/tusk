import { sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { dbAll, dbRun } from '../../db/exec';
import { boardsAdministeredBy, boardsEditableBy, boardsVisibleTo } from '../can';
import { tablesOf } from '../tables';

/**
 * The world the role matrix runs in (DESIGN.md §24 Testing): one workspace with six people in six roles, and three boards that show every way a board can
 * be reached. It is written straight into the tables, as the operations that make these rows will (17.1, 17.3), so that the permission of an operation
 * is tested against rows it did not make.
 *
 *   owner, coOwner   owners of the workspace (§7.2: it can have several)
 *   boardOwner       a member of the workspace, and the owner of the public board
 *   boardMember      a member of the workspace, and a member of the public board and the private one
 *   member           a member of the workspace on no board: a viewer of the public ones
 *   outsider         in no workspace at all
 *
 *   publicBoard      everyone in the workspace sees it; boardOwner owns it, boardMember is on it
 *   privateBoard     boardMember only, and the workspace's owners
 *   archivedBoard    public, boardOwner's, archived: read-only for everyone
 */
export const ROLES = [
  'owner',
  'coOwner',
  'boardOwner',
  'boardMember',
  'member',
  'outsider',
] as const;
export type Role = (typeof ROLES)[number];

export interface World {
  accounts: Record<Role, string>;
  workspace: string;
  boards: { publicBoard: string; privateBoard: string; archivedBoard: string };
}

const uuid = () => crypto.randomUUID();

export async function seedWorld(database: Database): Promise<World> {
  const t = tablesOf(database);
  const accounts = Object.fromEntries(ROLES.map((role) => [role, uuid()])) as Record<Role, string>;
  const workspace = uuid();
  const boards = { publicBoard: uuid(), privateBoard: uuid(), archivedBoard: uuid() };
  const now = 1_800_000_000_000;

  await dbRun(
    database,
    sql`INSERT INTO ${t.workspace} (id, name, created_by, created_at, updated_at) VALUES (${workspace}, 'Acme', ${accounts.owner}, ${now}, ${now})`,
  );
  const people: [Role, 'owner' | 'member'][] = [
    ['owner', 'owner'],
    ['coOwner', 'owner'],
    ['boardOwner', 'member'],
    ['boardMember', 'member'],
    ['member', 'member'],
  ];
  for (const [role, kind] of people) {
    await dbRun(
      database,
      sql`INSERT INTO ${t.workspaceMember} (workspace_id, account_id, role, added_by, created_at) VALUES (${workspace}, ${accounts[role]}, ${kind}, ${accounts.owner}, ${now})`,
    );
  }
  const board = (
    id: string,
    name: string,
    visibility: 'public' | 'private',
    archivedAt: number | null,
  ) =>
    dbRun(
      database,
      sql`INSERT INTO ${t.board} (id, workspace_id, name, color, visibility, archived_at, version, created_by, created_at, updated_at)
          VALUES (${id}, ${workspace}, ${name}, '#2563eb', ${visibility}, ${archivedAt}, 1, ${accounts.boardOwner}, ${now}, ${now})`,
    );
  await board(boards.publicBoard, 'Roadmap', 'public', null);
  await board(boards.privateBoard, 'Hiring', 'private', null);
  await board(boards.archivedBoard, 'Last year', 'public', now);
  const member = (boardId: string, role: Role, kind: 'owner' | 'member') =>
    dbRun(
      database,
      sql`INSERT INTO ${t.boardMember} (board_id, account_id, workspace_id, role, created_at) VALUES (${boardId}, ${accounts[role]}, ${workspace}, ${kind}, ${now})`,
    );
  await member(boards.publicBoard, 'boardOwner', 'owner');
  await member(boards.publicBoard, 'boardMember', 'member');
  await member(boards.privateBoard, 'boardMember', 'member');
  await member(boards.archivedBoard, 'boardOwner', 'owner');
  return { accounts, workspace, boards };
}

/** The ids of the boards a permission reaches for an account, from the subquery itself. */
export async function reachable(
  database: Database,
  permission: typeof boardsVisibleTo | typeof boardsEditableBy | typeof boardsAdministeredBy,
  accountId: string,
): Promise<string[]> {
  const rows = await dbAll<{ id: string }>(
    database,
    sql`SELECT id FROM ${tablesOf(database).board} WHERE id IN ${permission(database, accountId)} ORDER BY id`,
  );
  return rows.map((row) => row.id);
}
