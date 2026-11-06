import { describe, expect, it } from 'vitest';
import { setFilter } from '../actions/lists';
import type { LocalRow } from '../local/rows';
import { parseField } from '../sync/validate';
import {
  DEFAULT_FILTER,
  FILTERS,
  FILTER_LABELS,
  filterCards,
  filterOf,
  isFilter,
  showsCompleted,
} from './filter';

/** Which of a list's cards are shown (DESIGN.md §10.5): remembered with the list, and only a choice of what to show. */
const NOW = { date: '2026-11-06', time: '12:00' };
const card = (id: string, fields: Record<string, unknown> = {}): LocalRow =>
  ({
    table: 'desk_card',
    id,
    listId: 'l',
    position: `a${id}`,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: Object.fromEntries(
      Object.entries({ title: id, ...fields }).map(([k, v]) => [k, { v, s: 1 }]),
    ),
  }) as LocalRow;
const list = (fields: Record<string, unknown> = {}): LocalRow =>
  ({
    table: 'desk_list',
    id: 'list',
    position: 'a0',
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { v, s: 1 }])),
  }) as LocalRow;

describe('the filters', () => {
  it('are All, Active, Starred and Overdue, each with a label, and the server takes each as a list’s filter and nothing else', () => {
    expect([...FILTERS]).toEqual(['all', 'active', 'starred', 'overdue']);
    for (const filter of FILTERS) {
      expect(FILTER_LABELS[filter].length).toBeGreaterThan(0);
      expect(isFilter(filter)).toBe(true);
      expect(parseField('desk_list', 'filter', { v: filter }).ok).toBe(true);
    }
    for (const other of ['', 'ALL', 'completed', 'toString', null, 3]) {
      expect(isFilter(other)).toBe(false);
      expect(parseField('desk_list', 'filter', { v: other }).ok).toBe(false);
    }
  });

  it('is read from the list, and All for a list with none, a ciphertext one, or one this version does not know', () => {
    expect(filterOf(list({ filter: 'starred' }))).toBe('starred');
    expect(filterOf(list({ filter: 'overdue' }))).toBe('overdue');
    expect(filterOf(list())).toBe(DEFAULT_FILTER);
    expect(filterOf(undefined)).toBe(DEFAULT_FILTER);
    expect(filterOf(list({ filter: 'next-year' }))).toBe('all');
    expect(filterOf({ ...list(), fields: { filter: { c: 'YWdl', s: 1 } } } as LocalRow)).toBe(
      'all',
    );
  });

  it('is chosen by one change to the one field, and nothing for the one it already is or one that is not a filter', () => {
    const ids = { newId: () => 'm' };
    const result = setFilter(list(), 'starred', ids);
    expect(result.ok && result.mutation.changes).toEqual([
      { table: 'desk_list', id: 'list', fields: { filter: { v: 'starred' } } },
    ]);
    expect(setFilter(list({ filter: 'starred' }), 'starred', ids)).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(setFilter(list(), 'all', ids)).toEqual({ ok: false, reason: 'nothing' });
    expect(setFilter(list(), 'random', ids)).toEqual({ ok: false, reason: 'nothing' });
    expect(setFilter(undefined, 'starred', ids)).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('choosing cards by a filter', () => {
  const open = [
    card('1', { starred: true }),
    card('2'),
    card('3', { starred: true, dueDate: '2026-11-01', dueTime: null }),
    card('4', { starred: false, dueDate: '2026-11-01', dueTime: null }),
    card('5', { dueDate: '2026-11-06', dueTime: '18:00' }),
    card('6', { dueDate: '2026-11-06', dueTime: '09:00' }),
  ];
  const ids = (filter: (typeof FILTERS)[number]) =>
    filterCards(open, filter, NOW).map((each) => each.id);

  it('shows all and the active ones as they are, the starred alone, and the overdue alone', () => {
    expect(ids('all')).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(ids('active')).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(ids('starred')).toEqual(['1', '3']);
    expect(ids('overdue')).toEqual(['3', '4', '6']);
  });

  it('changes nothing it is given and keeps the order it was given', () => {
    const before = open.map((each) => ({ ...each }));
    const shuffled = [open[3], open[0], open[2]] as LocalRow[];
    expect(filterCards(shuffled, 'starred', NOW).map((each) => each.id)).toEqual(['1', '3']);
    expect(filterCards(shuffled, 'overdue', NOW).map((each) => each.id)).toEqual(['4', '3']);
    expect(open).toEqual(before);
  });

  it('lets a card that stops matching go without moving it: the star off, and it is gone, and the rest are where they were', () => {
    const unstarred = open.map((each) => (each.id === '1' ? card('1', { starred: false }) : each));
    expect(filterCards(unstarred, 'starred', NOW).map((each) => each.id)).toEqual(['3']);
    expect(filterCards(unstarred, 'all', NOW).map((each) => each.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
  });

  it('counts a star it cannot read as none, and shows the done ones under All alone', () => {
    const sealed = { ...card('7'), fields: { starred: { c: 'YWdl', s: 1 } } } as LocalRow;
    expect(filterCards([sealed], 'starred', NOW)).toEqual([]);
    expect(FILTERS.filter(showsCompleted)).toEqual(['all']);
  });
});
