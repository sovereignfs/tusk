import { loadConfig } from './src/config';
import { processEnv } from './src/config/env';

/**
 * Brings the server up, or stops it. The standalone server would otherwise stay up and answer, and an instance would find the mistake from a
 * person using it:
 *
 * 1. The settings are checked, and a wrong one stops the server, naming it.
 * 2. The database is provisioned, opened and migrated (DESIGN.md §22.1), and the server does not start if it cannot. It waits for one that is
 *    still starting, up to TASKS_DB_CONNECT_TIMEOUT_MS, since in a compose file the app and its database come up together.
 *
 * Later tasks add what else has to be up before anything is served: the jobs (1.6).
 */
export async function start(): Promise<void> {
  const result = loadConfig(processEnv());
  if (!result.ok) {
    console.error('Tasks cannot start, because of its settings:');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  try {
    const { getStores } = await import('./src/db/boot');
    await getStores(result.config.database);
  } catch (error) {
    console.error('Tasks cannot start, because its database is not usable:');
    console.error(`  - ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
