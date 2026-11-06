import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import { workspacesOf } from './can';
import { WORKSPACE_LIMITS, type WorkspaceRow } from './format';
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
