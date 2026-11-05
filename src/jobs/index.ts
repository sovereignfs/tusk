import type { Config } from '../config';
import { JobRunner, realDeps, type JobDefinition, type RunnerDeps } from './runner';

/**
 * Every job the app has. Each task that has one adds it here: the purge (13.7), the reminders (8.5, 8.6) and the backups (10.5). None is
 * built yet, so the runner starts with nothing to run, and that is the state its tests prove it is right in.
 */
export const jobs: readonly JobDefinition[] = [];

/**
 * Starts the jobs, or says why not. `TASKS_WORKER=off` runs nothing in this process: when several share a database, one runs the jobs and the
 * others only serve (DESIGN.md §5). Returns the runner, so that the server can stop it.
 */
export function startJobs(
  config: Pick<Config, 'worker'>,
  definitions: readonly JobDefinition[] = jobs,
  deps: RunnerDeps = realDeps,
): JobRunner | undefined {
  if (!config.worker) {
    deps.log('[tasks] jobs: off in this process (TASKS_WORKER=off)');
    return undefined;
  }
  const runner = new JobRunner(deps);
  for (const job of definitions) runner.register(job);
  runner.start();
  deps.log(`[tasks] jobs: running ${definitions.length} job${definitions.length === 1 ? '' : 's'}`);
  return runner;
}
