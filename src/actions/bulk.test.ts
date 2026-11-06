import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { TUSK_NAMESPACE, uuid5 } from '../uuid5';
import { deleteMany, restoreMany } from './cards';
import { type Selected, completeMany, moveMany } from './bulk';

/** Acting on several cards at once (DESIGN.md §10.6): one mutation each, chunked without splitting a card from what goes with it. */
const ids = () => {
  let n = 0;
  return { newId: () => `m-${++n}` };
};
const SERIES = '11111111-1111-4111-8111-111111111111';

const card = (
  id: string,
  listId = 'l1',
  position = 'a5',
  fields: Record<string, unknown> = {},
): LocalRow =>
  ({
    table: 'desk_card',
    id,
    listId,
    position,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: Object.fromEntries(
      Object.entries({ title: id, ...fields }).map(([k, v]) => [k, { v, s: 1 }]),
    ),
  }) as LocalRow;
const item = (cardId: string, n: number, completedAt: number | null = null): LocalRow =>
  ({
    table: 'desk_check',
    id: `${cardId}-i${n}`,
    cardId,
    position: `a${n}`,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: { title: { v: `item ${n}`, s: 1 }, completedAt: { v: completedAt, s: 1 } },
  }) as LocalRow;
const series = (): LocalRow =>
  ({
    table: 'desk_series',
    id: SERIES,
    listId: 'l1',
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: { rule: { v: 'FREQ=DAILY', s: 1 }, anchor: { v: '2026-11-01', s: 1 } },
  }) as LocalRow;
const sel = (c: LocalRow, items: LocalRow[] = [], s?: LocalRow): Selected => ({
  card: c,
  items,
  series: s,
});

describe('completing several cards', () => {
  it('completes each with its open items at one time, and a card that repeats makes its next in the same mutation', () => {
    const plain = card('a');
    const repeating = card('b', 'l1', 'a6', { seriesId: SERIES, dueDate: '2026-11-06' });
    const result = completeMany(
      [sel(plain, [item('a', 1), item('a', 2, 3)]), sel(repeating, [item('b', 1)], series())],
      100,
      '2026-11-06',
      ids(),
    );
    if (!result.ok) throw new Error('refused');
    expect(result.mutations).toHaveLength(1);
    const changes = result.mutations[0]?.changes ?? [];
    const set = (id: string) => changes.filter((c) => c.id === id);
    expect(set('a')).toEqual([
      { table: 'desk_card', id: 'a', fields: { completedAt: { v: 100 } } },
    ]);
    // The open item is ticked; the one done before is left with its own time.
    expect(set('a-i1')).toHaveLength(1);
    expect(set('a-i2')).toHaveLength(0);
    const next = uuid5(`occurrence:${SERIES}:2026-11-07`, TUSK_NAMESPACE);
    expect(set(next)).toHaveLength(1);
  });

  it('leaves a card that is done alone, so that doing it twice makes one next and not two, and is nothing when all are done', () => {
    const done = card('a', 'l1', 'a5', { completedAt: 5, seriesId: SERIES, dueDate: '2026-11-06' });
    expect(completeMany([sel(done, [], series())], 100, '2026-11-06', ids())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    const open = card('b');
    const result = completeMany([sel(done, [], series()), sel(open)], 100, '2026-11-06', ids());
    expect(result.ok && result.mutations.flatMap((m) => m.changes.map((c) => c.id))).toEqual(['b']);
  });

  it('is several mutations when it is large, none of which splits a card from its items or its next', () => {
    const selected: Selected[] = [];
    for (let n = 0; n < 300; n++) {
      const id = `c${n}`;
      selected.push(
        sel(
          card(id),
          Array.from({ length: 4 }, (_, i) => item(id, i)),
        ),
      );
    }
    const result = completeMany(selected, 100, '2026-11-06', ids());
    if (!result.ok) throw new Error('refused');
    expect(result.mutations.length).toBeGreaterThan(1);
    for (const mutation of result.mutations) {
      expect(mutation.changes.length).toBeLessThanOrEqual(400);
      const cards = new Set(
        mutation.changes.filter((c) => c.table === 'desk_card').map((c) => c.id),
      );
      for (const change of mutation.changes)
        if (change.table === 'desk_check')
          expect(cards.has(change.id.split('-')[0] ?? '')).toBe(true);
    }
    expect(result.mutations.flatMap((m) => m.changes)).toHaveLength(300 * 5);
  });
});

describe('moving several cards', () => {
  const there = [card('d1', 'l2', 'a5'), card('d2', 'l2', 'a7')];

  it('puts them at the top of the other list in the order they were shown, and a card already there stays', () => {
    const result = moveMany(
      [sel(card('x', 'l1')), sel(card('y', 'l1')), sel(card('z', 'l2'))],
      'l2',
      there,
      ids(),
    );
    if (!result.ok) throw new Error('refused');
    const moved = result.mutations.flatMap((m) => m.changes);
    expect(moved.map((c) => c.id)).toEqual(['x', 'y']);
    const [x, y] = moved as { position: string; listId: string }[];
    expect(x?.listId).toBe('l2');
    expect(x && y && x.position < y.position).toBe(true);
    expect(y && y.position < 'a5').toBe(true);
  });

  it('starts from nothing in an empty list, and keeps the keys all different', () => {
    const result = moveMany([sel(card('x')), sel(card('y')), sel(card('z'))], 'l2', [], ids());
    const keys = result.ok
      ? result.mutations.flatMap((m) => m.changes.map((c) => (c as { position: string }).position))
      : [];
    expect(new Set(keys).size).toBe(3);
    expect([...keys].sort()).toEqual(keys);
  });

  it('takes the series of a card that repeats, and a done card moves alone', () => {
    const repeating = card('r', 'l1', 'a6', { seriesId: SERIES });
    const done = card('p', 'l1', 'a7', { seriesId: SERIES, completedAt: 5 });
    const result = moveMany(
      [sel(repeating, [], series()), sel(done, [], series())],
      'l2',
      there,
      ids(),
    );
    const tables = result.ok
      ? result.mutations.flatMap((m) => m.changes.map((c) => `${c.table}:${c.id}`))
      : [];
    expect(tables).toEqual(['desk_card:r', `desk_series:${SERIES}`, 'desk_card:p']);
  });

  it('is nothing when every card is in the list already', () => {
    expect(moveMany([sel(card('z', 'l2'))], 'l2', there, ids())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(moveMany([], 'l2', there, ids())).toEqual({ ok: false, reason: 'nothing' });
  });
});

describe('deleting several, and the one Undo', () => {
  it('restores all of them and only those: an item deleted before stays deleted', () => {
    const a = card('a');
    const b = card('b');
    const aItems = [item('a', 1), item('a', 2)];
    const gone = { ...item('a', 3), deletedAt: 1 } as LocalRow;
    const deleted = deleteMany(
      [
        { card: a, items: [...aItems, gone] },
        { card: b, items: [] },
      ],
      ids(),
    );
    if (!deleted.ok) throw new Error('refused');
    const deletes = deleted.mutations.flatMap((m) => m.changes);
    // The item that was deleted before is not part of it.
    expect(deletes.map((c) => c.id).sort()).toEqual(['a', 'a-i1', 'a-i2', 'b']);

    // By the time of the undo they are deleted at one time, the earlier item at another.
    const at = (row: LocalRow) => ({ ...row, deletedAt: 50 }) as LocalRow;
    const back = restoreMany(
      [
        { card: at(a), items: [...aItems.map(at), gone] },
        { card: at(b), items: [] },
      ],
      ids(),
    );
    const restored = back.ok
      ? back.mutations.flatMap((m) => m.changes.map((c) => c.id)).sort()
      : [];
    expect(restored).toEqual(['a', 'a-i1', 'a-i2', 'b']);
  });
});
