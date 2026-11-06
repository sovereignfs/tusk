import { type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { tablesOf } from './tables';

/**
 * Who may do what, as **subqueries** that a statement carries (DESIGN.md §7.1, §7.2): never a check first and a write after. Each is "the ids this
 * account may reach", to be put after `id IN` or `board_id IN`, with the account bound as a value. A row that is not reachable is, to this account, not there,
 * and the statement affects nothing.
 *
 *  - `workspacesOwnedBy`, `workspacesOf`   the workspaces an account owns, and is in.
 *  - `boardsVisibleTo`   a public board of a workspace one is in, a board one is a member of, and every board of a workspace one owns (private included).
 *  - `boardsEditableBy`  a board one is a member of, and that is not archived. **Only membership edits**: a workspace owner who is not a member sees and
 *                        administers a board and does not touch its cards (§7.2).
 *  - `boardsAdministeredBy`  a board one owns, and every board of a workspace one owns. Archived or not: restoring one is administration.
 */
export function workspacesOwnedBy(database: Database, accountId: string): SQL {
  const { workspaceMember } = tablesOf(database);
  return sql`(SELECT workspace_id FROM ${workspaceMember} WHERE account_id = ${accountId} AND role = 'owner')`;
}

export function workspacesOf(database: Database, accountId: string): SQL {
  const { workspaceMember } = tablesOf(database);
  return sql`(SELECT workspace_id FROM ${workspaceMember} WHERE account_id = ${accountId})`;
}

export function boardsVisibleTo(database: Database, accountId: string): SQL {
  const { board, boardMember } = tablesOf(database);
  return sql`(
    SELECT id FROM ${board} WHERE visibility = 'public' AND workspace_id IN ${workspacesOf(database, accountId)}
    UNION SELECT board_id FROM ${boardMember} WHERE account_id = ${accountId}
    UNION SELECT id FROM ${board} WHERE workspace_id IN ${workspacesOwnedBy(database, accountId)}
  )`;
}

export function boardsEditableBy(database: Database, accountId: string): SQL {
  const { board, boardMember } = tablesOf(database);
  return sql`(
    SELECT m.board_id FROM ${boardMember} m JOIN ${board} b ON b.id = m.board_id
    WHERE m.account_id = ${accountId} AND b.archived_at IS NULL
  )`;
}

export function boardsAdministeredBy(database: Database, accountId: string): SQL {
  const { board, boardMember } = tablesOf(database);
  return sql`(
    SELECT board_id FROM ${boardMember} WHERE account_id = ${accountId} AND role = 'owner'
    UNION SELECT id FROM ${board} WHERE workspace_id IN ${workspacesOwnedBy(database, accountId)}
  )`;
}
