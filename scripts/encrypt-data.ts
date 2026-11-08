import { loadConfig } from '../src/config';
import { processEnv } from '../src/config/env';
import { getStores } from '../src/db/boot';
import { inspectOperatorState, moveContent } from '../src/crypto/operator-data';

/**
 * Moves existing data to or from the operator key (DESIGN.md §9.5, task 14.7). **It is explicit**, as Sovereign's rule asks: the server never converts what
 * is stored, and refuses to start when the setting and the data disagree. Run it with the server stopped, with TUSK_DB_ENCRYPTION=on and TUSK_ENCRYPTION_KEY in
 * the environment and the database settings the server uses:
 *
 *   node tools/encrypt-data.mjs status   what is plain and what is sealed, and changes nothing
 *   node tools/encrypt-data.mjs seal     seals what is plain, so that the server can start with the mode on
 *   node tools/encrypt-data.mjs open     opens what is sealed, so that the server can start with the mode off
 *
 * It works in short batches and each row by a conditional update, so it can be stopped and run again, and it says what it moved and never a value.
 */
export async function main(args: string[]): Promise<number> {
  const command = args.find((each) => !each.startsWith('-')) ?? 'status';
  if (!['status', 'seal', 'open'].includes(command)) {
    console.error('Usage: encrypt-data (status | seal | open)');
    return 2;
  }
  const result = loadConfig(processEnv());
  if (!result.ok) {
    console.error('The settings are wrong:');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    return 1;
  }
  const ring = result.config.encryption;
  if (!ring) {
    console.error('This needs TUSK_ENCRYPTION_KEY: the key content is sealed with, or was.');
    return 1;
  }
  const stores = await getStores(result.config.database);
  try {
    if (command === 'status') {
      const state = await inspectOperatorState(stores.app, ring);
      const show = (what: string, map: Map<string, number>) =>
        console.log(
          `${what}: ${map.size === 0 ? 'none' : [...map].map(([p, n]) => `${p} (${n})`).join(', ')}`,
        );
      show('plain', state.plain);
      show('sealed', state.sealed);
      show('sealed under a key this server was not given', state.unknownKey);
      console.log(`accounts with a key of their own: ${state.personalAccounts}`);
      return 0;
    }
    if (command === 'seal' && !result.config.operatorEncryption) {
      console.error(
        'Set TUSK_DB_ENCRYPTION=on first: this seals content so that the server can start with it on.',
      );
      return 1;
    }
    const moved = await moveContent(stores.app, ring, command as 'seal' | 'open', (line) =>
      console.log(line),
    );
    console.log(
      moved.length === 0
        ? 'Nothing to move.'
        : `Done: ${moved.reduce((n, m) => n + m.rows, 0)} row(s).`,
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await stores.close();
  }
}

// Run as a program (the bundle in the image, or through `jiti`); importing it, as a test does, runs nothing.
if (process.argv[1] && /encrypt-data(-run)?\.(mjs|ts)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
