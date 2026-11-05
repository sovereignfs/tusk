import { loadConfig } from './src/config';
import { processEnv } from './src/config/env';

/**
 * Checks the settings and stops the server on one that is wrong. The standalone server would otherwise stay up and answer, and an instance
 * would find the mistake from a person using it. Later tasks add to this what has to be up before anything is served: the database (1.5) and
 * the jobs (1.6).
 */
export async function start(): Promise<void> {
  const result = loadConfig(processEnv());
  if (!result.ok) {
    console.error('Tasks cannot start, because of its settings:');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
