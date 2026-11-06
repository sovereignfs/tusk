import { describe, expect, it } from 'vitest';
import { type LocalRow, applyChange } from '../local/rows';
import type { Mutation } from '../sync/format';
import { completeCard, reopenCard } from './cards';
import { moveOccurrence, reopenOccurrence } from './occurrences';
import { seriesIdOf } from './series';

/** The rest of an occurrence's life (DESIGN.md §12.5): reopened without losing anything, and moved with its series. */
const SERIES = '11111111-1111-4111-8111-111111111111';
const ids = () => {
  let n = 0;
  return { newId: () => `m-${++n}` };
};

const row = (table: string, id: string, extra: object, fields: Record<string, unknown>): LocalRow =>
  ({
    table,
    id,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    ...extra,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { v, s: 1 }])),
  }) as LocalRow;

const original = () =>
  row(
    'desk_card',
    'c1',
    { listId: 'list-1', position: 'a5' },
    {
      title: 'Water',
      description: 'By the window',
      starred: true,
      dueDate: '2026-11-06',
      dueTime: '18:00',
      seriesId: SERIES,
    },
  );
const itemsOfOriginal = () => [
  row('desk_check', 'i1', { cardId: 'c1', position: 'a0' }, { title: 'Fill the can' }),
  row('desk_check', 'i2', { cardId: 'c1', position: 'a1' }, { title: 'Turn the pots' }),
];
const theSeries = () =>
  row('desk_series', SERIES, { listId: 'list-1' }, { rule: 'FREQ=DAILY', anchor: '2026-11-01' });

/** The world as a Map of rows, with a mutation laid over it by the working copy's own rule. */
type World = Map<string, LocalRow>;
const key = (r: { table: string; id: string }) => `${r.table}:${r.id}`;
function lay(world: World, mutation: Mutation, now = 100): World {
  const out = new Map(world);
  for (const change of mutation.changes)
    out.set(key(change), applyChange(out.get(key(change)), change, now));
  return out;
}
const start = (): World =>
  new Map([original(), theSeries(), ...itemsOfOriginal()].map((r) => [key(r), r]));

const cardsOfWorld = (world: World) => [...world.values()].filter((r) => r.table === 'desk_card');
const itemsOf = (world: World, cardId: string) =>
  [...world.values()].filter(
    (r) => r.table === 'desk_check' && 'cardId' in r && r.cardId === cardId,
  );
const othersOf = (world: World, except: string) =>
  cardsOfWorld(world)
    .filter((c) => c.id !== except && seriesIdOf(c) === SERIES)
    .map((card) => ({ card, items: itemsOf(world, card.id) }));

/** What a person sees: the live rows, with their places and what is in their fields, a null being nothing. */
function seen(world: World) {
  return [...world.values()]
    .filter((r) => r.deletedAt === null)
    .map((r) => ({
      key: key(r),
      list: 'listId' in r ? r.listId : 'cardId' in r ? r.cardId : null,
      position: 'position' in r ? r.position : null,
      fields: Object.fromEntries(
        Object.entries(r.fields)
          .filter(([, f]) => 'v' in f && f.v !== null)
          .map(([k, f]) => [k, 'v' in f ? f.v : null]),
      ),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

function tick(world: World, today = '2026-11-06'): World {
  const result = completeCard(world.get('desk_card:c1'), 5, ids(), itemsOf(world, 'c1'), {
    series: world.get(`desk_series:${SERIES}`),
    today,
  });
  if (!result.ok) throw new Error('refused');
  return lay(world, result.mutation);
}
function reopen(world: World) {
  return reopenOccurrence(
    world.get('desk_card:c1'),
    world.get(`desk_series:${SERIES}`),
    itemsOf(world, 'c1'),
    othersOf(world, 'c1'),
    ids(),
  );
}
const nextOf = (world: World) =>
  cardsOfWorld(world).find((c) => c.id !== 'c1' && c.deletedAt === null);

describe('reopening an occurrence', () => {
  it('after a tick leaves exactly the starting rows: the next is taken away with its items, and the card is open again', () => {
    const before = start();
    const ticked = tick(before);
    expect(seen(ticked)).not.toEqual(seen(before));
    const result = reopen(ticked);
    if (!result.ok) throw new Error('refused');
    // One mutation.
    expect(result.mutation.changes.map((c) => c.table).sort()).toEqual([
      'desk_card',
      'desk_card',
      'desk_check',
      'desk_check',
      'desk_check',
      'desk_check',
    ]);
    expect(seen(lay(ticked, result.mutation))).toEqual(seen(before));
  });

  it('unticks only the items the tick ticked: one done before stays done, with the time it was done at', () => {
    const before = start();
    before.set(
      'desk_check:i1',
      row(
        'desk_check',
        'i1',
        { cardId: 'c1', position: 'a0' },
        { title: 'Fill the can', completedAt: 3 },
      ),
    );
    const ticked = tick(before);
    const result = reopen(ticked);
    if (!result.ok) throw new Error('refused');
    const after = lay(ticked, result.mutation);
    expect(after.get('desk_check:i1')?.fields.completedAt).toEqual(
      expect.objectContaining({ v: 3 }),
    );
    expect(after.get('desk_check:i2')?.fields.completedAt).toEqual(
      expect.objectContaining({ v: null }),
    );
  });

  it('can be ticked again after, and makes the same next', () => {
    const once = tick(start());
    const first = nextOf(once)?.id;
    const reopened = reopen(once);
    if (!reopened.ok) throw new Error('refused');
    const again = tick(lay(once, reopened.mutation));
    expect(nextOf(again)?.id).toBe(first);
    expect(itemsOf(again, first ?? '').filter((i) => i.deletedAt === null)).toHaveLength(2);
  });

  const touches: [string, (world: World, nextId: string) => World][] = [
    ['renamed', (w, id) => with_(w, 'desk_card', id, { title: { v: 'Water everything' } })],
    ['re-described', (w, id) => with_(w, 'desk_card', id, { description: { v: 'More' } })],
    ['starred', (w, id) => with_(w, 'desk_card', id, { starred: { v: false } })],
    ['given another time', (w, id) => with_(w, 'desk_card', id, { dueTime: { v: '09:00' } })],
    ['given another date', (w, id) => with_(w, 'desk_card', id, { dueDate: { v: '2026-11-09' } })],
    ['started', (w, id) => with_(w, 'desk_card', id, { startedAt: { v: 9 } })],
    ['moved to another list', (w, id) => structure(w, id, { listId: 'list-2' })],
    ['moved within its list', (w, id) => structure(w, id, { position: 'a1' })],
    [
      'an item ticked',
      (w, id) => with_(w, 'desk_check', itemOf(w, id)[0]?.id ?? '', { completedAt: { v: 9 } }),
    ],
    [
      'an item renamed',
      (w, id) =>
        with_(w, 'desk_check', itemOf(w, id)[0]?.id ?? '', { title: { v: 'Fill two cans' } }),
    ],
    [
      'an item deleted',
      (w, id) =>
        lay(w, {
          mutationId: 'x',
          changes: [{ table: 'desk_check', id: itemOf(w, id)[0]?.id ?? '', deleted: true }],
        }),
    ],
    [
      'an item added',
      (w, id) =>
        lay(w, {
          mutationId: 'x',
          changes: [
            {
              table: 'desk_check',
              id: 'extra',
              cardId: id,
              position: 'a9',
              fields: { title: { v: 'New' } },
            },
          ],
        }),
    ],
  ];
  const itemOf = (w: World, id: string) => itemsOf(w, id).filter((i) => i.deletedAt === null);
  function with_(w: World, table: 'desk_card' | 'desk_check', id: string, fields: object): World {
    return lay(w, { mutationId: 'x', changes: [{ table, id, fields } as never] });
  }
  function structure(w: World, id: string, change: object): World {
    return lay(w, { mutationId: 'x', changes: [{ table: 'desk_card', id, ...change } as never] });
  }

  for (const [what, touch] of touches) {
    it(`leaves the series when the next was changed (${what}): two open cards, one a one-off, nothing lost`, () => {
      const ticked = tick(start());
      const nextId = nextOf(ticked)?.id ?? '';
      const touched = touch(ticked, nextId);
      const result = reopen(touched);
      if (!result.ok) throw new Error('refused');
      const after = lay(touched, result.mutation);
      // The next is as it was, and alive.
      expect(after.get(`desk_card:${nextId}`)?.deletedAt).toBeNull();
      expect(seen(after).filter((r) => r.key.startsWith('desk_card')).length).toBe(2);
      // The reopened card is open, and no longer in the series.
      const reopened = after.get('desk_card:c1');
      expect(reopened && seriesIdOf(reopened)).toBeUndefined();
      expect(reopened?.fields.completedAt).toEqual(expect.objectContaining({ v: null }));
      expect(seriesIdOf(after.get(`desk_card:${nextId}`) as LocalRow)).toBe(SERIES);
      // Only the reopened card is written.
      expect(result.mutation.changes.map((c) => c.id)).toEqual(
        ['c1', 'c1'].slice(0, result.mutation.changes.length),
      );
    });
  }

  it('is a plain reopening when there is no next, for a series that is gone, and for a card that does not repeat', () => {
    const done = row(
      'desk_card',
      'c1',
      { listId: 'l', position: 'a0' },
      {
        title: 'x',
        completedAt: 5,
        seriesId: SERIES,
      },
    );
    const none = reopenOccurrence(done, theSeries(), [], [], ids());
    expect(none.ok && none.mutation.changes).toHaveLength(1);
    const gone = reopenOccurrence(done, undefined, [], [], ids());
    expect(gone).toEqual(reopenCard(done, { newId: () => 'm-1' }));
    const plain = row(
      'desk_card',
      'c2',
      { listId: 'l', position: 'a0' },
      { title: 'x', completedAt: 5 },
    );
    expect(reopenOccurrence(plain, undefined, [], [], ids())).toEqual(
      reopenCard(plain, { newId: () => 'm-1' }),
    );
    expect(
      reopenOccurrence(
        row('desk_card', 'c3', { listId: 'l', position: 'a0' }, { title: 'open' }),
        undefined,
        [],
        [],
        ids(),
      ),
    ).toEqual({
      ok: false,
      reason: 'nothing',
    });
  });

  it('leaves the series rather than guess when there is more than one open occurrence', () => {
    const ticked = tick(start());
    const other = row(
      'desk_card',
      'c9',
      { listId: 'list-1', position: 'a6' },
      {
        title: 'Water',
        dueDate: '2026-11-20',
        seriesId: SERIES,
      },
    );
    const world = new Map(ticked).set(key(other), other);
    const result = reopen(world);
    if (!result.ok) throw new Error('refused');
    expect(JSON.stringify(result.mutation.changes)).toContain('"seriesId":{"v":null}');
    expect(result.mutation.changes.some((c) => 'deleted' in c && c.deleted)).toBe(false);
  });

  it('ignores a next that was deleted or is done: there is nothing to take away, and the series goes on', () => {
    const ticked = tick(start());
    const nextId = nextOf(ticked)?.id ?? '';
    const deleted = lay(ticked, {
      mutationId: 'x',
      changes: [{ table: 'desk_card', id: nextId, deleted: true }],
    });
    const result = reopen(deleted);
    expect(result.ok && result.mutation.changes).toHaveLength(1);
    const next = ticked.get(`desk_card:${nextId}`) as LocalRow;
    const doneNext = lay(ticked, {
      mutationId: 'x',
      changes: [{ table: 'desk_card', id: next.id, fields: { completedAt: { v: 7 } } }],
    });
    const second = reopen(doneNext);
    expect(second.ok && second.mutation.changes).toHaveLength(1);
  });
});

describe('moving an occurrence', () => {
  const dest = [row('desk_card', 'd1', { listId: 'list-2', position: 'a3' }, { title: 'there' })];

  it('moves the series with it, in one mutation, so the next is made in the list it moved to', () => {
    const result = moveOccurrence(original(), theSeries(), 'list-2', dest, ids());
    expect(result.ok && result.mutation.changes).toEqual([
      expect.objectContaining({ table: 'desk_card', id: 'c1', listId: 'list-2' }),
      { table: 'desk_series', id: SERIES, listId: 'list-2' },
    ]);
    if (!result.ok) throw new Error('refused');
    const moved = lay(start(), result.mutation);
    const done = completeCard(moved.get('desk_card:c1'), 5, ids(), [], {
      series: moved.get(`desk_series:${SERIES}`),
      today: '2026-11-06',
    });
    expect(done.ok && JSON.stringify(done.mutation.changes)).toContain('"listId":"list-2"');
  });

  it('moves a completed occurrence alone, and a card that does not repeat as before', () => {
    const done = {
      ...original(),
      fields: { ...original().fields, completedAt: { v: 5, s: 1 } },
    } as LocalRow;
    const alone = moveOccurrence(done, theSeries(), 'list-2', dest, ids());
    expect(alone.ok && alone.mutation.changes.map((c) => c.table)).toEqual(['desk_card']);
    const plain = row('desk_card', 'c2', { listId: 'list-1', position: 'a0' }, { title: 'x' });
    const ordinary = moveOccurrence(plain, theSeries(), 'list-2', dest, ids());
    expect(ordinary.ok && ordinary.mutation.changes.map((c) => c.table)).toEqual(['desk_card']);
    expect(moveOccurrence(original(), theSeries(), 'list-1', dest, ids())).toEqual({
      ok: false,
      reason: 'nothing',
    });
  });
});
