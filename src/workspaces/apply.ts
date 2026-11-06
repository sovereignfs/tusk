import { type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import type { Directory } from '../auth/directory';
import { workspacesOf, workspacesOwnedBy } from './can';
import {
  type OpReason,
  type OpRefusal,
  type OpRequest,
  type OpResult,
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
  const inBoards = sql`board_id IN (SELECT id FROM ${t.board} WHERE workspace_id = ${workspaceId})`;
  for (const table of [
    t.activity,
    t.comment,
    t.checklistItem,
    t.cardAssignee,
    t.cardLabel,
    t.label,
    t.card,
    t.boardList,
    t.publication,
    t.boardMember,
  ]) {
    await dbAll(tx, sql`DELETE FROM ${table} WHERE ${inBoards} RETURNING 1 AS one`);
  }
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
