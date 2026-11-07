import { loadConfig } from './src/config';
import { processEnv } from './src/config/env';

/**
 * Brings the server up, or stops it. The standalone server would otherwise stay up and answer, and an instance would find the mistake from a
 * person using it:
 *
 * 1. The settings are checked, and a wrong one stops the server, naming it.
 * 2. The database is provisioned, opened and migrated (DESIGN.md §22.1), and the server does not start if it cannot. It waits for one that is
 *    still starting, up to TUSK_DB_CONNECT_TIMEOUT_MS, since in a compose file the app and its database come up together. The credentials that
 *    are kept sealed must be openable with the keys it was given, or it stops, naming the keys; and are moved to a new key when one is given.
 *
 * 3. The background jobs start, unless `TUSK_WORKER=off` (src/jobs), and stop when the process is told to (SIGTERM, which Docker sends).
 */
export async function start(): Promise<void> {
  const result = loadConfig(processEnv());
  if (!result.ok) {
    console.error('Tusk cannot start, because of its settings:');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  try {
    const { getStores } = await import('./src/db/boot');
    const stores = await getStores(result.config.database);
    // What is kept sealed must be openable: a key that was dropped stops the server here, naming it, and not a backup later. Credentials wrapped under the
    // previous key are moved to the current one (DESIGN.md §21.2), by whichever replica starts first or all of them: each row is moved once.
    const { assertKeys, rotateCredentials } = await import('./src/crypto/store');
    await assertKeys(stores.app, result.config.encryption);
    if (result.config.encryption) await rotateCredentials(stores.app, result.config.encryption);
  } catch (error) {
    console.error('Tusk cannot start, because its database is not usable:');
    console.error(`  - ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const { startJobs } = await import('./src/jobs');
  const runner = startJobs(result.config);
  if (runner) {
    // Next's own handler closes the server and exits with the signal's code; this one stops the timers at once and gives a run in flight a
    // moment, which it may not use up if Next finishes first: a run cut off is safe, because every job claims its work (src/jobs/claim.ts).
    const stop = () => void runner.stop();
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  }
}
