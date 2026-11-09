import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Mutation, MutationResult, Pull, PulledRow } from '../sync/format';
import { type LocalDatabase, deleteLocal, openLocal } from './db';
import {
  commitMutation,
  getRow,
  isPending,
  listsOf,
  deskSummary,
  openCounts,
  visibleCards,
  outboxSize,
  readCursor,
  readOutbox,
  settle,
  startSnapshot,
  cardsOf,
  checkCounts,
  checksOf,
} from './store';

/**
 * The working copy (DESIGN.md §8.1), on a real IndexedDB implementation: a write is in the rows and the outbox together or in neither, and what the
 * server sends is merged under what is waiting to be sent.
 */
const ID = () => crypto.randomUUID();
const open: LocalDatabase[] = [];
const names: string[] = [];
afterEach(async () => {
  for (const db of open.splice(0)) db.close();
  for (const name of names.splice(0)) await deleteLocal('', name);
});

async function device(): Promise<{
  db: LocalDatabase;
  account: string;
  reopen(): Promise<LocalDatabase>;
}> {
  const account = ID();
  names.push(`tusk-desk-${account}`);
  const db = await openLocal(account);
  open.push(db);
  return {
    db,
    account,
    async reopen() {
      db.close();
      const again = await openLocal(account);
      open.push(again);
      return again;
    },
  };
}

const mutation = (...changes: Mutation['changes'][number][]): Mutation => ({
  mutationId: ID(),
  changes,
});
const newList = (title = 'Home') => ({
  table: 'desk_list' as const,
  id: ID(),
  position: 'a0',
  fields: { title: { v: title } },
});
const newItem = (cardId: string, extra: Record<string, unknown> = {}) => ({
  table: 'desk_check' as const,
  id: ID(),
  cardId,
  position: 'a0',
  fields: { title: { v: 'Oat milk' } },
  ...extra,
});
const newCard = (listId: string, extra: Record<string, unknown> = {}) => ({
  table: 'desk_card' as const,
  id: ID(),
  listId,
  position: 'a0',
  fields: { title: { v: 'Buy milk' } },
  ...extra,
});

const answer = (m: Mutation, seq: number): MutationResult => ({
  mutationId: m.mutationId,
  status: 'applied',
  seq,
});
const pull = (
  rows: PulledRow[],
  cursor: number,
  more = false,
  tombstones: Pull['tombstones'] = [],
): Pull => ({ cursor, more, rows, tombstones });
const cardRow = (
  id: string,
  listId: string,
  seq: number,
  fields: Record<string, { v: unknown; s: number }>,
  extra: Record<string, unknown> = {},
) =>
  ({
    table: 'desk_card',
    id,
    listId,
    position: 'a0',
    deletedAt: null,
    seq,
    createdAt: 1,
    fields,
    ...extra,
  }) as PulledRow;

describe('committing', () => {
  it('writes the rows and the outbox together, and a screen reads it at once', async () => {
    const { db } = await device();
    const l = newList();
    const t = newCard(l.id);
    await commitMutation(db, mutation(l, t), 5000);

    expect((await listsOf(db)).map((r) => r.id)).toEqual([l.id]);
    expect((await cardsOf(db, l.id)).map((r) => r.id)).toEqual([t.id]);
    expect(await outboxSize(db)).toBe(1);
    expect(await isPending(db, 'desk_card', t.id)).toBe(true);
  });

  it('loses nothing if the tab closes at any moment: it is in both or in neither, and after a reopen it is still there', async () => {
    const { db, reopen } = await device();
    const l = newList();
    await commitMutation(db, mutation(l), 1000);

    // A write that fails part-way (here, the transaction aborts when the outbox is written) leaves neither the rows nor the outbox changed.
    const t = newCard(l.id);
    const broken = {
      ...mutation(t),
      changes: [t, { ...t, id: ID(), table: 'nonesuch' }],
    } as unknown as Mutation;
    await expect(commitMutation(db, broken, 2000)).rejects.toThrow();
    expect(await cardsOf(db, l.id)).toEqual([]);
    expect(await outboxSize(db)).toBe(1);

    // And what was committed survives the connection being closed and opened again, as it would across a closed tab.
    const again = await reopen();
    expect((await listsOf(again)).map((r) => r.id)).toEqual([l.id]);
    expect((await readOutbox(again, 10)).map((e) => e.mutation.changes[0]?.id)).toEqual([l.id]);
  });

  it('keeps the mutations in the order they were made', async () => {
    const { db } = await device();
    const l = newList();
    const made = [mutation(l)];
    for (let i = 0; i < 5; i++) made.push(mutation(newCard(l.id)));
    for (const m of made) await commitMutation(db, m, 1);
    expect((await readOutbox(db, 100)).map((e) => e.mutation.mutationId)).toEqual(
      made.map((m) => m.mutationId),
    );
    expect((await readOutbox(db, 2)).map((e) => e.mutation.mutationId)).toEqual(
      made.slice(0, 2).map((m) => m.mutationId),
    );
  });

  it('shows lists and cards in order by position, a deleted row not at all, and checklist items under their card', async () => {
    const { db } = await device();
    const l = newList();
    const a = newCard(l.id, { position: 'b' });
    const b = newCard(l.id, { position: 'a' });
    const sub = newItem(a.id, { position: 'a' });
    const gone = newCard(l.id, { position: 'c' });
    const second = { ...newList('Work'), position: 'a0' };
    await commitMutation(db, mutation(l, second, a, b, sub, gone), 1);
    await commitMutation(db, mutation({ table: 'desk_card', id: gone.id, deleted: true }), 2);

    expect((await cardsOf(db, l.id)).map((r) => r.id)).toEqual([b.id, a.id]);
    expect((await checksOf(db, a.id)).map((r) => r.id)).toEqual([sub.id]);
    expect((await listsOf(db)).map((r) => r.id).sort()).toEqual([l.id, second.id].sort());
    // Not gone: only not shown, so that Undo can bring it back.
    expect(await getRow(db, 'desk_card', gone.id)).toMatchObject({ deletedAt: 2 });
  });
});

describe('settling what the server answered', () => {
  it('drops an answered mutation from the outbox, moves the cursor, and keeps what the device shows', async () => {
    const { db } = await device();
    const l = newList();
    const t = newCard(l.id);
    const m = mutation(l, t);
    await commitMutation(db, m, 1);
    const sent = await readOutbox(db, 10);

    const settled = await settle(db, sent, [answer(m, 1)], pull([], 1), 100);
    expect(settled).toEqual({ refused: [], more: false, answered: 1 });
    expect(await outboxSize(db)).toBe(0);
    expect(await readCursor(db)).toBe(1);
    expect(await isPending(db, 'desk_card', t.id)).toBe(false);
    expect((await cardsOf(db, l.id)).map((r) => r.id)).toEqual([t.id]);
  });

  it('takes the server’s version of the rows it answered, as it arrives, per field', async () => {
    const { db } = await device();
    const l = newList();
    const t = newCard(l.id);
    const m = mutation(l, t);
    await commitMutation(db, m, 1);
    const sent = await readOutbox(db, 10);
    await settle(
      db,
      sent,
      [answer(m, 3)],
      pull(
        [
          cardRow(t.id, l.id, 3, {
            title: { v: 'Buy milk', s: 3 },
            description: { v: 'from another device', s: 2 },
          }),
        ],
        3,
      ),
      100,
    );
    expect(await getRow(db, 'desk_card', t.id)).toMatchObject({
      seq: 3,
      fields: { title: { v: 'Buy milk', s: 3 }, description: { v: 'from another device', s: 2 } },
    });
  });

  it('does not let a pull overwrite an edit that is waiting, and shows it again once it is answered', async () => {
    const { db } = await device();
    const l = newList();
    const t = newCard(l.id);
    const first = mutation(l, t);
    await commitMutation(db, first, 1);
    await settle(
      db,
      await readOutbox(db, 10),
      [answer(first, 1)],
      pull([cardRow(t.id, l.id, 1, { title: { v: 'Buy milk', s: 1 } })], 1),
      2,
    );

    // The person renames it here; before it is sent, another device’s rename and a note arrive.
    const edit = mutation({ table: 'desk_card', id: t.id, fields: { title: { v: 'Mine' } } });
    await commitMutation(db, edit, 3);
    await settle(
      db,
      [],
      [],
      pull(
        [
          cardRow(t.id, l.id, 5, {
            title: { v: 'Theirs', s: 5 },
            description: { v: 'a note', s: 5 },
          }),
        ],
        5,
      ),
      4,
    );
    expect(await getRow(db, 'desk_card', t.id)).toMatchObject({
      fields: { title: { v: 'Mine', s: 5 }, description: { v: 'a note', s: 5 } },
    });

    // Answered: the server applied it after theirs, so it wins, and the device agrees with the row the server then sends.
    const sent = await readOutbox(db, 10);
    await settle(
      db,
      sent,
      [answer(edit, 6)],
      pull(
        [
          cardRow(t.id, l.id, 6, {
            title: { v: 'Mine', s: 6 },
            description: { v: 'a note', s: 5 },
          }),
        ],
        6,
      ),
      5,
    );
    expect(await getRow(db, 'desk_card', t.id)).toMatchObject({
      seq: 6,
      fields: { title: { v: 'Mine', s: 6 }, description: { v: 'a note', s: 5 } },
    });
    expect(await isPending(db, 'desk_card', t.id)).toBe(false);
  });

  it('does not let a pull that is behind the cursor move it back', async () => {
    const { db } = await device();
    await settle(db, [], [], pull([], 9), 1);
    await settle(db, [], [], pull([], 4), 2);
    expect(await readCursor(db)).toBe(9);
  });

  it('undoes a refused mutation, back to what the server had, and reports it for the person to be told', async () => {
    const { db } = await device();
    const l = newList();
    const t = newCard(l.id);
    const base = mutation(l, t);
    await commitMutation(db, base, 1);
    await settle(
      db,
      await readOutbox(db, 10),
      [answer(base, 1)],
      pull([cardRow(t.id, l.id, 1, { title: { v: 'Buy milk', s: 1 } })], 1),
      2,
    );

    const bad = mutation(
      { table: 'desk_card', id: t.id, fields: { title: { v: 'Changed' } } },
      newCard(l.id),
    );
    await commitMutation(db, bad, 3);
    expect(JSON.stringify((await getRow(db, 'desk_card', t.id))?.fields.title)).toContain(
      'Changed',
    );

    const settled = await settle(
      db,
      await readOutbox(db, 10),
      [{ mutationId: bad.mutationId, status: 'refused', code: 'limit' }],
      pull([], 1),
      4,
    );
    expect(settled.refused).toHaveLength(1);
    expect(settled.refused[0]).toMatchObject({ mutationId: bad.mutationId, code: 'limit' });
    expect(JSON.stringify((await getRow(db, 'desk_card', t.id))?.fields.title)).toContain(
      'Buy milk',
    );
    // The row it would have made is gone, and nothing is left waiting or remembered.
    expect((await cardsOf(db, l.id)).map((r) => r.id)).toEqual([t.id]);
    expect(await outboxSize(db)).toBe(0);
    expect(await isPending(db, 'desk_card', t.id)).toBe(false);
  });

  it('keeps a later edit when an earlier mutation of the same row is the one refused', async () => {
    const { db } = await device();
    const l = newList();
    const t = newCard(l.id);
    const base = mutation(l, t);
    await commitMutation(db, base, 1);
    await settle(
      db,
      await readOutbox(db, 10),
      [answer(base, 1)],
      pull([cardRow(t.id, l.id, 1, { title: { v: 'Buy milk', s: 1 } })], 1),
      2,
    );

    const first = mutation({ table: 'desk_card', id: t.id, fields: { title: { v: 'First' } } });
    const second = mutation({
      table: 'desk_card',
      id: t.id,
      fields: { description: { v: 'Second' } },
    });
    await commitMutation(db, first, 3);
    await commitMutation(db, second, 4);
    const sent = await readOutbox(db, 1); // only the first goes out
    await settle(
      db,
      sent,
      [{ mutationId: first.mutationId, status: 'refused', code: 'unavailable' }],
      pull([], 1),
      5,
    );
    expect((await getRow(db, 'desk_card', t.id))?.fields).toEqual({
      title: { v: 'Buy milk', s: 1 },
      description: { v: 'Second', s: 0 },
    });
    expect(await outboxSize(db)).toBe(1);
  });

  it('forgets a row the server removed for good', async () => {
    const { db } = await device();
    const l = newList();
    const t = newCard(l.id);
    const m = mutation(l, t);
    await commitMutation(db, m, 1);
    await settle(
      db,
      await readOutbox(db, 10),
      [answer(m, 1)],
      pull([cardRow(t.id, l.id, 1, { title: { v: 'x', s: 1 } })], 1),
      2,
    );
    await settle(db, [], [], pull([], 9, false, [{ table: 'desk_card', id: t.id, seq: 9 }]), 3);
    expect(await getRow(db, 'desk_card', t.id)).toBeUndefined();
  });

  it('says there is more to pull when the server does', async () => {
    const { db } = await device();
    expect((await settle(db, [], [], pull([], 5, true), 1)).more).toBe(true);
  });
});

describe('counts for the sidebar', () => {
  it('are the open cards of each list: not deleted, not completed, and an item is not a card', async () => {
    const { db } = await device();
    const [a, b] = [newList('A'), newList('B')];
    const open1 = newCard(a.id);
    const open2 = newCard(a.id);
    const done = newCard(a.id, {
      fields: { title: { v: 'done' }, completedAt: { v: 1_793_000_000_000 } },
    });
    const reopened = newCard(a.id, { fields: { title: { v: 'again' }, completedAt: { v: null } } });
    const gone = newCard(a.id);
    const sub = newItem(open1.id);
    const sealed = newCard(b.id, { fields: { title: { c: 'YWdl' }, completedAt: { c: 'YWdl' } } });
    await commitMutation(db, mutation(a, b, open1, open2, done, reopened, gone, sub, sealed), 1);
    await commitMutation(db, mutation({ table: 'desk_card', id: gone.id, deleted: true }), 2);

    const counts = await openCounts(db);
    expect(counts.get(a.id)).toBe(3);
    // Ciphertext cannot be read, so it counts as open until the keys are in place.
    expect(counts.get(b.id)).toBe(1);
    expect(await openCounts((await device()).db)).toEqual(new Map());
  });

  it('count a card’s checklist for the ring on its row: the items it has, and how many are done, not those deleted', async () => {
    const { db } = await device();
    const l = newList();
    const c = newCard(l.id);
    const one = newItem(c.id, { position: 'a0' });
    const two = newItem(c.id, {
      position: 'a1',
      fields: { title: { v: 'two' }, completedAt: { v: 1_793_000_000_000 } },
    });
    const three = newItem(c.id, { position: 'a2' });
    await commitMutation(db, mutation(l, c, one, two, three), 1);
    await commitMutation(db, mutation({ table: 'desk_check', id: three.id, deleted: true }), 2);
    expect((await checkCounts(db)).get(c.id)).toEqual({ done: 1, total: 2 });
    expect((await checkCounts((await device()).db)).size).toBe(0);
  });
});

describe('the Desk’s summary for the boards index', () => {
  const now = { date: '2026-11-06', time: '12:00' };
  const due = (date: string, time?: string) => ({
    title: { v: 'x' },
    dueDate: { v: date },
    ...(time ? { dueTime: { v: time } } : {}),
  });

  it('counts the open cards, those due today and those overdue, and not a deleted or completed one', async () => {
    const { db } = await device();
    const [a, gone] = [newList('A'), newList('Gone')];
    const cards = [
      newCard(a.id, { fields: due(now.date) }),
      newCard(a.id, { fields: due('2026-11-07') }),
      newCard(a.id),
      newCard(a.id, { fields: { ...due(now.date), completedAt: { v: 1_793_000_000_000 } } }),
      newCard(a.id, { fields: { title: { c: 'YWdl' }, dueDate: { c: 'YWdl' } } }),
      newCard(gone.id, { fields: due(now.date) }),
    ];
    await commitMutation(db, mutation(a, gone, ...cards), 1);
    await commitMutation(db, mutation({ table: 'desk_list', id: gone.id, deleted: true }), 2);
    // Open: the two dated, the plain one and the sealed one (counted as open, and as neither due nor overdue, until the keys are in place). One is due today.
    expect(await deskSummary(db, now)).toEqual({ open: 4, dueToday: 1, overdue: 0 });
    expect(await deskSummary((await device()).db, now)).toEqual({
      open: 0,
      dueToday: 0,
      overdue: 0,
    });
  });

  it('counts overdue as the Desk does, before today or today at a time that has gone, and never one card as both', async () => {
    const { db } = await device();
    const a = newList('A');
    const cards = [
      // Overdue: yesterday, with or without a time, and today at a time that has gone.
      newCard(a.id, { fields: due('2026-11-05') }),
      newCard(a.id, { fields: due('2026-10-01', '23:59') }),
      newCard(a.id, { fields: due(now.date, '11:59') }),
      // Due today: no time, a time to come, and the minute it is now.
      newCard(a.id, { fields: due(now.date) }),
      newCard(a.id, { fields: due(now.date, '12:01') }),
      newCard(a.id, { fields: due(now.date, '12:00') }),
      // Neither: tomorrow, and nothing. A done card, overdue as it was, is not counted.
      newCard(a.id, { fields: due('2026-11-07') }),
      newCard(a.id),
      newCard(a.id, { fields: { ...due('2026-11-01'), completedAt: { v: 1_793_000_000_000 } } }),
    ];
    await commitMutation(db, mutation(a, ...cards), 1);
    expect(await deskSummary(db, now)).toEqual({ open: 8, dueToday: 3, overdue: 3 });
    // A minute later the card due at 12:00 is overdue and the one at 12:01 is still to come.
    expect(await deskSummary(db, { date: now.date, time: '12:01' })).toEqual({
      open: 8,
      dueToday: 2,
      overdue: 4,
    });
  });
});

describe('what a view across lists may show', () => {
  it('leaves out what is deleted and what is in a deleted list, and nothing else', async () => {
    const { db } = await device();
    const [a, b] = [newList('A'), newList('B')];
    const shown = newCard(a.id);
    const deleted = newCard(a.id);
    const inDeletedList = newCard(b.id);
    await commitMutation(db, mutation(a, b, shown, deleted, inDeletedList), 1);
    await commitMutation(db, mutation({ table: 'desk_card', id: deleted.id, deleted: true }), 2);
    await commitMutation(db, mutation({ table: 'desk_list', id: b.id, deleted: true }), 3);

    const ids = (await visibleCards(db)).map((t) => t.id).sort();
    expect(ids).toEqual([shown.id]);
    // Bringing the list back brings its tasks back, as they were.
    await commitMutation(db, mutation({ table: 'desk_list', id: b.id, deleted: false }), 5);
    expect((await visibleCards(db)).map((t) => t.id)).toContain(inDeletedList.id);
    expect((await visibleCards(db)).map((t) => t.id)).not.toContain(deleted.id);
  });
});

describe('starting again from a snapshot', () => {
  it('shows what it has while the pages arrive, and removes what the server did not send only when the last page is in', async () => {
    const { db } = await device();
    const l = newList();
    const [kept, purged] = [newCard(l.id), newCard(l.id)];
    const first = mutation(l, kept, purged);
    await commitMutation(db, first, 1);
    await settle(
      db,
      await readOutbox(db, 10),
      [answer(first, 1)],
      pull(
        [
          cardRow(kept.id, l.id, 1, { title: { v: 'kept', s: 1 } }),
          cardRow(purged.id, l.id, 1, { title: { v: 'purged', s: 1 } }),
        ],
        1,
      ),
      2,
    );

    await startSnapshot(db, 'one');
    expect(await readCursor(db)).toBe(0);
    // The first page has `kept` and says there is more: `purged` is still there, since it may be on the next page.
    await settle(
      db,
      [],
      [],
      pull([cardRow(kept.id, l.id, 4, { title: { v: 'kept', s: 4 } })], 4, true),
      3,
    );
    expect(await getRow(db, 'desk_card', purged.id)).toBeDefined();
    expect(await readCursor(db)).toBe(4);
    // The last page does not: it was purged while the device was away.
    await settle(db, [], [], pull([], 6, false), 4);
    expect(await getRow(db, 'desk_card', purged.id)).toBeUndefined();
    expect(await getRow(db, 'desk_card', kept.id)).toBeDefined();
    expect(await db.get('meta', 'snapshot')).toBeUndefined();
    // And the rows are as the server's rows are, with no trace of the tag.
    expect(Object.keys((await getRow(db, 'desk_card', kept.id)) ?? {}).sort()).toEqual(
      ['createdAt', 'deletedAt', 'fields', 'id', 'listId', 'position', 'seq', 'table'].sort(),
    );
  });

  it('keeps a row that has an edit waiting, which the server will refuse if the row is truly gone', async () => {
    const { db } = await device();
    const l = newList();
    const t = newCard(l.id);
    const base = mutation(l, t);
    await commitMutation(db, base, 1);
    await settle(
      db,
      await readOutbox(db, 10),
      [answer(base, 1)],
      pull([cardRow(t.id, l.id, 1, { title: { v: 'x', s: 1 } })], 1),
      2,
    );
    await commitMutation(
      db,
      mutation({
        table: 'desk_card',
        id: t.id,
        fields: { description: { v: 'edited while away' } },
      }),
      3,
    );

    await startSnapshot(db, 'two');
    await settle(db, [], [], pull([], 5, false), 4);
    expect(await getRow(db, 'desk_card', t.id)).toMatchObject({
      fields: { description: { v: 'edited while away' } },
    });
    expect(await outboxSize(db)).toBe(1);
  });
});

describe('one database per account', () => {
  it('keeps two accounts apart on one device, and deleting one leaves the other', async () => {
    const one = await device();
    const two = await device();
    const l = newList();
    await commitMutation(one.db, mutation(l), 1);
    expect(await listsOf(two.db)).toEqual([]);

    one.db.close();
    await deleteLocal(one.account);
    const gone = await openLocal(one.account);
    open.push(gone);
    expect(await listsOf(gone)).toEqual([]);
    expect(await outboxSize(gone)).toBe(0);
  });
});
