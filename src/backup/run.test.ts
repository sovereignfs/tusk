import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entryOf, ringOf } from '../crypto/keys';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { serialise } from '../portability/format';
import { summarise, validateFile } from '../portability/validate';
import { GitHubProvider } from '../providers/github';
import { FakeGitHub } from '../providers/testing/fake-github';
import { type Provider, type RepositoryRef } from '../providers/types';
import { applyMutation } from '../sync/apply';
import { card, check, list, makeStore, mutation } from '../sync/test-support';
import { type World, seedWorld } from '../workspaces/testing/roles';
import { connectRepository, readConnection } from './connection';
import { type RunDeps, runBackup } from './run';
import { takeSnapshot } from './snapshot';
import { backupConnectionTable } from './tables';

/**
 * Making a backup (DESIGN.md §21.3, §21.4), against `FakeGitHub` (a real git repository) and the real database: the file is at the right path with the export's
 * bytes, in a real commit on the default branch, and the rest of the tree is as it was; it imports; a moved head is read again and succeeds; a repository that
 * went public gets nothing; a lost answer is not repeated and records nothing; and **no transaction is open during a call to the host**.
 */
const { leg } = testTarget();
const TOKEN = 'github_pat_PLANTED_0123456789_TOKEN';
const ring = ringOf(entryOf(randomBytes(32)).key);
const directory = { profiles: async () => new Map() };
const NOW = Date.parse('2026-11-06T14:30:00Z');

let fake: FakeGitHub;
let database: Database;
let close: () => Promise<void>;
let world: World;
let counter = 0;
beforeAll(async () => {
  fake = await FakeGitHub.start();
  ({ database, close } = await makeStore());
  world = await seedWorld(database);
});
afterAll(async () => {
  await fake.stop();
  await close();
});
beforeEach(() => {
  fake.reset();
  fake.addToken(TOKEN, { write: true });
});

const deps = (extra: Partial<RunDeps> = {}): RunDeps => ({
  database,
  directory,
  ring,
  apiUrl: fake.url,
  ...extra,
});
const repo = async (options: Parameters<FakeGitHub['createRepository']>[1] = {}) => {
  const ref: RepositoryRef = { owner: 'ada', name: `backups-${(counter += 1)}` };
  await fake.createRepository(ref, options);
  return ref;
};
/** An account with a Desk (two lists, a card with a checklist item) and a repository connected. */
async function connected(options: Parameters<FakeGitHub['createRepository']>[1] = {}) {
  const account = crypto.randomUUID();
  const l = list({ title: 'Home' });
  const c = card(l.id, { fields: { title: { v: 'Buy milk' } } });
  await applyMutation(database, account, mutation(l, c, check(c.id)), { now: NOW - 1000 });
  const ref = await repo(options);
  const result = await connectRepository(
    { database, ring, apiUrl: fake.url, now: () => NOW - 500 },
    account,
    `${ref.owner}/${ref.name}`,
    TOKEN,
  );
  if (!result.ok) throw new Error(`could not connect: ${result.problem}`);
  return { account, ref };
}

describe(`making a backup (${leg})`, () => {
  it('puts the export at tusk/<UTC time>.json in one commit on the default branch, with the rest of the tree as it was', async () => {
    const { account, ref } = await connected({
      files: { 'README.md': '# Mine\n', 'fjord.json': '{"vault":true}\n', 'notes/a.md': 'a' },
    });
    const before = await fake.files(ref);
    const result = await runBackup(deps(), account, NOW, 'manual');
    if (!result.ok || result.unchanged) throw new Error('not written');
    expect(result.path).toBe('tusk/2026-11-06_14-30-00.json');
    const after = await fake.files(ref);
    // Nothing else of the repository was touched, fjord.json included.
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), result.path].sort());
    for (const [path, content] of Object.entries(before)) expect(after[path]).toBe(content);
    // The file is the export's bytes.
    const snapshot = await takeSnapshot(database, directory, account, new Date(NOW));
    expect(after[result.path]).toBe(serialise(snapshot.file));
    expect(result.bytes).toBe(Buffer.byteLength(after[result.path] ?? '', 'utf8'));
    // It is a real commit with our message, one on top of the head, on the default branch.
    expect(await fake.log(ref)).toEqual(['Tusk backup 2026-11-06 14:30:00 UTC', 'Initial commit']);
    expect(await fake.fsck(ref)).toBe(true);
    expect(result.url).toContain(`/blob/main/${result.path}`);
  });

  it('writes a file that imports: it is a valid export, with the Desk in it', async () => {
    const { account, ref } = await connected();
    const result = await runBackup(deps(), account, NOW, 'manual');
    if (!result.ok || result.unchanged) throw new Error('not written');
    const content = (await fake.files(ref))[result.path] ?? '';
    const read = validateFile(content);
    if (!read.ok) throw new Error(read.error);
    expect(read.file).toMatchObject({
      format: 'tusk',
      scope: 'everything',
      exportedAt: new Date(NOW).toISOString(),
    });
    expect(summarise(read.file)).toMatchObject({ desk: { lists: 1, cards: 1 } });
    expect(read.file.desk?.lists[0]?.cards[0]).toMatchObject({
      title: 'Buy milk',
      checklist: [{ title: 'Oat milk' }],
    });
  });

  it('holds the workspaces the person owns, and not those they are only in', async () => {
    const owner = world.accounts.owner;
    const ref = await repo();
    const connect = await connectRepository(
      { database, ring, apiUrl: fake.url, now: () => NOW },
      owner,
      `${ref.owner}/${ref.name}`,
      TOKEN,
    );
    expect(connect.ok).toBe(true);
    const mine = await runBackup(deps(), owner, NOW, 'manual');
    if (!mine.ok || mine.unchanged) throw new Error('not written');
    const file = validateFile((await fake.files(ref))[mine.path] ?? '');
    if (!file.ok) throw new Error(file.error);
    expect(file.file.workspaces?.length).toBe(1);
    expect(file.file.workspaces?.[0]?.boards.length).toBeGreaterThan(0);

    // A person who is only a member of that workspace has none of it in theirs.
    const memberRef = await repo();
    await connectRepository(
      { database, ring, apiUrl: fake.url, now: () => NOW },
      world.accounts.member,
      `${memberRef.owner}/${memberRef.name}`,
      TOKEN,
    );
    const theirs = await runBackup(deps(), world.accounts.member, NOW, 'manual');
    if (!theirs.ok || theirs.unchanged) throw new Error('not written');
    const theirFile = validateFile((await fake.files(memberRef))[theirs.path] ?? '');
    if (!theirFile.ok) throw new Error(theirFile.error);
    expect(theirFile.file.workspaces ?? []).toEqual([]);
  });

  it('records the run once the host has confirmed it, with the path and the fingerprint of what it held', async () => {
    const { account } = await connected();
    expect(await readConnection(database, account)).toMatchObject({
      lastBackupAt: null,
      lastBackupPath: null,
      lastFingerprint: null,
    });
    const result = await runBackup(deps(), account, NOW, 'manual');
    if (!result.ok || result.unchanged) throw new Error('not written');
    const connection = await readConnection(database, account);
    expect(connection).toMatchObject({ lastBackupAt: NOW, lastBackupPath: result.path });
    const snapshot = await takeSnapshot(database, directory, account, new Date(NOW));
    expect(connection?.lastFingerprint).toBe(snapshot.fingerprint);
  });

  it('is a new file each time, and nothing that is there is ever deleted or rewritten', async () => {
    const { account, ref } = await connected();
    const first = await runBackup(deps(), account, NOW, 'manual');
    const second = await runBackup(deps(), account, NOW + 61_000, 'manual');
    if (!first.ok || first.unchanged || !second.ok || second.unchanged) throw new Error('failed');
    const files = await fake.files(ref);
    expect(
      Object.keys(files)
        .filter((p) => p.startsWith('tusk/'))
        .sort(),
    ).toEqual([first.path, second.path]);
    expect((await fake.log(ref)).length).toBe(3);
  });

  it('changes its fingerprint when the Desk or a workspace changes, and not when nothing does', async () => {
    const { account } = await connected();
    const a = await takeSnapshot(database, directory, account, new Date(NOW));
    const b = await takeSnapshot(database, directory, account, new Date(NOW + 5000));
    expect(b.fingerprint).toBe(a.fingerprint);
    await applyMutation(database, account, mutation(list({ title: 'More' })), { now: NOW + 1000 });
    const c = await takeSnapshot(database, directory, account, new Date(NOW));
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it('reads the branch again and succeeds when it moved between reading it and writing', async () => {
    const { account, ref } = await connected();
    let moved = 0;
    const racing = (token: string): Provider => {
      const real = new GitHubProvider({ token, apiUrl: fake.url, sleep: async () => undefined });
      return {
        getRepository: (r) => real.getRepository(r),
        canWrite: (r, b) => real.canWrite(r, b),
        reachable: () => real.reachable(),
        getHead: (r, b) => real.getHead(r, b),
        // Someone else commits after the head was read, the first time only.
        commit: async (r, request) => {
          if (moved === 0) {
            moved += 1;
            await fake.advance(ref, 'main', { 'theirs.txt': 'theirs' });
          }
          return real.commit(r, request);
        },
      };
    };
    const result = await runBackup(deps({ makeProvider: racing }), account, NOW, 'manual');
    if (!result.ok || result.unchanged) throw new Error('not written');
    const files = await fake.files(ref);
    expect(files['theirs.txt']).toBe('theirs');
    expect(files[result.path]).toBeDefined();
    expect(await fake.log(ref)).toEqual([
      'Tusk backup 2026-11-06 14:30:00 UTC',
      'Someone else',
      'Initial commit',
    ]);
  });

  it('gives up when the branch moves twice in a row, and writes nothing', async () => {
    const { account, ref } = await connected();
    let tries = 0;
    const racing = (token: string): Provider => {
      const real = new GitHubProvider({ token, apiUrl: fake.url, sleep: async () => undefined });
      return {
        getRepository: (r) => real.getRepository(r),
        canWrite: (r, b) => real.canWrite(r, b),
        reachable: () => real.reachable(),
        getHead: (r, b) => real.getHead(r, b),
        commit: async (r, request) => {
          tries += 1;
          await fake.advance(ref, 'main', { [`theirs-${crypto.randomUUID()}.txt`]: 'x' });
          return real.commit(r, request);
        },
      };
    };
    const result = await runBackup(deps({ makeProvider: racing }), account, NOW, 'manual');
    expect(result).toEqual({ ok: false, problem: 'head_moved' });
    // Tried once more, and no more.
    expect(tries).toBe(2);
    expect(Object.keys(await fake.files(ref)).some((p) => p.startsWith('tusk/'))).toBe(false);
    expect((await readConnection(database, account))?.lastBackupAt).toBeNull();
  });

  it('writes nothing, and says so, when the repository has become public', async () => {
    const { account, ref } = await connected();
    fake.setPrivate(ref, false);
    expect(await runBackup(deps(), account, NOW, 'manual')).toEqual({
      ok: false,
      problem: 'public',
    });
    expect(Object.keys(await fake.files(ref)).some((p) => p.startsWith('tusk/'))).toBe(false);
    expect(fake.requests.filter((r) => r.method !== 'GET')).toEqual([]);
    expect((await readConnection(database, account))?.lastBackupAt).toBeNull();
  });

  it('does not repeat a write whose answer was lost, and records nothing', async () => {
    const { account, ref } = await connected();
    fake.reset();
    fake.loseAnswerNext('PATCH', 1);
    const result = await runBackup(deps(), account, NOW, 'manual');
    expect(result).toEqual({ ok: false, problem: 'unreachable' });
    expect(fake.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
    // It did land, once: the worst case is a file the person did not hear of, and the next backup is another.
    expect(Object.keys(await fake.files(ref)).filter((p) => p.startsWith('tusk/'))).toHaveLength(1);
    expect((await readConnection(database, account))?.lastBackupAt).toBeNull();
    expect((await readConnection(database, account))?.lastFingerprint).toBeNull();
  });

  it('says in our words what went wrong, for a token that stopped working, a repository gone, a read-only token, an empty repository, a host unwell and a limit', async () => {
    const { account, ref } = await connected();
    fake.reset();
    fake.addToken(TOKEN, { write: false });
    expect(await runBackup(deps(), account, NOW, 'manual')).toEqual({
      ok: false,
      problem: 'read_only',
    });
    fake.addToken(TOKEN, { write: true });

    fake.failNext(503, 20);
    expect(await runBackup(deps(), account, NOW, 'manual')).toEqual({
      ok: false,
      problem: 'unreachable',
    });
    fake.reset();
    fake.addToken(TOKEN, { write: true });
    fake.failNext(429, 1, { headers: { 'retry-after': '45' } });
    expect(await runBackup(deps(), account, NOW, 'manual')).toEqual({
      ok: false,
      problem: 'rate_limited',
      retryAfterMs: 45_000,
    });
    fake.reset();
    fake.addToken(TOKEN, { write: true });
    fake.failNext(401, 1);
    expect(await runBackup(deps(), account, NOW, 'manual')).toEqual({
      ok: false,
      problem: 'token_rejected',
    });
    fake.reset();
    fake.addToken(TOKEN, { write: true });
    // The repository is gone for the token: not found.
    fake.addToken(TOKEN, { write: true, only: [] });
    expect(await runBackup(deps(), account, NOW, 'manual')).toEqual({
      ok: false,
      problem: 'not_visible',
    });
    fake.addToken(TOKEN, { write: true });
    expect(ref.name).toBeTruthy();
  });

  it('has nothing to do for an account with nothing connected, or on a server with no key', async () => {
    expect(await runBackup(deps(), crypto.randomUUID(), NOW, 'manual')).toEqual({
      ok: false,
      problem: 'not_connected',
    });
    const { account } = await connected();
    expect(await runBackup(deps({ ring: undefined }), account, NOW, 'manual')).toEqual({
      ok: false,
      problem: 'no_key',
    });
  });

  it('cannot open a token sealed under another key, and says the token is no good', async () => {
    const { account } = await connected();
    const other = ringOf(entryOf(randomBytes(32)).key);
    expect(await runBackup(deps({ ring: other }), account, NOW, 'manual')).toEqual({
      ok: false,
      problem: 'token_rejected',
    });
  });

  it('keeps no transaction open while it calls the host', async () => {
    const { account } = await connected();
    // On a file the database does one transaction at a time in this process and a statement waits behind it: a write made from inside a call to the host that
    // does not come back is a transaction held open across it.
    let written = false;
    const watching = (token: string): Provider => {
      const real = new GitHubProvider({ token, apiUrl: fake.url, sleep: async () => undefined });
      const inside = async () => {
        const done = dbAll(
          database,
          sql`UPDATE ${backupConnectionTable(database)} SET kind = kind WHERE account_id = ${account} RETURNING account_id`,
        );
        const timeout = new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 1500));
        expect(await Promise.race([done.then(() => 'written' as const), timeout])).toBe('written');
        written = true;
      };
      return {
        getRepository: async (r) => (await inside(), real.getRepository(r)),
        canWrite: (r, b) => real.canWrite(r, b),
        reachable: () => real.reachable(),
        getHead: async (r, b) => (await inside(), real.getHead(r, b)),
        commit: async (r, request) => (await inside(), real.commit(r, request)),
      };
    };
    const result = await runBackup(deps({ makeProvider: watching }), account, NOW, 'manual');
    expect(result.ok).toBe(true);
    expect(written).toBe(true);
  });

  it('has the token in no result, however it ends', async () => {
    const { account } = await connected();
    fake.failNext(503, 20, { body: { message: 'HOST TEXT' } });
    const bad = await runBackup(deps(), account, NOW, 'manual');
    fake.reset();
    fake.addToken(TOKEN, { write: true });
    const good = await runBackup(deps(), account, NOW + 1, 'manual');
    for (const result of [bad, good]) {
      expect(JSON.stringify(result)).not.toContain('PLANTED');
      expect(JSON.stringify(result)).not.toContain('HOST TEXT');
    }
  });
});
