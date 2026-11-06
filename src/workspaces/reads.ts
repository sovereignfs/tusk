import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import type { Directory } from '../auth/directory';
import { workspacesOf } from './can';
import { type Person, type Role, WORKSPACE_LIMITS, type WorkspaceRow } from './format';
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
