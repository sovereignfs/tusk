/**
 * The one idea of "today" (DESIGN.md §11), used on the Desk and on boards, in the browser and by jobs. **Dates are `YYYY-MM-DD` strings and times `HH:MM`
 * throughout, and no `Date` crosses a boundary:** a due date is floating, written as on a calendar and in no zone, so that it compares as a string and
 * is the same for everyone who sees it. A zone is an IANA name; the browser's is its own, and the server's is `account_settings.time_zone`, which the
 * browser reports. An invalid zone is UTC. Pure: the time is given and never read, so a test controls it.
 */
export const FALLBACK_ZONE = 'UTC';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `zone` is a zone this runtime knows. */
export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone === '' || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The zone to use: `zone` if it is one, and UTC if not. */
export const zoneOrUtc = (zone: unknown): string => (isValidZone(zone) ? zone : FALLBACK_ZONE);

export interface LocalNow {
  /** `YYYY-MM-DD` */
  readonly date: string;
  /** `HH:MM`, 24 hours */
  readonly time: string;
}

/** The calendar date and clock time it is in `zone` at `epochMs`. `hourCycle: 'h23'`, so midnight is `00`, never `24`. */
export function localNow(zone: string, epochMs: number): LocalNow {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zoneOrUtc(zone),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/** Today's date in `zone` at `now` (milliseconds since the epoch). */
export const todayFor = (zone: string, now: number): string => localNow(zone, now).date;

/** `date` moved by `days` (negative goes back), by the calendar: no zone and no daylight saving come into it. Throws on a date that is not one. */
export function addDays(date: string, days: number): string {
  const match = DATE.exec(date);
  if (!match) throw new RangeError('not a date');
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  // `Date.UTC` rolls 31 February into March: a date that did not round-trip was not a date.
  const back = new Date(Date.UTC(y, m - 1, d));
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d)
    throw new RangeError('not a date');
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** The browser's own zone, or UTC where it will not say. Browser only. */
export function browserZone(): string {
  try {
    return zoneOrUtc(new Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return FALLBACK_ZONE;
  }
}

/** The date and time it is now in the browser's own zone: what "today" and "overdue" are measured against on a screen. Browser only. */
export const nowHere = (): LocalNow => localNow(browserZone(), Date.now());
