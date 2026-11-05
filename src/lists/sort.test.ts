import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { DEFAULT_SORT, SORTS, SORT_LABELS, canReorder, isSort, sortOf, sortTasks } from './sort';
import { parseField } from '../sync/validate';

const row = (
  id: string,
  position: string,
  createdAt: number,
  fields: Record<string, { v: unknown; s: number }> = {},
): LocalRow =>
  ({
    table: 'task',
    id,
    listId: 'l',
    parentId: null,
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
      expect(parseField('list', 'sort', { v: sort }).ok).toBe(true);
      expect(isSort(sort)).toBe(true);
    }
    for (const other of ['random', '', 'CUSTOM', 'toString', null, 3]) {
      expect(isSort(other)).toBe(false);
      expect(parseField('list', 'sort', { v: other }).ok).toBe(false);
    }
  });

  it('is read from the list, and custom for a list with none, a ciphertext one, or one this version does not know', () => {
    const list = (fields: Record<string, unknown>) =>
      ({
        table: 'list',
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
    expect(sortTasks(tasks, 'custom').map((t) => t.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('created is newest first', () => {
    const tasks = [row('old', 'a0', 1), row('new', 'a1', 3), row('mid', 'a2', 2)];
    expect(sortTasks(tasks, 'created').map((t) => t.id)).toEqual(['new', 'mid', 'old']);
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
    const sorted = sortTasks(tasks, 'title').map((t) => (t.fields.title as { v: string }).v);
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
    expect(sortTasks(tasks, 'due').map((t) => t.id)).toEqual([
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
    const before = tasks.map((t) => t.id);
    sortTasks(tasks, 'title');
    expect(tasks.map((t) => t.id)).toEqual(before);
    for (const sort of SORTS) {
      expect(sortTasks([...tasks].reverse(), sort).map((t) => t.id)).toEqual(
        sortTasks(tasks, sort).map((t) => t.id),
      );
    }
  });

  it('can be dragged only under custom', () => {
    expect(SORTS.filter(canReorder)).toEqual(['custom']);
  });
});
