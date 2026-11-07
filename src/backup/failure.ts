import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, transaction } from '../db/exec';
import { raiseSystem } from '../workspaces/notices';
import { backupConnectionTable } from './tables';
import type { RunProblem } from './run';

/**
 * What a backup that failed means for the next (DESIGN.md §21.4). **A failure that will mend itself is tried again at the next due time, never at once:** the
 * host did not answer, asked to be left alone (then not before it said), or the branch kept moving. **A failure that will not mend itself stops the automatic
 * backups:** a token that no longer works, a repository that is gone, made public or empty, a file too big, a key not confirmed, or a server that has lost its
 * key. It says so in Settings, with what to do, and once, in the Inbox. A repaired token (connecting again), **Back up now**, or choosing automatic again
 * resumes; a stopped connection is not claimed by the job, so it makes no calls at all while it is stopped. A backup that worked clears all of it.
 */
export const STOPS: ReadonlySet<RunProblem> = new Set([
  'token_rejected',
  'read_only',
  'not_visible',
  'public',
  'empty',
  'too_large',
  'key_unconfirmed',
  'no_key',
]);

/** Whether a failure of this kind stops automatic backups. */
export const stops = (problem: RunProblem): boolean => STOPS.has(problem);

/**
 * Keeps the failure: its kind and how many in a row. If it is one that stops, the connection is stopped **by a conditional update that only one caller wins**,
 * and the winner tells the person in the Inbox, in the same transaction, so that they are told once however many processes fail at the same moment. A host that
 * said when to come back moves the next automatic backup to then, if that is later than it was. Returns whether the connection was stopped by this call.
 */
export async function recordFailure(
  database: Database,
  accountId: string,
  problem: RunProblem,
  now: number,
  options: { retryAfterMs?: number } = {},
): Promise<boolean> {
  if (problem === 'not_connected') return false;
  const table = backupConnectionTable(database);
  return transaction(database, async (tx) => {
    await dbAll(
      tx,
      sql`UPDATE ${table} SET failure_kind = ${problem}, failures = failures + 1 WHERE account_id = ${accountId} RETURNING account_id`,
    );
    if (options.retryAfterMs !== undefined) {
      const later = now + options.retryAfterMs;
      await dbAll(
        tx,
        sql`UPDATE ${table} SET next_backup_at = ${later}
            WHERE account_id = ${accountId} AND mode = 'auto' AND next_backup_at IS NOT NULL AND next_backup_at < ${later} RETURNING account_id`,
      );
    }
    if (!stops(problem)) return false;
    const won = await dbAll(
      tx,
      sql`UPDATE ${table} SET stopped_at = ${now} WHERE account_id = ${accountId} AND stopped_at IS NULL RETURNING account_id`,
    );
    if (won.length === 0) return false;
    // Told once, in the same transaction as the stop. The person's own setting for this kind is kept to (a notice turned off is not written).
    await raiseSystem(tx, { recipient: accountId, kind: 'backup_stopped', subject: problem }, now);
    return true;
  });
}

/** A backup that worked: the failures and the stop are over. */
export async function recordSuccessClearing(database: Database, accountId: string): Promise<void> {
  await dbAll(
    database,
    sql`UPDATE ${backupConnectionTable(database)} SET failure_kind = NULL, failures = 0, stopped_at = NULL
        WHERE account_id = ${accountId} RETURNING account_id`,
  );
}
