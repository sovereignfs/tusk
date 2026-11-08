import { dueOf } from './actions/due';
import { isCompleted, isStarred } from './actions/cards';
import type { LocalRow } from './local/rows';

/**
 * **Today** (DESIGN.md §25.3), pure: what needs attention on the Desk, from the cards and the day. A card is in it once, **for the first reason that fits**:
 * overdue (due before today), due today, or starred. A card that is done, or deleted, or that Today was told to leave out for today (`dismissedOn` is today) is not.
 * The order is overdue oldest first, then due today by time (a card with no time after those that have one), then starred by title; the title and the id settle a tie, so
 * that two devices show the same order.
 *
 * It reads no clock: `today` is `YYYY-MM-DD` and `time` the time now as `HH:MM`, both given (`src/time.ts` makes them from the person's zone). **With a time, a card due
 * today at an hour that has passed is overdue**, as the Desk's rows say (§11); without one, a card due today is due today whatever the hour.
 */
export type Reason = 'overdue' | 'today' | 'starred';

export interface TodayCard {
  readonly card: LocalRow;
  readonly reason: Reason;
}

const ORDER: Record<Reason, number> = { overdue: 0, today: 1, starred: 2 };

const text = (card: LocalRow, name: string): string => {
  const field = card.fields[name];
  return field !== undefined && 'v' in field && typeof field.v === 'string' ? field.v : '';
};

/** The day Today was told to leave a card out of, or nothing. */
export const dismissedOn = (card: LocalRow): string | undefined => {
  const value = text(card, 'dismissedOn');
  return value === '' ? undefined : value;
};

/** Why a card is in Today, or `undefined` when it is not. */
export function reasonFor(card: LocalRow, today: string, time?: string): Reason | undefined {
  if (card.table !== 'desk_card' || card.deletedAt !== null || isCompleted(card)) return undefined;
  if (dismissedOn(card) === today) return undefined;
  const due = dueOf(card);
  if (due.date !== null) {
    if (due.date < today) return 'overdue';
    if (due.date === today) {
      if (time !== undefined && due.time !== null && due.time < time) return 'overdue';
      return 'today';
    }
  }
  return isStarred(card) ? 'starred' : undefined;
}

const compare = (a: TodayCard, b: TodayCard): number => {
  if (a.reason !== b.reason) return ORDER[a.reason] - ORDER[b.reason];
  const da = dueOf(a.card);
  const db = dueOf(b.card);
  if (a.reason !== 'starred') {
    if (da.date !== db.date) return (da.date ?? '') < (db.date ?? '') ? -1 : 1;
    if (a.reason === 'today' || da.date === db.date) {
      // By time, those with none after those with one.
      if (da.time !== db.time) {
        if (da.time === null) return 1;
        if (db.time === null) return -1;
        return da.time < db.time ? -1 : 1;
      }
    }
  }
  const ta = text(a.card, 'title').toLocaleLowerCase();
  const tb = text(b.card, 'title').toLocaleLowerCase();
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0;
};

export function buildToday(cards: readonly LocalRow[], today: string, time?: string): TodayCard[] {
  const out: TodayCard[] = [];
  for (const card of cards) {
    const reason = reasonFor(card, today, time);
    if (reason) out.push({ card, reason });
  }
  return out.sort(compare);
}
