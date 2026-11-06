import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll, dbRun } from '../db/exec';
import { testTarget } from '../db/test-support';
import { makeStore } from '../sync/test-support';
import { CryptoError, seal } from './envelope';
import { type KeyEntry, entryOf, ringOf } from './keys';
import {
  MissingKeys,
  assertKeys,
  deleteCredential,
  deleteCredentialsOf,
  keysInUse,
  putCredential,
  readCredential,
  rotateCredentials,
} from './store';
import { credentialTable } from './tables';

/** The credentials a person gave Tusk, kept sealed, on whichever database the leg runs: bound to their row, owner and purpose, moved between keys, and never in the clear. */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('no ring');
  return value;
};
const NOW = 1_800_000_000_000;
const SECRET = 'github_pat_PLANTED-SECRET-VALUE';
const OLD = entryOf(randomBytes(32));
const NEW = entryOf(randomBytes(32));
const oldRing = must(ringOf(OLD.key));
const newRing = must(ringOf(NEW.key, OLD.key));
const id = () => crypto.randomUUID();
const raw = () =>
  dbAll<{ id: string; sealed: string; keyFingerprint: string }>(
    database,
    sql`SELECT id, sealed, key_fingerprint AS "keyFingerprint" FROM ${credentialTable(database)}`,
  );

describe(`credentials at rest (${leg})`, () => {
  it('are kept sealed and read back for their account and purpose, with the secret nowhere in the table', async () => {
    const cred = { id: id(), accountId: id(), purpose: 'github-token' };
    await putCredential(database, oldRing, cred, SECRET, NOW);
    expect(await readCredential(database, oldRing, cred)).toBe(SECRET);
    const rows = JSON.stringify(await raw());
    expect(rows).not.toContain(SECRET);
    expect(rows).toContain(OLD.fingerprint);
    // Put again, it is replaced and not added.
    await putCredential(database, oldRing, cred, 'a new token', NOW + 1);
    expect(await readCredential(database, oldRing, cred)).toBe('a new token');
    expect((await raw()).filter((row) => row.id === cred.id)).toHaveLength(1);
  });

  it('are another account’s no more than a stranger’s: not found, not replaced, not opened for another purpose', async () => {
    const mine = { id: id(), accountId: id(), purpose: 'github-token' };
    await putCredential(database, oldRing, mine, SECRET, NOW);
    expect(await readCredential(database, oldRing, { ...mine, accountId: id() })).toBeUndefined();
    expect(await readCredential(database, oldRing, { ...mine, purpose: 'other' })).toBeUndefined();
    await expect(
      putCredential(database, oldRing, { ...mine, accountId: id() }, 'taken over', NOW),
    ).rejects.toThrow(/not this account/);
    await expect(
      putCredential(database, oldRing, { ...mine, purpose: 'other' }, 'taken over', NOW),
    ).rejects.toThrow(/not this account/);
    expect(await readCredential(database, oldRing, mine)).toBe(SECRET);
    await deleteCredential(database, { ...mine, accountId: id() });
    expect(await readCredential(database, oldRing, mine)).toBe(SECRET);
    await deleteCredential(database, mine);
    expect(await readCredential(database, oldRing, mine)).toBeUndefined();
  });

  it('do not open when the sealed value is moved to another row, whatever the account says', async () => {
    const [a, b] = [
      { id: id(), accountId: id(), purpose: 'github-token' },
      { id: id(), accountId: id(), purpose: 'github-token' },
    ];
    await putCredential(database, oldRing, a, 'secret of a', NOW);
    await putCredential(database, oldRing, b, 'secret of b', NOW);
    const [first] = (await raw()).filter((row) => row.id === a.id);
    // The database is read, and a's sealed value is written into b's row.
    await dbRun(
      database,
      sql`UPDATE ${credentialTable(database)} SET sealed = ${first?.sealed ?? ''} WHERE id = ${b.id}`,
    );
    await expect(readCredential(database, oldRing, b)).rejects.toBeInstanceOf(CryptoError);
    expect(await readCredential(database, oldRing, a)).toBe('secret of a');
  });

  it('go with the account that made them, and only theirs, twice over', async () => {
    const [person, other] = [id(), id()];
    for (let i = 0; i < 3; i++)
      await putCredential(
        database,
        oldRing,
        { id: id(), accountId: person, purpose: 'github-token' },
        's',
        NOW,
      );
    const keep = { id: id(), accountId: other, purpose: 'github-token' };
    await putCredential(database, oldRing, keep, 'kept', NOW);
    expect(await deleteCredentialsOf(database, person)).toBe(3);
    expect(await deleteCredentialsOf(database, person)).toBe(0);
    expect(await readCredential(database, oldRing, keep)).toBe('kept');
  });
});

describe(`keys at start-up (${leg})`, () => {
  it('stop the server when what is kept was sealed under a key that is not given, naming the fingerprint and never the key', async () => {
    const lost = entryOf(randomBytes(32));
    const cred = { id: id(), accountId: id(), purpose: 'github-token' };
    await putCredential(database, must(ringOf(lost.key)), cred, SECRET, NOW);
    for (const ring of [undefined, oldRing, newRing]) {
      const error = await assertKeys(database, ring).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(MissingKeys);
      const message = (error as Error).message;
      expect(message).toContain(lost.fingerprint);
      for (const secret of [lost.key.toString('hex'), lost.key.toString('base64'), SECRET])
        expect(message).not.toContain(secret);
    }
    // Disconnected, nothing needs the key, and the server starts without it.
    await deleteCredential(database, cred);
  });

  it('start when the keys given are the keys in use, current or previous, and when there is nothing kept and no key at all', async () => {
    const t = credentialTable(database);
    await dbRun(database, sql`DELETE FROM ${t}`);
    await expect(assertKeys(database, undefined)).resolves.toBeUndefined();
    await putCredential(
      database,
      oldRing,
      { id: id(), accountId: id(), purpose: 'github-token' },
      SECRET,
      NOW,
    );
    await expect(assertKeys(database, oldRing)).resolves.toBeUndefined();
    await expect(assertKeys(database, newRing)).resolves.toBeUndefined();
    expect([...(await keysInUse(database)).entries()]).toEqual([[OLD.fingerprint, 1]]);
  });
});

describe(`rotating the key (${leg})`, () => {
  const seed = async (count: number, as: KeyEntry = OLD) => {
    await dbRun(database, sql`DELETE FROM ${credentialTable(database)}`);
    const made: { id: string; accountId: string; purpose: string }[] = [];
    for (let i = 0; i < count; i++) {
      const cred = { id: id(), accountId: id(), purpose: 'github-token' };
      await putCredential(database, must(ringOf(as.key)), cred, `${SECRET}-${i}`, NOW);
      made.push(cred);
    }
    return made;
  };

  it('moves every credential from the previous key to the current, naming both and nothing secret, and the values are as they were', async () => {
    const made = await seed(120);
    const lines: string[] = [];
    const result = await rotateCredentials(database, newRing, (line) => lines.push(line));
    expect(result).toEqual({ moved: 120, from: OLD.fingerprint, to: NEW.fingerprint });
    expect(lines).toEqual([
      `[tusk] credentials: 120 moved from key ${OLD.fingerprint} to key ${NEW.fingerprint}`,
    ]);
    expect(lines.join('\n')).not.toContain(SECRET);
    expect([...(await keysInUse(database)).entries()]).toEqual([[NEW.fingerprint, 120]]);
    // They open under the new key alone, and the old key is no longer needed.
    const onlyNew = must(ringOf(NEW.key));
    for (const [i, cred] of made.entries())
      expect(await readCredential(database, onlyNew, cred)).toBe(`${SECRET}-${i}`);
    await expect(assertKeys(database, onlyNew)).resolves.toBeUndefined();
  });

  it('is done again at the next start with nothing to do, and with no previous key does nothing at all', async () => {
    await seed(5);
    await rotateCredentials(database, newRing, () => undefined);
    const lines: string[] = [];
    expect(await rotateCredentials(database, newRing, (line) => lines.push(line))).toMatchObject({
      moved: 0,
    });
    expect(lines).toEqual([]);
    expect(
      await rotateCredentials(database, must(ringOf(NEW.key)), (line) => lines.push(line)),
    ).toEqual({ moved: 0, from: undefined, to: NEW.fingerprint });
  });

  it('is safe from two replicas at once: every credential is moved by exactly one of them, and every one opens', async () => {
    const made = await seed(150);
    const runs = await Promise.all([
      rotateCredentials(database, newRing, () => undefined),
      rotateCredentials(database, newRing, () => undefined),
      rotateCredentials(database, newRing, () => undefined),
    ]);
    expect(runs.reduce((n, run) => n + run.moved, 0)).toBe(150);
    expect([...(await keysInUse(database)).entries()]).toEqual([[NEW.fingerprint, 150]]);
    for (const [i, cred] of made.entries())
      expect(await readCredential(database, must(ringOf(NEW.key)), cred)).toBe(`${SECRET}-${i}`);
  });

  it('leaves alone a row that says it is under the old key and is not, and does not give up the others for it', async () => {
    const made = await seed(3);
    const third = entryOf(randomBytes(32));
    const liar = { id: id(), accountId: id(), purpose: 'github-token' };
    const sealed = seal('under a key that is gone', { id: liar.id, purpose: liar.purpose }, third);
    await dbRun(
      database,
      sql`INSERT INTO ${credentialTable(database)} (id, account_id, purpose, sealed, key_fingerprint, created_at, updated_at) VALUES (${liar.id}, ${liar.accountId}, ${liar.purpose}, ${sealed}, ${OLD.fingerprint}, 1, 1)`,
    );
    expect((await rotateCredentials(database, newRing, () => undefined)).moved).toBe(3);
    for (const cred of made)
      expect(await readCredential(database, must(ringOf(NEW.key)), cred)).toBeDefined();
    expect((await raw()).find((row) => row.id === liar.id)?.sealed).toBe(sealed);
  });
});
