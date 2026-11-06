import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { start } from '../../instrumentation-node';
import { getStores } from '../db/boot';
import { fingerprintOf, ringOf } from './keys';
import { keysInUse, putCredential } from './store';

/**
 * The start-up (DESIGN.md §21.2): the real `start()` against a database file of its own. A credential sealed under a key that the server is no longer given
 * stops it, naming the key by its fingerprint; a new key with the old one beside it moves the credentials at the start, and the old key can then be dropped.
 */
const directory = mkdtempSync(join(tmpdir(), 'tusk-start-'));
const keyA = randomBytes(32);
const keyB = randomBytes(32);
const SECRET = 'github_pat_PLANTED-START-SECRET';
const saved = { ...process.env };

beforeAll(() => {
  process.env.TUSK_DB_DIALECT = 'sqlite';
  process.env.TUSK_SQLITE_URL = `file:${join(directory, 'tusk.db')}`;
  process.env.TUSK_WORKER = 'off';
  delete process.env.TUSK_ENCRYPTION_KEY_PREVIOUS;
});
afterAll(async () => {
  try {
    await (await getStores()).close();
  } catch {
    // Not opened.
  }
  for (const key of Object.keys(process.env))
    if (!(key in saved)) Reflect.deleteProperty(process.env, key);
  Object.assign(process.env, saved);
  rmSync(directory, { recursive: true, force: true });
});

/** Runs the start-up and says whether it stopped, and what it said. */
async function starting(env: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  const said: string[] = [];
  const error = vi
    .spyOn(console, 'error')
    .mockImplementation((...args) => void said.push(args.join(' ')));
  const info = vi
    .spyOn(console, 'info')
    .mockImplementation((...args) => void said.push(args.join(' ')));
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never);
  try {
    await start();
    return { stopped: false, said };
  } catch (e) {
    return { stopped: (e as Error).message === 'exit 1', said };
  } finally {
    error.mockRestore();
    info.mockRestore();
    exit.mockRestore();
  }
}

describe('start-up with credentials kept', () => {
  it('starts with no key when nothing is kept, and a credential is then kept and read', async () => {
    expect((await starting({ TUSK_ENCRYPTION_KEY: keyA.toString('base64') })).stopped).toBe(false);
    const database = (await getStores()).app;
    const ring = ringOf(keyA);
    if (!ring) throw new Error('no ring');
    await putCredential(
      database,
      ring,
      { id: crypto.randomUUID(), accountId: 'acct', purpose: 'github-token' },
      SECRET,
      1,
    );
    expect([...(await keysInUse(database)).keys()]).toEqual([fingerprintOf(keyA)]);
  });

  it('stops, naming the key by its fingerprint and never by its value or the secret, when the key is dropped or another is given', async () => {
    for (const env of [
      { TUSK_ENCRYPTION_KEY: undefined },
      { TUSK_ENCRYPTION_KEY: keyB.toString('base64') },
    ]) {
      const run = await starting(env);
      expect(run.stopped).toBe(true);
      const text = run.said.join('\n');
      expect(text).toContain(fingerprintOf(keyA));
      for (const secret of [
        SECRET,
        keyA.toString('base64'),
        keyA.toString('hex'),
        keyB.toString('base64'),
      ])
        expect(text).not.toContain(secret);
    }
  });

  it('moves the credentials to a new key when the old one is given beside it, says so, and then needs the old one no longer', async () => {
    const run = await starting({
      TUSK_ENCRYPTION_KEY: keyB.toString('base64'),
      TUSK_ENCRYPTION_KEY_PREVIOUS: keyA.toString('base64'),
    });
    expect(run.stopped).toBe(false);
    expect(run.said.join('\n')).toContain(
      `1 moved from key ${fingerprintOf(keyA)} to key ${fingerprintOf(keyB)}`,
    );
    expect(
      (
        await starting({
          TUSK_ENCRYPTION_KEY: keyB.toString('base64'),
          TUSK_ENCRYPTION_KEY_PREVIOUS: undefined,
        })
      ).stopped,
    ).toBe(false);
    const rows = await keysInUse((await getStores()).app);
    expect([...rows.keys()]).toEqual([fingerprintOf(keyB)]);
  });
});
