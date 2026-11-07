import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entryOf, ringOf } from '../crypto/keys';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { noticeHref, noticeText } from '../inbox/group';
import { FakeGitHub } from '../providers/testing/fake-github';
import type { RepositoryRef } from '../providers/types';
import { applyMutation } from '../sync/apply';
import { card, list, makeStore, mutation } from '../sync/test-support';
import { tablesOf } from '../workspaces/tables';
import { runDueBackups, setSchedule } from './auto';
import { RUN_MESSAGES, type RunDeps, type RunProblem, runBackup } from './run';
import { confirmKey, connectRepository, readConnection } from './connection';
import { recordFailure, stops } from './failure';

/**
 * Backups that fail (DESIGN.md §21.4): a failure that will mend itself is tried again at the next due time and never at once; one that will not stops the
 * automatic backups, says so in Settings and, once, in the Inbox; a stopped connection makes no calls on later ticks; a backup that works, or a repaired
 * connection, ends it; a lost answer records no success; and nothing the host said, and no token, is in anything a person reads.
 */
const { leg } = testTarget();
const TOKEN = 'github_pat_PLANTED_0123456789_TOKEN';
const ring = ringOf(entryOf(randomBytes(32)).key);
const directory = { profiles: async () => new Map() };
const T0 = Date.parse('2026-11-06T09:00:00Z');
const HOUR = 3_600_000;

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
beforeEach(async () => {
  fake.reset();
  fake.addToken(TOKEN, { write: true });
  const t = (await import('../backup/tables')).backupConnectionTable(database);
  await dbAll(database, sql`DELETE FROM ${t} RETURNING account_id`);
});

const deps = (extra: Partial<RunDeps> = {}): RunDeps => ({
  database,
  directory,
  ring,
  apiUrl: fake.url,
  ...extra,
});
async function connected(auto = true) {
  const account = crypto.randomUUID();
  const l = list({ title: 'Home' });
  await applyMutation(database, account, mutation(l, card(l.id)), { now: T0 - 5000 });
  const ref: RepositoryRef = { owner: 'ada', name: `fail-${(counter += 1)}` };
  await fake.createRepository(ref);
  const result = await connectRepository(
    { database, ring, apiUrl: fake.url, now: () => T0 },
    account,
    `${ref.owner}/${ref.name}`,
    TOKEN,
  );
  if (!result.ok) throw new Error(result.problem);
  if (auto) await setSchedule(database, account, { mode: 'auto', frequency: 'hourly' }, T0);
  return { account, ref };
}
const notices = (account: string) =>
  dbAll<{ kind: string; details: string; actor: string | null; workspace: string | null }>(
    database,
    sql`SELECT kind, details, actor_id AS actor, workspace_id AS workspace FROM ${tablesOf(database).notice} WHERE account_id = ${account}`,
  );
const dueAt = async (account: string) =>
  ((await readConnection(database, account))?.nextBackupAt ?? 0) + 1;

describe(`what a failure means (${leg})`, () => {
  it('stops for a token that no longer works, a repository gone, made public or empty, a file too big, a key not confirmed or lost, and for nothing that mends itself', () => {
    const stopping: RunProblem[] = [
      'token_rejected',
      'read_only',
      'not_visible',
      'public',
      'empty',
      'too_large',
      'key_unconfirmed',
      'no_key',
    ];
    const mending: RunProblem[] = ['unreachable', 'rate_limited', 'head_moved', 'moving'];
    for (const problem of stopping) expect(stops(problem), problem).toBe(true);
    for (const problem of mending) expect(stops(problem), problem).toBe(false);
    // Every kind there is is one or the other: a new one has to be decided.
    expect(Object.keys(RUN_MESSAGES).sort()).toEqual(
      [...stopping, ...mending, 'not_connected'].sort(),
    );
  });

  it('counts the failures in a row and keeps the last kind, and does not stop for one that mends itself', async () => {
    const { account } = await connected();
    expect(await recordFailure(database, account, 'unreachable', T0)).toBe(false);
    expect(await recordFailure(database, account, 'head_moved', T0 + 1)).toBe(false);
    expect(await readConnection(database, account)).toMatchObject({
      failureKind: 'head_moved',
      failures: 2,
      stoppedAt: null,
    });
    expect(await notices(account)).toEqual([]);
  });

  it('stops for one that will not, and tells the person in the Inbox once, however many fail at the same moment and however often after', async () => {
    const { account } = await connected();
    const results = await Promise.all([
      recordFailure(database, account, 'token_rejected', T0 + 10),
      recordFailure(database, account, 'token_rejected', T0 + 10),
      recordFailure(database, account, 'public', T0 + 11),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await recordFailure(database, account, 'token_rejected', T0 + 20)).toBe(false);
    const told = await notices(account);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: 'backup_stopped', actor: null, workspace: null });
    expect(await readConnection(database, account)).toMatchObject({
      stoppedAt: expect.any(Number),
      failures: 4,
    });
  });

  it('writes no notice for a person who turned that kind off, and stops all the same', async () => {
    const { account } = await connected();
    await dbAll(
      database,
      sql`INSERT INTO ${database.dialect === 'postgres' ? (await import('../db/schema/postgres/app')).accountSettings : (await import('../db/schema/sqlite/app')).accountSettings} (account_id, created_at, notices_off) VALUES (${account}, 1, 'backup_stopped') ON CONFLICT (account_id) DO UPDATE SET notices_off = 'backup_stopped' RETURNING account_id`,
    );
    expect(await recordFailure(database, account, 'token_rejected', T0)).toBe(true);
    expect(await notices(account)).toEqual([]);
    expect((await readConnection(database, account))?.stoppedAt).not.toBeNull();
  });

  it('says in words what stopped and where to go, with none of the host’s text', () => {
    for (const kind of [
      'token_rejected',
      'read_only',
      'not_visible',
      'public',
      'empty',
      'too_large',
      'key_unconfirmed',
      'no_key',
    ]) {
      const row = { kind: 'backup_stopped' as const, actorName: null, subject: kind };
      const text = noticeText(row);
      expect(text).toMatch(
        /^Automatic backups have stopped: .+ Open Settings, Data, to see what to do\.$/,
      );
      // A word of ours, never the code that names the kind.
      expect(text).not.toMatch(/[a-z]+_[a-z]+/);
      expect(noticeHref({ ...row, workspaceId: null, boardId: null, cardId: null })).toBe(
        '/account?section=data',
      );
    }
  });
});

describe(`through a backup that fails (${leg})`, () => {
  it('stops for a revoked token, says so in words with no GitHub text and no token, and makes no calls on later ticks', async () => {
    const { account } = await connected();
    fake.failNext(401, 100, { body: { message: 'Bad credentials HOST TEXT planted' } });
    const first = await runDueBackups(deps(), await dueAt(account));
    expect(first).toMatchObject({ claimed: 1, failed: 1 });
    const stopped = await readConnection(database, account);
    expect(stopped).toMatchObject({ failureKind: 'token_rejected', failures: 1 });
    expect(stopped?.stoppedAt).not.toBeNull();
    const told = JSON.stringify(await notices(account));
    expect(told).not.toContain('HOST TEXT');
    expect(told).not.toContain('PLANTED');
    expect(RUN_MESSAGES.token_rejected).not.toContain('HOST TEXT');

    // Later ticks: the connection is not claimed, so nothing is asked of GitHub at all.
    fake.reset();
    const calls = fake.requests.length;
    expect(await runDueBackups(deps(), T0 + 10 * 24 * HOUR)).toMatchObject({ claimed: 0 });
    expect(await runDueBackups(deps(), T0 + 20 * 24 * HOUR)).toMatchObject({ claimed: 0 });
    expect(fake.requests.length).toBe(calls);
    expect(await notices(account)).toHaveLength(1);
  });

  it('is started again by Back up now once it is mended, and the failure is over', async () => {
    const { account } = await connected();
    fake.failNext(401, 100);
    await runDueBackups(deps(), await dueAt(account));
    expect((await readConnection(database, account))?.stoppedAt).not.toBeNull();
    fake.reset();
    fake.addToken(TOKEN, { write: true });
    const result = await runBackup(deps(), account, T0 + 5 * HOUR, 'manual');
    expect(result.ok).toBe(true);
    expect(await readConnection(database, account)).toMatchObject({
      failureKind: null,
      failures: 0,
      stoppedAt: null,
    });
    // And the job runs it again when it is due.
    const next = await dueAt(account);
    expect(await runDueBackups(deps(), next)).toMatchObject({ claimed: 1 });
  });

  it('is started again by connecting afresh, and by choosing automatic again', async () => {
    const one = await connected();
    fake.failNext(401, 100);
    await runDueBackups(deps(), await dueAt(one.account));
    fake.reset();
    fake.addToken(TOKEN, { write: true });
    const again = await connectRepository(
      { database, ring, apiUrl: fake.url, now: () => T0 + HOUR },
      one.account,
      `${one.ref.owner}/${one.ref.name}`,
      TOKEN,
    );
    expect(again.ok).toBe(true);
    expect(await readConnection(database, one.account)).toMatchObject({
      failureKind: null,
      failures: 0,
      stoppedAt: null,
    });

    const two = await connected();
    await recordFailure(database, two.account, 'public', T0);
    expect((await readConnection(database, two.account))?.stoppedAt).not.toBeNull();
    await setSchedule(database, two.account, { mode: 'manual' }, T0 + 1);
    expect((await readConnection(database, two.account))?.stoppedAt).not.toBeNull();
    await setSchedule(database, two.account, { mode: 'auto' }, T0 + 2);
    expect((await readConnection(database, two.account))?.stoppedAt).toBeNull();
  });

  it('tries a failure that mends itself again at the next due time, never at once', async () => {
    const { account } = await connected();
    const due = await dueAt(account);
    fake.failNext(503, 100);
    expect(await runDueBackups(deps(), due)).toMatchObject({ claimed: 1, failed: 1 });
    const after = await readConnection(database, account);
    expect(after).toMatchObject({ failureKind: 'unreachable', failures: 1, stoppedAt: null });
    expect(after?.nextBackupAt).toBeGreaterThan(due);
    expect(await notices(account)).toEqual([]);
    // A minute later: not due. At the next time: tried, and it works.
    fake.reset();
    fake.addToken(TOKEN, { write: true });
    expect(await runDueBackups(deps(), due + 60_000)).toMatchObject({ claimed: 0 });
    expect(await runDueBackups(deps(), after?.nextBackupAt ?? 0)).toMatchObject({
      claimed: 1,
      committed: 1,
    });
    expect(await readConnection(database, account)).toMatchObject({
      failureKind: null,
      failures: 0,
    });
  });

  it('waits as long as GitHub said when it asks to be left alone', async () => {
    const { account } = await connected();
    const due = await dueAt(account);
    fake.failNext(429, 100, { headers: { 'retry-after': '10800' } });
    await runDueBackups(deps(), due);
    const after = await readConnection(database, account);
    expect(after).toMatchObject({ failureKind: 'rate_limited', stoppedAt: null });
    // Three hours, which is later than the hourly time it would have had.
    expect(after?.nextBackupAt).toBeGreaterThanOrEqual(due + 3 * HOUR);
  });

  it('does not take a lost answer for a success: nothing is recorded, nothing is repeated, and it is tried at the next time', async () => {
    const { account, ref } = await connected();
    fake.reset();
    fake.loseAnswerNext('PATCH', 1);
    const result = await runBackup(deps(), account, T0 + HOUR, 'manual');
    expect(result).toEqual({ ok: false, problem: 'unreachable' });
    expect(fake.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
    const kept = await readConnection(database, account);
    expect(kept).toMatchObject({
      failureKind: 'unreachable',
      failures: 1,
      lastBackupAt: null,
      lastFingerprint: null,
      stoppedAt: null,
    });
    expect(Object.keys(await fake.files(ref)).filter((p) => p.startsWith('tusk/'))).toHaveLength(1);
  });

  it('keeps one stopped account’s failure from another’s', async () => {
    const [a, b] = [await connected(), await connected()];
    await recordFailure(database, a.account, 'public', T0);
    expect((await readConnection(database, b.account))?.stoppedAt).toBeNull();
    expect(await notices(b.account)).toEqual([]);
    expect(await runDueBackups(deps(), await dueAt(b.account))).toMatchObject({
      claimed: 1,
      committed: 1,
    });
  });

  it('is resumed by confirming the key when that was the failure, and not by confirming for another', async () => {
    const { account } = await connected();
    await recordFailure(database, account, 'key_unconfirmed', T0);
    expect((await readConnection(database, account))?.stoppedAt).not.toBeNull();
    expect(await confirmKey(database, account, T0 + 1)).toBe(true);
    expect(await readConnection(database, account)).toMatchObject({
      failureKind: null,
      failures: 0,
      stoppedAt: null,
    });
    await recordFailure(database, account, 'public', T0 + 2);
    await confirmKey(database, account, T0 + 3);
    expect((await readConnection(database, account))?.stoppedAt).not.toBeNull();
  });
});
