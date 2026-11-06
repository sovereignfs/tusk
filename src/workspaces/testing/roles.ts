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
 *
 * Each board has one list, `Backlog`, so that the operations on a list have one to be done to.
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
  /** One list on each board, so that the operations on a list have one to be done to. */
  lists: { publicBoard: string; privateBoard: string; archivedBoard: string };
  /** Two cards in the public board's list, so that the operations on a card have one to be done to: one open, one archived. */
  cards: { open: string; archived: string };
  /** A label on the public board, and one on the private board, to show that a label of another board is refused. */
  labels: { publicBoard: string; privateBoard: string };
}

const uuid = () => crypto.randomUUID();

export async function seedWorld(database: Database): Promise<World> {
  const t = tablesOf(database);
  const accounts = Object.fromEntries(ROLES.map((role) => [role, uuid()])) as Record<Role, string>;
  const workspace = uuid();
  const boards = { publicBoard: uuid(), privateBoard: uuid(), archivedBoard: uuid() };
  const lists = { publicBoard: uuid(), privateBoard: uuid(), archivedBoard: uuid() };
  const cards = { open: uuid(), archived: uuid() };
  const labels = { publicBoard: uuid(), privateBoard: uuid() };
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
  for (const key of ['publicBoard', 'privateBoard', 'archivedBoard'] as const)
    await dbRun(
      database,
      sql`INSERT INTO ${t.boardList} (id, board_id, name, position, created_at, updated_at) VALUES (${lists[key]}, ${boards[key]}, 'Backlog', 'a0', ${now}, ${now})`,
    );
  await dbRun(
    database,
    sql`INSERT INTO ${t.card} (id, board_id, list_id, title, position, archived_at, created_by, created_at, updated_at)
        VALUES (${cards.open}, ${boards.publicBoard}, ${lists.publicBoard}, 'Open one', 'a0', NULL, ${accounts.boardOwner}, ${now}, ${now})`,
  );
  await dbRun(
    database,
    sql`INSERT INTO ${t.card} (id, board_id, list_id, title, position, archived_at, created_by, created_at, updated_at)
        VALUES (${cards.archived}, ${boards.publicBoard}, ${lists.publicBoard}, 'Old one', 'a1', ${now}, ${accounts.boardOwner}, ${now}, ${now})`,
  );
  for (const key of ['publicBoard', 'privateBoard'] as const)
    await dbRun(
      database,
      sql`INSERT INTO ${t.label} (id, board_id, name, color, created_at) VALUES (${labels[key]}, ${boards[key]}, ${key === 'publicBoard' ? 'Urgent' : 'Secret'}, '#dc2626', ${now})`,
    );
  return { accounts, workspace, boards, lists, cards, labels };
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

/** One row of every table below a board, on the public board (its list is the world's), and a notice about the workspace: what deleting a workspace must leave nothing of. */
export async function seedBoardContents(database: Database, world: World): Promise<void> {
  const t = tablesOf(database);
  const board = world.boards.publicBoard;
  const list = world.lists.publicBoard;
  const card = uuid();
  const label = uuid();
  const now = 1_800_000_000_000;
  const who = world.accounts.boardOwner;
  const run = (query: ReturnType<typeof sql>) => dbRun(database, query);
  await run(
    sql`INSERT INTO ${t.card} (id, board_id, list_id, title, position, created_by, created_at, updated_at) VALUES (${card}, ${board}, ${list}, 'First', 'a0', ${who}, ${now}, ${now})`,
  );
  await run(
    sql`INSERT INTO ${t.label} (id, board_id, name, color, created_at) VALUES (${label}, ${board}, 'Bug', '#dc2626', ${now})`,
  );
  await run(
    sql`INSERT INTO ${t.cardLabel} (card_id, label_id, board_id) VALUES (${card}, ${label}, ${board})`,
  );
  await run(
    sql`INSERT INTO ${t.cardAssignee} (card_id, account_id, board_id, assigned_by, created_at) VALUES (${card}, ${who}, ${board}, ${who}, ${now})`,
  );
  await run(
    sql`INSERT INTO ${t.checklistItem} (id, card_id, board_id, title, position, created_at) VALUES (${uuid()}, ${card}, ${board}, 'Step', 'a0', ${now})`,
  );
  await run(
    sql`INSERT INTO ${t.comment} (id, card_id, board_id, author_id, body, created_at) VALUES (${uuid()}, ${card}, ${board}, ${who}, 'Hello', ${now})`,
  );
  await run(
    sql`INSERT INTO ${t.activity} (id, board_id, card_id, actor_id, kind, details, created_at) VALUES (${uuid()}, ${board}, ${card}, ${who}, 'card.created', '{}', ${now})`,
  );
  await run(
    sql`INSERT INTO ${t.publication} (board_id, token, created_by, created_at) VALUES (${board}, ${uuid()}, ${who}, ${now})`,
  );
  await run(
    sql`INSERT INTO ${t.notice} (id, account_id, kind, actor_id, workspace_id, board_id, details, created_at) VALUES (${uuid()}, ${world.accounts.member}, 'added_to_workspace', ${who}, ${world.workspace}, ${board}, '{}', ${now})`,
  );
}

/** How many rows there are in every workspace table, by table, for comparing before and after. */
export async function countAll(database: Database): Promise<Record<string, number>> {
  const t = tablesOf(database);
  const names = {
    workspace: t.workspace,
    workspace_member: t.workspaceMember,
    board: t.board,
    board_member: t.boardMember,
    board_list: t.boardList,
    card: t.card,
    label: t.label,
    card_label: t.cardLabel,
    card_assignee: t.cardAssignee,
    checklist_item: t.checklistItem,
    comment: t.comment,
    activity: t.activity,
    publication: t.publication,
    notice: t.notice,
  };
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries(names)) {
    const row = await dbAll<{ n: number | string }>(
      database,
      sql`SELECT COUNT(*) AS n FROM ${table}`,
    );
    out[name] = Number(row[0]?.n ?? 0);
  }
  return out;
}
