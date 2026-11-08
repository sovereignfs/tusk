import { authDirectory } from '../auth/directory';
import { runDueBackups } from '../backup/auto';
import type { Config } from '../config';
import { getConfig } from '../config/current';
import { getAuthDatabase, getDatabase } from '../db/boot';
import { installationTokens } from '../github-app/server';
import { deliverNotices } from '../notifications/deliver';
import { serverChannels } from '../notifications/server';
import { purge } from '../sync/purge';
import { trimNotices } from '../workspaces/inbox';
import { JobRunner, realDeps, type JobDefinition, type RunnerDeps } from './runner';
import { operatorOf } from '../crypto/operator';

/**
 * Every job the app has. Each task that has one adds it here: the purge (13.7, here), the reminders (8.5, 8.6) and the backups (10.5, here).
 */
export const jobs: readonly JobDefinition[] = [
  {
    // Deleted rows are removed for good after seven days, and old tombstones go (DESIGN.md §8.7). Hourly is often enough for a seven-day rule, and the job
    // is safe to run from any process at any time.
    name: 'purge',
    everyMs: 60 * 60 * 1000,
    runAtStart: true,
    run: async ({ now }) => {
      await purge(await getDatabase(), now.getTime(), getConfig().operatorEncryption);
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
  {
    // Inbox notices that go outside the app too (DESIGN.md §25.2), by email and core's bell, for the kinds a person asked to have sent. Each notice is claimed by a
    // conditional update, so any process may run this at any time and one sends each. With no channel on this server nothing is claimed.
    name: 'send-notices',
    everyMs: 30 * 1000,
    run: async ({ now }) => {
      const config = getConfig();
      if (!config.mail && !config.auth?.sovereign && !config.push) return;
      const database = await getDatabase();
      const channels = serverChannels(
        config,
        { app: database, auth: await getAuthDatabase() },
        (line) => console.info(line),
      );
      if (channels.length > 0)
        await deliverNotices(database, channels, now.getTime(), {
          log: (line) => console.info(line),
        });
    },
  },
  {
    // The automatic backups that are due (DESIGN.md §21.4). Each is claimed by a conditional update, so any process may run this at any time and one runs
    // each connection. Without an instance key nothing can have been connected.
    name: 'backups',
    everyMs: 60 * 1000,
    run: async ({ now }) => {
      const config = getConfig();
      // With neither a key nor the App there is nothing that could have been connected.
      if (!config.encryption && !config.githubApp) return;
      const summary = await runDueBackups(
        {
          database: await getDatabase(),
          directory: authDirectory(await getAuthDatabase()),
          ring: config.encryption,
          ...(operatorOf(config) ? { operator: operatorOf(config) } : {}),
          apiUrl: config.githubApiUrl,
          ...(installationTokens() ? { tokens: installationTokens() } : {}),
        },
        now.getTime(),
        {},
        (line) => console.info(line),
      );
      if (summary.claimed > 0)
        console.info(
          `[tusk] backup: ${summary.committed} written, ${summary.unchanged} unchanged, ${summary.failed} failed`,
        );
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
