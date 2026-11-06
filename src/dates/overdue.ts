import type { LocalNow } from '../time';

/**
 * Overdue, and due today or overdue (DESIGN.md §10.4, §11), measured against **now in the person's own zone**, given and never read, so that it is
 * tested with no clock. A due date is floating, written as on a calendar: a card with a date and no time is due all that day, so it is overdue from the
 * next day; a card with a time is overdue from that minute. A card with no date is never overdue. Dates and times compare as strings, which sort
 * chronologically.
 */
export interface DueAt {
  /** `YYYY-MM-DD`, or null for none. */
  readonly date: string | null;
  /** `HH:MM`, or null; only with a date. */
  readonly time: string | null;
}

export function isOverdue(due: DueAt, now: LocalNow): boolean {
  if (due.date === null) return false;
  if (due.date < now.date) return true;
  return due.date === now.date && due.time !== null && due.time < now.time;
}

/** Due today or overdue: the cards that float to the top of a list under Custom order. A date before today, or today, whatever the time. */
export function isDueTodayOrOverdue(due: DueAt, now: LocalNow): boolean {
  return due.date !== null && due.date <= now.date;
}
