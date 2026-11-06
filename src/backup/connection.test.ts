import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entryOf, ringOf } from '../crypto/keys';
import { readCredential } from '../crypto/store';
import { credentialTable } from '../crypto/tables';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { GitHubProvider } from '../providers/github';
import { FakeGitHub } from '../providers/testing/fake-github';
import type { RepositoryRef } from '../providers/types';
import { makeStore } from '../sync/test-support';
import {
  type ConnectDeps,
  type ConnectProblem,
  PROBLEM_MESSAGES,
  TOKEN_PURPOSE,
  connectRepository,
  credentialIdOf,
  disconnectRepository,
  readConnection,
} from './connection';
import { backupConnectionTable } from './tables';

/**
 * Connecting a repository (DESIGN.md §21.2), against `FakeGitHub` and the real database: each refusal, in the order a person would fix things, and that a refusal
 * leaves nothing behind; a private repository only; a token that reaches more is accepted with how many; the token sealed and in no row, result or message.
 */
const { leg } = testTarget();
const TOKEN = 'github_pat_PLANTED_0123456789_TOKEN';
const ring = (() => {
  const ring = ringOf(entryOf(randomBytes(32)).key);
  if (!ring) throw new Error('no ring');
  return ring;
})();

let fake: FakeGitHub;
let database: Database;
let close: () => Promise<void>;
let counter = 0;
beforeAll(async () => {
  fake = await FakeGitHub.start();
  ({ database, close } = await makeStore());
});
afterAll(async () => {
  await fake.stop();
  await close();
});
beforeEach(() => {
  fake.reset();
  fake.addToken(TOKEN, { write: true });
});

const deps = (extra: Partial<ConnectDeps> = {}): ConnectDeps => ({
  database,
  ring,
  apiUrl: fake.url,
  now: () => 1_800_000_000_000,
  ...extra,
});
const account = () => crypto.randomUUID();
const repo = async (options: Parameters<FakeGitHub['createRepository']>[1] = {}) => {
  const ref: RepositoryRef = { owner: 'ada', name: `notes-${(counter += 1)}` };
  await fake.createRepository(ref, options);
  return ref;
};
const address = (ref: RepositoryRef) => `${ref.owner}/${ref.name}`;
const rows = async () => ({
  connections: await dbAll<{ accountId: string }>(
    database,
    sql`SELECT account_id AS "accountId" FROM ${backupConnectionTable(database)}`,
  ),
  credentials: await dbAll<{ id: string }>(
    database,
    sql`SELECT id FROM ${credentialTable(database)}`,
  ),
});
const refused = async (
  who: string,
  addr: string,
  token: string,
  extra: Partial<ConnectDeps> = {},
): Promise<ConnectProblem> => {
  const before = await rows();
  const result = await connectRepository(deps(extra), who, addr, token);
  if (result.ok) throw new Error('it connected');
  // A refusal leaves nothing behind, and says nothing of the token.
  expect(await rows()).toEqual(before);
  expect(JSON.stringify(result)).not.toContain('PLANTED');
  expect(PROBLEM_MESSAGES[result.problem]).not.toContain('PLANTED');
  return result.problem;
};

describe(`connecting a repository (${leg})`, () => {
  it('connects a private repository that has something in it and that the token may write to, and keeps the token sealed', async () => {
    const ref = await repo({ defaultBranch: 'trunk' });
    const who = account();
    const result = await connectRepository(deps(), who, address(ref), ` ${TOKEN} `);
    expect(result).toMatchObject({
      ok: true,
      alsoReaches: expect.any(Number),
      connection: {
        accountId: who,
        kind: 'token',
        repository: address(ref),
        branch: 'trunk',
        credentialId: credentialIdOf(who),
        createdAt: 1_800_000_000_000,
      },
    });
    expect(await readConnection(database, who)).toMatchObject({ repository: address(ref) });
    // The token is opened for this account and purpose, and is in no column of either table.
    expect(
      await readCredential(database, ring, {
        id: credentialIdOf(who),
        accountId: who,
        purpose: TOKEN_PURPOSE,
      }),
    ).toBe(TOKEN);
    const raw = JSON.stringify(
      await dbAll(
        database,
        sql`SELECT * FROM ${credentialTable(database)} WHERE account_id = ${who}`,
      ),
    );
    expect(raw).not.toContain('PLANTED');
    expect(
      JSON.stringify(
        await dbAll(
          database,
          sql`SELECT * FROM ${backupConnectionTable(database)} WHERE account_id = ${who}`,
        ),
      ),
    ).not.toContain('PLANTED');
  });

  it('takes the address in any of its forms', async () => {
    const ref = await repo();
    const who = account();
    const host = new URL(fake.url).host;
    for (const form of [address(ref), `${address(ref)}.git`, `http://${host}/${address(ref)}`]) {
      // http is refused for an address, even on the host the setting names: an address a person pastes is https or not at all.
      const result = await connectRepository(deps(), who, form, TOKEN);
      expect(result.ok, form).toBe(form.startsWith('http://') ? false : true);
    }
  });

  it('refuses an address that is not one, another host and a password, before the token is looked at or used', async () => {
    const ref = await repo();
    const who = account();
    fake.reset();
    expect(await refused(who, 'notes', TOKEN)).toBe('address');
    expect(await refused(who, 'https://gitlab.com/ada/notes', TOKEN)).toBe('host');
    expect(await refused(who, `https://ada:${TOKEN}@github.com/ada/notes`, TOKEN)).toBe('password');
    expect(address(ref)).toBeTruthy();
    // Nothing was asked of the host for any of them.
    expect(fake.requests).toEqual([]);
  });

  it('says there is no key, and keeps nothing, when the server has none', async () => {
    const ref = await repo();
    expect(await refused(account(), address(ref), TOKEN, { ring: undefined })).toBe('no_key');
  });

  it('refuses what is not a token without sending it anywhere', async () => {
    const ref = await repo();
    fake.reset();
    for (const bad of [
      '',
      '   ',
      'short',
      'has a space inside it',
      `new\nline${'x'.repeat(20)}`,
      'x'.repeat(513),
    ])
      expect(await refused(account(), address(ref), bad), JSON.stringify(bad)).toBe('token');
    expect(fake.requests).toEqual([]);
  });

  it('refuses, in order: a token that is not accepted, a repository that cannot be seen, one that is public, one with nothing in it, a token that cannot write', async () => {
    const who = account();
    const ref = await repo();
    expect(await refused(who, address(ref), 'github_pat_NOT_A_TOKEN_THE_HOST_KNOWS')).toBe(
      'token_rejected',
    );
    expect(await refused(who, `ada/missing-${counter}`, TOKEN)).toBe('not_visible');

    // A token made for another repository cannot see this one: the host says it is not there.
    const other = await repo();
    fake.addToken('github_pat_ONLY_FOR_OTHER_01', { write: true, only: [other] });
    expect(await refused(who, address(ref), 'github_pat_ONLY_FOR_OTHER_01')).toBe('not_visible');

    const open = await repo({ private: false });
    expect(await refused(who, address(open), TOKEN)).toBe('public');

    const empty = await repo({ files: null });
    expect(await refused(who, address(empty), TOKEN)).toBe('empty');

    fake.addToken('github_pat_READ_ONLY_0123456', { write: false });
    expect(await refused(who, address(ref), 'github_pat_READ_ONLY_0123456')).toBe('read_only');
    const archived = await repo({ archived: true });
    expect(await refused(who, address(archived), TOKEN)).toBe('read_only');
  });

  it('asks the checks in the order a person would fix them: a public and empty repository is public first, and a public one the token cannot write is public', async () => {
    const who = account();
    const publicEmpty = await repo({ private: false, files: null });
    expect(await refused(who, address(publicEmpty), TOKEN)).toBe('public');
    fake.addToken('github_pat_READ_ONLY_0123456', { write: false });
    const emptyReadOnly = await repo({ files: null });
    expect(await refused(who, address(emptyReadOnly), 'github_pat_READ_ONLY_0123456')).toBe(
      'empty',
    );
  });

  it('says so, in our words, when GitHub is unwell or asks to be left alone, and not with its text', async () => {
    const ref = await repo();
    const who = account();
    fake.failNext(503, 10, { body: { message: 'SECRET HOST TEXT planted' } });
    expect(await refused(who, address(ref), TOKEN)).toBe('unreachable');
    fake.reset();
    fake.failNext(429, 10, {
      headers: { 'retry-after': '30' },
      body: { message: 'SECRET HOST TEXT' },
    });
    expect(await refused(who, address(ref), TOKEN)).toBe('rate_limited');
    fake.reset();
    fake.delayNext(500);
    expect(
      await refused(who, address(ref), TOKEN, {
        makeProvider: (token) =>
          new GitHubProvider({
            token,
            apiUrl: fake.url,
            timeoutMs: 80,
            retries: 0,
            sleep: async () => undefined,
          }),
      }),
    ).toBe('unreachable');
    for (const text of Object.values(PROBLEM_MESSAGES)) expect(text).not.toContain('SECRET HOST');
  });

  it('does not accept a public repository that was private when it was last looked at: it is looked at now', async () => {
    const ref = await repo();
    const who = account();
    fake.setPrivate(ref, false);
    expect(await refused(who, address(ref), TOKEN)).toBe('public');
    fake.setPrivate(ref, true);
    expect((await connectRepository(deps(), who, address(ref), TOKEN)).ok).toBe(true);
  });

  it('accepts a token that reaches more than the repository, and says how many others', async () => {
    const mine = await repo();
    await repo();
    await repo();
    const who = account();
    const wide = await connectRepository(deps(), who, address(mine), TOKEN);
    if (!wide.ok) throw new Error('refused');
    expect(wide.alsoReaches).toBeGreaterThanOrEqual(2);

    // One made for this repository alone reaches no other: no warning.
    fake.addToken('github_pat_ONLY_FOR_MINE_0123', { write: true, only: [mine] });
    const narrow = await connectRepository(
      deps(),
      account(),
      address(mine),
      'github_pat_ONLY_FOR_MINE_0123',
    );
    expect(narrow).toMatchObject({ ok: true, alsoReaches: 0 });
  });

  it('replaces the connection and the token when an account connects again, and keeps one of each', async () => {
    const first = await repo();
    const second = await repo();
    const who = account();
    await connectRepository(deps(), who, address(first), TOKEN);
    fake.addToken('github_pat_SECOND_TOKEN_01234', { write: true });
    const again = await connectRepository(
      deps(),
      who,
      address(second),
      'github_pat_SECOND_TOKEN_01234',
    );
    expect(again).toMatchObject({ ok: true, connection: { repository: address(second) } });
    const mine = (await rows()).connections.filter((row) => row.accountId === who);
    expect(mine).toHaveLength(1);
    const credentials = await dbAll<{ id: string }>(
      database,
      sql`SELECT id FROM ${credentialTable(database)} WHERE account_id = ${who}`,
    );
    expect(credentials).toEqual([{ id: credentialIdOf(who) }]);
    expect(
      await readCredential(database, ring, {
        id: credentialIdOf(who),
        accountId: who,
        purpose: TOKEN_PURPOSE,
      }),
    ).toBe('github_pat_SECOND_TOKEN_01234');
  });

  it('keeps a connection when a later try fails: a refused token does not disconnect the one that works', async () => {
    const ref = await repo();
    const who = account();
    await connectRepository(deps(), who, address(ref), TOKEN);
    expect(await refused(who, address(ref), 'github_pat_NOT_A_TOKEN_THE_HOST_KNOWS')).toBe(
      'token_rejected',
    );
    expect(await readConnection(database, who)).toMatchObject({ repository: address(ref) });
    expect(
      await readCredential(database, ring, {
        id: credentialIdOf(who),
        accountId: who,
        purpose: TOKEN_PURPOSE,
      }),
    ).toBe(TOKEN);
  });

  it('keeps accounts apart: one account’s connection is not another’s, and disconnecting one leaves the other', async () => {
    const ref = await repo();
    const [ada, grace] = [account(), account()];
    await connectRepository(deps(), ada, address(ref), TOKEN);
    await connectRepository(deps(), grace, address(ref), TOKEN);
    expect(await disconnectRepository(database, ada)).toBe(true);
    expect(await readConnection(database, ada)).toBeUndefined();
    expect(await readConnection(database, grace)).toMatchObject({ repository: address(ref) });
    expect(
      await readCredential(database, ring, {
        id: credentialIdOf(grace),
        accountId: grace,
        purpose: TOKEN_PURPOSE,
      }),
    ).toBe(TOKEN);
    // Another account's credential is not found by naming its id.
    expect(
      await readCredential(database, ring, {
        id: credentialIdOf(grace),
        accountId: ada,
        purpose: TOKEN_PURPOSE,
      }),
    ).toBeUndefined();
  });

  it('disconnects the connection and the credential, leaves the repository alone, and is safe to run twice', async () => {
    const ref = await repo();
    const who = account();
    await connectRepository(deps(), who, address(ref), TOKEN);
    const before = await fake.files(ref);
    const log = await fake.log(ref);
    expect(await disconnectRepository(database, who)).toBe(true);
    expect(await disconnectRepository(database, who)).toBe(false);
    const left = await rows();
    expect(left.connections.map((row) => row.accountId)).not.toContain(who);
    expect(left.credentials.map((row) => row.id)).not.toContain(credentialIdOf(who));
    expect(await fake.files(ref)).toEqual(before);
    expect(await fake.log(ref)).toEqual(log);
    // Nothing was ever written to the repository, by connecting or by leaving.
    expect(fake.requests.filter((r) => r.method !== 'GET')).toEqual([]);
  });

  it('has the token in no result, however the connection ends', async () => {
    const ref = await repo();
    const results = [
      await connectRepository(deps(), account(), address(ref), TOKEN),
      await connectRepository(
        deps(),
        account(),
        address(ref),
        'github_pat_NOT_A_TOKEN_THE_HOST_KNOWS',
      ),
      await connectRepository(deps({ ring: undefined }), account(), address(ref), TOKEN),
    ];
    for (const result of results) expect(JSON.stringify(result)).not.toContain('PLANTED');
  });
});
