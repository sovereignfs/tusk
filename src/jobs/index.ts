import type { Config } from '../config';
import { getDatabase } from '../db/boot';
import { purge } from '../sync/purge';
import { trimNotices } from '../workspaces/inbox';
import { JobRunner, realDeps, type JobDefinition, type RunnerDeps } from './runner';

/**
 * Every job the app has. Each task that has one adds it here: the purge (13.7, here), the reminders (8.5, 8.6) and the backups (10.5).
 */
export const jobs: readonly JobDefinition[] = [
  {
    // Deleted rows are removed for good after seven days, and old tombstones go (DESIGN.md §8.7). Hourly is often enough for a seven-day rule, and the job
    // is safe to run from any process at any time.
    name: 'purge',
    everyMs: 60 * 60 * 1000,
    runAtStart: true,
    run: async ({ now }) => {
      await purge(await getDatabase(), now.getTime());
    },
  },
  {
    // Notices older than 90 days go, and each person keeps the latest 500 (DESIGN.md §16). Safe to run from any process at any time.
    name: 'trim-notices',
    everyMs: 60 * 60 * 1000,
    runAtStart: true,
    run: async ({ now }) => {
      await trimNotices(await getDatabase(), now.getTime());
    },
  },
];

/**
 * Starts the jobs, or says why not. `TUSK_WORKER=off` runs nothing in this process: when several share a database, one runs the jobs and the
 * others only serve (DESIGN.md §5). Returns the runner, so that the server can stop it.
 */
export function startJobs(
  config: Pick<Config, 'worker'>,
  definitions: readonly JobDefinition[] = jobs,
  deps: RunnerDeps = realDeps,
): JobRunner | undefined {
  if (!config.worker) {
    deps.log('[tusk] jobs: off in this process (TUSK_WORKER=off)');
    return undefined;
  }
  const runner = new JobRunner(deps);
  for (const job of definitions) runner.register(job);
  runner.start();
  deps.log(`[tusk] jobs: running ${definitions.length} job${definitions.length === 1 ? '' : 's'}`);
  return runner;
}
