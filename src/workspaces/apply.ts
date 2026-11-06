import { type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import type { Directory } from '../auth/directory';
import { first } from '../position';
import {
  boardsAdministeredBy,
  boardsEditableBy,
  boardsVisibleTo,
  workspacesOf,
  workspacesOwnedBy,
} from './can';
import { boardRowOf } from './reads';
import {
  type OpReason,
  type OpRefusal,
  type OpRequest,
  type OpResult,
  type CardTile,
  type ListRow,
  type Role,
  WORKSPACE_LIMITS,
} from './format';
import { tablesOf } from './tables';

/**
 * Applying an operation (DESIGN.md §7.3): **one short transaction** in which the server records the `opId`, does the work with the permission in the
 * statement, and writes whatever else the change owes (activity and notices, which later operations add). All of it or none of it: a refusal rolls
 * everything back, the record of the `opId` included.
 *
 * The answer to a refusal is the same whether the thing does not exist or is not the caller's (`not_found`), so it cannot be used to find out which.
 */
export interface ApplyOptions {
  /** The time, in milliseconds: given and not read, so that a test controls it. */
  now: number;
  /**
   * Who has an address. Needed by `member.add` only, and **asked before the transaction**, since the accounts may be in a store of their own and a
   * transaction does not call out of its database (§7.3).
   */
  directory?: Pick<Directory, 'idOfEmail'>;
}

class Refused extends Error {
  constructor(
    readonly code: OpRefusal,
    readonly reason?: OpReason,
  ) {
    super(`refused: ${code}`);
  }
}

const applied = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.appliedMutation : sqliteApp.appliedMutation;

export async function applyOp(
  database: Database,
  accountId: string,
  request: OpRequest,
  options: ApplyOptions,
): Promise<OpResult> {
  let target: string | undefined;
  if (request.op === 'member.add') {
    if (!options.directory) throw new Error('member.add needs a directory of accounts');
    target = await options.directory.idOfEmail(request.email);
  }
  try {
    return await transaction(database, async (tx) => {
      // The record first: an `opId` already used is a repeat, answered as applied and done no more. An id another account used is not an answer to this one,
      // since the record is by account.
      const fresh = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${applied(tx)} (account_id, id, seq, applied_at) VALUES (${accountId}, ${request.opId}, 0, ${options.now})
            ON CONFLICT (account_id, id) DO NOTHING RETURNING id`,
      );
      if (fresh.length === 0) return { status: 'applied', replay: true, rows: {} } as const;

      const rows = await run(tx, accountId, request, options.now, target);
      return { status: 'applied', replay: false, rows } as const;
    });
  } catch (error) {
    if (error instanceof Refused)
      return error.reason
        ? { status: 'refused', code: error.code, reason: error.reason }
        : { status: 'refused', code: error.code };
    throw error;
  }
}

async function run(
  tx: Database,
  accountId: string,
  request: OpRequest,
  now: number,
  target: string | undefined,
) {
  const t = tablesOf(tx);
  switch (request.op) {
    case 'workspace.create': {
      const count = await dbGet<{ n: number | string }>(
        tx,
        sql`SELECT COUNT(*) AS n FROM ${t.workspace} WHERE created_by = ${accountId}`,
      );
      if (Number(count?.n ?? 0) >= WORKSPACE_LIMITS.workspacesPerAccount)
        throw new Refused('limit');
      // An id that another account already uses is a conflict, and writes nothing: the answer is the one for a workspace that is not theirs.
      const made = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${t.workspace} (id, name, created_by, created_at, updated_at)
            VALUES (${request.id}, ${request.name}, ${accountId}, ${now}, ${now})
            ON CONFLICT (id) DO NOTHING RETURNING id`,
      );
      if (made.length === 0) throw new Refused('not_found');
      await dbAll(
        tx,
        sql`INSERT INTO ${t.workspaceMember} (workspace_id, account_id, role, added_by, created_at)
            VALUES (${request.id}, ${accountId}, 'owner', ${accountId}, ${now}) RETURNING account_id`,
      );
      return {
        workspace: {
          id: request.id,
          name: request.name,
          role: 'owner' as const,
          createdAt: now,
          updatedAt: now,
        },
      };
    }
    case 'workspace.delete': {
      // Only an owner's workspace is a row it can reach, and only when the name typed is the name it has: a shared space is not deleted by accident.
      const found = await dbGet<{ name: string }>(
        tx,
        sql`SELECT name FROM ${t.workspace} WHERE id = ${request.id} AND id IN ${workspacesOwnedBy(tx, accountId)}`,
      );
      if (!found) throw new Refused('not_found');
      if (found.name !== request.name) throw new Refused('invalid');
      await deleteWorkspace(tx, request.id);
      return { deleted: request.id };
    }
    case 'member.add': {
      await lockWorkspace(tx, request.workspaceId, workspacesOwnedBy(tx, accountId), now);
      // Only an owner gets as far as learning that an address has no account (and that is why it is rated).
      if (!target) throw new Refused('invalid', 'no_account');
      const count = await dbGet<{ n: number | string }>(
        tx,
        sql`SELECT COUNT(*) AS n FROM ${t.workspaceMember} WHERE workspace_id = ${request.workspaceId}`,
      );
      if (Number(count?.n ?? 0) >= WORKSPACE_LIMITS.membersPerWorkspace) throw new Refused('limit');
      const added = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${t.workspaceMember} (workspace_id, account_id, role, added_by, created_at)
            VALUES (${request.workspaceId}, ${target}, 'member', ${accountId}, ${now})
            ON CONFLICT (workspace_id, account_id) DO NOTHING RETURNING account_id AS id`,
      );
      if (added.length === 0) throw new Refused('invalid', 'already_in');
      return {
        member: { workspaceId: request.workspaceId, accountId: target, role: 'member' as Role },
      };
    }
    case 'member.setRole': {
      await lockWorkspace(tx, request.workspaceId, workspacesOwnedBy(tx, accountId), now);
      const guard =
        request.role === 'member' ? sql`AND ${notTheLastOwner(tx, request.workspaceId)}` : sql``;
      const changed = await dbAll<{ role: string }>(
        tx,
        sql`UPDATE ${t.workspaceMember} SET role = ${request.role}
            WHERE workspace_id = ${request.workspaceId} AND account_id = ${request.accountId}
              AND workspace_id IN ${workspacesOwnedBy(tx, accountId)} ${guard}
            RETURNING role`,
      );
      if (changed.length === 0) {
        if (await membersOf(tx, request.workspaceId, request.accountId))
          throw new Refused('invalid', 'last_owner');
        throw new Refused('stale');
      }
      return {
        member: {
          workspaceId: request.workspaceId,
          accountId: request.accountId,
          role: request.role,
        },
      };
    }
    case 'member.remove': {
      await lockWorkspace(tx, request.workspaceId, workspacesOwnedBy(tx, accountId), now);
      await takeOut(tx, request.workspaceId, request.accountId, 'stale');
      return { removed: { workspaceId: request.workspaceId, accountId: request.accountId } };
    }
    case 'member.leave': {
      await lockWorkspace(tx, request.workspaceId, workspacesOf(tx, accountId), now);
      await takeOut(tx, request.workspaceId, accountId, 'not_found');
      return { removed: { workspaceId: request.workspaceId, accountId } };
    }
    case 'board.create': {
      await lockWorkspace(tx, request.workspaceId, workspacesOf(tx, accountId), now);
      const count = await dbGet<{ n: number | string }>(
        tx,
        sql`SELECT COUNT(*) AS n FROM ${t.board} WHERE workspace_id = ${request.workspaceId}`,
      );
      if (Number(count?.n ?? 0) >= WORKSPACE_LIMITS.boardsPerWorkspace) throw new Refused('limit');
      // An id that another account already uses is a conflict, and is answered as a board that is not theirs.
      const made = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${t.board} (id, workspace_id, name, color, description, visibility, archived_at, version, created_by, created_at, updated_at)
            VALUES (${request.id}, ${request.workspaceId}, ${request.name}, ${request.color}, NULL, 'public', NULL, 1, ${accountId}, ${now}, ${now})
            ON CONFLICT (id) DO NOTHING RETURNING id`,
      );
      if (made.length === 0) throw new Refused('not_found');
      await dbAll(
        tx,
        sql`INSERT INTO ${t.boardMember} (board_id, account_id, workspace_id, role, created_at)
            VALUES (${request.id}, ${accountId}, ${request.workspaceId}, 'owner', ${now}) RETURNING account_id`,
      );
      await dbAll(
        tx,
        sql`INSERT INTO ${t.boardList} (id, board_id, name, position, created_at, updated_at)
            VALUES (${crypto.randomUUID()}, ${request.id}, 'Backlog', ${first()}, ${now}, ${now}) RETURNING id`,
      );
      return {
        board: {
          id: request.id,
          workspaceId: request.workspaceId,
          name: request.name,
          color: request.color,
          description: null,
          visibility: 'public' as const,
          archived: false,
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
        version: 1,
      };
    }
    case 'list.create': {
      // The board is taken, with the permission in the statement, and its version moved on; the list is made under it.
      const version = await touchBoard(tx, request.boardId, boardsEditableBy(tx, accountId), now);
      const count = await dbGet<{ n: number | string }>(
        tx,
        sql`SELECT COUNT(*) AS n FROM ${t.boardList} WHERE board_id = ${request.boardId}`,
      );
      if (Number(count?.n ?? 0) >= WORKSPACE_LIMITS.listsPerBoard) throw new Refused('limit');
      const made = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${t.boardList} (id, board_id, name, position, created_at, updated_at)
            VALUES (${request.id}, ${request.boardId}, ${request.name}, ${request.position}, ${now}, ${now})
            ON CONFLICT (id) DO NOTHING RETURNING id`,
      );
      if (made.length === 0) throw new Refused('not_found');
      const list: ListRow = {
        id: request.id,
        boardId: request.boardId,
        name: request.name,
        position: request.position,
        cards: 0,
      };
      return { list, version };
    }
    case 'list.rename':
    case 'list.move': {
      const changed = await dbAll<{ boardId: string; name: string; position: string }>(
        tx,
        request.op === 'list.rename'
          ? sql`UPDATE ${t.boardList} SET name = ${request.name}, updated_at = ${now}
                WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}
                RETURNING board_id AS "boardId", name, position`
          : sql`UPDATE ${t.boardList} SET position = ${request.position}, updated_at = ${now}
                WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}
                RETURNING board_id AS "boardId", name, position`,
      );
      const row = changed[0];
      if (!row) throw new Refused('not_found');
      const version = await touchBoard(tx, row.boardId, boardsEditableBy(tx, accountId), now);
      const list: ListRow = { id: request.id, ...row, cards: await openCards(tx, request.id) };
      return { list, version };
    }
    case 'list.delete': {
      const gone = await dbAll<{ boardId: string }>(
        tx,
        sql`DELETE FROM ${t.boardList}
            WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}
            RETURNING board_id AS "boardId"`,
      );
      const boardId = gone[0]?.boardId;
      if (!boardId) throw new Refused('not_found');
      // The cards that were on it, and everything on them: by `board_id` and the list's own id, children before parents.
      const cards = sql`card_id IN (SELECT id FROM ${t.card} WHERE list_id = ${request.id} AND board_id = ${boardId})`;
      for (const table of [t.comment, t.checklistItem, t.cardAssignee, t.cardLabel, t.activity])
        await dbAll(
          tx,
          sql`DELETE FROM ${table} WHERE board_id = ${boardId} AND ${cards} RETURNING 1 AS one`,
        );
      await dbAll(
        tx,
        sql`DELETE FROM ${t.card} WHERE list_id = ${request.id} AND board_id = ${boardId} RETURNING 1 AS one`,
      );
      const version = await touchBoard(tx, boardId, boardsEditableBy(tx, accountId), now);
      return { deletedList: request.id, version };
    }
    case 'card.create':
    case 'card.move': {
      // The list is taken first, with the permission in its statement, and the board is the list's: a card can only be put in a list of a board its
      // maker may change, and can only be moved to a list of its own board.
      const taken = await dbAll<{ boardId: string }>(
        tx,
        sql`UPDATE ${t.boardList} SET updated_at = ${now}
            WHERE id = ${request.listId} AND board_id IN ${boardsEditableBy(tx, accountId)}
            RETURNING board_id AS "boardId"`,
      );
      const boardId = taken[0]?.boardId;
      if (!boardId) throw new Refused('not_found');
      const version = await touchBoard(tx, boardId, boardsEditableBy(tx, accountId), now);
      if (request.op === 'card.create') {
        const count = await dbGet<{ n: number | string }>(
          tx,
          sql`SELECT COUNT(*) AS n FROM ${t.card} WHERE board_id = ${boardId}`,
        );
        if (Number(count?.n ?? 0) >= WORKSPACE_LIMITS.cardsPerBoard) throw new Refused('limit');
        const made = await dbAll<{ id: string }>(
          tx,
          sql`INSERT INTO ${t.card} (id, board_id, list_id, title, position, created_by, created_at, updated_at)
              VALUES (${request.id}, ${boardId}, ${request.listId}, ${request.title}, ${request.position}, ${accountId}, ${now}, ${now})
              ON CONFLICT (id) DO NOTHING RETURNING id`,
        );
        if (made.length === 0) throw new Refused('not_found');
      } else {
        const moved = await dbAll<{ id: string }>(
          tx,
          sql`UPDATE ${t.card} SET list_id = ${request.listId}, position = ${request.position}, updated_at = ${now}
              WHERE id = ${request.id} AND board_id = ${boardId} AND archived_at IS NULL RETURNING id`,
        );
        if (moved.length === 0) throw new Refused('not_found');
      }
      return { card: await cardTile(tx, request.id), version };
    }
    case 'card.archive':
    case 'card.restore':
    case 'card.delete': {
      // The card's own statement carries the permission; the state it must be in is part of it (only an archived card is deleted).
      const changed = await dbAll<{ boardId: string }>(
        tx,
        request.op === 'card.archive'
          ? sql`UPDATE ${t.card} SET archived_at = ${now}, updated_at = ${now}
                WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)} AND archived_at IS NULL
                RETURNING board_id AS "boardId"`
          : request.op === 'card.restore'
            ? sql`UPDATE ${t.card} SET archived_at = NULL, updated_at = ${now}
                  WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)} AND archived_at IS NOT NULL
                  RETURNING board_id AS "boardId"`
            : sql`DELETE FROM ${t.card}
                  WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)} AND archived_at IS NOT NULL
                  RETURNING board_id AS "boardId"`,
      );
      const boardId = changed[0]?.boardId;
      if (!boardId) throw new Refused('not_found');
      if (request.op === 'card.delete') {
        // Its labels, assignees, checklist and comments go with it; its activity stays (DESIGN.md §15.8).
        for (const table of [t.comment, t.checklistItem, t.cardAssignee, t.cardLabel])
          await dbAll(
            tx,
            sql`DELETE FROM ${table} WHERE board_id = ${boardId} AND card_id = ${request.id} RETURNING 1 AS one`,
          );
      }
      const version = await touchBoard(tx, boardId, boardsEditableBy(tx, accountId), now);
      return request.op === 'card.delete'
        ? { deletedCard: request.id, version }
        : { card: await cardTile(tx, request.id), version };
    }
    case 'card.rename':
    case 'card.describe': {
      const changed = await dbAll<{ boardId: string }>(
        tx,
        request.op === 'card.rename'
          ? sql`UPDATE ${t.card} SET title = ${request.title}, updated_at = ${now}
                WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}
                RETURNING board_id AS "boardId"`
          : sql`UPDATE ${t.card} SET description = ${request.description.trim() === '' ? null : request.description}, updated_at = ${now}
                WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}
                RETURNING board_id AS "boardId"`,
      );
      const boardId = changed[0]?.boardId;
      if (!boardId) throw new Refused('not_found');
      const version = await touchBoard(tx, boardId, boardsEditableBy(tx, accountId), now);
      return { card: await cardTile(tx, request.id), version };
    }
    case 'board.update':
    case 'board.archive':
    case 'board.restore': {
      // Administration is a board owner's, or the owner of its workspace, who need not be on the board. The state a board must be in is part of the
      // statement: an archived board is read-only for everyone, its settings included, until it is restored.
      const description = request.op === 'board.update' ? request.description.trim() : '';
      const changed = await dbAll<{ id: string }>(
        tx,
        request.op === 'board.update'
          ? sql`UPDATE ${t.board} SET name = ${request.name}, color = ${request.color}, description = ${description === '' ? null : request.description}, updated_at = ${now}
                WHERE id = ${request.id} AND id IN ${boardsAdministeredBy(tx, accountId)} AND archived_at IS NULL RETURNING id`
          : request.op === 'board.archive'
            ? sql`UPDATE ${t.board} SET archived_at = ${now}, updated_at = ${now}
                  WHERE id = ${request.id} AND id IN ${boardsAdministeredBy(tx, accountId)} AND archived_at IS NULL RETURNING id`
            : sql`UPDATE ${t.board} SET archived_at = NULL, updated_at = ${now}
                  WHERE id = ${request.id} AND id IN ${boardsAdministeredBy(tx, accountId)} AND archived_at IS NOT NULL RETURNING id`,
      );
      if (changed.length === 0) throw new Refused('not_found');
      const version = await touchBoard(tx, request.id, boardsAdministeredBy(tx, accountId), now);
      const board = await boardRowOf(tx, request.id);
      if (!board) throw new Refused('not_found');
      return { board, version };
    }
    case 'board.delete': {
      const found = await dbGet<{ name: string; workspaceId: string }>(
        tx,
        sql`SELECT name, workspace_id AS "workspaceId" FROM ${t.board} WHERE id = ${request.id} AND id IN ${boardsAdministeredBy(tx, accountId)}`,
      );
      if (!found) throw new Refused('not_found');
      if (found.name !== request.name) throw new Refused('invalid');
      await deleteBoard(tx, request.id);
      await dbAll(
        tx,
        sql`UPDATE ${t.workspace} SET updated_at = ${now} WHERE id = ${found.workspaceId} RETURNING id`,
      );
      return { deletedBoard: request.id };
    }
    case 'board.setVisibility': {
      const changed = await dbAll<{ id: string }>(
        tx,
        sql`UPDATE ${t.board} SET visibility = ${request.visibility}, updated_at = ${now}
            WHERE id = ${request.id} AND id IN ${boardsAdministeredBy(tx, accountId)} AND archived_at IS NULL RETURNING id`,
      );
      if (changed.length === 0) throw new Refused('not_found');
      const version = await touchBoard(
        tx,
        request.id,
        boardsAdministeredBy(tx, accountId),
        now,
        true,
      );
      const board = await boardRowOf(tx, request.id);
      if (!board) throw new Refused('not_found');
      return { board, version };
    }
    case 'boardMember.add':
    case 'boardMember.setRole':
    case 'boardMember.remove': {
      if (request.op === 'boardMember.add') {
        // The workspace's row first, as removing a person from the workspace does, so that adding someone to a board and taking them off the workspace
        // wait for each other and never leave a person on a board of a workspace they are not in.
        const held = await dbAll<{ id: string }>(
          tx,
          sql`UPDATE ${t.workspace} SET updated_at = ${now}
              WHERE id = (SELECT workspace_id FROM ${t.board} WHERE id = ${request.boardId}) AND id IN ${workspacesOf(tx, accountId)}
              RETURNING id`,
        );
        if (held.length === 0) throw new Refused('not_found');
      }
      const version = await touchBoard(
        tx,
        request.boardId,
        boardsAdministeredBy(tx, accountId),
        now,
        true,
      );
      if (request.op === 'boardMember.add') {
        const inWorkspace = await dbGet<{ one: number }>(
          tx,
          sql`SELECT 1 AS one FROM ${t.workspaceMember} wm JOIN ${t.board} b ON b.workspace_id = wm.workspace_id
              WHERE b.id = ${request.boardId} AND wm.account_id = ${request.accountId}`,
        );
        if (!inWorkspace) throw new Refused('invalid', 'not_in_workspace');
        const added = await dbAll<{ id: string }>(
          tx,
          sql`INSERT INTO ${t.boardMember} (board_id, account_id, workspace_id, role, created_at)
              VALUES (${request.boardId}, ${request.accountId}, (SELECT workspace_id FROM ${t.board} WHERE id = ${request.boardId}), 'member', ${now})
              ON CONFLICT (board_id, account_id) DO NOTHING RETURNING account_id AS id`,
        );
        if (added.length === 0) throw new Refused('invalid', 'already_in');
        return {
          boardMember: {
            boardId: request.boardId,
            accountId: request.accountId,
            role: 'member' as Role,
          },
          version,
        };
      }
      if (request.op === 'boardMember.setRole') {
        const set = await dbAll<{ id: string }>(
          tx,
          sql`UPDATE ${t.boardMember} SET role = ${request.role}
              WHERE board_id = ${request.boardId} AND account_id = ${request.accountId} RETURNING account_id AS id`,
        );
        if (set.length === 0) throw new Refused('stale');
        return {
          boardMember: {
            boardId: request.boardId,
            accountId: request.accountId,
            role: request.role,
          },
          version,
        };
      }
      await takeOffBoard(tx, request.boardId, request.accountId, 'stale');
      return {
        removedBoardMember: { boardId: request.boardId, accountId: request.accountId },
        version,
      };
    }
    case 'board.join': {
      // Anyone in the workspace on a public board, and a workspace owner on any board (they administer it and can add themselves, §7.2); not an
      // archived one. The workspace's row is taken first, as adding someone does.
      const held = await dbAll<{ workspaceId: string }>(
        tx,
        sql`UPDATE ${t.workspace} SET updated_at = ${now}
            WHERE id = (SELECT workspace_id FROM ${t.board} WHERE id = ${request.id}
                        AND archived_at IS NULL
                        AND (visibility = 'public' OR workspace_id IN ${workspacesOwnedBy(tx, accountId)}))
              AND id IN ${workspacesOf(tx, accountId)}
            RETURNING id AS "workspaceId"`,
      );
      const workspaceId = held[0]?.workspaceId;
      if (!workspaceId) throw new Refused('not_found');
      const added = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${t.boardMember} (board_id, account_id, workspace_id, role, created_at)
            VALUES (${request.id}, ${accountId}, ${workspaceId}, 'member', ${now})
            ON CONFLICT (board_id, account_id) DO NOTHING RETURNING account_id AS id`,
      );
      if (added.length === 0) throw new Refused('invalid', 'already_in');
      const version = await touchBoard(tx, request.id, boardsVisibleTo(tx, accountId), now, true);
      return { boardMember: { boardId: request.id, accountId, role: 'member' as Role }, version };
    }
    case 'board.leave': {
      // A member of the board, whether or not it is archived.
      const version = await touchBoard(
        tx,
        request.id,
        sql`(SELECT board_id FROM ${t.boardMember} WHERE account_id = ${accountId})`,
        now,
      );
      await takeOffBoard(tx, request.id, accountId, 'not_found');
      return { removedBoardMember: { boardId: request.id, accountId }, version };
    }
    case 'card.setDue': {
      const changed = await dbAll<{ boardId: string }>(
        tx,
        sql`UPDATE ${t.card} SET due_date = ${request.dueDate}, due_time = ${request.dueDate === null ? null : request.dueTime}, updated_at = ${now}
            WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}
            RETURNING board_id AS "boardId"`,
      );
      const boardId = changed[0]?.boardId;
      if (!boardId) throw new Refused('not_found');
      const version = await touchBoard(tx, boardId, boardsEditableBy(tx, accountId), now);
      return { card: await cardTile(tx, request.id), version };
    }
    case 'workspace.rename': {
      // The permission is in the statement: only an owner's workspace is a row it can reach.
      const changed = await dbAll<{ createdAt: number | string }>(
        tx,
        sql`UPDATE ${t.workspace} SET name = ${request.name}, updated_at = ${now}
            WHERE id = ${request.id} AND id IN ${workspacesOwnedBy(tx, accountId)}
            RETURNING created_at AS "createdAt"`,
      );
      const row = changed[0];
      if (!row) throw new Refused('not_found');
      return {
        workspace: {
          id: request.id,
          name: request.name,
          role: 'owner' as const,
          createdAt: Number(row.createdAt),
          updatedAt: now,
        },
      };
    }
  }
}

/**
 * The first statement of every operation on a board's lists (DESIGN.md §14.7): it moves the board's `version` on, so that anyone who has it open can
 * tell it has changed, and the workspace's `updated_at` with it. It carries the permission, and **takes the board's row**, so that two people changing
 * one board wait for each other and the limits are counted fairly. Returns the version now.
 */
async function touchBoard(
  tx: Database,
  boardId: string,
  permission: SQL,
  now: number,
  /** Only a board that is not archived: an archived board is read-only for everyone (DESIGN.md §14.4). */
  open = false,
): Promise<number> {
  const t = tablesOf(tx);
  const moved = await dbAll<{ version: number | string; workspaceId: string }>(
    tx,
    sql`UPDATE ${t.board} SET version = version + 1, updated_at = ${now}
        WHERE id = ${boardId} AND id IN ${permission} ${open ? sql`AND archived_at IS NULL` : sql``}
        RETURNING version, workspace_id AS "workspaceId"`,
  );
  const row = moved[0];
  if (!row) throw new Refused('not_found');
  await dbAll(
    tx,
    sql`UPDATE ${t.workspace} SET updated_at = ${now} WHERE id = ${row.workspaceId} RETURNING id`,
  );
  return Number(row.version);
}

/** Takes a person off a board and unassigns them from its cards, in the transaction that holds it. Their comments and activity stay. */
async function takeOffBoard(
  tx: Database,
  boardId: string,
  accountId: string,
  absent: OpRefusal,
): Promise<void> {
  const t = tablesOf(tx);
  const gone = await dbAll<{ id: string }>(
    tx,
    sql`DELETE FROM ${t.boardMember} WHERE board_id = ${boardId} AND account_id = ${accountId} RETURNING account_id AS id`,
  );
  if (gone.length === 0) throw new Refused(absent);
  await dbAll(
    tx,
    sql`DELETE FROM ${t.cardAssignee} WHERE board_id = ${boardId} AND account_id = ${accountId} RETURNING 1 AS one`,
  );
}

/** A card as its tile shows it, as the transaction now has it. */
async function cardTile(tx: Database, id: string): Promise<CardTile> {
  const t = tablesOf(tx);
  const row = await dbGet<{
    id: string;
    boardId: string;
    listId: string;
    title: string;
    position: string;
    dueDate: string | null;
    dueTime: string | null;
    hasDescription: number | boolean | string;
  }>(
    tx,
    sql`SELECT id, board_id AS "boardId", list_id AS "listId", title, position, due_date AS "dueDate", due_time AS "dueTime",
          (description IS NOT NULL AND description <> '') AS "hasDescription"
        FROM ${t.card} WHERE id = ${id}`,
  );
  if (!row) throw new Refused('not_found');
  return {
    ...row,
    hasDescription: row.hasDescription === true || Number(row.hasDescription) === 1,
  };
}

async function openCards(tx: Database, listId: string): Promise<number> {
  const t = tablesOf(tx);
  const count = await dbGet<{ n: number | string }>(
    tx,
    sql`SELECT COUNT(*) AS n FROM ${t.card} WHERE list_id = ${listId} AND archived_at IS NULL`,
  );
  return Number(count?.n ?? 0);
}

/**
 * The first statement of every operation on a workspace's people: it moves the workspace's `updated_at` on and takes the row, **so that two owners
 * changing the people at once wait for each other** and each sees the other's work. It carries the permission, so what is not reachable is not touched.
 */
async function lockWorkspace(
  tx: Database,
  workspaceId: string,
  permission: SQL,
  now: number,
): Promise<void> {
  const t = tablesOf(tx);
  const held = await dbAll<{ id: string }>(
    tx,
    sql`UPDATE ${t.workspace} SET updated_at = ${now} WHERE id = ${workspaceId} AND id IN ${permission} RETURNING id`,
  );
  if (held.length === 0) throw new Refused('not_found');
}

/** A workspace keeps at least one owner (DESIGN.md §7.2): a statement that would take the last away carries this and then does nothing. */
const notTheLastOwner = (tx: Database, workspaceId: string): SQL => {
  const t = tablesOf(tx);
  return sql`(role = 'member' OR (SELECT COUNT(*) FROM ${t.workspaceMember} WHERE workspace_id = ${workspaceId} AND role = 'owner') > 1)`;
};

async function membersOf(tx: Database, workspaceId: string, accountId: string) {
  const t = tablesOf(tx);
  return dbGet<{ role: string }>(
    tx,
    sql`SELECT role FROM ${t.workspaceMember} WHERE workspace_id = ${workspaceId} AND account_id = ${accountId}`,
  );
}

/**
 * Taking a person out of a workspace, whoever asked (DESIGN.md §7.2): off its people, off every board of it, and unassigned there, in one transaction.
 * Their comments and activity stay, under their name. The last owner cannot be taken out.
 */
async function takeOut(
  tx: Database,
  workspaceId: string,
  accountId: string,
  absent: OpRefusal,
): Promise<void> {
  const t = tablesOf(tx);
  const gone = await dbAll<{ id: string }>(
    tx,
    sql`DELETE FROM ${t.workspaceMember}
        WHERE workspace_id = ${workspaceId} AND account_id = ${accountId} AND ${notTheLastOwner(tx, workspaceId)}
        RETURNING account_id AS id`,
  );
  if (gone.length === 0) {
    // Nothing was taken: either they are not in it, or they are its last owner.
    if (await membersOf(tx, workspaceId, accountId)) throw new Refused('invalid', 'last_owner');
    throw new Refused(absent);
  }
  await dbAll(
    tx,
    sql`DELETE FROM ${t.boardMember} WHERE workspace_id = ${workspaceId} AND account_id = ${accountId} RETURNING 1 AS one`,
  );
  await dbAll(
    tx,
    sql`DELETE FROM ${t.cardAssignee}
        WHERE account_id = ${accountId} AND board_id IN (SELECT id FROM ${t.board} WHERE workspace_id = ${workspaceId})
        RETURNING 1 AS one`,
  );
}

/**
 * Everything of a workspace, by name and in one transaction (DESIGN.md §23.1: no cascades): the rows below its boards by `board_id`, the boards, the
 * people, the notices about it, and the workspace. Children before parents, so that a run that stopped never leaves a card whose board is gone.
 */
async function deleteWorkspace(tx: Database, workspaceId: string): Promise<void> {
  const t = tablesOf(tx);
  // Set-based: a workspace can hold 500 boards, and a statement for each would be thousands.
  const inBoards = sql`board_id IN (SELECT id FROM ${t.board} WHERE workspace_id = ${workspaceId})`;
  for (const table of BOARD_TABLES)
    await dbAll(tx, sql`DELETE FROM ${tablesOf(tx)[table]} WHERE ${inBoards} RETURNING 1 AS one`);
  await dbAll(
    tx,
    sql`DELETE FROM ${t.board} WHERE workspace_id = ${workspaceId} RETURNING 1 AS one`,
  );
  await dbAll(
    tx,
    sql`DELETE FROM ${t.notice} WHERE workspace_id = ${workspaceId} RETURNING 1 AS one`,
  );
  await dbAll(
    tx,
    sql`DELETE FROM ${t.workspaceMember} WHERE workspace_id = ${workspaceId} RETURNING 1 AS one`,
  );
  await dbAll(tx, sql`DELETE FROM ${t.workspace} WHERE id = ${workspaceId} RETURNING 1 AS one`);
}

/** The tables with a `board_id` that a board's deletion empties, children before parents (the board's people last, then the board itself). */
const BOARD_TABLES = [
  'activity',
  'comment',
  'checklistItem',
  'cardAssignee',
  'cardLabel',
  'label',
  'card',
  'boardList',
  'publication',
  'boardMember',
] as const;

/**
 * Everything of a board, by name and in the transaction that holds it (DESIGN.md §23.1: no cascades): every row below it by `board_id`, its publication,
 * the notices about it, its people and the board. Children before parents, so that a run that stopped never leaves a card whose board is gone.
 */
async function deleteBoard(tx: Database, boardId: string): Promise<void> {
  const t = tablesOf(tx);
  for (const table of BOARD_TABLES)
    await dbAll(tx, sql`DELETE FROM ${t[table]} WHERE board_id = ${boardId} RETURNING 1 AS one`);
  await dbAll(tx, sql`DELETE FROM ${t.notice} WHERE board_id = ${boardId} RETURNING 1 AS one`);
  await dbAll(tx, sql`DELETE FROM ${t.board} WHERE id = ${boardId} RETURNING 1 AS one`);
}
