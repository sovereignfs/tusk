import type { LocalRow } from '../local/rows';
import { byPosition } from '../local/rows';
import { isDueTodayOrOverdue } from '../dates/overdue';
import type { LocalNow } from '../time';

/**
 * How a list's cards are ordered on the screen (DESIGN.md §10.5), **remembered per list** as a field of the list, so that it survives a reload and
 * reaches another device. Pure: no clock, no database.
 *
 * - `custom`   the order the person made by dragging (the position). **The only order that can be dragged**: under any other, a row has no handle and
 *               a drag does nothing, since where it lands would be decided by the sort and not by the person.
 * - `created`  newest first.
 * - `due`      soonest first; a card with no date after those that have one, in position order among themselves.
 * - `title`    alphabetical as a person reads it: case and accents do not decide, and "card 2" comes before "card 10".
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

/** The cards in the order `sort` says. A new array: the one given is not changed. */
export function sortCards(cards: readonly LocalRow[], sort: Sort): LocalRow[] {
  const positional = (a: LocalRow, b: LocalRow) =>
    'position' in a && 'position' in b ? byPosition(a, b) : tie(a, b);
  const out = [...cards];
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

/** A card's due date and time as one string that sorts chronologically (DESIGN.md §11), or undefined if it has no date or it cannot be read. */
function dueOf(card: LocalRow): string | undefined {
  const date = plainText(card, 'dueDate');
  if (date === '') return undefined;
  return `${date} ${plainText(card, 'dueTime') || '99:99'}`;
}

/** Whether cards can be dragged into order under this sort. */
export const canReorder = (sort: Sort): boolean => sort === 'custom';

/** A card's due date and time as the pair the date rules take; a date that is ciphertext, or none, is none. */
export function dueAt(card: LocalRow): { date: string | null; time: string | null } {
  const date = plainText(card, 'dueDate');
  return {
    date: date === '' ? null : date,
    time: date === '' ? null : plainText(card, 'dueTime') || null,
  };
}

/**
 * Under Custom order, the cards that are overdue or due today float to the top (DESIGN.md §10.4): **a partition, not a change to any position.** The
 * pinned ones come first and the rest after, each group in the order it was given, so nothing moves that does not have to and no row is written. Pure,
 * given now. Under any other sort the order is the sort's and nothing is pinned.
 */
export function pinFirst(cards: readonly LocalRow[], now: LocalNow): LocalRow[] {
  const pinned: LocalRow[] = [];
  const rest: LocalRow[] = [];
  for (const card of cards) (isDueTodayOrOverdue(dueAt(card), now) ? pinned : rest).push(card);
  return [...pinned, ...rest];
}

/**
 * Where a drag lands once the pinned cards are on top (DESIGN.md §10.4). The screen shows two groups in one column, and the positions of the two do not
 * run on from one to the other, so the neighbours of a drop at the edge between them would be out of order. **A drop is worked out inside the group of
 * the card that was dragged:** the cards of its group as they are shown, and the index it has among them once it has been put where it was dropped. A card
 * dropped in the other group lands at the edge of its own, nearest where it was let go; one that does not move within its group is undefined, nothing to
 * write. Positions of the cards of the other group are never read.
 */
export function dropWithinGroup(
  rendered: readonly LocalRow[],
  id: string,
  to: number,
  now: LocalNow,
): { group: LocalRow[]; toIndex: number } | undefined {
  const from = rendered.findIndex((card) => card.id === id);
  const target = Math.max(0, Math.min(to, rendered.length - 1));
  const dragged = rendered[from];
  if (!dragged) return undefined;
  const pinned = isDueTodayOrOverdue(dueAt(dragged), now);
  const moved = [...rendered];
  moved.splice(from, 1);
  moved.splice(target, 0, dragged);
  const inGroup = (card: LocalRow) => isDueTodayOrOverdue(dueAt(card), now) === pinned;
  return {
    group: rendered.filter(inGroup),
    toIndex: moved.filter(inGroup).findIndex((card) => card.id === id),
  };
}
