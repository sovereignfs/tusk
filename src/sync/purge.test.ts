import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { testTarget } from '../db/test-support';
import { applyMutation } from './apply';
import type { Mutation } from './format';
import { pull } from './pull';
import { KEEP_TOMBSTONES_MS, PURGE_AFTER_MS, purge } from './purge';
import {
  account,
  accountSeq,
  list,
  makeStore,
  mutation,
  rowOf,
  series,
  snapshot,
  task,
} from './test-support';

/**
 * The purge (DESIGN.md §8.7, §11.5): deleted rows are removed for good after seven days, leaving a tombstone so that a device that was away learns of it;
 * tombstones and applied mutations go after ninety days.
 */
const { leg } = testTarget();
const DAY = 24 * 60 * 60 * 1000;

let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

const T0 = 1_800_000_000_000;
const apply = (owner: string, m: Mutation, now = T0) => applyMutation(database, owner, m, { now });
const tombstoneTable = () =>
  database.dialect === 'postgres' ? postgresSchema.tombstone : sqliteSchema.tombstone;
const tombstones = (owner: string) =>
  dbAll<{ table_name: string; id: string; seq: number | string }>(
    database,
    sql`SELECT table_name, id, seq FROM ${tombstoneTable()} WHERE account_id = ${owner} ORDER BY id`,
  );

describe(`the purge (${leg})`, () => {
  it('removes a row deleted over seven days ago, and not one deleted less than seven days ago', async () => {
    const owner = account();
    const l = list();
    const old = task(l.id);
    const recent = task(l.id);
    await apply(owner, mutation(l, old, recent));
    await apply(owner, mutation({ table: 'task', id: old.id, deleted: true }), T0);
    await apply(owner, mutation({ table: 'task', id: recent.id, deleted: true }), T0 + 2 * DAY);

    // Six days and twenty-three hours after the first: nothing is due.
    expect((await purge(database, T0 + PURGE_AFTER_MS - 3_600_000)).purged.task).toBe(0);
    expect(await rowOf(database, 'task', old.id)).toBeDefined();

    // Seven days and a second after it: the first goes, and the second, deleted two days later, stays.
    const result = await purge(database, T0 + PURGE_AFTER_MS + 1000);
    expect(result.purged.task).toBeGreaterThanOrEqual(1);
    expect(await rowOf(database, 'task', old.id)).toBeUndefined();
    expect(await rowOf(database, 'task', recent.id)).toBeDefined();
    expect((await tombstones(owner)).map((t) => t.id)).toEqual([old.id]);
  });

  it('leaves what is not deleted, and what was deleted and then restored, alone', async () => {
    const owner = account();
    const l = list();
    const kept = task(l.id);
    const restored = task(l.id);
    await apply(owner, mutation(l, kept, restored));
    await apply(owner, mutation({ table: 'task', id: restored.id, deleted: true }), T0);
    await apply(owner, mutation({ table: 'task', id: restored.id, deleted: false }), T0 + DAY);
    await purge(database, T0 + 30 * DAY);
    expect(await rowOf(database, 'task', kept.id)).toBeDefined();
    expect(await rowOf(database, 'task', restored.id)).toBeDefined();
    expect(await tombstones(owner)).toEqual([]);
  });

  it('takes a deleted parent’s subtasks, a deleted list’s tasks and series, and a subtask deleted on its own, and leaves the rest', async () => {
    const owner = account();
    const gone = list();
    const kept = list();
    const inGone = task(gone.id);
    const parent = task(kept.id);
    const withParent = task(kept.id, { parentId: parent.id });
    const alone = task(kept.id, { parentId: parent.id });
    const survivor = task(kept.id);
    const s = series(gone.id);
    await apply(owner, mutation(gone, kept, inGone, parent, withParent, alone, survivor, s));
    await apply(owner, mutation({ table: 'list', id: gone.id, deleted: true }), T0);
    await apply(
      owner,
      mutation(
        { table: 'task', id: parent.id, deleted: true },
        { table: 'task', id: withParent.id, deleted: true },
      ),
      T0,
    );
    await apply(owner, mutation({ table: 'task', id: alone.id, deleted: true }), T0);

    await purge(database, T0 + 8 * DAY);
    const rows = await snapshot(database, owner);
    expect((rows.list as { id: string }[]).map((r) => r.id)).toEqual([kept.id]);
    expect((rows.task as { id: string }[]).map((r) => r.id)).toEqual([survivor.id]);
    expect(rows.series).toEqual([]);
    const gonePairs = (await tombstones(owner)).map((t) => `${t.table_name}`).sort();
    expect(gonePairs).toEqual(['list', 'series', 'task', 'task', 'task', 'task']);
  });

  it('gives every tombstone of a run one new seq, past what the account had, so that a pull finds them', async () => {
    const owner = account();
    const l = list();
    const t = task(l.id);
    await apply(owner, mutation(l, t));
    await apply(owner, mutation({ table: 'task', id: t.id, deleted: true }), T0);
    const before = (await accountSeq(database, owner)) ?? 0;

    await purge(database, T0 + 8 * DAY);
    const [stone] = await tombstones(owner);
    expect(Number(stone?.seq)).toBeGreaterThan(before);
    expect(await accountSeq(database, owner)).toBe(Number(stone?.seq));
    // A device that was at `before` hears of it, and one that was at the end hears nothing.
    expect((await pull(database, owner, before)).tombstones).toEqual([
      { table: 'task', id: t.id, seq: Number(stone?.seq) },
    ]);
    expect((await pull(database, owner, Number(stone?.seq))).tombstones).toEqual([]);
  });

  it('does nothing the second time, and nothing to another account', async () => {
    const [ada, grace] = [account(), account()];
    const l = list();
    const t = task(l.id);
    await apply(ada, mutation(l, t));
    await apply(ada, mutation({ table: 'task', id: t.id, deleted: true }), T0);
    const gl = list();
    const gt = task(gl.id);
    await apply(grace, mutation(gl, gt));
    const graceBefore = await snapshot(database, grace);

    await purge(database, T0 + 8 * DAY);
    const seq = await accountSeq(database, ada);
    const again = await purge(database, T0 + 8 * DAY);
    expect(again.purged).toEqual({ list: 0, task: 0, series: 0 });
    expect(await accountSeq(database, ada)).toBe(seq);
    expect(await snapshot(database, grace)).toEqual(graceBefore);
    expect(await tombstones(grace)).toEqual([]);
  });

  it('can run in two places at once: the rows go once and each has one tombstone', async () => {
    const owner = account();
    const l = list();
    const tasks = Array.from({ length: 5 }, () => task(l.id));
    await apply(owner, mutation(l, ...tasks));
    await apply(
      owner,
      mutation(...tasks.map((t) => ({ table: 'task' as const, id: t.id, deleted: true }))),
      T0,
    );
    await Promise.all([
      purge(database, T0 + 8 * DAY),
      purge(database, T0 + 8 * DAY),
      purge(database, T0 + 8 * DAY),
    ]);
    expect((await snapshot(database, owner)).task).toEqual([]);
    expect(await tombstones(owner)).toHaveLength(5);
  });

  describe('what it keeps of the past', () => {
    it('forgets a tombstone after ninety days, and remembers that it did: the account’s cursors below it need a snapshot', async () => {
      const owner = account();
      const l = list();
      const t = task(l.id);
      await apply(owner, mutation(l, t));
      await apply(owner, mutation({ table: 'task', id: t.id, deleted: true }), T0);
      const purgedAt = T0 + 8 * DAY;
      await purge(database, purgedAt);
      const [stone] = await tombstones(owner);

      // Not yet: eighty-nine days after it was made.
      expect((await purge(database, purgedAt + KEEP_TOMBSTONES_MS - DAY)).tombstonesRemoved).toBe(
        0,
      );
      expect(await tombstones(owner)).toHaveLength(1);

      const result = await purge(database, purgedAt + KEEP_TOMBSTONES_MS + DAY);
      expect(result.tombstonesRemoved).toBeGreaterThanOrEqual(1);
      expect(await tombstones(owner)).toEqual([]);
      const settingsTable =
        database.dialect === 'postgres'
          ? postgresSchema.accountSettings
          : sqliteSchema.accountSettings;
      const [settings] = await dbAll<{ pruned_through: number | string }>(
        database,
        sql`SELECT pruned_through FROM ${settingsTable} WHERE account_id = ${owner}`,
      );
      expect(Number(settings?.pruned_through)).toBe(Number(stone?.seq));
    });

    it('forgets the record of an applied mutation after ninety days, and not before', async () => {
      const owner = account();
      const m = mutation(list());
      await apply(owner, m, T0);
      const recorded = () =>
        dbAll<{ id: string }>(
          database,
          sql`SELECT id FROM ${database.dialect === 'postgres' ? postgresSchema.appliedMutation : sqliteSchema.appliedMutation} WHERE account_id = ${owner}`,
        );
      await purge(database, T0 + KEEP_TOMBSTONES_MS - DAY);
      expect(await recorded()).toHaveLength(1);
      await purge(database, T0 + KEEP_TOMBSTONES_MS + DAY);
      expect(await recorded()).toEqual([]);
    });
  });
});
