import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Mutation, MutationResult, Pull, PulledRow } from '../sync/format';
import { type LocalDatabase, deleteLocal, openLocal } from './db';
import {
  commitMutation,
  getRow,
  isPending,
  listsOf,
  openCounts,
  visibleTasks,
  outboxSize,
  readCursor,
  readOutbox,
  settle,
  startSnapshot,
  subtasksOf,
  tasksOf,
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
  table: 'list' as const,
  id: ID(),
  position: 'a0',
  fields: { title: { v: title } },
});
const newTask = (listId: string, extra: Record<string, unknown> = {}) => ({
  table: 'task' as const,
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
const taskRow = (
  id: string,
  listId: string,
  seq: number,
  fields: Record<string, { v: unknown; s: number }>,
  extra: Record<string, unknown> = {},
) =>
  ({
    table: 'task',
    id,
    listId,
    parentId: null,
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
    const t = newTask(l.id);
    await commitMutation(db, mutation(l, t), 5000);

    expect((await listsOf(db)).map((r) => r.id)).toEqual([l.id]);
    expect((await tasksOf(db, l.id)).map((r) => r.id)).toEqual([t.id]);
    expect(await outboxSize(db)).toBe(1);
    expect(await isPending(db, 'task', t.id)).toBe(true);
  });

  it('loses nothing if the tab closes at any moment: it is in both or in neither, and after a reopen it is still there', async () => {
    const { db, reopen } = await device();
    const l = newList();
    await commitMutation(db, mutation(l), 1000);

    // A write that fails part-way (here, the transaction aborts when the outbox is written) leaves neither the rows nor the outbox changed.
    const t = newTask(l.id);
    const broken = {
      ...mutation(t),
      changes: [t, { ...t, id: ID(), table: 'nonesuch' as 'task' }],
    };
    await expect(commitMutation(db, broken, 2000)).rejects.toThrow();
    expect(await tasksOf(db, l.id)).toEqual([]);
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
    for (let i = 0; i < 5; i++) made.push(mutation(newTask(l.id)));
    for (const m of made) await commitMutation(db, m, 1);
    expect((await readOutbox(db, 100)).map((e) => e.mutation.mutationId)).toEqual(
      made.map((m) => m.mutationId),
    );
    expect((await readOutbox(db, 2)).map((e) => e.mutation.mutationId)).toEqual(
      made.slice(0, 2).map((m) => m.mutationId),
    );
  });

  it('shows lists and tasks in order by position, a deleted row not at all, and subtasks under their parent', async () => {
    const { db } = await device();
    const l = newList();
    const a = newTask(l.id, { position: 'b' });
    const b = newTask(l.id, { position: 'a' });
    const sub = newTask(l.id, { parentId: a.id, position: 'a' });
    const gone = newTask(l.id, { position: 'c' });
    const second = { ...newList('Work'), position: 'a0' };
    await commitMutation(db, mutation(l, second, a, b, sub, gone), 1);
    await commitMutation(db, mutation({ table: 'task', id: gone.id, deleted: true }), 2);

    expect((await tasksOf(db, l.id)).map((r) => r.id)).toEqual([b.id, a.id]);
    expect((await subtasksOf(db, a.id)).map((r) => r.id)).toEqual([sub.id]);
    expect((await listsOf(db)).map((r) => r.id).sort()).toEqual([l.id, second.id].sort());
    // Not gone: only not shown, so that Undo can bring it back.
    expect(await getRow(db, 'task', gone.id)).toMatchObject({ deletedAt: 2 });
  });
});

describe('settling what the server answered', () => {
  it('drops an answered mutation from the outbox, moves the cursor, and keeps what the device shows', async () => {
    const { db } = await device();
    const l = newList();
    const t = newTask(l.id);
    const m = mutation(l, t);
    await commitMutation(db, m, 1);
    const sent = await readOutbox(db, 10);

    const settled = await settle(db, sent, [answer(m, 1)], pull([], 1), 100);
    expect(settled).toEqual({ refused: [], more: false, answered: 1 });
    expect(await outboxSize(db)).toBe(0);
    expect(await readCursor(db)).toBe(1);
    expect(await isPending(db, 'task', t.id)).toBe(false);
    expect((await tasksOf(db, l.id)).map((r) => r.id)).toEqual([t.id]);
  });

  it('takes the server’s version of the rows it answered, as it arrives, per field', async () => {
    const { db } = await device();
    const l = newList();
    const t = newTask(l.id);
    const m = mutation(l, t);
    await commitMutation(db, m, 1);
    const sent = await readOutbox(db, 10);
    await settle(
      db,
      sent,
      [answer(m, 3)],
      pull(
        [
          taskRow(t.id, l.id, 3, {
            title: { v: 'Buy milk', s: 3 },
            notes: { v: 'from another device', s: 2 },
          }),
        ],
        3,
      ),
      100,
    );
    expect(await getRow(db, 'task', t.id)).toMatchObject({
      seq: 3,
      fields: { title: { v: 'Buy milk', s: 3 }, notes: { v: 'from another device', s: 2 } },
    });
  });

  it('does not let a pull overwrite an edit that is waiting, and shows it again once it is answered', async () => {
    const { db } = await device();
    const l = newList();
    const t = newTask(l.id);
    const first = mutation(l, t);
    await commitMutation(db, first, 1);
    await settle(
      db,
      await readOutbox(db, 10),
      [answer(first, 1)],
      pull([taskRow(t.id, l.id, 1, { title: { v: 'Buy milk', s: 1 } })], 1),
      2,
    );

    // The person renames it here; before it is sent, another device’s rename and a note arrive.
    const edit = mutation({ table: 'task', id: t.id, fields: { title: { v: 'Mine' } } });
    await commitMutation(db, edit, 3);
    await settle(
      db,
      [],
      [],
      pull(
        [taskRow(t.id, l.id, 5, { title: { v: 'Theirs', s: 5 }, notes: { v: 'a note', s: 5 } })],
        5,
      ),
      4,
    );
    expect(await getRow(db, 'task', t.id)).toMatchObject({
      fields: { title: { v: 'Mine', s: 5 }, notes: { v: 'a note', s: 5 } },
    });

    // Answered: the server applied it after theirs, so it wins, and the device agrees with the row the server then sends.
    const sent = await readOutbox(db, 10);
    await settle(
      db,
      sent,
      [answer(edit, 6)],
      pull(
        [taskRow(t.id, l.id, 6, { title: { v: 'Mine', s: 6 }, notes: { v: 'a note', s: 5 } })],
        6,
      ),
      5,
    );
    expect(await getRow(db, 'task', t.id)).toMatchObject({
      seq: 6,
      fields: { title: { v: 'Mine', s: 6 }, notes: { v: 'a note', s: 5 } },
    });
    expect(await isPending(db, 'task', t.id)).toBe(false);
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
    const t = newTask(l.id);
    const base = mutation(l, t);
    await commitMutation(db, base, 1);
    await settle(
      db,
      await readOutbox(db, 10),
      [answer(base, 1)],
      pull([taskRow(t.id, l.id, 1, { title: { v: 'Buy milk', s: 1 } })], 1),
      2,
    );

    const bad = mutation(
      { table: 'task', id: t.id, fields: { title: { v: 'Changed' } } },
      newTask(l.id),
    );
    await commitMutation(db, bad, 3);
    expect(JSON.stringify((await getRow(db, 'task', t.id))?.fields.title)).toContain('Changed');

    const settled = await settle(
      db,
      await readOutbox(db, 10),
      [{ mutationId: bad.mutationId, status: 'refused', code: 'limit' }],
      pull([], 1),
      4,
    );
    expect(settled.refused).toHaveLength(1);
    expect(settled.refused[0]).toMatchObject({ mutationId: bad.mutationId, code: 'limit' });
    expect(JSON.stringify((await getRow(db, 'task', t.id))?.fields.title)).toContain('Buy milk');
    // The row it would have made is gone, and nothing is left waiting or remembered.
    expect((await tasksOf(db, l.id)).map((r) => r.id)).toEqual([t.id]);
    expect(await outboxSize(db)).toBe(0);
    expect(await isPending(db, 'task', t.id)).toBe(false);
  });

  it('keeps a later edit when an earlier mutation of the same row is the one refused', async () => {
    const { db } = await device();
    const l = newList();
    const t = newTask(l.id);
    const base = mutation(l, t);
    await commitMutation(db, base, 1);
    await settle(
      db,
      await readOutbox(db, 10),
      [answer(base, 1)],
      pull([taskRow(t.id, l.id, 1, { title: { v: 'Buy milk', s: 1 } })], 1),
      2,
    );

    const first = mutation({ table: 'task', id: t.id, fields: { title: { v: 'First' } } });
    const second = mutation({ table: 'task', id: t.id, fields: { notes: { v: 'Second' } } });
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
    expect((await getRow(db, 'task', t.id))?.fields).toEqual({
      title: { v: 'Buy milk', s: 1 },
      notes: { v: 'Second', s: 0 },
    });
    expect(await outboxSize(db)).toBe(1);
  });

  it('forgets a row the server removed for good', async () => {
    const { db } = await device();
    const l = newList();
    const t = newTask(l.id);
    const m = mutation(l, t);
    await commitMutation(db, m, 1);
    await settle(
      db,
      await readOutbox(db, 10),
      [answer(m, 1)],
      pull([taskRow(t.id, l.id, 1, { title: { v: 'x', s: 1 } })], 1),
      2,
    );
    await settle(db, [], [], pull([], 9, false, [{ table: 'task', id: t.id, seq: 9 }]), 3);
    expect(await getRow(db, 'task', t.id)).toBeUndefined();
  });

  it('says there is more to pull when the server does', async () => {
    const { db } = await device();
    expect((await settle(db, [], [], pull([], 5, true), 1)).more).toBe(true);
  });
});

describe('counts for the sidebar', () => {
  it('are the open top-level tasks of each list: not deleted, not completed, not subtasks', async () => {
    const { db } = await device();
    const [a, b] = [newList('A'), newList('B')];
    const open1 = newTask(a.id);
    const open2 = newTask(a.id);
    const done = newTask(a.id, {
      fields: { title: { v: 'done' }, completedAt: { v: 1_793_000_000_000 } },
    });
    const reopened = newTask(a.id, { fields: { title: { v: 'again' }, completedAt: { v: null } } });
    const gone = newTask(a.id);
    const sub = newTask(a.id, { parentId: open1.id });
    const sealed = newTask(b.id, { fields: { title: { c: 'YWdl' }, completedAt: { c: 'YWdl' } } });
    await commitMutation(db, mutation(a, b, open1, open2, done, reopened, gone, sub, sealed), 1);
    await commitMutation(db, mutation({ table: 'task', id: gone.id, deleted: true }), 2);

    const counts = await openCounts(db);
    expect(counts.get(a.id)).toBe(3);
    // Ciphertext cannot be read, so it counts as open until the keys are in place.
    expect(counts.get(b.id)).toBe(1);
    expect(await openCounts((await device()).db)).toEqual(new Map());
  });
});

describe('what a view across lists may show', () => {
  it('leaves out what is deleted, what is in a deleted list, and what is under a deleted task, and nothing else', async () => {
    const { db } = await device();
    const [a, b] = [newList('A'), newList('B')];
    const shown = newTask(a.id);
    const deleted = newTask(a.id);
    const inDeletedList = newTask(b.id);
    const parent = newTask(a.id);
    const keptSub = newTask(a.id, { parentId: parent.id });
    const orphan = newTask(a.id);
    const underDeleted = newTask(a.id, { parentId: orphan.id });
    await commitMutation(
      db,
      mutation(a, b, shown, deleted, inDeletedList, parent, keptSub, orphan, underDeleted),
      1,
    );
    await commitMutation(db, mutation({ table: 'task', id: deleted.id, deleted: true }), 2);
    await commitMutation(db, mutation({ table: 'list', id: b.id, deleted: true }), 3);
    // The parent is deleted, and its subtask is a live row under it.
    await commitMutation(db, mutation({ table: 'task', id: orphan.id, deleted: true }), 4);

    const ids = (await visibleTasks(db)).map((t) => t.id).sort();
    expect(ids).toEqual([shown.id, parent.id, keptSub.id].sort());
    // Bringing the list back brings its tasks back, as they were.
    await commitMutation(db, mutation({ table: 'list', id: b.id, deleted: false }), 5);
    expect((await visibleTasks(db)).map((t) => t.id)).toContain(inDeletedList.id);
    expect((await visibleTasks(db)).map((t) => t.id)).not.toContain(deleted.id);
  });
});

describe('starting again from a snapshot', () => {
  it('shows what it has while the pages arrive, and removes what the server did not send only when the last page is in', async () => {
    const { db } = await device();
    const l = newList();
    const [kept, purged] = [newTask(l.id), newTask(l.id)];
    const first = mutation(l, kept, purged);
    await commitMutation(db, first, 1);
    await settle(
      db,
      await readOutbox(db, 10),
      [answer(first, 1)],
      pull(
        [
          taskRow(kept.id, l.id, 1, { title: { v: 'kept', s: 1 } }),
          taskRow(purged.id, l.id, 1, { title: { v: 'purged', s: 1 } }),
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
      pull([taskRow(kept.id, l.id, 4, { title: { v: 'kept', s: 4 } })], 4, true),
      3,
    );
    expect(await getRow(db, 'task', purged.id)).toBeDefined();
    expect(await readCursor(db)).toBe(4);
    // The last page does not: it was purged while the device was away.
    await settle(db, [], [], pull([], 6, false), 4);
    expect(await getRow(db, 'task', purged.id)).toBeUndefined();
    expect(await getRow(db, 'task', kept.id)).toBeDefined();
    expect(await db.get('meta', 'snapshot')).toBeUndefined();
    // And the rows are as the server's rows are, with no trace of the tag.
    expect(Object.keys((await getRow(db, 'task', kept.id)) ?? {}).sort()).toEqual(
      [
        'createdAt',
        'deletedAt',
        'fields',
        'id',
        'listId',
        'parentId',
        'position',
        'seq',
        'table',
      ].sort(),
    );
  });

  it('keeps a row that has an edit waiting, which the server will refuse if the row is truly gone', async () => {
    const { db } = await device();
    const l = newList();
    const t = newTask(l.id);
    const base = mutation(l, t);
    await commitMutation(db, base, 1);
    await settle(
      db,
      await readOutbox(db, 10),
      [answer(base, 1)],
      pull([taskRow(t.id, l.id, 1, { title: { v: 'x', s: 1 } })], 1),
      2,
    );
    await commitMutation(
      db,
      mutation({ table: 'task', id: t.id, fields: { notes: { v: 'edited while away' } } }),
      3,
    );

    await startSnapshot(db, 'two');
    await settle(db, [], [], pull([], 5, false), 4);
    expect(await getRow(db, 'task', t.id)).toMatchObject({
      fields: { notes: { v: 'edited while away' } },
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
