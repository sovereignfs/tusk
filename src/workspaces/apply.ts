import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import { workspacesOwnedBy } from './can';
import { type OpRefusal, type OpRequest, type OpResult, WORKSPACE_LIMITS } from './format';
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
}

class Refused extends Error {
  constructor(readonly code: OpRefusal) {
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

      const rows = await run(tx, accountId, request, options.now);
      return { status: 'applied', replay: false, rows } as const;
    });
  } catch (error) {
    if (error instanceof Refused) return { status: 'refused', code: error.code };
    throw error;
  }
}

async function run(tx: Database, accountId: string, request: OpRequest, now: number) {
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
