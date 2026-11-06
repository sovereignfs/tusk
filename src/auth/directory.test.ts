import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { authDirectory } from './directory';
import { type TestAuth, makeAuth } from './test-support';

/** The directory over a real auth store (DESIGN.md §13.2): accounts made the way a person makes one, then found by address and read by id. */
const { leg } = testTarget();
let t: TestAuth;
const ids: Record<string, string> = {};
const idOf = (name: string): string => {
  const found = ids[name];
  if (!found) throw new Error(`no account for ${name}`);
  return found;
};

beforeAll(async () => {
  t = await makeAuth({ signUp: 'open' });
  for (const [name, email] of [
    ['Ada Lovelace', 'Ada@Example.com'],
    ['Grace Hopper', 'grace@example.com'],
  ] as const) {
    const reply = await t
      .client()
      .post('/api/auth/sign-up/email', { name, email, password: 'a-long-enough-password' });
    expect(reply.status, name).toBe(200);
    ids[name] = reply.body.user.id;
  }
});
afterAll(async () => t.close());

describe(`the directory over the auth store (${leg})`, () => {
  it('finds an account by its exact address, whatever the case, and nobody else', async () => {
    const directory = authDirectory(t.database);
    expect(await directory.idOfEmail('ada@example.com')).toBe(idOf('Ada Lovelace'));
    expect(await directory.idOfEmail('ADA@EXAMPLE.COM')).toBe(idOf('Ada Lovelace'));
    expect(await directory.idOfEmail('  grace@example.com ')).toBe(idOf('Grace Hopper'));
    // An address is exact: a part of one, or one with something added, is no account.
    expect(await directory.idOfEmail('ada@example')).toBeUndefined();
    expect(await directory.idOfEmail('%@example.com')).toBeUndefined();
    expect(await directory.idOfEmail('ada@example.com.au')).toBeUndefined();
  });

  it('reads names for the ids it is given, and leaves out one that is not an account', async () => {
    const directory = authDirectory(t.database);
    const found = await directory.profiles([
      idOf('Ada Lovelace'),
      idOf('Grace Hopper'),
      'no-such-account',
      idOf('Ada Lovelace'),
    ]);
    expect([...found.values()].map((each) => each.name).sort()).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
    ]);
    expect(found.has('no-such-account')).toBe(false);
    expect((await directory.profiles([])).size).toBe(0);
  });
});
