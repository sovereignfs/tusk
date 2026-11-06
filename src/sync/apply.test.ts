import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { testTarget } from '../db/test-support';
import { type ApplyResult, applyMutation } from './apply';
import { LIMITS, type Mutation, type SyncTable } from './format';
import { decodeFields } from './validate';
import {
  account,
  accountSeq,
  card,
  check,
  id,
  list,
  makeStore,
  mutation,
  rowOf,
  series,
  snapshot,
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
  options: {
    plain?: 'check' | 'refuse';
    limits?: { lists: number; cards: number; checks?: number };
  } = {},
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
      const t = card(l.id, { position: 'a1' });
      const r = series(l.id);
      const result = applied(await apply(ada, mutation(l, t, r)));
      expect(result).toEqual({ status: 'applied', seq: 1, replay: false });

      expect(await rowOf(database, 'desk_list', l.id)).toMatchObject({
        owner_id: ada,
        position: 'a0',
        seq: 1,
        deleted_at: null,
      });
      expect(await rowOf(database, 'desk_card', t.id)).toMatchObject({
        owner_id: ada,
        list_id: l.id,
        position: 'a1',
        seq: 1,
      });
      expect(await rowOf(database, 'desk_series', r.id)).toMatchObject({
        owner_id: ada,
        list_id: l.id,
        seq: 1,
      });
      expect(await fieldsOf('desk_card', t.id)).toEqual({ title: { v: 'Buy milk', s: 1 } });
      expect(Number((await rowOf(database, 'desk_card', t.id))?.created_at)).toBeGreaterThan(0);
      expect(await accountSeq(database, ada)).toBe(1);
    });

    it('can be made as ciphertext, which is stored as it came', async () => {
      const ada = account();
      const l = list();
      const t = card(l.id, { fields: { title: { c: CIPHER }, description: { c: CIPHER } } });
      applied(await apply(ada, mutation(l, t)));
      expect(await fieldsOf('desk_card', t.id)).toEqual({
        title: { c: CIPHER, s: 1 },
        description: { c: CIPHER, s: 1 },
      });
    });

    it('needs what its table needs: a task with no list is an edit of a row that is not there', async () => {
      const ada = account();
      expect(
        await apply(ada, mutation({ table: 'desk_card', id: id(), fields: { title: { v: 'x' } } })),
      ).toEqual({ status: 'refused', code: 'unavailable' });
      expect(await accountSeq(database, ada)).toBeUndefined();
    });
  });

  describe('order', () => {
    it('is the account’s counter: each mutation takes the next seq, and only the rows it touched are stamped with it', async () => {
      const ada = account();
      const l = list();
      const a = card(l.id);
      const b = card(l.id);
      expect(applied(await apply(ada, mutation(l, a, b))).seq).toBe(1);
      expect(
        applied(
          await apply(
            ada,
            mutation({ table: 'desk_card', id: a.id, fields: { starred: { v: true } } }),
          ),
        ).seq,
      ).toBe(2);
      expect(Number((await rowOf(database, 'desk_card', a.id))?.seq)).toBe(2);
      expect(Number((await rowOf(database, 'desk_card', b.id))?.seq)).toBe(1);
      expect(Number((await rowOf(database, 'desk_list', l.id))?.seq)).toBe(1);
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
      const t = card(l.id);
      applied(await apply(ada, mutation(l, t)));
      applied(
        await apply(
          ada,
          mutation({
            table: 'desk_card',
            id: t.id,
            fields: { description: { v: 'from the phone' } },
          }),
        ),
      );
      applied(
        await apply(
          ada,
          mutation({ table: 'desk_card', id: t.id, fields: { starred: { v: true } } }),
        ),
      );
      expect(await fieldsOf('desk_card', t.id)).toEqual({
        title: { v: 'Buy milk', s: 1 },
        description: { v: 'from the phone', s: 2 },
        starred: { v: true, s: 3 },
      });
    });

    it('go to the later arrival when two devices change the same one, and say which seq wrote it', async () => {
      const ada = account();
      const l = list();
      const t = card(l.id);
      applied(await apply(ada, mutation(l, t)));
      applied(
        await apply(
          ada,
          mutation({ table: 'desk_card', id: t.id, fields: { title: { v: 'from the laptop' } } }),
        ),
      );
      applied(
        await apply(
          ada,
          mutation({ table: 'desk_card', id: t.id, fields: { title: { v: 'from the phone' } } }),
        ),
      );
      expect((await fieldsOf('desk_card', t.id)).title).toEqual({ v: 'from the phone', s: 3 });
    });

    it('can become ciphertext and plain again, a field at a time', async () => {
      const ada = account();
      const l = list();
      const t = card(l.id);
      applied(await apply(ada, mutation(l, t)));
      applied(
        await apply(
          ada,
          mutation({ table: 'desk_card', id: t.id, fields: { title: { c: CIPHER } } }),
        ),
      );
      expect((await fieldsOf('desk_card', t.id)).title).toEqual({ c: CIPHER, s: 2 });
    });
  });

  describe('a mutation sent again', () => {
    it('changes nothing and is answered as it was', async () => {
      const ada = account();
      const l = list();
      const m = mutation(l, card(l.id));
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
      const other = { mutationId: m.mutationId, changes: [card(l.id)] };
      expect(applied(await apply(ada, other as Mutation)).replay).toBe(true);
      expect((await snapshot(database, ada)).desk_card).toEqual([]);
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
      expect((await snapshot(database, grace)).desk_list).toHaveLength(1);
    });
  });

  describe('a mutation that cannot be applied', () => {
    it('writes nothing of it, not the changes before the bad one, not the counter, and not that it was tried', async () => {
      const ada = account();
      const l = list();
      applied(await apply(ada, mutation(l)));
      const before = await snapshot(database, ada);
      const m = mutation(card(l.id), card(id()) /* a list that is not there */, card(l.id));

      expect(await apply(ada, m)).toEqual({ status: 'refused', code: 'unavailable' });
      expect(await snapshot(database, ada)).toEqual(before);
      expect(await accountSeq(database, ada)).toBe(1);
      // Not recorded, so a corrected mutation under the same id is not taken for a repeat.
      const fixed = { mutationId: m.mutationId, changes: [card(l.id)] };
      expect(applied(await apply(ada, fixed))).toMatchObject({ seq: 2, replay: false });
    });
  });

  describe('as the wrong account', () => {
    // Ada owns a list, a card with a checklist item, and a series. Grace owns a list and a card. Each way Grace can reach for Ada's is tried, on each table.
    it('changes nothing of Ada’s and gives the same answer as for a row that does not exist, whatever Grace does', async () => {
      const ada = account();
      const grace = account();
      const aList = list();
      const aTask = card(aList.id);
      const aSub = check(aTask.id);
      const aSeries = series(aList.id);
      applied(await apply(ada, mutation(aList, aTask, aSub, aSeries)));
      const gList = list();
      const gTask = card(gList.id);
      applied(await apply(grace, mutation(gList, gTask)));

      const adaBefore = await snapshot(database, ada);
      const graceBefore = await snapshot(database, grace);
      const graceSeq = await accountSeq(database, grace);

      const attempts: [string, Mutation][] = [
        [
          'edit her task',
          mutation({ table: 'desk_card', id: aTask.id, fields: { title: { v: 'mine now' } } }),
        ],
        [
          'edit her list',
          mutation({ table: 'desk_list', id: aList.id, fields: { title: { v: 'mine now' } } }),
        ],
        [
          'edit her series',
          mutation({
            table: 'desk_series',
            id: aSeries.id,
            fields: { rule: { v: 'FREQ=YEARLY' } },
          }),
        ],
        ['delete her task', mutation({ table: 'desk_card', id: aTask.id, deleted: true })],
        ['delete her list', mutation({ table: 'desk_list', id: aList.id, deleted: true })],
        ['restore her item', mutation({ table: 'desk_check', id: aSub.id, deleted: false })],
        ['move her task', mutation({ table: 'desk_card', id: aTask.id, listId: gList.id })],
        ['reorder her list', mutation({ table: 'desk_list', id: aList.id, position: 'zz' })],
        ['make a task with her task’s id', mutation({ ...card(gList.id), id: aTask.id })],
        ['make a list with her list’s id', mutation({ ...list(), id: aList.id })],
        ['make a series with her series’ id', mutation({ ...series(gList.id), id: aSeries.id })],
        ['put a new task in her list', mutation(card(aList.id))],
        ['put a new series in her list', mutation(series(aList.id))],
        ['make an item of her card', mutation(check(aTask.id))],
        [
          'move her own task into her list',
          mutation({ table: 'desk_card', id: gTask.id, listId: aList.id }),
        ],
        [
          'move her own item to her card',
          mutation({ table: 'desk_check', id: check(gTask.id).id, cardId: aTask.id }),
        ],
        [
          'point her own task at her series',
          mutation({ table: 'desk_card', id: gTask.id, fields: { seriesId: { v: aSeries.id } } }),
        ],
        [
          'move her own series into her list',
          mutation({ table: 'desk_series', id: series(gList.id).id, listId: aList.id }),
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

    it('refuses a mutation of many cards whole when one of them is another account’s, and none of her own is touched', async () => {
      const [ada, grace] = [account(), account()];
      const aList = list();
      const aTask = card(aList.id);
      applied(await apply(ada, mutation(aList, aTask)));
      const gList = list();
      const own = [card(gList.id), card(gList.id), card(gList.id)];
      applied(await apply(grace, mutation(gList, ...own)));

      const before = await snapshot(database, grace);
      const adaBefore = await snapshot(database, ada);
      // What a bulk action sends: a change for each card chosen, here with one that is Ada's among Grace's own, in the middle.
      for (const change of [
        (c: { id: string }) => ({
          table: 'desk_card' as const,
          id: c.id,
          fields: { completedAt: { v: 5 } },
        }),
        (c: { id: string }) => ({ table: 'desk_card' as const, id: c.id, deleted: true }),
        (c: { id: string }) => ({
          table: 'desk_card' as const,
          id: c.id,
          listId: gList.id,
          position: 'a5',
        }),
      ]) {
        const result = await apply(
          grace,
          mutation(
            change(own[0] as { id: string }),
            change(aTask),
            change(own[1] as { id: string }),
          ),
        );
        expect(result).toEqual({ status: 'refused', code: 'unavailable' });
        expect(await snapshot(database, grace)).toEqual(before);
        expect(await snapshot(database, ada)).toEqual(adaBefore);
      }
    });

    it('is the answer for every one of those: unavailable, which says nothing of whose it is', async () => {
      const ada = account();
      const grace = account();
      const aList = list();
      const aTask = card(aList.id);
      applied(await apply(ada, mutation(aList, aTask)));
      for (const m of [
        mutation({ table: 'desk_card', id: aTask.id, fields: { title: { v: 'x' } } }),
        mutation({ ...card(id()), id: aTask.id }),
        mutation(card(aList.id)),
      ]) {
        expect(await apply(grace, m)).toEqual({ status: 'refused', code: 'unavailable' });
      }
    });
  });

  describe('deleting and restoring', () => {
    it('stamps the time it is deleted at on the server, and an edit of a deleted row restores it', async () => {
      const ada = account();
      const l = list();
      const t = card(l.id);
      applied(await apply(ada, mutation(l, t)));

      applied(await apply(ada, mutation({ table: 'desk_card', id: t.id, deleted: true })));
      expect(Number((await rowOf(database, 'desk_card', t.id))?.deleted_at)).toBeGreaterThan(0);

      applied(
        await apply(
          ada,
          mutation({ table: 'desk_card', id: t.id, fields: { description: { v: 'still here' } } }),
        ),
      );
      expect((await rowOf(database, 'desk_card', t.id))?.deleted_at).toBeNull();
      expect((await fieldsOf('desk_card', t.id)).description).toMatchObject({ v: 'still here' });
    });

    it('keeps the first time when both devices delete, and is deleted', async () => {
      const ada = account();
      const l = list();
      const t = card(l.id);
      applied(await apply(ada, mutation(l, t)));
      applied(await apply(ada, mutation({ table: 'desk_card', id: t.id, deleted: true })));
      const first = Number((await rowOf(database, 'desk_card', t.id))?.deleted_at);
      applied(await apply(ada, mutation({ table: 'desk_card', id: t.id, deleted: true })));
      expect(Number((await rowOf(database, 'desk_card', t.id))?.deleted_at)).toBe(first);
    });

    it('restores with deleted: false, and not just by editing', async () => {
      const ada = account();
      const l = list();
      applied(await apply(ada, mutation(l)));
      applied(await apply(ada, mutation({ table: 'desk_list', id: l.id, deleted: true })));
      applied(await apply(ada, mutation({ table: 'desk_list', id: l.id, deleted: false })));
      expect((await rowOf(database, 'desk_list', l.id))?.deleted_at).toBeNull();
    });

    it('brings a list back when a task is added to it that another device deleted', async () => {
      const ada = account();
      const l = list();
      applied(await apply(ada, mutation(l)));
      applied(await apply(ada, mutation({ table: 'desk_list', id: l.id, deleted: true })));
      const seqBefore = Number((await rowOf(database, 'desk_list', l.id))?.seq);

      const added = card(l.id);
      const result = applied(await apply(ada, mutation(added)));
      expect((await rowOf(database, 'desk_list', l.id))?.deleted_at).toBeNull();
      // And devices learn of it: the list is stamped with the mutation’s seq.
      expect(Number((await rowOf(database, 'desk_list', l.id))?.seq)).toBe(result.seq);
      expect(result.seq).toBeGreaterThan(seqBefore);
    });

    it('does not bring it back when the same mutation deletes it', async () => {
      const ada = account();
      const l = list();
      const t = card(l.id);
      applied(await apply(ada, mutation(l, t)));
      applied(
        await apply(
          ada,
          mutation(
            { table: 'desk_list', id: l.id, deleted: true },
            { table: 'desk_card', id: t.id, deleted: true },
          ),
        ),
      );
      expect(Number((await rowOf(database, 'desk_list', l.id))?.deleted_at)).toBeGreaterThan(0);
      expect(Number((await rowOf(database, 'desk_card', t.id))?.deleted_at)).toBeGreaterThan(0);
    });

    it('brings a deleted card back with a checklist item that is edited, and its list with it', async () => {
      const ada = account();
      const l = list();
      const parent = card(l.id);
      const item = check(parent.id);
      applied(await apply(ada, mutation(l, parent, item)));
      applied(
        await apply(
          ada,
          mutation(
            { table: 'desk_card', id: parent.id, deleted: true },
            { table: 'desk_list', id: l.id, deleted: true },
          ),
        ),
      );
      applied(
        await apply(
          ada,
          mutation({ table: 'desk_check', id: item.id, fields: { title: { v: 'x' } } }),
        ),
      );
      expect((await rowOf(database, 'desk_card', parent.id))?.deleted_at).toBeNull();
      expect((await rowOf(database, 'desk_list', l.id))?.deleted_at).toBeNull();
    });
  });

  describe('a card deleted with its checklist', () => {
    it('is stamped with one time for all of them, so that restoring finds exactly those', async () => {
      const ada = account();
      const l = list();
      const parent = card(l.id);
      const early = check(parent.id);
      const withIt = check(parent.id);
      applied(await apply(ada, mutation(l, parent, early, withIt)));
      // One item is deleted on its own, earlier.
      applied(await apply(ada, mutation({ table: 'desk_check', id: early.id, deleted: true })));
      applied(
        await apply(
          ada,
          mutation(
            { table: 'desk_card', id: parent.id, deleted: true },
            { table: 'desk_check', id: withIt.id, deleted: true },
          ),
        ),
      );
      const [p, w, e] = await Promise.all([
        rowOf(database, 'desk_card', parent.id),
        rowOf(database, 'desk_check', withIt.id),
        rowOf(database, 'desk_check', early.id),
      ]);
      expect(Number(p?.deleted_at)).toBeGreaterThan(0);
      expect(w?.deleted_at).toEqual(p?.deleted_at);
      expect(Number(e?.deleted_at)).toBeLessThan(Number(p?.deleted_at));
    });
  });

  describe('checklist items', () => {
    async function setup() {
      const ada = account();
      const l = list();
      const other = list();
      const parent = card(l.id);
      applied(await apply(ada, mutation(l, other, parent)));
      return { ada, l, other, parent };
    }

    it('belong to a card of the account, and are stored with it, in an order of their own', async () => {
      const { ada, parent } = await setup();
      const item = check(parent.id, { position: 'a3' });
      applied(await apply(ada, mutation(item)));
      expect(await rowOf(database, 'desk_check', item.id)).toMatchObject({
        owner_id: ada,
        card_id: parent.id,
        position: 'a3',
      });
      expect(await fieldsOf('desk_check', item.id)).toEqual({ title: { v: 'Oat milk', s: 2 } });
    });

    it('are refused for a card that is not there, whoever it belongs to', async () => {
      const { ada, parent } = await setup();
      const grace = account();
      expect(await apply(ada, mutation(check(id())))).toEqual({
        status: 'refused',
        code: 'unavailable',
      });
      // Grace cannot put one in Ada’s card, and the answer is the one for a card that does not exist.
      expect(await apply(grace, mutation(check(parent.id)))).toEqual({
        status: 'refused',
        code: 'unavailable',
      });
      expect((await snapshot(database, grace)).desk_check).toHaveLength(0);
    });

    it('move to another card of the account, and not to another account’s', async () => {
      const { ada, l, parent } = await setup();
      const second = card(l.id);
      const item = check(parent.id);
      applied(await apply(ada, mutation(second, item)));
      applied(await apply(ada, mutation({ table: 'desk_check', id: item.id, cardId: second.id })));
      expect(await rowOf(database, 'desk_check', item.id)).toMatchObject({ card_id: second.id });

      const grace = account();
      const gl = list();
      const gc = card(gl.id);
      applied(await apply(grace, mutation(gl, gc)));
      expect(
        await apply(ada, mutation({ table: 'desk_check', id: item.id, cardId: gc.id })),
      ).toEqual({ status: 'refused', code: 'unavailable' });
      expect(await rowOf(database, 'desk_check', item.id)).toMatchObject({ card_id: second.id });
    });

    it('stay where their card is when it moves to another list: they have no list of their own', async () => {
      const { ada, other, parent } = await setup();
      const item = check(parent.id);
      applied(await apply(ada, mutation(item)));
      applied(
        await apply(
          ada,
          mutation({ table: 'desk_card', id: parent.id, listId: other.id, position: 'a5' }),
        ),
      );
      expect(await rowOf(database, 'desk_check', item.id)).toMatchObject({ card_id: parent.id });
      expect(await rowOf(database, 'desk_card', parent.id)).toMatchObject({ list_id: other.id });
    });

    it('have a title and a tick and nothing else: a date, a star or a repeat is not a field of one', async () => {
      const { ada, parent } = await setup();
      for (const fields of [
        { title: { v: 'x' }, dueDate: { v: '2026-11-05' } },
        { title: { v: 'x' }, starred: { v: true } },
        { title: { v: 'x' }, seriesId: { v: id() } },
      ]) {
        expect(await apply(ada, mutation(check(parent.id, { fields })))).toEqual({
          status: 'refused',
          code: 'structure',
        });
      }
      expect((await snapshot(database, ada)).desk_check).toHaveLength(0);
      // An edit that names such a field is stopped before it gets here, by the same validators (`validate.test.ts`).
    });

    it('may be ticked, and the time is the server’s to mirror only for a card', async () => {
      const { ada, parent } = await setup();
      const item = check(parent.id);
      applied(await apply(ada, mutation(item)));
      applied(
        await apply(
          ada,
          mutation({
            table: 'desk_check',
            id: item.id,
            fields: { completedAt: { v: 1_793_000_000_000 } },
          }),
        ),
      );
      expect((await fieldsOf('desk_check', item.id)).completedAt).toMatchObject({
        v: 1_793_000_000_000,
      });
    });
  });

  describe('what an account may have', () => {
    it('is 200 lists, 50,000 cards and 200,000 checklist items', () => {
      expect(LIMITS.listsPerAccount).toBe(200);
      expect(LIMITS.cardsPerAccount).toBe(50_000);
      expect(LIMITS.checksPerAccount).toBe(200_000);
    });

    it('is enforced: the row over the limit refuses the whole mutation, and a mutation inside it is let through', async () => {
      const limits = { lists: 3, cards: 4, checks: 2 };
      const ada = account();
      const lists = [list(), list(), list()];
      const home = lists[0]?.id ?? '';
      applied(await apply(ada, mutation(...lists), { limits }));
      expect(await apply(ada, mutation(list()), { limits })).toEqual({
        status: 'refused',
        code: 'limit',
      });
      expect((await snapshot(database, ada)).desk_list).toHaveLength(3);

      applied(
        await apply(ada, mutation(card(home), card(home), card(home), card(home)), { limits }),
      );
      expect(await apply(ada, mutation(card(home)), { limits })).toEqual({
        status: 'refused',
        code: 'limit',
      });
      expect((await snapshot(database, ada)).desk_card).toHaveLength(4);
      // Checklist items have a limit of their own.
      const parent = ((await snapshot(database, ada)).desk_card as { id: string }[])[0]?.id ?? '';
      applied(await apply(ada, mutation(check(parent), check(parent)), { limits }));
      expect(await apply(ada, mutation(check(parent)), { limits })).toEqual({
        status: 'refused',
        code: 'limit',
      });
      // An edit is not a new row, so an account that is full can still work.
      const existing = ((await snapshot(database, ada)).desk_card as { id: string }[])[0] ?? {
        id: '',
      };
      applied(
        await apply(
          ada,
          mutation({ table: 'desk_card', id: existing.id, fields: { starred: { v: true } } }),
          { limits },
        ),
      );
    });

    it('is each account’s own: one that is full does not stop another', async () => {
      const limits = { lists: 1, cards: 1 };
      const ada = account();
      const grace = account();
      applied(await apply(ada, mutation(list()), { limits }));
      applied(await apply(grace, mutation(list()), { limits }));
    });
  });

  describe('the mirrors the Planner and reminders will read (phase 2)', () => {
    it('are copied from the fields when they are readable, and follow them', async () => {
      const ada = account();
      const l = list();
      const t = card(l.id, {
        fields: {
          title: { v: 'x' },
          dueDate: { v: '2026-11-05' },
          dueTime: { v: '09:30' },
          completedAt: { v: 1_793_000_000_000 },
        },
      });
      applied(await apply(ada, mutation(l, t)));
      expect(await rowOf(database, 'desk_card', t.id)).toMatchObject({
        due_date: '2026-11-05',
        due_time: '09:30',
      });
      expect(Number((await rowOf(database, 'desk_card', t.id))?.completed_at)).toBe(
        1_793_000_000_000,
      );

      applied(
        await apply(
          ada,
          mutation({
            table: 'desk_card',
            id: t.id,
            fields: { dueDate: { v: null }, completedAt: { v: null } },
          }),
        ),
      );
      expect(await rowOf(database, 'desk_card', t.id)).toMatchObject({
        due_date: null,
        due_time: '09:30',
        completed_at: null,
      });
    });

    it('are null when the fields are ciphertext, since the server can read nothing of them', async () => {
      const ada = account();
      const l = list();
      const t = card(l.id, {
        fields: { title: { c: CIPHER }, dueDate: { c: CIPHER }, dueTime: { c: CIPHER } },
      });
      applied(await apply(ada, mutation(l, t)));
      expect(await rowOf(database, 'desk_card', t.id)).toMatchObject({
        due_date: null,
        due_time: null,
        completed_at: null,
      });
    });
  });

  describe('a series a card points at', () => {
    it('must be the account’s, when the pointer can be read', async () => {
      const ada = account();
      const l = list();
      const r = series(l.id);
      applied(await apply(ada, mutation(l, r)));
      applied(
        await apply(
          ada,
          mutation(card(l.id, { fields: { title: { v: 'x' }, seriesId: { v: r.id } } })),
        ),
      );
      expect(
        await apply(
          ada,
          mutation(card(l.id, { fields: { title: { v: 'x' }, seriesId: { v: id() } } })),
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
          mutation(l, card(l.id, { fields: { title: { v: 'x' }, seriesId: { v: r.id } } }), r),
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
        Array.from({ length: 12 }, () => apply(ada, mutation(card(l.id)))),
      );
      const seqs = results.map((result) => applied(result).seq).sort((a, b) => a - b);
      expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => i + 2));
      expect(await accountSeq(database, ada)).toBe(13);
      expect((await snapshot(database, ada)).desk_card).toHaveLength(12);
      // Each row carries the seq of the mutation that made it, and no two mutations share one.
      const stamped = (await snapshot(database, ada)).desk_card
        .map((row) => Number((row as { seq: number }).seq))
        .sort((a, b) => a - b);
      expect(stamped).toEqual(seqs);
    });

    it('applies the same mutation sent twice at once exactly once', async () => {
      const ada = account();
      const l = list();
      const m = mutation(l, card(l.id));
      const results = await Promise.all(Array.from({ length: 6 }, () => apply(ada, m)));
      expect(results.filter((r) => r.status === 'applied' && !r.replay)).toHaveLength(1);
      expect(results.every((r) => r.status === 'applied')).toBe(true);
      expect(new Set(results.map((r) => (r.status === 'applied' ? r.seq : -1))).size).toBe(1);
      expect(await accountSeq(database, ada)).toBe(1);
      expect((await snapshot(database, ada)).desk_card).toHaveLength(1);
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
        sql`SELECT owner_id FROM ${database.dialect === 'postgres' ? postgresSchema.deskList : sqliteSchema.deskList} WHERE id = ${shared.id}`,
      );
      expect(rows).toHaveLength(1);
    });
  });

  it('gives up ciphertext only to the account’s own device: nothing in a row names who else could read it', async () => {
    const ada = account();
    const l = list();
    applied(await apply(ada, mutation(l, card(l.id, { fields: { title: { c: CIPHER } } }))));
    const rows = (await snapshot(database, ada)).desk_card as { fields: string }[];
    expect(rows[0]?.fields).not.toContain('"v"');
  });
});
