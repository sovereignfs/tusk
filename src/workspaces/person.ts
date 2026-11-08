import { sql } from 'drizzle-orm';
import type { Directory } from '../auth/directory';
import type { Database } from '../db/client';
import { dbAll, transaction } from '../db/exec';
import { deleteWorkspace } from './apply';
import { raiseSystem } from './notices';
import { tablesOf } from './tables';
import { inNameOrder, nameOrderSql, openText } from './content';

/**
 * What becomes of a person's part in the shared work when their account goes (DESIGN.md §22). **Shared work is left to the people still using it:** a
 * workspace where they are the only owner passes to the member who has been in it longest, who is told in their Inbox, and one with nobody else in it is
 * deleted with its boards; everywhere else they are taken out of the workspace and its boards and unassigned, as removing a person does (§7.2). **Their
 * comments, the cards they made and the activity they caused stay,** and resolve to "Deleted account" because the account no longer answers to a name:
 * nothing is copied to keep it. Each workspace is one transaction, and the whole is written to be run again: what is done is not there to be done twice.
 */
export interface Passing {
  readonly workspaceId: string;
  readonly name: string;
  /** Who it passes to, by name, or `null` if it is to be deleted because nobody else is in it. */
  readonly to: string | null;
}

/** The members of a workspace other than `accountId`, the one who has been in it longest first. */
async function successors(tx: Database, workspaceId: string, accountId: string) {
  const t = tablesOf(tx);
  return dbAll<{ accountId: string }>(
    tx,
    sql`SELECT account_id AS "accountId" FROM ${t.workspaceMember}
        WHERE workspace_id = ${workspaceId} AND account_id <> ${accountId}
        ORDER BY created_at, account_id`,
  );
}

/** The workspaces of the person where they are the only owner, and what would become of each: for the screen that asks before it is done. */
export async function previewLeaving(
  database: Database,
  directory: Pick<Directory, 'profiles'>,
  accountId: string,
): Promise<Passing[]> {
  const t = tablesOf(database);
  const soleRows = await dbAll<{ workspaceId: string; name: string }>(
    database,
    sql`SELECT w.id AS "workspaceId", w.name AS name FROM ${t.workspace} w
        JOIN ${t.workspaceMember} m ON m.workspace_id = w.id AND m.account_id = ${accountId} AND m.role = 'owner'
        WHERE NOT EXISTS (
          SELECT 1 FROM ${t.workspaceMember} o WHERE o.workspace_id = w.id AND o.role = 'owner' AND o.account_id <> ${accountId}
        )
        ${sql.raw(nameOrderSql('w.name', 'w.id'))}`,
  );
  const sole = inNameOrder(
    soleRows.map((row) => ({
      id: row.workspaceId,
      workspaceId: row.workspaceId,
      name: openText('workspace', row.workspaceId, 'name', row.name),
    })),
    (row) => row.name,
  );
  const out: Passing[] = [];
  for (const each of sole) {
    const next = (await successors(database, each.workspaceId, accountId))[0];
    const profile = next
      ? (await directory.profiles([next.accountId])).get(next.accountId)
      : undefined;
    out.push({
      workspaceId: each.workspaceId,
      name: each.name,
      to: next ? (profile?.name ?? 'Someone') : null,
    });
  }
  return out;
}

/**
 * Takes the person out of every workspace, handing on or deleting those they alone own. Returns what was done. Safe to run again, and safe to run when
 * stopped half way: a workspace already handed on has another owner, and one already left has no row to take.
 */
export async function leaveAllWorkspaces(
  database: Database,
  accountId: string,
  now: number,
): Promise<{ passed: number; deleted: number; left: number }> {
  const t = tablesOf(database);
  const mine = await dbAll<{ workspaceId: string }>(
    database,
    sql`SELECT workspace_id AS "workspaceId" FROM ${t.workspaceMember} WHERE account_id = ${accountId} ORDER BY workspace_id`,
  );
  const done = { passed: 0, deleted: 0, left: 0 };
  for (const { workspaceId } of mine) {
    await transaction(database, async (tx) => {
      const tt = tablesOf(tx);
      const [row] = await dbAll<{ role: string; name: string }>(
        tx,
        sql`SELECT m.role AS role, w.name AS name FROM ${tt.workspaceMember} m JOIN ${tt.workspace} w ON w.id = m.workspace_id
            WHERE m.workspace_id = ${workspaceId} AND m.account_id = ${accountId}`,
      );
      if (!row) return;
      if (row.role === 'owner') {
        const [other] = await dbAll<{ n: number | string }>(
          tx,
          sql`SELECT COUNT(*) AS n FROM ${tt.workspaceMember} WHERE workspace_id = ${workspaceId} AND role = 'owner' AND account_id <> ${accountId}`,
        );
        if (Number(other?.n ?? 0) === 0) {
          const next = (await successors(tx, workspaceId, accountId))[0];
          if (!next) {
            // Nobody else is in it: it goes, with its boards.
            await deleteWorkspace(tx, workspaceId);
            done.deleted += 1;
            return;
          }
          await dbAll(
            tx,
            sql`UPDATE ${tt.workspaceMember} SET role = 'owner' WHERE workspace_id = ${workspaceId} AND account_id = ${next.accountId} RETURNING account_id`,
          );
          await dbAll(
            tx,
            sql`UPDATE ${tt.workspace} SET updated_at = ${now} WHERE id = ${workspaceId} RETURNING id`,
          );
          await raiseSystem(
            tx,
            {
              recipient: next.accountId,
              kind: 'workspace_passed',
              subject: openText('workspace', workspaceId, 'name', row.name),
              workspaceId,
            },
            now,
          );
          done.passed += 1;
        }
      }
      await dbAll(
        tx,
        sql`DELETE FROM ${tt.workspaceMember} WHERE workspace_id = ${workspaceId} AND account_id = ${accountId} RETURNING account_id`,
      );
      await dbAll(
        tx,
        sql`DELETE FROM ${tt.boardMember} WHERE workspace_id = ${workspaceId} AND account_id = ${accountId} RETURNING account_id`,
      );
      await dbAll(
        tx,
        sql`DELETE FROM ${tt.cardAssignee}
            WHERE account_id = ${accountId} AND board_id IN (SELECT id FROM ${tt.board} WHERE workspace_id = ${workspaceId})
            RETURNING account_id`,
      );
      done.left += 1;
    });
  }
  // What they were told, and what was told about them: nothing of a person is left in another's Inbox once they are gone.
  await dbAll(
    database,
    sql`DELETE FROM ${t.notice} WHERE account_id = ${accountId} OR actor_id = ${accountId} RETURNING id`,
  );
  return done;
}
