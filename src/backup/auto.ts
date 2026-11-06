import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { claim } from '../jobs/claim';
import { kindOf } from '../jobs/runner';
import { type Connection, readConnection } from './connection';
import { type RunDeps, runBackup } from './run';
import { type Frequency, type Mode, isFrequency, nextBackup } from './schedule';
import { backupConnectionTable } from './tables';

/**
 * Automatic backups (DESIGN.md §21.1, §21.4). **A person chooses `manual` or `auto` and, for `auto`, how often** (`setSchedule`); a job looks every minute for
 * the connections that are due (`runDueBackups`). **A process claims a connection by a conditional update that moves `next_backup_at` on and holds only
 * while it is still what was read,** so that however many processes tick at once, one runs it, and a run that fails is simply tried again at the next due
 * time and never at once. A `manual` connection has no due time and the job never runs it. A run only writes if something changed since the last backup
 * (`runBackup` compares the fingerprint); otherwise it records that it looked.
 */

/**
 * Changes how a connection is run, and when it is next due. **Switching to `manual` clears the next time;** switching to `auto`, or to another frequency
 * while on it, sets it one interval from `now` (with the account's spread); changing nothing leaves it alone. `undefined` when nothing is connected.
 */
export async function setSchedule(
  database: Database,
  accountId: string,
  patch: { mode?: Mode; frequency?: Frequency },
  now: number,
): Promise<Connection | undefined> {
  const current = await readConnection(database, accountId);
  if (!current) return undefined;
  const mode = patch.mode ?? current.mode;
  const frequency = patch.frequency ?? current.frequency;
  const next =
    mode === 'manual'
      ? null
      : mode !== current.mode || frequency !== current.frequency || current.nextBackupAt === null
        ? nextBackup(frequency, now, accountId)
        : current.nextBackupAt;
  await dbAll(
    database,
    sql`UPDATE ${backupConnectionTable(database)} SET mode = ${mode}, frequency = ${frequency}, next_backup_at = ${next}
        WHERE account_id = ${accountId} RETURNING account_id`,
  );
  return readConnection(database, accountId);
}

export interface DueOptions {
  /** The most connections taken in one tick. */
  readonly cap?: number;
  /** How many run at once. */
  readonly concurrency?: number;
}

export interface DueSummary {
  /** Connections this process won the right to run. */
  readonly claimed: number;
  readonly committed: number;
  readonly unchanged: number;
  readonly failed: number;
}

export const DEFAULT_CAP = 20;
export const DEFAULT_CONCURRENCY = 3;

/** The connections whose time has come, oldest first. */
async function due(database: Database, now: number, cap: number) {
  const rows = await dbAll<{ accountId: string; frequency: string; due: number | string }>(
    database,
    sql`SELECT account_id AS "accountId", frequency, next_backup_at AS due FROM ${backupConnectionTable(database)}
        WHERE mode = 'auto' AND next_backup_at IS NOT NULL AND next_backup_at <= ${now}
        ORDER BY next_backup_at, account_id LIMIT ${cap}`,
  );
  return rows.map((row) => ({
    accountId: row.accountId,
    due: Number(row.due),
    frequency: isFrequency(row.frequency) ? row.frequency : ('daily' as const),
  }));
}

/** The job's work for one tick, with the clock passed in. Safe to run from any number of processes at once. */
export async function runDueBackups(
  deps: RunDeps,
  now: number,
  options: DueOptions = {},
  log: (line: string) => void = () => undefined,
): Promise<DueSummary> {
  const cap = options.cap ?? DEFAULT_CAP;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const candidates = await due(deps.database, now, cap);
  const summary = { claimed: 0, committed: 0, unchanged: 0, failed: 0 };

  const take = async (candidate: (typeof candidates)[number]) => {
    // The next time is moved on first, and only by the process whose update found it as it was read: it is the one that runs this.
    const next = nextBackup(candidate.frequency, now, candidate.accountId, candidate.due);
    const won = await claim(
      deps.database,
      sql`UPDATE ${backupConnectionTable(deps.database)} SET next_backup_at = ${next}
          WHERE account_id = ${candidate.accountId} AND mode = 'auto' AND next_backup_at = ${candidate.due}
          RETURNING account_id`,
    );
    if (!won) return;
    summary.claimed += 1;
    try {
      const result = await runBackup(deps, candidate.accountId, now, 'auto');
      if (!result.ok) summary.failed += 1;
      else if (result.unchanged) summary.unchanged += 1;
      else summary.committed += 1;
    } catch (error) {
      // What went wrong is said by its kind alone: its message could hold a repository or a path.
      summary.failed += 1;
      log(`[tusk] backup: a run failed (${kindOf(error)})`);
    }
  };

  const queue = [...candidates];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await take(next);
    }),
  );
  return summary;
}
