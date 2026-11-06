import { spawnSync } from 'node:child_process';
import { processEnv } from '../config/env';

/**
 * The real `age` and `age-keygen`, for the tests that hold this cipher to the format and not to itself. On a developer's machine without them the tests
 * that need them are skipped; **in CI (the `CI` variable) a missing binary is a failure,** so that the check is never quietly not made.
 */
export const hasAge = (() => {
  const found =
    spawnSync('age', ['--version']).status === 0 &&
    spawnSync('age-keygen', ['--version']).status === 0;
  if (!found && processEnv().CI)
    throw new Error('age and age-keygen are needed to run these tests in CI');
  return found;
})();

export function run(command: string, args: string[], input?: string | Buffer) {
  const result = spawnSync(command, args, { input });
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr.toString().slice(0, 200)}`);
  return result.stdout;
}
