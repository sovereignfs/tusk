import { isoDate } from '../access/parse';
import { addDays } from '../time';

/**
 * The range of days the Planner asks the server for (DESIGN.md §25.1, task 19.1): two real dates, the first not after the last, and at most `MAX_RANGE_DAYS` of
 * them (both ends counted), so that one read is never a whole year. Pure, and shared by the route and the screen.
 */
export const MAX_RANGE_DAYS = 62;

export type Range = { ok: true; from: string; to: string } | { ok: false };

export function parseRange(params: URLSearchParams): Range {
  const from = isoDate(params.get('from'));
  const to = isoDate(params.get('to'));
  if (!from.ok || !to.ok || from.value > to.value) return { ok: false };
  if (to.value > addDays(from.value, MAX_RANGE_DAYS - 1)) return { ok: false };
  return { ok: true, from: from.value, to: to.value };
}
