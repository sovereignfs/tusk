import { isOverdue } from '../dates/overdue';
import type { LocalRow } from '../local/rows';
import type { LocalNow } from '../time';
import { dueAt } from './sort';

/**
 * Which of a list's cards are shown (DESIGN.md §10.5), **remembered per list** as a field of the list, with the order. Pure: now is given.
 *
 * - `all`      every card, the done ones in their own section.
 * - `active`   the cards still to do: the Completed section is not shown.
 * - `starred`  the open cards with a star.
 * - `overdue`  the open cards whose date and time have passed (4.3).
 *
 * A filter only chooses what is shown. **It writes nothing and moves nothing:** a card that stops matching (a star taken off under Starred) leaves the
 * view where it was, and is back in its place when the filter is.
 */
export const FILTERS = ['all', 'active', 'starred', 'overdue'] as const;
export type Filter = (typeof FILTERS)[number];

export const DEFAULT_FILTER: Filter = 'all';

export const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  active: 'Active',
  starred: 'Starred',
  overdue: 'Overdue',
};

export function isFilter(value: unknown): value is Filter {
  return typeof value === 'string' && (FILTERS as readonly string[]).includes(value);
}

/** A list's filter, from its field; a list with none, or one this version does not know, shows all. */
export function filterOf(list: LocalRow | undefined): Filter {
  const field = list?.fields.filter;
  return field !== undefined && 'v' in field && isFilter(field.v) ? field.v : DEFAULT_FILTER;
}

const starred = (card: LocalRow): boolean => {
  const field = card.fields.starred;
  return field !== undefined && 'v' in field && field.v === true;
};

/** The open cards a filter shows, in the order they were given. A star that is ciphertext cannot be read, and counts as none until the keys are in place. */
export function filterCards(open: readonly LocalRow[], filter: Filter, now: LocalNow): LocalRow[] {
  switch (filter) {
    case 'starred':
      return open.filter(starred);
    case 'overdue':
      return open.filter((card) => isOverdue(dueAt(card), now));
    case 'all':
    case 'active':
      return [...open];
  }
}

/** Whether the Completed section is part of what a filter shows: only when everything is. */
export const showsCompleted = (filter: Filter): boolean => filter === 'all';
