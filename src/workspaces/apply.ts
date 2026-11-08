import { type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import type { Directory } from '../auth/directory';
import { between, first } from '../position';
import {
  boardsAdministeredBy,
  boardsEditableBy,
  boardsOwnedBy,
  boardsVisibleTo,
  workspacesOf,
  workspacesOwnedBy,
} from './can';
import { capture, record } from './activity';
import { raise } from './notices';
import { boardRowOf } from './reads';
import {
  type OpReason,
  type OpRefusal,
  type OpRequest,
  type OpResult,
  type CardTile,
  type ChecklistItem,
  type LabelRow,
  type ListRow,
  type Role,
  WORKSPACE_LIMITS,
} from './format';
import { open, openText, seal, sealText } from './content';
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

      const before = await capture(tx, request);
      const rows = await run(tx, accountId, request, options.now, target);
      await record(tx, accountId, request, before, rows, options.now);
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
            VALUES (${request.id}, ${sealText('workspace', request.id, 'name', request.name)}, ${accountId}, ${now}, ${now})
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
      if (openText('workspace', request.id, 'name', found.name) !== request.name)
        throw new Refused('invalid');
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
      const named = await dbGet<{ name: string }>(
        tx,
        sql`SELECT name FROM ${t.workspace} WHERE id = ${request.workspaceId}`,
      );
      await raise(
        tx,
        {
          recipient: target,
          kind: 'added_to_workspace',
          actor: accountId,
          workspaceId: request.workspaceId,
          subject: named ? openText('workspace', request.workspaceId, 'name', named.name) : '',
        },
        now,
      );
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
            VALUES (${request.id}, ${request.workspaceId}, ${sealText('board', request.id, 'name', request.name)}, ${request.color}, NULL, 'public', NULL, 1, ${accountId}, ${now}, ${now})
            ON CONFLICT (id) DO NOTHING RETURNING id`,
      );
      if (made.length === 0) throw new Refused('not_found');
      await dbAll(
        tx,
        sql`INSERT INTO ${t.boardMember} (board_id, account_id, workspace_id, role, created_at)
            VALUES (${request.id}, ${accountId}, ${request.workspaceId}, 'owner', ${now}) RETURNING account_id`,
      );
      const backlog = crypto.randomUUID();
      await dbAll(
        tx,
        sql`INSERT INTO ${t.boardList} (id, board_id, name, position, created_at, updated_at)
            VALUES (${backlog}, ${request.id}, ${sealText('board_list', backlog, 'name', 'Backlog')}, ${first()}, ${now}, ${now}) RETURNING id`,
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
            VALUES (${request.id}, ${request.boardId}, ${sealText('board_list', request.id, 'name', request.name)}, ${request.position}, ${now}, ${now})
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
          ? sql`UPDATE ${t.boardList} SET name = ${sealText('board_list', request.id, 'name', request.name)}, updated_at = ${now}
                WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}
                RETURNING board_id AS "boardId", name, position`
          : sql`UPDATE ${t.boardList} SET position = ${request.position}, updated_at = ${now}
                WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}
                RETURNING board_id AS "boardId", name, position`,
      );
      const row = changed[0];
      if (!row) throw new Refused('not_found');
      const version = await touchBoard(tx, row.boardId, boardsEditableBy(tx, accountId), now);
      const list: ListRow = {
        id: request.id,
        ...row,
        name: openText('board_list', request.id, 'name', row.name),
        cards: await openCards(tx, request.id),
      };
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
      for (const table of [t.comment, t.checklistItem, t.cardAssignee, t.cardLabel])
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
              VALUES (${request.id}, ${boardId}, ${request.listId}, ${sealText('card', request.id, 'title', request.title)}, ${request.position}, ${accountId}, ${now}, ${now})
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
          ? sql`UPDATE ${t.card} SET title = ${sealText('card', request.id, 'title', request.title)}, updated_at = ${now}
                WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}
                RETURNING board_id AS "boardId"`
          : sql`UPDATE ${t.card} SET description = ${seal('card', request.id, 'description', request.description.trim() === '' ? null : request.description)}, updated_at = ${now}
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
          ? sql`UPDATE ${t.board} SET name = ${sealText('board', request.id, 'name', request.name)}, color = ${request.color}, description = ${seal('board', request.id, 'description', description === '' ? null : request.description)}, updated_at = ${now}
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
      if (openText('board', request.id, 'name', found.name) !== request.name)
        throw new Refused('invalid');
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
        const board = await dbGet<{ name: string; workspaceId: string }>(
          tx,
          sql`SELECT name, workspace_id AS "workspaceId" FROM ${t.board} WHERE id = ${request.boardId}`,
        );
        if (board)
          await raise(
            tx,
            {
              recipient: request.accountId,
              kind: 'added_to_board',
              actor: accountId,
              workspaceId: board.workspaceId,
              boardId: request.boardId,
              subject: openText('board', request.boardId, 'name', board.name),
            },
            now,
          );
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
    case 'label.create': {
      const version = await touchBoard(
        tx,
        request.boardId,
        boardsEditableBy(tx, accountId),
        now,
        true,
      );
      const count = await dbGet<{ n: number | string }>(
        tx,
        sql`SELECT COUNT(*) AS n FROM ${t.label} WHERE board_id = ${request.boardId}`,
      );
      if (Number(count?.n ?? 0) >= WORKSPACE_LIMITS.labelsPerBoard) throw new Refused('limit');
      const made = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${t.label} (id, board_id, name, color, created_at)
            VALUES (${request.id}, ${request.boardId}, ${sealText('label', request.id, 'name', request.name)}, ${request.color}, ${now})
            ON CONFLICT (id) DO NOTHING RETURNING id`,
      );
      if (made.length === 0) throw new Refused('not_found');
      const label: LabelRow = {
        id: request.id,
        boardId: request.boardId,
        name: request.name,
        color: request.color,
      };
      return { label, version };
    }
    case 'label.update':
    case 'label.delete': {
      // The label's own statement carries the permission; the board is the label's.
      const changed = await dbAll<{ boardId: string }>(
        tx,
        request.op === 'label.update'
          ? sql`UPDATE ${t.label} SET name = ${sealText('label', request.id, 'name', request.name)}, color = ${request.color}
                WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}
                RETURNING board_id AS "boardId"`
          : sql`DELETE FROM ${t.label}
                WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}
                RETURNING board_id AS "boardId"`,
      );
      const boardId = changed[0]?.boardId;
      if (!boardId) throw new Refused('not_found');
      if (request.op === 'label.delete') {
        // Off every card, in the same transaction.
        await dbAll(
          tx,
          sql`DELETE FROM ${t.cardLabel} WHERE label_id = ${request.id} AND board_id = ${boardId} RETURNING 1 AS one`,
        );
      }
      const version = await touchBoard(tx, boardId, boardsEditableBy(tx, accountId), now, true);
      return request.op === 'label.delete'
        ? { deletedLabel: request.id, version }
        : { label: { id: request.id, boardId, name: request.name, color: request.color }, version };
    }
    case 'card.addLabel':
    case 'card.removeLabel': {
      // The card is taken with the permission in its statement; the label must be that card's board's, so a label of another board is a label that is not there.
      const taken = await dbAll<{ boardId: string }>(
        tx,
        sql`UPDATE ${t.card} SET updated_at = ${now}
            WHERE id = ${request.cardId} AND board_id IN ${boardsEditableBy(tx, accountId)} AND archived_at IS NULL
            RETURNING board_id AS "boardId"`,
      );
      const boardId = taken[0]?.boardId;
      if (!boardId) throw new Refused('not_found');
      const version = await touchBoard(tx, boardId, boardsEditableBy(tx, accountId), now, true);
      const ours = await dbGet<{ one: number }>(
        tx,
        sql`SELECT 1 AS one FROM ${t.label} WHERE id = ${request.labelId} AND board_id = ${boardId}`,
      );
      if (!ours) throw new Refused('not_found');
      if (request.op === 'card.addLabel')
        await dbAll(
          tx,
          sql`INSERT INTO ${t.cardLabel} (card_id, label_id, board_id) VALUES (${request.cardId}, ${request.labelId}, ${boardId})
              ON CONFLICT (card_id, label_id) DO NOTHING RETURNING card_id`,
        );
      else
        await dbAll(
          tx,
          sql`DELETE FROM ${t.cardLabel} WHERE card_id = ${request.cardId} AND label_id = ${request.labelId} AND board_id = ${boardId} RETURNING 1 AS one`,
        );
      return { card: await cardTile(tx, request.cardId), version };
    }
    case 'card.assign':
    case 'card.unassign': {
      // The card, with the permission in its statement; the person must be on the card's board, which is what keeps an assignee a member.
      const taken = await dbAll<{ boardId: string; title: string; workspaceId: string }>(
        tx,
        sql`UPDATE ${t.card} SET updated_at = ${now}
            WHERE id = ${request.cardId} AND board_id IN ${boardsEditableBy(tx, accountId)} AND archived_at IS NULL
            RETURNING board_id AS "boardId", title, (SELECT workspace_id FROM ${t.board} WHERE id = ${t.card}.board_id) AS "workspaceId"`,
      );
      const card = taken[0];
      if (!card) throw new Refused('not_found');
      const cardTitle = openText('card', request.cardId, 'title', card.title);
      const version = await touchBoard(
        tx,
        card.boardId,
        boardsEditableBy(tx, accountId),
        now,
        true,
      );
      if (request.op === 'card.unassign') {
        await dbAll(
          tx,
          sql`DELETE FROM ${t.cardAssignee} WHERE card_id = ${request.cardId} AND account_id = ${request.accountId} AND board_id = ${card.boardId} RETURNING 1 AS one`,
        );
        return { card: await cardTile(tx, request.cardId), version };
      }
      const onBoard = await dbGet<{ one: number }>(
        tx,
        sql`SELECT 1 AS one FROM ${t.boardMember} WHERE board_id = ${card.boardId} AND account_id = ${request.accountId}`,
      );
      if (!onBoard) throw new Refused('invalid', 'not_on_board');
      const added = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${t.cardAssignee} (card_id, account_id, board_id, assigned_by, created_at)
            VALUES (${request.cardId}, ${request.accountId}, ${card.boardId}, ${accountId}, ${now})
            ON CONFLICT (card_id, account_id) DO NOTHING RETURNING account_id AS id`,
      );
      // Written in the operation's transaction, once, for someone who is not the one who did it (DESIGN.md §16). Assigning oneself tells nobody.
      if (added.length > 0)
        await raise(
          tx,
          {
            recipient: request.accountId,
            kind: 'assigned',
            actor: accountId,
            workspaceId: card.workspaceId,
            boardId: card.boardId,
            cardId: request.cardId,
            subject: cardTitle,
          },
          now,
        );
      return { card: await cardTile(tx, request.cardId), version };
    }
    case 'item.add': {
      const taken = await dbAll<{ boardId: string }>(
        tx,
        sql`UPDATE ${t.card} SET updated_at = ${now}
            WHERE id = ${request.cardId} AND board_id IN ${boardsEditableBy(tx, accountId)} AND archived_at IS NULL
            RETURNING board_id AS "boardId"`,
      );
      const boardId = taken[0]?.boardId;
      if (!boardId) throw new Refused('not_found');
      const version = await touchBoard(tx, boardId, boardsEditableBy(tx, accountId), now, true);
      const count = await dbGet<{ n: number | string }>(
        tx,
        sql`SELECT COUNT(*) AS n FROM ${t.checklistItem} WHERE card_id = ${request.cardId}`,
      );
      if (Number(count?.n ?? 0) >= WORKSPACE_LIMITS.itemsPerCard) throw new Refused('limit');
      const made = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${t.checklistItem} (id, card_id, board_id, title, completed_at, position, created_at)
            VALUES (${request.id}, ${request.cardId}, ${boardId}, ${sealText('checklist_item', request.id, 'title', request.title)}, NULL, ${request.position}, ${now})
            ON CONFLICT (id) DO NOTHING RETURNING id`,
      );
      if (made.length === 0) throw new Refused('not_found');
      return {
        item: await itemRow(tx, request.id),
        card: await cardTile(tx, request.cardId),
        version,
      };
    }
    case 'item.rename':
    case 'item.tick':
    case 'item.untick':
    case 'item.move':
    case 'item.delete': {
      // The item's own statement carries the permission; the board and the card are the item's.
      const where = sql`id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}`;
      const changed = await dbAll<{ boardId: string; cardId: string }>(
        tx,
        request.op === 'item.rename'
          ? sql`UPDATE ${t.checklistItem} SET title = ${sealText('checklist_item', request.id, 'title', request.title)} WHERE ${where} RETURNING board_id AS "boardId", card_id AS "cardId"`
          : request.op === 'item.tick'
            ? sql`UPDATE ${t.checklistItem} SET completed_at = ${now} WHERE ${where} RETURNING board_id AS "boardId", card_id AS "cardId"`
            : request.op === 'item.untick'
              ? sql`UPDATE ${t.checklistItem} SET completed_at = NULL WHERE ${where} RETURNING board_id AS "boardId", card_id AS "cardId"`
              : request.op === 'item.move'
                ? sql`UPDATE ${t.checklistItem} SET position = ${request.position} WHERE ${where} RETURNING board_id AS "boardId", card_id AS "cardId"`
                : sql`DELETE FROM ${t.checklistItem} WHERE ${where} RETURNING board_id AS "boardId", card_id AS "cardId"`,
      );
      const row = changed[0];
      if (!row) throw new Refused('not_found');
      const version = await touchBoard(tx, row.boardId, boardsEditableBy(tx, accountId), now, true);
      const card = await cardTile(tx, row.cardId);
      return request.op === 'item.delete'
        ? { deletedItem: request.id, card, version }
        : { item: await itemRow(tx, request.id), card, version };
    }
    case 'comment.add': {
      const taken = await dbAll<{
        boardId: string;
        title: string;
        createdBy: string;
        workspaceId: string;
      }>(
        tx,
        sql`UPDATE ${t.card} SET updated_at = ${now}
            WHERE id = ${request.cardId} AND board_id IN ${boardsEditableBy(tx, accountId)} AND archived_at IS NULL
            RETURNING board_id AS "boardId", title, created_by AS "createdBy",
                      (SELECT workspace_id FROM ${t.board} WHERE id = ${t.card}.board_id) AS "workspaceId"`,
      );
      const card = taken[0];
      if (!card) throw new Refused('not_found');
      const version = await touchBoard(
        tx,
        card.boardId,
        boardsEditableBy(tx, accountId),
        now,
        true,
      );
      const count = await dbGet<{ n: number | string }>(
        tx,
        sql`SELECT COUNT(*) AS n FROM ${t.comment} WHERE card_id = ${request.cardId}`,
      );
      if (Number(count?.n ?? 0) >= WORKSPACE_LIMITS.commentsPerCard) throw new Refused('limit');
      const made = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${t.comment} (id, card_id, board_id, author_id, body, created_at, edited_at)
            VALUES (${request.id}, ${request.cardId}, ${card.boardId}, ${accountId}, ${sealText('comment', request.id, 'body', request.body)}, ${now}, NULL)
            ON CONFLICT (id) DO NOTHING RETURNING id`,
      );
      if (made.length === 0) throw new Refused('not_found');
      // Told, in this transaction: the card's assignees and the person who made it (if they are still in the workspace), never the one who wrote it.
      const told = await dbAll<{ id: string }>(
        tx,
        sql`SELECT account_id AS id FROM ${t.cardAssignee} WHERE card_id = ${request.cardId}
            UNION SELECT account_id AS id FROM ${t.workspaceMember}
                  WHERE workspace_id = ${card.workspaceId} AND account_id = ${card.createdBy}`,
      );
      for (const each of told)
        await raise(
          tx,
          {
            recipient: each.id,
            kind: 'comment',
            actor: accountId,
            workspaceId: card.workspaceId,
            boardId: card.boardId,
            cardId: request.cardId,
            subject: openText('card', request.cardId, 'title', card.title),
          },
          now,
        );
      return { card: await cardTile(tx, request.cardId), version };
    }
    case 'comment.edit':
    case 'comment.delete': {
      // Its author's to edit, and its author's or the board owner's to delete: both are members of an open board, and the statement says which.
      const changed = await dbAll<{ boardId: string; cardId: string }>(
        tx,
        request.op === 'comment.edit'
          ? sql`UPDATE ${t.comment} SET body = ${sealText('comment', request.id, 'body', request.body)}, edited_at = ${now}
                WHERE id = ${request.id} AND author_id = ${accountId} AND board_id IN ${boardsEditableBy(tx, accountId)}
                RETURNING board_id AS "boardId", card_id AS "cardId"`
          : sql`DELETE FROM ${t.comment}
                WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)}
                  AND (author_id = ${accountId} OR board_id IN ${boardsOwnedBy(tx, accountId)})
                RETURNING board_id AS "boardId", card_id AS "cardId"`,
      );
      const row = changed[0];
      if (!row) throw new Refused('not_found');
      const version = await touchBoard(tx, row.boardId, boardsEditableBy(tx, accountId), now, true);
      const card = await cardTile(tx, row.cardId);
      return request.op === 'comment.delete'
        ? { deletedComment: request.id, card, version }
        : { card, version };
    }
    case 'card.moveToBoard': {
      // The card, with the permission in its statement: a member of its board, which is open, and the card is not archived.
      const taken = await dbAll<{ boardId: string; workspaceId: string }>(
        tx,
        sql`UPDATE ${t.card} SET updated_at = ${now}
            WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)} AND archived_at IS NULL
            RETURNING board_id AS "boardId", (SELECT workspace_id FROM ${t.board} WHERE id = ${t.card}.board_id) AS "workspaceId"`,
      );
      const source = taken[0];
      if (!source || source.boardId === request.boardId) throw new Refused('not_found');
      // The other board: of the same workspace, and one the person is a member of (and open), and the list is its own.
      const sameWorkspace = await dbGet<{ one: number }>(
        tx,
        sql`SELECT 1 AS one FROM ${t.board} WHERE id = ${request.boardId} AND workspace_id = ${source.workspaceId}`,
      );
      if (!sameWorkspace) throw new Refused('not_found');
      const version = await touchBoard(
        tx,
        request.boardId,
        boardsEditableBy(tx, accountId),
        now,
        true,
      );
      await touchBoard(tx, source.boardId, boardsEditableBy(tx, accountId), now, true);
      const listThere = await dbGet<{ name: string }>(
        tx,
        sql`SELECT name FROM ${t.boardList} WHERE id = ${request.listId} AND board_id = ${request.boardId}`,
      );
      if (!listThere) throw new Refused('not_found');
      const count = await dbGet<{ n: number | string }>(
        tx,
        sql`SELECT COUNT(*) AS n FROM ${t.card} WHERE board_id = ${request.boardId}`,
      );
      if (Number(count?.n ?? 0) >= WORKSPACE_LIMITS.cardsPerBoard) throw new Refused('limit');
      // Labels: matched there by name and colour, and made if the board lacks them.
      const carried = await dbAll<{ id: string; name: string; color: string }>(
        tx,
        sql`SELECT l.id AS id, l.name AS name, l.color AS color FROM ${t.cardLabel} cl JOIN ${t.label} l ON l.id = cl.label_id
            WHERE cl.card_id = ${request.id} ORDER BY l.created_at, l.id`,
      );
      await dbAll(
        tx,
        sql`DELETE FROM ${t.cardLabel} WHERE card_id = ${request.id} RETURNING 1 AS one`,
      );
      for (const carriedLabel of carried) {
        // Matched by name and colour: the name is compared opened, since under the operator key the database cannot compare it.
        const label = {
          ...carriedLabel,
          name: openText('label', carriedLabel.id, 'name', carriedLabel.name),
        };
        const candidates = await dbAll<{ id: string; name: string }>(
          tx,
          sql`SELECT id, name FROM ${t.label} WHERE board_id = ${request.boardId} AND color = ${label.color} ORDER BY created_at, id`,
        );
        let there = candidates.find(
          (each) => openText('label', each.id, 'name', each.name) === label.name,
        )?.id;
        if (!there) {
          const have = await dbGet<{ n: number | string }>(
            tx,
            sql`SELECT COUNT(*) AS n FROM ${t.label} WHERE board_id = ${request.boardId}`,
          );
          if (Number(have?.n ?? 0) >= WORKSPACE_LIMITS.labelsPerBoard) throw new Refused('limit');
          there = crypto.randomUUID();
          await dbAll(
            tx,
            sql`INSERT INTO ${t.label} (id, board_id, name, color, created_at) VALUES (${there}, ${request.boardId}, ${sealText('label', there, 'name', label.name)}, ${label.color}, ${now}) RETURNING id`,
          );
        }
        await dbAll(
          tx,
          sql`INSERT INTO ${t.cardLabel} (card_id, label_id, board_id) VALUES (${request.id}, ${there}, ${request.boardId})
              ON CONFLICT (card_id, label_id) DO NOTHING RETURNING card_id`,
        );
      }
      // Assignees who are not members there are dropped; the rest go with the card.
      await dbAll(
        tx,
        sql`DELETE FROM ${t.cardAssignee} WHERE card_id = ${request.id}
            AND account_id NOT IN (SELECT account_id FROM ${t.boardMember} WHERE board_id = ${request.boardId}) RETURNING 1 AS one`,
      );
      // The card and everything that is its own go to the other board: its checklist, its comments and its history.
      const before = await dbGet<{ title: string; boardId: string; boardName: string }>(
        tx,
        sql`SELECT c.title AS title, b.id AS "boardId", b.name AS "boardName" FROM ${t.card} c JOIN ${t.board} b ON b.id = c.board_id WHERE c.id = ${request.id}`,
      );
      const was = before && {
        title: openText('card', request.id, 'title', before.title),
        boardName: openText('board', before.boardId, 'name', before.boardName),
      };
      await dbAll(
        tx,
        sql`UPDATE ${t.card} SET board_id = ${request.boardId}, list_id = ${request.listId}, position = ${request.position}, updated_at = ${now}
            WHERE id = ${request.id} RETURNING id`,
      );
      for (const table of [t.checklistItem, t.comment, t.cardAssignee, t.activity, t.notice])
        await dbAll(
          tx,
          sql`UPDATE ${table} SET board_id = ${request.boardId} WHERE card_id = ${request.id} RETURNING 1 AS one`,
        );
      const target = await dbGet<{ name: string }>(
        tx,
        sql`SELECT name FROM ${t.board} WHERE id = ${request.boardId}`,
      );
      // Both boards' history say so: the one it left (with no card, since the card is no longer there), and the one it came to (as part of the card's own).
      const out = crypto.randomUUID();
      const into = crypto.randomUUID();
      const targetName = target ? openText('board', request.boardId, 'name', target.name) : '';
      await dbAll(
        tx,
        sql`INSERT INTO ${t.activity} (id, board_id, card_id, actor_id, kind, details, created_at)
            VALUES (${out}, ${source.boardId}, NULL, ${accountId}, 'card.moved_out',
                    ${sealText('activity', out, 'details', JSON.stringify({ title: was?.title ?? '', to: targetName }))}, ${now}) RETURNING id`,
      );
      await dbAll(
        tx,
        sql`INSERT INTO ${t.activity} (id, board_id, card_id, actor_id, kind, details, created_at)
            VALUES (${into}, ${request.boardId}, ${request.id}, ${accountId}, 'card.moved_in',
                    ${sealText('activity', into, 'details', JSON.stringify({ title: was?.title ?? '', from: was?.boardName ?? '' }))}, ${now}) RETURNING id`,
      );
      return { card: await cardTile(tx, request.id), version };
    }
    case 'card.clone': {
      const taken = await dbAll<{
        boardId: string;
        listId: string;
        title: string;
        description: string | null;
        dueDate: string | null;
        dueTime: string | null;
        position: string;
      }>(
        tx,
        sql`UPDATE ${t.card} SET updated_at = ${now}
            WHERE id = ${request.id} AND board_id IN ${boardsEditableBy(tx, accountId)} AND archived_at IS NULL
            RETURNING board_id AS "boardId", list_id AS "listId", title, description, due_date AS "dueDate", due_time AS "dueTime", position`,
      );
      const row = taken[0];
      if (!row) throw new Refused('not_found');
      const original = {
        ...row,
        title: openText('card', request.id, 'title', row.title),
        description: open('card', request.id, 'description', row.description),
      };
      const version = await touchBoard(
        tx,
        original.boardId,
        boardsEditableBy(tx, accountId),
        now,
        true,
      );
      const count = await dbGet<{ n: number | string }>(
        tx,
        sql`SELECT COUNT(*) AS n FROM ${t.card} WHERE board_id = ${original.boardId}`,
      );
      if (Number(count?.n ?? 0) >= WORKSPACE_LIMITS.cardsPerBoard) throw new Refused('limit');
      // Below it: between its position and the next card's in the same list.
      const next = await dbGet<{ position: string }>(
        tx,
        sql`SELECT position FROM ${t.card} WHERE list_id = ${original.listId} AND archived_at IS NULL AND position > ${original.position}
            ORDER BY position, id LIMIT 1`,
      );
      const made = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${t.card} (id, board_id, list_id, title, description, due_date, due_time, position, created_by, created_at, updated_at)
            VALUES (${request.newId}, ${original.boardId}, ${original.listId}, ${sealText('card', request.newId, 'title', original.title)}, ${seal('card', request.newId, 'description', original.description)}, ${original.dueDate},
                    ${original.dueTime}, ${between(original.position, next?.position ?? null)}, ${accountId}, ${now}, ${now})
            ON CONFLICT (id) DO NOTHING RETURNING id`,
      );
      if (made.length === 0) throw new Refused('not_found');
      // Its checklist, unticked; its labels and its assignees. Not its comments or its history.
      await dbAll(
        tx,
        sql`INSERT INTO ${t.cardLabel} (card_id, label_id, board_id)
            SELECT ${request.newId}, label_id, board_id FROM ${t.cardLabel} WHERE card_id = ${request.id} RETURNING card_id`,
      );
      await dbAll(
        tx,
        sql`INSERT INTO ${t.cardAssignee} (card_id, account_id, board_id, assigned_by, created_at)
            SELECT ${request.newId}, account_id, board_id, ${accountId}, ${now} FROM ${t.cardAssignee} WHERE card_id = ${request.id} RETURNING card_id`,
      );
      const items = await dbAll<{ id: string; title: string; position: string }>(
        tx,
        sql`SELECT id, title, position FROM ${t.checklistItem} WHERE card_id = ${request.id} ORDER BY position, id`,
      );
      for (const item of items) {
        const copy = crypto.randomUUID();
        await dbAll(
          tx,
          sql`INSERT INTO ${t.checklistItem} (id, card_id, board_id, title, completed_at, position, created_at)
              VALUES (${copy}, ${request.newId}, ${original.boardId}, ${sealText('checklist_item', copy, 'title', openText('checklist_item', item.id, 'title', item.title))}, NULL, ${item.position}, ${now}) RETURNING id`,
        );
      }
      const cloned = crypto.randomUUID();
      await dbAll(
        tx,
        sql`INSERT INTO ${t.activity} (id, board_id, card_id, actor_id, kind, details, created_at)
            VALUES (${cloned}, ${original.boardId}, ${request.newId}, ${accountId}, 'card.cloned',
                    ${sealText('activity', cloned, 'details', JSON.stringify({ title: original.title, from: original.title }))}, ${now}) RETURNING id`,
      );
      return { card: await cardTile(tx, request.newId), version };
    }
    case 'board.publish':
    case 'board.unpublish': {
      // An administrator's. A board is published while it is open; taking it down is allowed whatever state it is in, so that an archived board's address can go.
      const version = await touchBoard(
        tx,
        request.id,
        boardsAdministeredBy(tx, accountId),
        now,
        request.op === 'board.publish',
      );
      const existing = await dbGet<{ token: string }>(
        tx,
        sql`SELECT token FROM ${t.publication} WHERE board_id = ${request.id}`,
      );
      if (request.op === 'board.unpublish') {
        if (!existing) throw new Refused('stale');
        await dbAll(
          tx,
          sql`DELETE FROM ${t.publication} WHERE board_id = ${request.id} RETURNING 1 AS one`,
        );
        return { unpublished: request.id, version };
      }
      if (existing) return { publication: { boardId: request.id, token: existing.token }, version };
      // 32 random bytes, base64url: an address that cannot be guessed (DESIGN.md §14.6).
      const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
      await dbAll(
        tx,
        sql`INSERT INTO ${t.publication} (board_id, token, created_by, created_at) VALUES (${request.id}, ${token}, ${accountId}, ${now}) RETURNING board_id`,
      );
      return { publication: { boardId: request.id, token }, version };
    }
    case 'workspace.rename': {
      // The permission is in the statement: only an owner's workspace is a row it can reach.
      const changed = await dbAll<{ createdAt: number | string }>(
        tx,
        sql`UPDATE ${t.workspace} SET name = ${sealText('workspace', request.id, 'name', request.name)}, updated_at = ${now}
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

/** A checklist item as the transaction now has it. */
async function itemRow(tx: Database, id: string): Promise<ChecklistItem> {
  const row = await dbGet<{
    id: string;
    cardId: string;
    title: string;
    completedAt: number | string | null;
    position: string;
  }>(
    tx,
    sql`SELECT id, card_id AS "cardId", title, completed_at AS "completedAt", position FROM ${tablesOf(tx).checklistItem} WHERE id = ${id}`,
  );
  if (!row) throw new Refused('not_found');
  return {
    id: row.id,
    cardId: row.cardId,
    title: openText('checklist_item', row.id, 'title', row.title),
    done: row.completedAt !== null,
    position: row.position,
  };
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
  const labels = await dbAll<{ id: string }>(
    tx,
    sql`SELECT cl.label_id AS id FROM ${t.cardLabel} cl JOIN ${t.label} l ON l.id = cl.label_id
        WHERE cl.card_id = ${id} ORDER BY l.created_at, l.id`,
  );
  const assignees = await dbAll<{ id: string }>(
    tx,
    sql`SELECT account_id AS id FROM ${t.cardAssignee} WHERE card_id = ${id} ORDER BY created_at, account_id`,
  );
  const progress = await dbGet<{ total: number | string; done: number | string | null }>(
    tx,
    sql`SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END) AS done
        FROM ${t.checklistItem} WHERE card_id = ${id}`,
  );
  return {
    ...row,
    title: openText('card', row.id, 'title', row.title),
    hasDescription: row.hasDescription === true || Number(row.hasDescription) === 1,
    labels: labels.map((each) => each.id),
    assignees: assignees.map((each) => each.id),
    checklist: { done: Number(progress?.done ?? 0), total: Number(progress?.total ?? 0) },
    comments: Number(
      (
        await dbGet<{ n: number | string }>(
          tx,
          sql`SELECT COUNT(*) AS n FROM ${t.comment} WHERE card_id = ${id}`,
        )
      )?.n ?? 0,
    ),
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
export async function deleteWorkspace(tx: Database, workspaceId: string): Promise<void> {
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
