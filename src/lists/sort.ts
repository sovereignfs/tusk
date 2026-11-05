import type { LocalRow } from '../local/rows';
import { byPosition } from '../local/rows';

/**
 * How a list's tasks are ordered on the screen (DESIGN.md §11.4), **remembered per list** as a field of the list, so that it survives a reload and
 * reaches another device. Pure: no clock, no database.
 *
 * - `custom`   the order the person made by dragging (the position). **The only order that can be dragged**: under any other, a row has no handle and
 *               a drag does nothing, since where it lands would be decided by the sort and not by the person.
 * - `created`  newest first.
 * - `due`      soonest first; a task with no date after those that have one, in position order among themselves.
 * - `title`    alphabetical as a person reads it: case and accents do not decide, and "task 2" comes before "task 10".
 */
export const SORTS = ['custom', 'created', 'due', 'title'] as const;
export type Sort = (typeof SORTS)[number];

export const DEFAULT_SORT: Sort = 'custom';

export const SORT_LABELS: Record<Sort, string> = {
  custom: 'Custom',
  created: 'Date created',
  due: 'Due date',
  title: 'Title',
};

export function isSort(value: unknown): value is Sort {
  return typeof value === 'string' && (SORTS as readonly string[]).includes(value);
}

/** A list's sort, from its field; a list with none, or one this version does not know, is `custom`. */
export function sortOf(list: LocalRow | undefined): Sort {
  const field = list?.fields.sort;
  return field !== undefined && 'v' in field && isSort(field.v) ? field.v : DEFAULT_SORT;
}

const plainText = (row: LocalRow, name: string): string => {
  const field = row.fields[name];
  return field !== undefined && 'v' in field && typeof field.v === 'string' ? field.v : '';
};

/** Compares titles as a person would: by letters, not by code; digits by their value. */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const tie = (a: LocalRow, b: LocalRow): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The tasks in the order `sort` says. A new array: the one given is not changed. */
export function sortTasks(tasks: readonly LocalRow[], sort: Sort): LocalRow[] {
  const positional = (a: LocalRow, b: LocalRow) =>
    'position' in a && 'position' in b ? byPosition(a, b) : tie(a, b);
  const out = [...tasks];
  switch (sort) {
    case 'custom':
      return out.sort(positional);
    case 'created':
      return out.sort((a, b) => b.createdAt - a.createdAt || tie(a, b));
    case 'title':
      return out.sort(
        (a, b) => collator.compare(plainText(a, 'title'), plainText(b, 'title')) || tie(a, b),
      );
    case 'due':
      return out.sort((a, b) => {
        const [da, db] = [dueOf(a), dueOf(b)];
        if (da === undefined && db === undefined) return positional(a, b);
        if (da === undefined) return 1;
        if (db === undefined) return -1;
        return da < db ? -1 : da > db ? 1 : positional(a, b);
      });
  }
}

/** A task's due date and time as one string that sorts chronologically (DESIGN.md §12), or undefined if it has no date or it cannot be read. */
function dueOf(task: LocalRow): string | undefined {
  const date = plainText(task, 'dueDate');
  if (date === '') return undefined;
  return `${date} ${plainText(task, 'dueTime') || '99:99'}`;
}

/** Whether tasks can be dragged into order under this sort. */
export const canReorder = (sort: Sort): boolean => sort === 'custom';
