import { describe, expect, it } from 'vitest';
import { type LocalRow, applyChange } from '../local/rows';
import { LIMITS } from '../sync/format';
import { parseMutation } from '../sync/validate';
import { type DeskPart, buildDesk, envelope, serialise } from './format';
import { type Existing, importDesk } from './import-desk';
import { validateFile } from './validate';

/** Importing the Desk's part (DESIGN.md §20.2): created, never merged, every id new, in whole mutations, and equal to what was exported but for ids. */
let n = 0;
const uid = () => {
  n += 1;
  return `${n.toString(16).padStart(8, '0')}-1111-4111-8111-${n.toString(16).padStart(12, '0')}`;
};
const ids = { newId: uid };

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

/** A Desk of two lists, a repeating card, a done card with a checklist, and a starred one with a date. */
function source() {
  const [l1, l2, c1, c2, c3, s1] = [uid(), uid(), uid(), uid(), uid(), uid()];
  return {
    lists: [
      row('desk_list', l1, { position: 'a0' }, { title: 'Home', color: '#2563eb', sort: 'due' }),
      row('desk_list', l2, { position: 'a1' }, { title: 'Work' }),
    ],
    cards: [
      row(
        'desk_card',
        c1,
        { listId: l1, position: 'a0' },
        {
          title: 'Water',
          description: 'daily',
          seriesId: s1,
          dueDate: '2026-11-06',
          dueTime: '09:00',
        },
      ),
      row(
        'desk_card',
        c2,
        { listId: l1, position: 'a1' },
        { title: 'Done', completedAt: 7, startedAt: 3 },
      ),
      row('desk_card', c3, { listId: l2, position: 'a0' }, { title: 'Starred', starred: true }),
    ],
    checks: [
      row('desk_check', uid(), { cardId: c2, position: 'a0' }, { title: 'first', completedAt: 7 }),
      row('desk_check', uid(), { cardId: c2, position: 'a1' }, { title: 'second' }),
    ],
    series: [row('desk_series', s1, { listId: l1 }, { rule: 'FREQ=DAILY', anchor: '2026-11-01' })],
  };
}

const nothing: Existing = { lists: [], listRows: 0, cardRows: 0, checkRows: 0, seriesRows: 0 };

/** What the working copy holds once mutations are laid over it, by its own rule. */
function lay(mutations: { changes: readonly object[] }[]) {
  const world = new Map<string, LocalRow>();
  for (const mutation of mutations)
    for (const change of mutation.changes as { table: string; id: string }[])
      world.set(
        `${change.table}:${change.id}`,
        applyChange(world.get(`${change.table}:${change.id}`), change as never, 1),
      );
  const all = [...world.values()];
  const of = (table: string) => all.filter((r) => r.table === table);
  return {
    lists: of('desk_list'),
    cards: of('desk_card'),
    checks: of('desk_check'),
    series: of('desk_series'),
  };
}

/** A Desk with no ids: what "equal data" means (the ids are new, and so is where the lists were put). */
function bare(part: DeskPart) {
  const listIndex = new Map(part.lists.map((l, i) => [l.id, i]));
  const seriesIndex = new Map(part.series.map((s, i) => [s.id, i]));
  return {
    lists: part.lists.map((l) => ({
      title: l.title,
      color: l.color,
      sort: l.sort,
      cards: l.cards.map((c) => ({
        ...c,
        id: undefined,
        seriesId: c.seriesId === null ? null : seriesIndex.get(c.seriesId),
        checklist: c.checklist.map((i) => ({ ...i, id: undefined })),
      })),
    })),
    series: part.series.map((s) => ({
      rule: s.rule,
      anchor: s.anchor,
      list: listIndex.get(s.listId),
    })),
  };
}

function fromFile(): DeskPart {
  const exported = buildDesk(source());
  const text = serialise(envelope('desk', { desk: exported }, new Date('2026-11-06T09:00:00Z')));
  const read = validateFile(text);
  if (!read.ok || !read.file.desk) throw new Error(`not read: ${!read.ok && read.error}`);
  return read.file.desk;
}

describe('importing the Desk', () => {
  it('into an empty account gives equal data, ignoring ids: export, read, import, export again', () => {
    const part = fromFile();
    const made = importDesk(part, nothing, ids);
    if (!made.ok) throw new Error('refused');
    expect(made.counts).toEqual({ lists: 2, cards: 3, items: 2, series: 1 });
    expect(bare(buildDesk(lay(made.mutations)))).toEqual(bare(buildDesk(source())));
  });

  it('gives every row a new id, and the new ids point at each other: a card at its list and series, an item at its card', () => {
    const part = fromFile();
    const fileIds = JSON.stringify(part).match(/[0-9a-f]{8}-1111-4111-8111-[0-9a-f]{12}/g) ?? [];
    const made = importDesk(part, nothing, ids);
    if (!made.ok) throw new Error('refused');
    const text = JSON.stringify(made.mutations);
    for (const old of fileIds) expect(text, old).not.toContain(old);
    const world = lay(made.mutations);
    const listIds = new Set(world.lists.map((l) => l.id));
    for (const card of world.cards)
      expect(listIds.has((card as { listId: string }).listId)).toBe(true);
    const cardIds = new Set(world.cards.map((c) => c.id));
    for (const item of world.checks)
      expect(cardIds.has((item as { cardId: string }).cardId)).toBe(true);
    const seriesIds = new Set(world.series.map((s) => s.id));
    const pointers = world.cards.map((c) => c.fields.seriesId).filter((f) => f && 'v' in f && f.v);
    expect(pointers).toHaveLength(1);
    expect(pointers.every((f) => f && 'v' in f && seriesIds.has(f.v as string))).toBe(true);
  });

  it('makes two copies when it is done twice, with nothing in common', () => {
    const part = fromFile();
    const a = importDesk(part, nothing, ids);
    const b = importDesk(part, nothing, ids);
    if (!a.ok || !b.ok) throw new Error('refused');
    const [first, second] = [lay(a.mutations), lay(b.mutations)];
    const idsOf = (w: ReturnType<typeof lay>) =>
      [...w.lists, ...w.cards, ...w.checks, ...w.series].map((r) => r.id);
    expect(new Set([...idsOf(first), ...idsOf(second)]).size).toBe(idsOf(first).length * 2);
    // Both, laid in one working copy, are two Desks.
    expect(buildDesk(lay([...a.mutations, ...b.mutations])).lists).toHaveLength(4);
  });

  it('adds the lists after the ones the Desk has, in the file’s order, and never changes a row that is there', () => {
    const part = fromFile();
    const there = [row('desk_list', uid(), { position: 'a4' }, { title: 'Mine' })];
    const made = importDesk(part, { ...nothing, lists: there, listRows: 1 }, ids);
    if (!made.ok) throw new Error('refused');
    const world = lay(made.mutations);
    const keys = world.lists.map((l) => (l as { position: string }).position);
    expect(keys.every((key) => key > 'a4')).toBe(true);
    expect([...keys].sort()).toEqual(keys);
    expect(
      world.lists.map((l) => l.fields.title && 'v' in l.fields.title && l.fields.title.v),
    ).toEqual(['Home', 'Work']);
    expect(JSON.stringify(made.mutations)).not.toContain(there[0]?.id ?? 'x');
  });

  it('puts a list and a series before the cards that point at them, and never splits a card from its checklist', () => {
    const made = importDesk(fromFile(), nothing, ids);
    if (!made.ok) throw new Error('refused');
    const order = made.mutations.flatMap((m) => m.changes.map((c) => c.table));
    expect(order.lastIndexOf('desk_list')).toBeLessThan(order.indexOf('desk_card'));
    expect(order.lastIndexOf('desk_series')).toBeLessThan(order.indexOf('desk_card'));
  });

  it('is several mutations when it is large, each whole and within a mutation’s size, and every one is a change the sync would take', () => {
    const big: DeskPart = {
      lists: [
        {
          id: uid(),
          title: 'Big',
          color: null,
          position: 'a0',
          sort: null,
          cards: Array.from({ length: 300 }, (_, i) => ({
            id: uid(),
            title: `card ${i}`,
            description: '',
            starred: false,
            dueDate: null,
            dueTime: null,
            seriesId: null,
            startedAt: null,
            completedAt: null,
            position: `a${String(i).padStart(3, '0')}`,
            checklist: Array.from({ length: 3 }, (_, k) => ({
              id: uid(),
              title: `step ${k}`,
              completedAt: null,
              position: `a${k}`,
            })),
          })),
        },
      ],
      series: [],
    };
    const made = importDesk(big, nothing, ids);
    if (!made.ok) throw new Error('refused');
    expect(made.mutations.length).toBeGreaterThan(1);
    for (const mutation of made.mutations) {
      expect(mutation.changes.length).toBeLessThanOrEqual(400);
      const cards = new Set(
        mutation.changes.filter((c) => c.table === 'desk_card').map((c) => c.id),
      );
      for (const change of mutation.changes)
        if (change.table === 'desk_check')
          expect(cards.has((change as { cardId: string }).cardId)).toBe(true);
      expect(parseMutation(mutation).ok, JSON.stringify(parseMutation(mutation))).toBe(true);
    }
    expect(made.mutations.flatMap((m) => m.changes)).toHaveLength(1 + 300 * 4);
  });

  it('is refused whole when it would take the account over a limit, counting what is deleted and not yet removed', () => {
    const part = fromFile();
    expect(importDesk(part, { ...nothing, listRows: LIMITS.listsPerAccount - 1 }, ids)).toEqual({
      ok: false,
      reason: 'lists',
    });
    expect(importDesk(part, { ...nothing, cardRows: LIMITS.cardsPerAccount - 2 }, ids)).toEqual({
      ok: false,
      reason: 'cards',
    });
    expect(importDesk(part, { ...nothing, checkRows: LIMITS.checksPerAccount - 1 }, ids)).toEqual({
      ok: false,
      reason: 'items',
    });
    expect(importDesk(part, { ...nothing, seriesRows: LIMITS.cardsPerAccount }, ids)).toEqual({
      ok: false,
      reason: 'series',
    });
    expect(importDesk(part, { ...nothing, listRows: LIMITS.listsPerAccount - 2 }, ids).ok).toBe(
      true,
    );
  });

  it('makes nothing of an empty Desk, and a part with only lists is only lists', () => {
    const made = importDesk({ lists: [], series: [] }, nothing, ids);
    expect(made).toEqual({
      ok: true,
      mutations: [],
      counts: { lists: 0, cards: 0, items: 0, series: 0 },
    });
  });
});
