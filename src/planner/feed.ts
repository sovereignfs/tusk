import { colourOf, plain, text } from '../screens/fields';
import type { LocalRow } from '../local/rows';
import { addDays } from '../time';
import type { PlannedBoardCard } from './format';

/**
 * The Planner's feed, pure (DESIGN.md §25.1, task 19.1): which days to ask for, how the Desk's cards and the boards' are made into one kind of entry, which
 * entry is on which day, and how runs of empty days are folded. Dates are `YYYY-MM-DD`, floating (§11), compared as text; **no clock and no zone is read here**,
 * today is given.
 */

/** A chunk is four weeks, the unit the boards' part is read in and the window grows by. Chunks are on a fixed grid, so a day is always in the same one. */
export const CHUNK_DAYS = 28;

const DAY_MS = 86_400_000;
const dayNumber = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
};
const dateOf = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** The index of the chunk a date is in. */
export const chunkOf = (date: string): number => Math.floor(dayNumber(date) / CHUNK_DAYS);

/** The first and last day of a chunk. */
export function chunkRange(index: number): { from: string; to: string } {
  return { from: dateOf(index * CHUNK_DAYS), to: dateOf(index * CHUNK_DAYS + CHUNK_DAYS - 1) };
}

/** Every day from `from` to `to`, both counted. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = dayNumber(from); day <= dayNumber(to); day += 1) out.push(dateOf(day));
  return out;
}

/** What a card is in the feed, whichever half it is from. */
export interface Entry {
  /** Unique across both halves. */
  readonly key: string;
  readonly source: 'desk' | 'board';
  readonly id: string;
  readonly title: string;
  readonly date: string;
  /** `HH:MM`, or null for a card with a date and no time. */
  readonly time: string | null;
  readonly done: boolean;
  /** `#rrggbb`, a list's or a board's: drawn as a band. */
  readonly color: string;
  /** The list or board it is from. */
  readonly where: string;
  /** Where tapping it goes. */
  readonly href: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The Desk's cards that have a date in `[from, to]`, as entries. **A card whose date cannot be read (ciphertext, or not a date) is left out**, never placed
 * on a guess; a time that cannot be read is a card with no time. A completed card is kept and marked done.
 */
export function deskEntries(
  cards: readonly LocalRow[],
  lists: readonly LocalRow[],
  from: string,
  to: string,
): Entry[] {
  const listById = new Map(lists.map((list) => [list.id, list]));
  const out: Entry[] = [];
  for (const card of cards) {
    if (card.table !== 'desk_card') continue;
    const date = plain(card, 'dueDate');
    if (typeof date !== 'string' || !DATE.test(date) || date < from || date > to) continue;
    const time = plain(card, 'dueTime');
    const list = listById.get(card.listId);
    out.push({
      key: `desk:${card.id}`,
      source: 'desk',
      id: card.id,
      title: text(card, 'title', 'Untitled card'),
      date,
      time: typeof time === 'string' && TIME.test(time) ? time : null,
      done: typeof plain(card, 'completedAt') === 'number',
      color: colourOf(list),
      where: text(list, 'title', 'Untitled list'),
      // Over the Planner (`?card=`), as the Desk opens a card: the same address with the card named, never a navigation away from the feed.
      href: `/planner?card=${card.id}`,
    });
  }
  return out;
}

/** The boards' cards (what `GET /api/planner` returned) as entries. */
export function boardEntries(cards: readonly PlannedBoardCard[]): Entry[] {
  return cards.map((card) => ({
    key: `board:${card.cardId}`,
    source: 'board',
    id: card.cardId,
    title: card.title,
    date: card.dueDate,
    time: card.dueTime,
    done: false,
    color: card.boardColor,
    where: card.boardName,
    href: `/b/${card.boardId}/c/${card.cardId}`,
  }));
}

/** The order within a day: the cards with no time first, then by time; then the Desk's before a board's, then by title. A total order, so it never flickers. */
export function byDay(a: Entry, b: Entry): number {
  if ((a.time === null) !== (b.time === null)) return a.time === null ? -1 : 1;
  if (a.time !== b.time) return (a.time ?? '') < (b.time ?? '') ? -1 : 1;
  if (a.source !== b.source) return a.source === 'desk' ? -1 : 1;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Entries by their date, each day's in order. */
export function groupByDate(entries: readonly Entry[]): Map<string, Entry[]> {
  const out = new Map<string, Entry[]>();
  for (const entry of entries) {
    const day = out.get(entry.date);
    if (day) day.push(entry);
    else out.set(entry.date, [entry]);
  }
  for (const day of out.values()) day.sort(byDay);
  return out;
}

/** One row of the feed: a day, or a run of empty days folded into one. */
export type Row =
  | { readonly kind: 'day'; readonly date: string; readonly entries: readonly Entry[] }
  | { readonly kind: 'gap'; readonly from: string; readonly to: string; readonly count: number };

/** The shortest run of empty days that is folded. */
export const FOLD_AT = 3;

/**
 * The feed's rows for `days`: a day with cards is a day; a run of `FOLD_AT` or more empty days is a gap, unless it holds a day that is in `open` (a run that is opened is named by its first day, and stays open as the window makes it longer at either end), and
 * **today and the day either side of it are never folded**, so the place the reader starts is always whole. Shorter runs are days, to add to.
 */
export function layout(
  days: readonly string[],
  byDate: ReadonlyMap<string, readonly Entry[]>,
  today: string,
  open: ReadonlySet<string> = new Set(),
): Row[] {
  const near = new Set([addDays(today, -1), today, addDays(today, 1)]);
  const rows: Row[] = [];
  let run: string[] = [];
  const flush = () => {
    const first = run[0];
    const last = run[run.length - 1];
    if (first !== undefined && last !== undefined) {
      if (run.length >= FOLD_AT && !run.some((date) => open.has(date)))
        rows.push({ kind: 'gap', from: first, to: last, count: run.length });
      else for (const date of run) rows.push({ kind: 'day', date, entries: [] });
    }
    run = [];
  };
  for (const date of days) {
    const entries = byDate.get(date) ?? [];
    if (entries.length === 0 && !near.has(date)) run.push(date);
    else {
      flush();
      rows.push({ kind: 'day', date, entries });
    }
  }
  flush();
  return rows;
}

/** "Wed", "3" and "Nov" for a date, in the locale's words: a date is floating, so it is read in UTC from its own year, month and day. */
export function dayParts(
  date: string,
  locale?: string,
): { weekday: string; day: string; month: string; year: string } {
  const at = new Date(`${date}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(at);
  return {
    weekday: part({ weekday: 'short' }),
    day: part({ day: 'numeric' }),
    month: part({ month: 'short' }),
    year: part({ year: 'numeric' }),
  };
}

/** "Mar 10 – 21" for a gap within a month, "Mar 28 – Apr 3" across months, with the year when it is not the one of `today`. */
export function gapLabel(from: string, to: string, today: string, locale?: string): string {
  const a = dayParts(from, locale);
  const b = dayParts(to, locale);
  const withYear = (date: string, p: { year: string }) =>
    date.slice(0, 4) === today.slice(0, 4) ? '' : `, ${p.year}`;
  if (from.slice(0, 7) === to.slice(0, 7))
    return `${a.month} ${a.day} – ${b.day}${withYear(to, b)}`;
  return `${a.month} ${a.day}${withYear(from, a)} – ${b.month} ${b.day}${withYear(to, b)}`;
}

/**
 * Where the line for "now" goes in today's entries (in the day's order): the index of the first timed card that is after `time`, or the length when every timed
 * card is before it. **Null when today has no timed card**, since a line needs something to be between. The cards with no time are before it, and a card at
 * exactly `time` is before the line.
 */
export function nowIndex(entries: readonly Entry[], time: string): number | null {
  if (!entries.some((entry) => entry.time !== null)) return null;
  const after = entries.findIndex((entry) => entry.time !== null && entry.time > time);
  return after === -1 ? entries.length : after;
}
