import { sql } from 'drizzle-orm';
import type { Directory } from '../auth/directory';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import type { BoardPart, WorkspacePart } from '../portability/format';
import { write } from './activity';
import { WORKSPACE_LIMITS } from './format';
import { tablesOf } from './tables';
import { workspacesOf } from './can';

/**
 * Importing boards and workspaces (DESIGN.md §20.2), on the server, **in one transaction**: a file that fails, at any row, changes nothing. **It creates:**
 * every row has a new id and nothing is replaced or merged, so importing twice makes two copies. **Comments and activity are not written**: they stay in
 * the file as a record, and a new board's history starts with one row saying it was imported. **People are matched by address** to accounts here: someone
 * who is a member of the destination workspace is assigned and put on the board (as a member), and **anyone else is dropped and counted**; importing a
 * workspace adds no one to it. An archived card stays archived; the board is made open, since a board made by an import is not one that was put away.
 *
 * What the caller must have done before: read the file with `validateFile`, which the server does again, since it takes nothing from a browser on trust.
 */
export type ImportRefusal = 'not_found' | 'limit';

export interface Imported {
  readonly workspaces: number;
  readonly boards: number;
  readonly cards: number;
  /** The people the file named as assigned that were not members of the destination, by distinct address. */
  readonly peopleDropped: number;
  /** The assignments dropped for it. */
  readonly assignmentsDropped: number;
}

class Refused extends Error {
  constructor(readonly code: ImportRefusal) {
    super(`refused: ${code}`);
  }
}

type Directory_ = Pick<Directory, 'idOfEmail'>;

/** The account for each address the boards assign, if an account here has it: asked outside the transaction, since the auth store may be another database. */
async function accountsFor(
  directory: Directory_,
  boards: readonly BoardPart[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const emails = new Set<string>();
  for (const board of boards)
    for (const list of board.lists)
      for (const card of list.cards)
        for (const person of card.assignees)
          if (person.email !== '') emails.add(person.email.toLowerCase());
  for (const email of emails) {
    const id = await directory.idOfEmail(email);
    if (id) found.set(email, id);
  }
  return found;
}

interface Counts {
  boards: number;
  cards: number;
  dropped: Set<string>;
  droppedAssignments: number;
}

/** One board into a workspace the asker is in, inside a transaction. */
async function insertBoard(
  tx: Database,
  accountId: string,
  workspaceId: string,
  board: BoardPart,
  accounts: ReadonlyMap<string, string>,
  members: ReadonlySet<string>,
  now: number,
  counts: Counts,
): Promise<void> {
  const t = tablesOf(tx);
  const boardId = crypto.randomUUID();
  const run = (query: ReturnType<typeof sql>) => dbAll(tx, query);
  await run(
    sql`INSERT INTO ${t.board} (id, workspace_id, name, color, description, visibility, archived_at, version, created_by, created_at, updated_at)
        VALUES (${boardId}, ${workspaceId}, ${board.name}, ${board.color}, ${board.description}, ${board.visibility}, NULL, 1, ${accountId}, ${now}, ${now}) RETURNING id`,
  );
  await run(
    sql`INSERT INTO ${t.boardMember} (board_id, account_id, workspace_id, role, created_at) VALUES (${boardId}, ${accountId}, ${workspaceId}, 'owner', ${now}) RETURNING account_id`,
  );

  const labelIds = new Map<string, string>();
  for (const label of board.labels) {
    const id = crypto.randomUUID();
    labelIds.set(label.id, id);
    await run(
      sql`INSERT INTO ${t.label} (id, board_id, name, color, created_at) VALUES (${id}, ${boardId}, ${label.name}, ${label.color}, ${now}) RETURNING id`,
    );
  }
  const onBoard = new Set<string>([accountId]);
  for (const list of board.lists) {
    const listId = crypto.randomUUID();
    await run(
      sql`INSERT INTO ${t.boardList} (id, board_id, name, position, created_at, updated_at) VALUES (${listId}, ${boardId}, ${list.name}, ${list.position}, ${now}, ${now}) RETURNING id`,
    );
    for (const card of list.cards) {
      const cardId = crypto.randomUUID();
      counts.cards += 1;
      await run(
        sql`INSERT INTO ${t.card} (id, board_id, list_id, title, description, due_date, due_time, position, archived_at, created_by, created_at, updated_at)
            VALUES (${cardId}, ${boardId}, ${listId}, ${card.title}, ${card.description === '' ? null : card.description}, ${card.dueDate}, ${card.dueTime}, ${card.position},
                    ${card.archived ? now : null}, ${accountId}, ${now}, ${now}) RETURNING id`,
      );
      for (const label of card.labels) {
        const id = labelIds.get(label);
        if (id)
          await run(
            sql`INSERT INTO ${t.cardLabel} (card_id, label_id, board_id) VALUES (${cardId}, ${id}, ${boardId}) RETURNING card_id`,
          );
      }
      for (const item of card.checklist)
        await run(
          sql`INSERT INTO ${t.checklistItem} (id, card_id, board_id, title, completed_at, position, created_at)
              VALUES (${crypto.randomUUID()}, ${cardId}, ${boardId}, ${item.title}, ${item.completedAt}, ${item.position}, ${now}) RETURNING id`,
        );
      const assigned = new Set<string>();
      for (const person of card.assignees) {
        const email = person.email.toLowerCase();
        const account = accounts.get(email);
        if (!account || !members.has(account)) {
          if (email !== '') counts.dropped.add(email);
          counts.droppedAssignments += 1;
          continue;
        }
        if (assigned.has(account)) continue;
        assigned.add(account);
        if (!onBoard.has(account)) {
          onBoard.add(account);
          await run(
            sql`INSERT INTO ${t.boardMember} (board_id, account_id, workspace_id, role, created_at) VALUES (${boardId}, ${account}, ${workspaceId}, 'member', ${now}) RETURNING account_id`,
          );
        }
        await run(
          sql`INSERT INTO ${t.cardAssignee} (card_id, account_id, board_id, assigned_by, created_at) VALUES (${cardId}, ${account}, ${boardId}, ${accountId}, ${now}) RETURNING card_id`,
        );
      }
    }
  }
  await write(tx, accountId, boardId, null, 'board.imported', {}, now);
  counts.boards += 1;
}

async function membersOf(tx: Database, workspaceId: string): Promise<Set<string>> {
  const rows = await dbAll<{ accountId: string }>(
    tx,
    sql`SELECT account_id AS "accountId" FROM ${tablesOf(tx).workspaceMember} WHERE workspace_id = ${workspaceId}`,
  );
  return new Set(rows.map((row) => row.accountId));
}

async function boardsIn(tx: Database, workspaceId: string): Promise<number> {
  const row = await dbGet<{ n: number | string }>(
    tx,
    sql`SELECT COUNT(*) AS n FROM ${tablesOf(tx).board} WHERE workspace_id = ${workspaceId}`,
  );
  return Number(row?.n ?? 0);
}

/** A board, created in a workspace the asker is in. */
export async function importBoard(
  database: Database,
  directory: Directory_,
  accountId: string,
  workspaceId: string,
  board: BoardPart,
  now: number,
): Promise<{ ok: true; imported: Imported } | { ok: false; reason: ImportRefusal }> {
  const accounts = await accountsFor(directory, [board]);
  const counts: Counts = { boards: 0, cards: 0, dropped: new Set(), droppedAssignments: 0 };
  try {
    await transaction(database, async (tx) => {
      // The workspace is held, with the permission in the statement, as the operation that makes a board holds it: a workspace that is not theirs is not there.
      const held = await dbAll<{ id: string }>(
        tx,
        sql`UPDATE ${tablesOf(tx).workspace} SET updated_at = ${now} WHERE id = ${workspaceId} AND id IN ${workspacesOf(tx, accountId)} RETURNING id`,
      );
      if (held.length === 0) throw new Refused('not_found');
      if ((await boardsIn(tx, workspaceId)) >= WORKSPACE_LIMITS.boardsPerWorkspace)
        throw new Refused('limit');
      await insertBoard(
        tx,
        accountId,
        workspaceId,
        board,
        accounts,
        await membersOf(tx, workspaceId),
        now,
        counts,
      );
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.code };
    throw error;
  }
  return {
    ok: true,
    imported: {
      workspaces: 0,
      boards: counts.boards,
      cards: counts.cards,
      peopleDropped: counts.dropped.size,
      assignmentsDropped: counts.droppedAssignments,
    },
  };
}

/** Workspaces, each created with the asker as its owner and its boards in it. People are not added to them. */
export async function importWorkspaces(
  database: Database,
  directory: Directory_,
  accountId: string,
  workspaces: readonly WorkspacePart[],
  now: number,
): Promise<{ ok: true; imported: Imported } | { ok: false; reason: ImportRefusal }> {
  const accounts = await accountsFor(
    directory,
    workspaces.flatMap((w) => w.boards),
  );
  const counts: Counts = { boards: 0, cards: 0, dropped: new Set(), droppedAssignments: 0 };
  try {
    await transaction(database, async (tx) => {
      const t = tablesOf(tx);
      const made = await dbGet<{ n: number | string }>(
        tx,
        sql`SELECT COUNT(*) AS n FROM ${t.workspace} WHERE created_by = ${accountId}`,
      );
      if (Number(made?.n ?? 0) + workspaces.length > WORKSPACE_LIMITS.workspacesPerAccount)
        throw new Refused('limit');
      for (const workspace of workspaces) {
        const id = crypto.randomUUID();
        await dbAll(
          tx,
          sql`INSERT INTO ${t.workspace} (id, name, created_by, created_at, updated_at) VALUES (${id}, ${workspace.name}, ${accountId}, ${now}, ${now}) RETURNING id`,
        );
        await dbAll(
          tx,
          sql`INSERT INTO ${t.workspaceMember} (workspace_id, account_id, role, added_by, created_at) VALUES (${id}, ${accountId}, 'owner', ${accountId}, ${now}) RETURNING account_id`,
        );
        const members = new Set<string>([accountId]);
        for (const board of workspace.boards)
          await insertBoard(tx, accountId, id, board, accounts, members, now, counts);
      }
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.code };
    throw error;
  }
  return {
    ok: true,
    imported: {
      workspaces: workspaces.length,
      boards: counts.boards,
      cards: counts.cards,
      peopleDropped: counts.dropped.size,
      assignmentsDropped: counts.droppedAssignments,
    },
  };
}
