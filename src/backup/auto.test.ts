import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entryOf, ringOf } from '../crypto/keys';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { FakeGitHub } from '../providers/testing/fake-github';
import type { RepositoryRef } from '../providers/types';
import { applyMutation } from '../sync/apply';
import { card, list, makeStore, mutation } from '../sync/test-support';
import { runDueBackups, setSchedule } from './auto';
import { connectRepository, readConnection } from './connection';
import type { RunDeps } from './run';
import { INTERVAL_MS, nextBackup } from './schedule';
import { backupConnectionTable } from './tables';

/**
 * Automatic backups (DESIGN.md §21.1, §21.4), against `FakeGitHub` and the real database, with the clock passed in: a `manual` connection is never run; an
 * `auto` one when it is due and no sooner; two runners at once make one commit; a quiet account is looked at and not committed for, and a change makes one the
 * next time; a failure is tried again at the next due time and never at once.
 */
const { leg } = testTarget();
const TOKEN = 'github_pat_PLANTED_0123456789_TOKEN';
const ring = ringOf(entryOf(randomBytes(32)).key);
const directory = { profiles: async () => new Map() };
const T0 = Date.parse('2026-11-06T09:00:00Z');
const DAY = INTERVAL_MS.daily;

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
  // What an earlier test left connected and due is not what this one is about.
  await dbAll(database, sql`DELETE FROM ${backupConnectionTable(database)} RETURNING account_id`);
});

const deps = (extra: Partial<RunDeps> = {}): RunDeps => ({
  database,
  directory,
  ring,
  apiUrl: fake.url,
  ...extra,
});
async function connected(): Promise<{ account: string; ref: RepositoryRef }> {
  const account = crypto.randomUUID();
  const l = list({ title: 'Home' });
  await applyMutation(database, account, mutation(l, card(l.id)), { now: T0 - 5000 });
  const ref: RepositoryRef = { owner: 'ada', name: `auto-${(counter += 1)}` };
  await fake.createRepository(ref);
  const result = await connectRepository(
    { database, ring, apiUrl: fake.url, now: () => T0 },
    account,
    `${ref.owner}/${ref.name}`,
    TOKEN,
  );
  if (!result.ok) throw new Error(result.problem);
  return { account, ref };
}
const backups = async (ref: RepositoryRef) =>
  Object.keys(await fake.files(ref)).filter((path) => path.startsWith('tusk/'));

describe(`choosing how a backup is run (${leg})`, () => {
  it('starts as manual, daily, with nothing due', async () => {
    const { account } = await connected();
    expect(await readConnection(database, account)).toMatchObject({
      mode: 'manual',
      frequency: 'daily',
      nextBackupAt: null,
      lastCheckedAt: null,
    });
  });

  it('sets the next time one interval away, plus the account’s spread, when auto is chosen, and clears it for manual', async () => {
    const { account } = await connected();
    const auto = await setSchedule(database, account, { mode: 'auto' }, T0);
    expect(auto).toMatchObject({
      mode: 'auto',
      frequency: 'daily',
      nextBackupAt: nextBackup('daily', T0, account),
    });
    const weekly = await setSchedule(database, account, { frequency: 'weekly' }, T0 + 1000);
    expect(weekly).toMatchObject({
      mode: 'auto',
      frequency: 'weekly',
      nextBackupAt: nextBackup('weekly', T0 + 1000, account),
    });
    const manual = await setSchedule(database, account, { mode: 'manual' }, T0 + 2000);
    expect(manual).toMatchObject({ mode: 'manual', frequency: 'weekly', nextBackupAt: null });
    // The frequency chosen while on manual is kept, and used when auto is chosen again.
    const again = await setSchedule(database, account, { mode: 'auto' }, T0 + 3000);
    expect(again?.nextBackupAt).toBe(nextBackup('weekly', T0 + 3000, account));
  });

  it('leaves the next time where it was when nothing changes, and has nothing to set for an account with nothing connected', async () => {
    const { account } = await connected();
    const first = await setSchedule(database, account, { mode: 'auto' }, T0);
    const same = await setSchedule(
      database,
      account,
      { mode: 'auto', frequency: 'daily' },
      T0 + 60_000,
    );
    expect(same?.nextBackupAt).toBe(first?.nextBackupAt);
    expect(await setSchedule(database, crypto.randomUUID(), { mode: 'auto' }, T0)).toBeUndefined();
  });
});

describe(`the automatic job (${leg})`, () => {
  it('runs an auto connection when it is due and not before, and keeps its place on the schedule', async () => {
    const { account, ref } = await connected();
    const set = await setSchedule(database, account, { mode: 'auto' }, T0);
    const due = set?.nextBackupAt ?? 0;
    expect(await runDueBackups(deps(), due - 1)).toMatchObject({ claimed: 0 });
    expect(await backups(ref)).toEqual([]);

    const late = due + 40_000;
    expect(await runDueBackups(deps(), late)).toEqual({
      claimed: 1,
      committed: 1,
      unchanged: 0,
      failed: 0,
    });
    expect(await backups(ref)).toHaveLength(1);
    const after = await readConnection(database, account);
    expect(after).toMatchObject({
      lastBackupAt: late,
      lastCheckedAt: late,
      nextBackupAt: due + DAY,
    });
    // And it is not run again until then.
    expect(await runDueBackups(deps(), late + 60_000)).toMatchObject({ claimed: 0 });
    expect(await backups(ref)).toHaveLength(1);
  });

  it('never runs a manual connection, however it came to have a time', async () => {
    const { account, ref } = await connected();
    await dbAll(
      database,
      sql`UPDATE ${backupConnectionTable(database)} SET next_backup_at = ${T0 - DAY} WHERE account_id = ${account} RETURNING account_id`,
    );
    expect(await runDueBackups(deps(), T0 + 10 * DAY)).toMatchObject({ claimed: 0 });
    expect(await backups(ref)).toEqual([]);
    expect((await readConnection(database, account))?.nextBackupAt).toBe(T0 - DAY);
  });

  it('makes one commit when two runners tick at the same time', async () => {
    const { account, ref } = await connected();
    const set = await setSchedule(database, account, { mode: 'auto', frequency: 'hourly' }, T0);
    const at = (set?.nextBackupAt ?? 0) + 1000;
    const [a, b, c] = await Promise.all([
      runDueBackups(deps(), at),
      runDueBackups(deps(), at),
      runDueBackups(deps(), at),
    ]);
    expect(a.claimed + b.claimed + c.claimed).toBe(1);
    expect(a.committed + b.committed + c.committed).toBe(1);
    expect(await backups(ref)).toHaveLength(1);
    expect(await fake.log(ref)).toHaveLength(2);
  });

  it('looks at a quiet account and makes no commit, and makes one the next time after a change', async () => {
    const { account, ref } = await connected();
    let set = await setSchedule(database, account, { mode: 'auto' }, T0);
    // The first run has no earlier backup to be the same as: it writes.
    let at = (set?.nextBackupAt ?? 0) + 10;
    expect(await runDueBackups(deps(), at)).toMatchObject({ committed: 1 });
    const written = (await readConnection(database, account))?.lastBackupAt;
    expect(await backups(ref)).toHaveLength(1);

    // A day later nothing has changed: it looks, records that it did, and writes nothing.
    set = await readConnection(database, account);
    at = (set?.nextBackupAt ?? 0) + 10;
    const calls = fake.requests.length;
    expect(await runDueBackups(deps(), at)).toEqual({
      claimed: 1,
      committed: 0,
      unchanged: 1,
      failed: 0,
    });
    expect(await backups(ref)).toHaveLength(1);
    expect(await fake.log(ref)).toHaveLength(2);
    expect(fake.requests.slice(calls).filter((r) => r.method !== 'GET')).toEqual([]);
    const looked = await readConnection(database, account);
    expect(looked).toMatchObject({ lastBackupAt: written, lastCheckedAt: at });
    expect(looked?.nextBackupAt).toBeGreaterThan(at);

    // Then the person changes something, and the next day's run writes.
    await applyMutation(database, account, mutation(list({ title: 'New list' })), {
      now: at + 1000,
    });
    at = (looked?.nextBackupAt ?? 0) + 10;
    expect(await runDueBackups(deps(), at)).toMatchObject({ committed: 1, unchanged: 0 });
    expect(await backups(ref)).toHaveLength(2);
  });

  it('tells nothing apart from a change in a workspace the person owns: a change there is written', async () => {
    const { account, ref } = await connected();
    await setSchedule(database, account, { mode: 'auto', frequency: 'hourly' }, T0);
    let row = await readConnection(database, account);
    expect(await runDueBackups(deps(), (row?.nextBackupAt ?? 0) + 1)).toMatchObject({
      committed: 1,
    });
    row = await readConnection(database, account);
    expect(await runDueBackups(deps(), (row?.nextBackupAt ?? 0) + 1)).toMatchObject({
      unchanged: 1,
    });
    expect(await backups(ref)).toHaveLength(1);
  });

  it('takes no more than the cap in a tick, oldest first, and the rest the next tick', async () => {
    const accounts: string[] = [];
    for (let n = 0; n < 5; n += 1) {
      const { account } = await connected();
      await dbAll(
        database,
        sql`UPDATE ${backupConnectionTable(database)} SET mode = 'auto', next_backup_at = ${T0 + n} WHERE account_id = ${account} RETURNING account_id`,
      );
      accounts.push(account);
    }
    const first = await runDueBackups(deps(), T0 + 100, { cap: 2, concurrency: 2 });
    expect(first.claimed).toBe(2);
    for (const account of accounts.slice(0, 2))
      expect((await readConnection(database, account))?.lastBackupAt).toBe(T0 + 100);
    for (const account of accounts.slice(2))
      expect((await readConnection(database, account))?.lastBackupAt).toBeNull();
    const rest = await runDueBackups(deps(), T0 + 200, { cap: 10 });
    expect(rest.claimed).toBe(3);
  });

  it('moves a failed connection on and does not try it again until it is due, and tells the others nothing of it', async () => {
    const bad = await connected();
    const good = await connected();
    await setSchedule(database, bad.account, { mode: 'auto', frequency: 'hourly' }, T0);
    await setSchedule(database, good.account, { mode: 'auto', frequency: 'hourly' }, T0);
    // The first one's repository goes public: its run fails, and the other's does not.
    fake.setPrivate(bad.ref, false);
    const rowBad = await readConnection(database, bad.account);
    const rowGood = await readConnection(database, good.account);
    const at = Math.max(rowBad?.nextBackupAt ?? 0, rowGood?.nextBackupAt ?? 0) + 1;
    expect(await runDueBackups(deps(), at)).toEqual({
      claimed: 2,
      committed: 1,
      unchanged: 0,
      failed: 1,
    });
    expect(await backups(bad.ref)).toEqual([]);
    expect(await backups(good.ref)).toHaveLength(1);
    const after = await readConnection(database, bad.account);
    expect(after?.nextBackupAt).toBeGreaterThan(at);
    // Not tried again a minute later.
    const calls = fake.requests.length;
    expect(await runDueBackups(deps(), at + 60_000)).toMatchObject({ claimed: 0 });
    expect(fake.requests.length).toBe(calls);
  });

  it('records nothing and writes nothing for a connection on a server that has lost its key, and moves on', async () => {
    const { account, ref } = await connected();
    await setSchedule(database, account, { mode: 'auto', frequency: 'hourly' }, T0);
    const at = ((await readConnection(database, account))?.nextBackupAt ?? 0) + 1;
    expect(await runDueBackups(deps({ ring: undefined }), at)).toMatchObject({
      claimed: 1,
      failed: 1,
    });
    expect(await backups(ref)).toEqual([]);
    expect((await readConnection(database, account))?.lastBackupAt).toBeNull();
  });

  it('starts a repository connected afresh with a first backup, whatever the last repository had', async () => {
    const { account } = await connected();
    await setSchedule(database, account, { mode: 'auto', frequency: 'hourly' }, T0);
    let row = await readConnection(database, account);
    await runDueBackups(deps(), (row?.nextBackupAt ?? 0) + 1);
    expect((await readConnection(database, account))?.lastFingerprint).not.toBeNull();
    // Connected to another repository: nothing is known of backups there, so the next run writes though nothing changed.
    const other: RepositoryRef = { owner: 'ada', name: `auto-${(counter += 1)}` };
    await fake.createRepository(other);
    const again = await connectRepository(
      { database, ring, apiUrl: fake.url, now: () => T0 + 5 },
      account,
      `${other.owner}/${other.name}`,
      TOKEN,
    );
    expect(again.ok).toBe(true);
    row = await readConnection(database, account);
    expect(row).toMatchObject({ lastFingerprint: null, lastBackupAt: null, mode: 'auto' });
    expect(await runDueBackups(deps(), (row?.nextBackupAt ?? 0) + 1)).toMatchObject({
      committed: 1,
    });
    expect(await backups(other)).toHaveLength(1);
  });
});
