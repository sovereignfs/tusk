import { describe, expect, it } from 'vitest';
import { moveCard } from '../actions/cards';
import type { LocalRow } from '../local/rows';
import {
  DEFAULT_SORT,
  SORTS,
  SORT_LABELS,
  canReorder,
  dropWithinGroup,
  dueAt,
  isSort,
  pinFirst,
  sortOf,
  sortCards,
} from './sort';
import { parseField } from '../sync/validate';

const row = (
  id: string,
  position: string,
  createdAt: number,
  fields: Record<string, { v: unknown; s: number }> = {},
): LocalRow =>
  ({
    table: 'desk_card',
    id,
    listId: 'l',
    position,
    deletedAt: null,
    seq: 1,
    createdAt,
    fields: { title: { v: id, s: 1 }, ...fields },
  }) as LocalRow;

describe('sorting a list', () => {
  it('offers four sorts, each with a label, and the server takes each as a list’s sort and nothing else', () => {
    expect([...SORTS]).toEqual(['custom', 'created', 'due', 'title']);
    for (const sort of SORTS) {
      expect(SORT_LABELS[sort].length).toBeGreaterThan(0);
      expect(parseField('desk_list', 'sort', { v: sort }).ok).toBe(true);
      expect(isSort(sort)).toBe(true);
    }
    for (const other of ['random', '', 'CUSTOM', 'toString', null, 3]) {
      expect(isSort(other)).toBe(false);
      expect(parseField('desk_list', 'sort', { v: other }).ok).toBe(false);
    }
  });

  it('is read from the list, and custom for a list with none, a ciphertext one, or one this version does not know', () => {
    const list = (fields: Record<string, unknown>) =>
      ({
        table: 'desk_list',
        id: 'l',
        position: 'a0',
        deletedAt: null,
        seq: 1,
        createdAt: 1,
        fields,
      }) as unknown as LocalRow;
    expect(sortOf(list({ sort: { v: 'title', s: 1 } }))).toBe('title');
    expect(sortOf(list({}))).toBe(DEFAULT_SORT);
    expect(sortOf(list({ sort: { v: 'newest', s: 1 } }))).toBe(DEFAULT_SORT);
    expect(sortOf(list({ sort: { c: 'YWdl', s: 1 } }))).toBe(DEFAULT_SORT);
    expect(sortOf(undefined)).toBe(DEFAULT_SORT);
  });

  it('custom is by position as bytes, and equal positions by id', () => {
    const tasks = [row('c', 'a1', 1), row('b', 'a0', 2), row('a', 'a0', 3), row('d', 'B', 4)];
    expect(sortCards(tasks, 'custom').map((t: LocalRow) => t.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('created is newest first', () => {
    const tasks = [row('old', 'a0', 1), row('new', 'a1', 3), row('mid', 'a2', 2)];
    expect(sortCards(tasks, 'created').map((t: LocalRow) => t.id)).toEqual(['new', 'mid', 'old']);
  });

  it('title is alphabetical as a person reads it: case and accents do not decide, and numbers go by value', () => {
    const named = (id: string, title: string) => row(id, 'a0', 1, { title: { v: title, s: 1 } });
    const tasks = [
      named('1', 'banana'),
      named('2', 'Apple'),
      named('3', 'cherry'),
      named('4', 'task 10'),
      named('5', 'task 2'),
      named('6', 'Éclair'),
      named('7', 'apple'),
    ];
    const sorted = sortCards(tasks, 'title').map((t) => (t.fields.title as { v: string }).v);
    expect(sorted.slice(0, 2).map((t) => t.toLowerCase())).toEqual(['apple', 'apple']);
    expect(sorted.indexOf('task 2')).toBeLessThan(sorted.indexOf('task 10'));
    expect(sorted.indexOf('banana')).toBeLessThan(sorted.indexOf('cherry'));
    expect(sorted.indexOf('cherry')).toBeLessThan(sorted.indexOf('Éclair'));
  });

  it('due is soonest first, a time breaking a tie, and tasks with no date last in the order they have', () => {
    const due = (id: string, position: string, date?: string, time?: string) =>
      row(id, position, 1, {
        ...(date ? { dueDate: { v: date, s: 1 } } : {}),
        ...(time ? { dueTime: { v: time, s: 1 } } : {}),
      });
    const tasks = [
      due('none2', 'a5'),
      due('later', 'a0', '2026-12-01'),
      due('noon', 'a1', '2026-11-05', '12:00'),
      due('morning', 'a2', '2026-11-05', '09:00'),
      due('allday', 'a3', '2026-11-05'),
      due('none1', 'a4'),
    ];
    expect(sortCards(tasks, 'due').map((t: LocalRow) => t.id)).toEqual([
      'morning',
      'noon',
      'allday',
      'later',
      'none1',
      'none2',
    ]);
  });

  it('does not change the array it was given, and is the same whatever order it was given in', () => {
    const tasks = [row('b', 'a1', 1), row('a', 'a0', 2)];
    const before = tasks.map((t: LocalRow) => t.id);
    sortCards(tasks, 'title');
    expect(tasks.map((t: LocalRow) => t.id)).toEqual(before);
    for (const sort of SORTS) {
      expect(sortCards([...tasks].reverse(), sort).map((t: LocalRow) => t.id)).toEqual(
        sortCards(tasks, sort).map((t: LocalRow) => t.id),
      );
    }
  });

  it('can be dragged only under custom', () => {
    expect(SORTS.filter(canReorder)).toEqual(['custom']);
  });
});

describe('pinning what is overdue or due today to the top', () => {
  const NOW = { date: '2026-11-06', time: '12:00' };
  const due = (date: string, time?: string) => ({
    dueDate: { v: date, s: 1 },
    dueTime: { v: time ?? '', s: 1 },
  });
  const cards = [
    row('a', 'a0', 1),
    row('b', 'a1', 2, due('2026-11-01')),
    row('c', 'a2', 3, due('2026-12-01')),
    row('d', 'a3', 4, due('2026-11-06', '18:00')),
    row('e', 'a4', 5),
    row('f', 'a5', 6, due('2026-10-01')),
  ];

  it('reads a card’s due as a date and a time, and a card with no date as neither', () => {
    expect(dueAt(cards[1] as LocalRow)).toEqual({ date: '2026-11-01', time: null });
    expect(dueAt(cards[3] as LocalRow)).toEqual({ date: '2026-11-06', time: '18:00' });
    expect(dueAt(cards[0] as LocalRow)).toEqual({ date: null, time: null });
  });

  it('is a stable partition: the pinned first, each group in the order it came, and no row changed', () => {
    const before = cards.map((card) => ({ ...card }));
    expect(pinFirst(cards, NOW).map((card) => card.id)).toEqual(['b', 'd', 'f', 'a', 'c', 'e']);
    expect(cards).toEqual(before);
  });

  it('changes nothing when nothing is pinned, and returns a copy', () => {
    const none = [row('x', 'a0', 1), row('y', 'a1', 2, due('2027-01-01'))];
    const out = pinFirst(none, NOW);
    expect(out.map((card) => card.id)).toEqual(['x', 'y']);
    expect(out).not.toBe(none);
  });

  it('is undone by the day passing: tomorrow a card due today is overdue and still first, one due tomorrow is pinned', () => {
    const tomorrow = { date: '2026-11-07', time: '00:01' };
    expect(pinFirst(cards, tomorrow).map((card) => card.id)).toEqual([
      'b',
      'd',
      'f',
      'a',
      'c',
      'e',
    ]);
    const dec = { date: '2026-12-01', time: '00:01' };
    expect(pinFirst(cards, dec).map((card) => card.id)).toEqual(['b', 'c', 'd', 'f', 'a', 'e']);
  });
});

describe('dragging across the pinned cards', () => {
  const NOW = { date: '2026-11-06', time: '12:00' };
  const late = { dueDate: { v: '2026-11-01', s: 1 }, dueTime: { v: '', s: 1 } };
  // In the order made: p, q, r (pinned: q, s) and u, t.
  const made = [
    row('p', 'a0', 1),
    row('q', 'a1', 2, late),
    row('r', 'a2', 3),
    row('s', 'a3', 4, late),
    row('t', 'a4', 5),
  ];
  const screen = () => pinFirst(sortCards(made, 'custom'), NOW);
  /** What the screen shows after dragging `id` to `toIndex` of what it showed: the one row written, then sorted and pinned again. */
  function drag(id: string, toIndex: number): { shown: string[]; written: number } {
    const within = dropWithinGroup(screen(), id, toIndex, NOW);
    if (!within) throw new Error('not there');
    const result = moveCard(within.group, id, within.toIndex, { newId: () => 'n' });
    if (!result.ok) return { shown: screen().map((card) => card.id), written: 0 };
    const change = result.mutation.changes[0];
    const position = change && 'position' in change ? (change.position as string) : '';
    const next = made.map((card) => (card.id === id ? ({ ...card, position } as LocalRow) : card));
    return {
      shown: pinFirst(sortCards(next, 'custom'), NOW).map((card) => card.id),
      written: result.mutation.changes.length,
    };
  }

  it('shows the pinned first and the rest in the order made', () => {
    expect(screen().map((card) => card.id)).toEqual(['q', 's', 'p', 'r', 't']);
  });

  it('reorders the pinned cards when one is dragged past another, with one row written', () => {
    expect(drag('s', 0)).toEqual({ shown: ['s', 'q', 'p', 'r', 't'], written: 1 });
    expect(drag('q', 1)).toEqual({ shown: ['s', 'q', 'p', 'r', 't'], written: 1 });
  });

  it('reorders the others among themselves', () => {
    expect(drag('t', 2).shown).toEqual(['q', 's', 't', 'p', 'r']);
  });

  it('writes a valid position for a card dragged across the partition, and it falls back to its group', () => {
    // A card that is not pinned, dropped among the pinned ones, stays out of them.
    expect(drag('r', 0).shown).toEqual(['q', 's', 'r', 'p', 't']);
    // A pinned card dropped among the others stays pinned, and moves among the pinned by where it landed between its neighbours.
    expect(drag('q', 4).shown).toEqual(['s', 'q', 'p', 'r', 't']);
  });
});
