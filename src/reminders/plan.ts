import { dueOf } from '../actions/due';
import { isCompleted } from '../actions/cards';
import type { LocalRow } from '../local/rows';
import { instantOf } from '../time';

/**
 * The times to tell the server (DESIGN.md §25.2, task 14.6), pure: from a Desk that was opened in the browser, **the instants at which an open card with a date and a time is
 * due, over the next fourteen days, to the minute, each once.** Two cards due together are one instant, and nothing about a card goes with it. A card that is done, or
 * deleted, or has no time, has none (the daily brief for such a Desk is not made: the server cannot count what it cannot read). The caller gives the rows already opened,
 * the zone the account's jobs use (the same, so that a reminder is at the time on the card where the person is) and the time now.
 */
export const PLAN_DAYS = 14;
/** The server holds no more than this many (`MAX_SLOTS`). */
export const PLAN_MAX = 700;

export function slotsFor(cards: readonly LocalRow[], zone: string, now: number): number[] {
  const last = now + PLAN_DAYS * 24 * 60 * 60 * 1000;
  const instants = new Set<number>();
  for (const card of cards) {
    if (card.table !== 'desk_card' || card.deletedAt !== null || isCompleted(card)) continue;
    const { date, time } = dueOf(card);
    if (date === null || time === null) continue;
    const at = instantOf(zone, date, time);
    // The minute now is still to come (the job wakes a little after it); what has passed is not told.
    if (at >= now - (now % 60_000) && at <= last) instants.add(at);
  }
  return [...instants].sort((a, b) => a - b).slice(0, PLAN_MAX);
}
