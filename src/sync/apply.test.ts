import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll, dbRun } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { testTarget } from '../db/test-support';
import { type ApplyResult, applyMutation } from './apply';
import { LIMITS, type Mutation, type SyncTable } from './format';
import { decodeFields } from './validate';
import {
  account,
  accountSeq,
  id,
  list,
  makeStore,
  mutation,
  rowOf,
  series,
  snapshot,
  task,
} from './test-support';

/**
 * Applying a mutation, on whichever database the leg runs on (DESIGN.md §7, §8.3, §8.4). Each test uses accounts of its own, so they do not depend
 * on each other or on the order, and what one account does is always compared with what another has, which is the point.
 */
const { leg } = testTarget();
const CIPHER = 'YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0-IFgyNTUxOSBhYmM';

let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

let clock = 1_800_000_000_000;
const now = () => (clock += 1000);
const apply = (
  owner: string,
  m: Mutation,
  options: { plain?: 'check' | 'refuse'; limits?: { lists: number; tasks: number } } = {},
) => applyMutation(database, owner, m, { now: now(), ...options });
const applied = (result: ApplyResult) => {
  if (result.status !== 'applied') throw new Error(`refused: ${result.code}`);
  return result;
};
const fieldsOf = async (table: SyncTable, rowId: string) => {
  const row = await rowOf(database, table, rowId);
  const decoded = decodeFields(String(row?.fields));
  if (!decoded.ok) throw new Error('bad fields');
  return decoded.value;
};

describe(`applying a mutation (${leg})`, () => {
  describe('a new row', () => {
    it('is stored with its owner, its structure, the seq and time it was made at, and each field stamped with that seq', async () => {
      const ada = account();
      const l = list({ title: 'Home' });
      const t = task(l.id, { position: 'a1' });
      const r = series(l.id);
      const result = applied(await apply(ada, mutation(l, t, r)));
      expect(result).toEqual({ status: 'applied', seq: 1, replay: false });

      expect(await rowOf(database, 'list', l.id)).toMatchObject({
        owner_id: ada,
        position: 'a0',
        seq: 1,
        deleted_at: null,
      });
      expect(await rowOf(database, 'task', t.id)).toMatchObject({
        owner_id: ada,
        list_id: l.id,
        parent_id: null,
        position: 'a1',
        seq: 1,
      });
      expect(await rowOf(database, 'series', r.id)).toMatchObject({
        owner_id: ada,
        list_id: l.id,
        seq: 1,
      });
      expect(await fieldsOf('task', t.id)).toEqual({ title: { v: 'Buy milk', s: 1 } });
      expect(Number((await rowOf(database, 'task', t.id))?.created_at)).toBeGreaterThan(0);
      expect(await accountSeq(database, ada)).toBe(1);
    });

    it('can be made as ciphertext, which is stored as it came', async () => {
      const ada = account();
      const l = list();
      const t = task(l.id, { fields: { title: { c: CIPHER }, notes: { c: CIPHER } } });
      applied(await apply(ada, mutation(l, t)));
      expect(await fieldsOf('task', t.id)).toEqual({
        title: { c: CIPHER, s: 1 },
        notes: { c: CIPHER, s: 1 },
      });
    });

    it('needs what its table needs: a task with no list is an edit of a row that is not there', async () => {
      const ada = account();
      expect(
        await apply(ada, mutation({ table: 'task', id: id(), fields: { title: { v: 'x' } } })),
      ).toEqual({ status: 'refused', code: 'unavailable' });
      expect(await accountSeq(database, ada)).toBeUndefined();
    });
  });

  describe('order', () => {
    it('is the account’s counter: each mutation takes the next seq, and only the rows it touched are stamped with it', async () => {
      const ada = account();
      const l = list();
      const a = task(l.id);
      const b = task(l.id);
      expect(applied(await apply(ada, mutation(l, a, b))).seq).toBe(1);
      expect(
        applied(
          await apply(ada, mutation({ table: 'task', id: a.id, fields: { starred: { v: true } } })),
        ).seq,
      ).toBe(2);
      expect(Number((await rowOf(database, 'task', a.id))?.seq)).toBe(2);
      expect(Number((await rowOf(database, 'task', b.id))?.seq)).toBe(1);
      expect(Number((await rowOf(database, 'list', l.id))?.seq)).toBe(1);
      expect(await accountSeq(database, ada)).toBe(2);
    });

    it('is not shared between accounts: another account’s mutations do not move it', async () => {
      const ada = account();
      const grace = account();
      applied(await apply(ada, mutation(list())));
      applied(await apply(ada, mutation(list())));
      expect(applied(await apply(grace, mutation(list()))).seq).toBe(1);
      expect(await accountSeq(database, ada)).toBe(2);
    });
  });

  describe('fields', () => {
    it('merge: two devices that change different fields both stand', async () => {
      const ada = account();
      const l = list();
      const t = task(l.id);
      applied(await apply(ada, mutation(l, t)));
      applied(
        await apply(
          ada,
          mutation({ table: 'task', id: t.id, fields: { notes: { v: 'from the phone' } } }),
        ),
      );
      applied(
        await apply(ada, mutation({ table: 'task', id: t.id, fields: { starred: { v: true } } })),
      );
      expect(await fieldsOf('task', t.id)).toEqual({
        title: { v: 'Buy milk', s: 1 },
        notes: { v: 'from the phone', s: 2 },
        starred: { v: true, s: 3 },
      });
    });

    it('go to the later arrival when two devices change the same one, and say which seq wrote it', async () => {
      const ada = account();
      const l = list();
      const t = task(l.id);
      applied(await apply(ada, mutation(l, t)));
      applied(
        await apply(
          ada,
          mutation({ table: 'task', id: t.id, fields: { title: { v: 'from the laptop' } } }),
        ),
      );
      applied(
        await apply(
          ada,
          mutation({ table: 'task', id: t.id, fields: { title: { v: 'from the phone' } } }),
        ),
      );
      expect((await fieldsOf('task', t.id)).title).toEqual({ v: 'from the phone', s: 3 });
    });

    it('can become ciphertext and plain again, a field at a time', async () => {
      const ada = account();
      const l = list();
      const t = task(l.id);
      applied(await apply(ada, mutation(l, t)));
      applied(
        await apply(ada, mutation({ table: 'task', id: t.id, fields: { title: { c: CIPHER } } })),
      );
      expect((await fieldsOf('task', t.id)).title).toEqual({ c: CIPHER, s: 2 });
    });
  });

  describe('a mutation sent again', () => {
    it('changes nothing and is answered as it was', async () => {
      const ada = account();
      const l = list();
      const m = mutation(l, task(l.id));
      const first = applied(await apply(ada, m));
      const before = await snapshot(database, ada);

      const again = applied(await apply(ada, m));
      expect(again).toEqual({ status: 'applied', seq: first.seq, replay: true });
      expect(await snapshot(database, ada)).toEqual(before);
      expect(await accountSeq(database, ada)).toBe(first.seq);
    });

    it('is decided by its id: other content under a used id is not applied', async () => {
      const ada = account();
      const l = list();
      const m = mutation(l);
      applied(await apply(ada, m));
      const other = { mutationId: m.mutationId, changes: [task(l.id)] };
      expect(applied(await apply(ada, other as Mutation)).replay).toBe(true);
      expect((await snapshot(database, ada)).task).toEqual([]);
    });

    it('is not an answer to another account that happens to use the same id', async () => {
      const ada = account();
      const grace = account();
      const m = mutation(list());
      applied(await apply(ada, m));
      // The same mutation id with rows of her own: Ada’s record of it is nothing to Grace.
      const hers = { mutationId: m.mutationId, changes: [list()] };
      expect(applied(await apply(grace, hers))).toEqual({
        status: 'applied',
        seq: 1,
        replay: false,
      });
      expect((await snapshot(database, grace)).list).toHaveLength(1);
    });
  });

  describe('a mutation that cannot be applied', () => {
    it('writes nothing of it, not the changes before the bad one, not the counter, and not that it was tried', async () => {
      const ada = account();
      const l = list();
      applied(await apply(ada, mutation(l)));
      const before = await snapshot(database, ada);
      const m = mutation(task(l.id), task(id()) /* a list that is not there */, task(l.id));

      expect(await apply(ada, m)).toEqual({ status: 'refused', code: 'unavailable' });
      expect(await snapshot(database, ada)).toEqual(before);
      expect(await accountSeq(database, ada)).toBe(1);
      // Not recorded, so a corrected mutation under the same id is not taken for a repeat.
      const fixed = { mutationId: m.mutationId, changes: [task(l.id)] };
      expect(applied(await apply(ada, fixed))).toMatchObject({ seq: 2, replay: false });
    });
  });

  describe('as the wrong account', () => {
    // Ada owns a list, a task with a subtask, and a series. Grace owns a list and a task. Each way Grace can reach for Ada's is tried, on each table.
    it('changes nothing of Ada’s and gives the same answer as for a row that does not exist, whatever Grace does', async () => {
      const ada = account();
      const grace = account();
      const aList = list();
      const aTask = task(aList.id);
      const aSub = task(aList.id, { parentId: aTask.id });
      const aSeries = series(aList.id);
      applied(await apply(ada, mutation(aList, aTask, aSub, aSeries)));
      const gList = list();
      const gTask = task(gList.id);
      applied(await apply(grace, mutation(gList, gTask)));

      const adaBefore = await snapshot(database, ada);
      const graceBefore = await snapshot(database, grace);
      const graceSeq = await accountSeq(database, grace);

      const attempts: [string, Mutation][] = [
        [
          'edit her task',
          mutation({ table: 'task', id: aTask.id, fields: { title: { v: 'mine now' } } }),
        ],
        [
          'edit her list',
          mutation({ table: 'list', id: aList.id, fields: { title: { v: 'mine now' } } }),
        ],
        [
          'edit her series',
          mutation({ table: 'series', id: aSeries.id, fields: { rule: { v: 'FREQ=YEARLY' } } }),
        ],
        ['delete her task', mutation({ table: 'task', id: aTask.id, deleted: true })],
        ['delete her list', mutation({ table: 'list', id: aList.id, deleted: true })],
        ['restore her task', mutation({ table: 'task', id: aSub.id, deleted: false })],
        ['move her task', mutation({ table: 'task', id: aTask.id, listId: gList.id })],
        ['reorder her list', mutation({ table: 'list', id: aList.id, position: 'zz' })],
        ['make a task with her task’s id', mutation({ ...task(gList.id), id: aTask.id })],
        ['make a list with her list’s id', mutation({ ...list(), id: aList.id })],
        ['make a series with her series’ id', mutation({ ...series(gList.id), id: aSeries.id })],
        ['put a new task in her list', mutation(task(aList.id))],
        ['put a new series in her list', mutation(series(aList.id))],
        ['make a subtask of her task', mutation(task(gList.id, { parentId: aTask.id }))],
        [
          'move her own task into her list',
          mutation({ table: 'task', id: gTask.id, listId: aList.id }),
        ],
        [
          'make her own task a subtask of hers',
          mutation({ table: 'task', id: gTask.id, parentId: aTask.id }),
        ],
        [
          'point her own task at her series',
          mutation({ table: 'task', id: gTask.id, fields: { seriesId: { v: aSeries.id } } }),
        ],
        [
          'move her own series into her list',
          mutation({ table: 'series', id: series(gList.id).id, listId: aList.id }),
        ],
      ];
      for (const [what, m] of attempts) {
        const result = await apply(grace, m);
        expect(result.status, what).toBe('refused');
        // Whether the row is there for someone else or not there at all, the answer is the same.
        const nothing = { ...m, changes: m.changes.map((c) => ({ ...c, id: id() })) } as Mutation;
        if (
          what.startsWith('edit') ||
          what.startsWith('delete') ||
          what.startsWith('restore') ||
          what.startsWith('move her task') ||
          what.startsWith('reorder')
        ) {
          expect(await apply(grace, nothing), what).toEqual(result);
        }
      }

      expect(await snapshot(database, ada)).toEqual(adaBefore);
      expect(await snapshot(database, grace)).toEqual(graceBefore);
      expect(await accountSeq(database, grace)).toBe(graceSeq);
      expect(await accountSeq(database, ada)).toBe(1);
    });

    it('is the answer for every one of those: unavailable, which says nothing of whose it is', async () => {
      const ada = account();
      const grace = account();
      const aList = list();
      const aTask = task(aList.id);
      applied(await apply(ada, mutation(aList, aTask)));
      for (const m of [
        mutation({ table: 'task', id: aTask.id, fields: { title: { v: 'x' } } }),
        mutation({ ...task(id()), id: aTask.id }),
        mutation(task(aList.id)),
      ]) {
        expect(await apply(grace, m)).toEqual({ status: 'refused', code: 'unavailable' });
      }
    });
  });

  describe('deleting and restoring', () => {
    it('stamps the time it is deleted at on the server, and an edit of a deleted row restores it', async () => {
      const ada = account();
      const l = list();
      const t = task(l.id);
      applied(await apply(ada, mutation(l, t)));

      applied(await apply(ada, mutation({ table: 'task', id: t.id, deleted: true })));
      expect(Number((await rowOf(database, 'task', t.id))?.deleted_at)).toBeGreaterThan(0);

      applied(
        await apply(
          ada,
          mutation({ table: 'task', id: t.id, fields: { notes: { v: 'still here' } } }),
        ),
      );
      expect((await rowOf(database, 'task', t.id))?.deleted_at).toBeNull();
      expect((await fieldsOf('task', t.id)).notes).toMatchObject({ v: 'still here' });
    });

    it('keeps the first time when both devices delete, and is deleted', async () => {
      const ada = account();
      const l = list();
      const t = task(l.id);
      applied(await apply(ada, mutation(l, t)));
      applied(await apply(ada, mutation({ table: 'task', id: t.id, deleted: true })));
      const first = Number((await rowOf(database, 'task', t.id))?.deleted_at);
      applied(await apply(ada, mutation({ table: 'task', id: t.id, deleted: true })));
      expect(Number((await rowOf(database, 'task', t.id))?.deleted_at)).toBe(first);
    });

    it('restores with deleted: false, and not just by editing', async () => {
      const ada = account();
      const l = list();
      applied(await apply(ada, mutation(l)));
      applied(await apply(ada, mutation({ table: 'list', id: l.id, deleted: true })));
      applied(await apply(ada, mutation({ table: 'list', id: l.id, deleted: false })));
      expect((await rowOf(database, 'list', l.id))?.deleted_at).toBeNull();
    });

    it('brings a list back when a task is added to it that another device deleted', async () => {
      const ada = account();
      const l = list();
      applied(await apply(ada, mutation(l)));
      applied(await apply(ada, mutation({ table: 'list', id: l.id, deleted: true })));
      const seqBefore = Number((await rowOf(database, 'list', l.id))?.seq);

      const added = task(l.id);
      const result = applied(await apply(ada, mutation(added)));
      expect((await rowOf(database, 'list', l.id))?.deleted_at).toBeNull();
      // And devices learn of it: the list is stamped with the mutation’s seq.
      expect(Number((await rowOf(database, 'list', l.id))?.seq)).toBe(result.seq);
      expect(result.seq).toBeGreaterThan(seqBefore);
    });

    it('does not bring it back when the same mutation deletes it', async () => {
      const ada = account();
      const l = list();
      const t = task(l.id);
      applied(await apply(ada, mutation(l, t)));
      applied(
        await apply(
          ada,
          mutation(
            { table: 'list', id: l.id, deleted: true },
            { table: 'task', id: t.id, deleted: true },
          ),
        ),
      );
      expect(Number((await rowOf(database, 'list', l.id))?.deleted_at)).toBeGreaterThan(0);
      expect(Number((await rowOf(database, 'task', t.id))?.deleted_at)).toBeGreaterThan(0);
    });

    it('brings a deleted parent back with a subtask that is edited', async () => {
      const ada = account();
      const l = list();
      const parent = task(l.id);
      const sub = task(l.id, { parentId: parent.id });
      applied(await apply(ada, mutation(l, parent, sub)));
      applied(await apply(ada, mutation({ table: 'task', id: parent.id, deleted: true })));
      applied(
        await apply(ada, mutation({ table: 'task', id: sub.id, fields: { notes: { v: 'x' } } })),
      );
      expect((await rowOf(database, 'task', parent.id))?.deleted_at).toBeNull();
    });
  });

  describe('a parent deleted with its subtasks', () => {
    it('is stamped with one time for all of them, so that restoring finds exactly those', async () => {
      const ada = account();
      const l = list();
      const parent = task(l.id);
      const early = task(l.id, { parentId: parent.id });
      const withIt = task(l.id, { parentId: parent.id });
      applied(await apply(ada, mutation(l, parent, early, withIt)));
      // One subtask is deleted on its own, earlier.
      applied(await apply(ada, mutation({ table: 'task', id: early.id, deleted: true })));
      applied(
        await apply(
          ada,
          mutation(
            { table: 'task', id: parent.id, deleted: true },
            { table: 'task', id: withIt.id, deleted: true },
          ),
        ),
      );
      const [p, w, e] = await Promise.all([
        rowOf(database, 'task', parent.id),
        rowOf(database, 'task', withIt.id),
        rowOf(database, 'task', early.id),
      ]);
      expect(Number(p?.deleted_at)).toBeGreaterThan(0);
      expect(w?.deleted_at).toEqual(p?.deleted_at);
      expect(Number(e?.deleted_at)).toBeLessThan(Number(p?.deleted_at));
    });
  });

  describe('subtasks', () => {
    async function setup() {
      const ada = account();
      const l = list();
      const other = list();
      const parent = task(l.id);
      applied(await apply(ada, mutation(l, other, parent)));
      return { ada, l, other, parent };
    }

    it('are one level deep, in the list of the parent', async () => {
      const { ada, l, parent } = await setup();
      applied(await apply(ada, mutation(task(l.id, { parentId: parent.id }))));
    });

    it('are refused in another list than their parent’s', async () => {
      const { ada, other, parent } = await setup();
      expect(await apply(ada, mutation(task(other.id, { parentId: parent.id })))).toEqual({
        status: 'refused',
        code: 'structure',
      });
    });

    it('are refused under a subtask', async () => {
      const { ada, l, parent } = await setup();
      const sub = task(l.id, { parentId: parent.id });
      applied(await apply(ada, mutation(sub)));
      expect(await apply(ada, mutation(task(l.id, { parentId: sub.id })))).toEqual({
        status: 'refused',
        code: 'structure',
      });
    });

    it('are refused for a task that has subtasks already, which then would be a third level', async () => {
      const { ada, l, parent } = await setup();
      const sub = task(l.id, { parentId: parent.id });
      const loose = task(l.id);
      applied(await apply(ada, mutation(sub, loose)));
      expect(
        await apply(ada, mutation({ table: 'task', id: parent.id, parentId: loose.id })),
      ).toEqual({ status: 'refused', code: 'structure' });
    });

    it('are refused under a parent that is not there', async () => {
      const { ada, l } = await setup();
      expect(await apply(ada, mutation(task(l.id, { parentId: id() })))).toEqual({
        status: 'refused',
        code: 'unavailable',
      });
    });

    it('move with their parent, in one mutation, and not alone in a mutation that leaves them behind', async () => {
      const { ada, l, other, parent } = await setup();
      const sub = task(l.id, { parentId: parent.id });
      applied(await apply(ada, mutation(sub)));

      expect(
        await apply(ada, mutation({ table: 'task', id: parent.id, listId: other.id })),
      ).toEqual({ status: 'refused', code: 'structure' });
      expect(await apply(ada, mutation({ table: 'task', id: sub.id, listId: other.id }))).toEqual({
        status: 'refused',
        code: 'structure',
      });

      applied(
        await apply(
          ada,
          mutation(
            { table: 'task', id: parent.id, listId: other.id, position: 'a5' },
            { table: 'task', id: sub.id, listId: other.id },
          ),
        ),
      );
      expect(await rowOf(database, 'task', sub.id)).toMatchObject({
        list_id: other.id,
        parent_id: parent.id,
      });
    });

    it('can be promoted to top-level tasks with parentId null', async () => {
      const { ada, l, parent } = await setup();
      const sub = task(l.id, { parentId: parent.id });
      applied(await apply(ada, mutation(sub)));
      applied(await apply(ada, mutation({ table: 'task', id: sub.id, parentId: null })));
      expect((await rowOf(database, 'task', sub.id))?.parent_id).toBeNull();
    });
  });

  describe('a subtask has no date, star or repeat', () => {
    async function parentAndList() {
      const ada = account();
      const l = list();
      const parent = task(l.id);
      applied(await apply(ada, mutation(l, parent)));
      return { ada, l, parent };
    }
    const refused = { status: 'refused', code: 'structure' };

    it('is refused when it is made with one, wherever it can be read', async () => {
      const { ada, l, parent } = await parentAndList();
      const sub = (fields: Record<string, unknown>) =>
        task(l.id, { parentId: parent.id, fields: { title: { v: 'x' }, ...fields } });
      for (const fields of [
        { dueDate: { v: '2026-11-05' } },
        { dueTime: { v: '09:30' } },
        { starred: { v: true } },
        { seriesId: { v: id() } },
      ]) {
        expect(await apply(ada, mutation(sub(fields))), JSON.stringify(fields)).toEqual(refused);
      }
      expect((await snapshot(database, ada)).task).toHaveLength(1);
    });

    it('is refused when an edit gives an existing one a date, a star or a repeat', async () => {
      const { ada, l, parent } = await parentAndList();
      const sub = task(l.id, { parentId: parent.id });
      applied(await apply(ada, mutation(sub)));
      const edits: Record<string, { v: string | boolean }>[] = [
        { dueDate: { v: '2026-11-05' } },
        { starred: { v: true } },
        { dueTime: { v: '10:00' } },
      ];
      for (const fields of edits) {
        expect(
          await apply(ada, mutation({ table: 'task', id: sub.id, fields })),
          JSON.stringify(fields),
        ).toEqual(refused);
      }
      expect(
        await apply(ada, mutation({ table: 'task', id: sub.id, fields: { notes: { v: 'fine' } } })),
      ).toMatchObject({ status: 'applied' });
    });

    it('is refused when a task that has a date is made a subtask, and let through when it is cleared in the same mutation', async () => {
      const { ada, l, parent } = await parentAndList();
      const dated = task(l.id, {
        fields: { title: { v: 'dated' }, dueDate: { v: '2026-11-05' }, starred: { v: true } },
      });
      applied(await apply(ada, mutation(dated)));
      expect(
        await apply(ada, mutation({ table: 'task', id: dated.id, parentId: parent.id })),
      ).toEqual(refused);
      applied(
        await apply(
          ada,
          mutation({
            table: 'task',
            id: dated.id,
            parentId: parent.id,
            fields: { dueDate: { v: null }, starred: { v: false } },
          }),
        ),
      );
    });

    it('may have them empty, false or unreadable: nothing is held against what the server cannot see', async () => {
      const { ada, l, parent } = await parentAndList();
      applied(
        await apply(
          ada,
          mutation(
            task(l.id, {
              parentId: parent.id,
              fields: {
                title: { v: 'a' },
                dueDate: { v: null },
                starred: { v: false },
                seriesId: { v: null },
              },
            }),
          ),
        ),
      );
      applied(
        await apply(
          ada,
          mutation(
            task(l.id, {
              parentId: parent.id,
              fields: { title: { c: CIPHER }, dueDate: { c: CIPHER } },
            }),
          ),
        ),
      );
    });
  });

  describe('what an account may have', () => {
    it('is 200 lists and 50,000 tasks', () => {
      expect(LIMITS.listsPerAccount).toBe(200);
      expect(LIMITS.tasksPerAccount).toBe(50_000);
    });

    it('is enforced: the row over the limit refuses the whole mutation, and a mutation inside it is let through', async () => {
      const limits = { lists: 3, tasks: 4 };
      const ada = account();
      const lists = [list(), list(), list()];
      const home = lists[0]?.id ?? '';
      applied(await apply(ada, mutation(...lists), { limits }));
      expect(await apply(ada, mutation(list()), { limits })).toEqual({
        status: 'refused',
        code: 'limit',
      });
      expect((await snapshot(database, ada)).list).toHaveLength(3);

      applied(
        await apply(ada, mutation(task(home), task(home), task(home), task(home)), { limits }),
      );
      expect(await apply(ada, mutation(task(home)), { limits })).toEqual({
        status: 'refused',
        code: 'limit',
      });
      expect((await snapshot(database, ada)).task).toHaveLength(4);
      // An edit is not a new row, so an account that is full can still work.
      const existing = ((await snapshot(database, ada)).task as { id: string }[])[0] ?? { id: '' };
      applied(
        await apply(
          ada,
          mutation({ table: 'task', id: existing.id, fields: { starred: { v: true } } }),
          { limits },
        ),
      );
    });

    it('is each account’s own: one that is full does not stop another', async () => {
      const limits = { lists: 1, tasks: 1 };
      const ada = account();
      const grace = account();
      applied(await apply(ada, mutation(list()), { limits }));
      applied(await apply(grace, mutation(list()), { limits }));
    });
  });

  describe('the mirrors the reminder job reads', () => {
    it('are copied from the fields when they are readable, and follow them', async () => {
      const ada = account();
      const l = list();
      const t = task(l.id, {
        fields: {
          title: { v: 'x' },
          dueDate: { v: '2026-11-05' },
          dueTime: { v: '09:30' },
          completedAt: { v: 1_793_000_000_000 },
        },
      });
      applied(await apply(ada, mutation(l, t)));
      expect(await rowOf(database, 'task', t.id)).toMatchObject({
        due_date: '2026-11-05',
        due_time: '09:30',
      });
      expect(Number((await rowOf(database, 'task', t.id))?.completed_at)).toBe(1_793_000_000_000);

      applied(
        await apply(
          ada,
          mutation({
            table: 'task',
            id: t.id,
            fields: { dueDate: { v: null }, completedAt: { v: null } },
          }),
        ),
      );
      expect(await rowOf(database, 'task', t.id)).toMatchObject({
        due_date: null,
        due_time: '09:30',
        completed_at: null,
      });
    });

    it('are null when the fields are ciphertext, since the server can read nothing of them', async () => {
      const ada = account();
      const l = list();
      const t = task(l.id, {
        fields: { title: { c: CIPHER }, dueDate: { c: CIPHER }, dueTime: { c: CIPHER } },
      });
      applied(await apply(ada, mutation(l, t)));
      expect(await rowOf(database, 'task', t.id)).toMatchObject({
        due_date: null,
        due_time: null,
        completed_at: null,
      });
    });

    it('clear a reminder that was sent when the due date or time changes, and not when anything else does', async () => {
      const ada = account();
      const l = list();
      const t = task(l.id, {
        fields: { title: { v: 'x' }, dueDate: { v: '2026-11-05' }, dueTime: { v: '09:30' } },
      });
      applied(await apply(ada, mutation(l, t)));
      const taskTable = database.dialect === 'postgres' ? postgresSchema.task : sqliteSchema.task;
      const markSent = () =>
        dbRun(database, sql`UPDATE ${taskTable} SET reminder_sent_at = 12345 WHERE id = ${t.id}`);

      await markSent();
      applied(
        await apply(
          ada,
          mutation({
            table: 'task',
            id: t.id,
            fields: { title: { v: 'renamed' }, starred: { v: true } },
          }),
        ),
      );
      expect(Number((await rowOf(database, 'task', t.id))?.reminder_sent_at)).toBe(12345);

      applied(
        await apply(
          ada,
          mutation({ table: 'task', id: t.id, fields: { dueTime: { v: '10:00' } } }),
        ),
      );
      expect((await rowOf(database, 'task', t.id))?.reminder_sent_at).toBeNull();
    });
  });

  describe('a series a task points at', () => {
    it('must be the account’s, when the pointer can be read', async () => {
      const ada = account();
      const l = list();
      const r = series(l.id);
      applied(await apply(ada, mutation(l, r)));
      applied(
        await apply(
          ada,
          mutation(task(l.id, { fields: { title: { v: 'x' }, seriesId: { v: r.id } } })),
        ),
      );
      expect(
        await apply(
          ada,
          mutation(task(l.id, { fields: { title: { v: 'x' }, seriesId: { v: id() } } })),
        ),
      ).toEqual({ status: 'refused', code: 'unavailable' });
    });

    it('may be made in the same mutation, in either order', async () => {
      const ada = account();
      const l = list();
      const r = series(l.id);
      applied(
        await apply(
          ada,
          mutation(l, task(l.id, { fields: { title: { v: 'x' }, seriesId: { v: r.id } } }), r),
        ),
      );
    });
  });

  describe('at once', () => {
    it('serialises mutations of one account: each gets its own seq, none repeats, and the counter ends at the last', async () => {
      const ada = account();
      const l = list();
      applied(await apply(ada, mutation(l)));
      const results = await Promise.all(
        Array.from({ length: 12 }, () => apply(ada, mutation(task(l.id)))),
      );
      const seqs = results.map((result) => applied(result).seq).sort((a, b) => a - b);
      expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => i + 2));
      expect(await accountSeq(database, ada)).toBe(13);
      expect((await snapshot(database, ada)).task).toHaveLength(12);
      // Each row carries the seq of the mutation that made it, and no two mutations share one.
      const stamped = (await snapshot(database, ada)).task
        .map((row) => Number((row as { seq: number }).seq))
        .sort((a, b) => a - b);
      expect(stamped).toEqual(seqs);
    });

    it('applies the same mutation sent twice at once exactly once', async () => {
      const ada = account();
      const l = list();
      const m = mutation(l, task(l.id));
      const results = await Promise.all(Array.from({ length: 6 }, () => apply(ada, m)));
      expect(results.filter((r) => r.status === 'applied' && !r.replay)).toHaveLength(1);
      expect(results.every((r) => r.status === 'applied')).toBe(true);
      expect(new Set(results.map((r) => (r.status === 'applied' ? r.seq : -1))).size).toBe(1);
      expect(await accountSeq(database, ada)).toBe(1);
      expect((await snapshot(database, ada)).task).toHaveLength(1);
    });

    it('does not hold one account up for another’s', async () => {
      const accounts = [account(), account(), account()];
      const results = await Promise.all(
        accounts.flatMap((owner) => [
          apply(owner, mutation(list())),
          apply(owner, mutation(list())),
        ]),
      );
      expect(results.every((r) => r.status === 'applied')).toBe(true);
      for (const owner of accounts) expect(await accountSeq(database, owner)).toBe(2);
    });

    it('is not confused by two accounts making the same id at once: one wins, one is refused, nothing is merged', async () => {
      const ada = account();
      const grace = account();
      const shared = list();
      const [a, g] = await Promise.all([
        apply(ada, mutation(shared)),
        apply(grace, mutation({ ...shared })),
      ]);
      expect([a.status, g.status].sort()).toEqual(['applied', 'refused']);
      const rows = await dbAll<{ owner_id: string }>(
        database,
        sql`SELECT owner_id FROM ${database.dialect === 'postgres' ? postgresSchema.list : sqliteSchema.list} WHERE id = ${shared.id}`,
      );
      expect(rows).toHaveLength(1);
    });
  });

  it('gives up ciphertext only to the account’s own device: nothing in a row names who else could read it', async () => {
    const ada = account();
    const l = list();
    applied(await apply(ada, mutation(l, task(l.id, { fields: { title: { c: CIPHER } } }))));
    const rows = (await snapshot(database, ada)).task as { fields: string }[];
    expect(rows[0]?.fields).not.toContain('"v"');
  });
});
