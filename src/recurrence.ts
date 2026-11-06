import { RRule } from 'rrule';

/**
 * Everything about a repeat rule (DESIGN.md §12.2, §12.3), in one file, and **the only one that imports `rrule`**, so that the package can be replaced.
 * Pure: no clock, no zone, no database. A date is `YYYY-MM-DD` and a rule is an RFC 5545 `RRULE` string without `DTSTART` and without the `RRULE:`
 * prefix, kept to a short allow-list (below), so that what a device sends and what a server stores is something this file can read.
 *
 * `rrule` works in UTC. **A date crosses into it only through `Date.UTC` and comes back only through `getUTC*`** (`toUtc`, `fromUtc`): through a local
 * `Date` a weekday moves by a day east of Greenwich. The tests run under three zones for that reason.
 *
 * A monthly or yearly rule on a day that some months lack (the 31st, the 29th of February) takes the months that have it, as RFC 5545 says: it never
 * lands on a day that is not the rule's, and it never lands on a date that does not exist.
 */

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** How a rule stops: never, on a date (inclusive), or after that many occurrences, the first being the anchor's own. */
export type RuleEnd =
  | { readonly kind: 'never' }
  | { readonly kind: 'until'; readonly date: string }
  | { readonly kind: 'count'; readonly count: number };

export interface Rule {
  readonly freq: Frequency;
  /** 1 to 999: every this many days, weeks, months or years. */
  readonly interval: number;
  /** Weekly only: the weekdays it falls on, Monday first and each once. Empty is the anchor's own weekday. */
  readonly byDay: readonly Weekday[];
  readonly end: RuleEnd;
}

export const LIMITS = { ruleChars: 200, interval: 999, count: 999 } as const;

/** Why a rule was refused: for a test and a log, never for a person to read. */
export type Refusal =
  | 'empty'
  | 'too_long'
  | 'syntax'
  | 'unknown_key'
  | 'duplicate_key'
  | 'freq'
  | 'interval'
  | 'byday'
  | 'byday_not_weekly'
  | 'end_both'
  | 'count'
  | 'until';

export type Parsed = { ok: true; rule: Rule } | { ok: false; reason: Refusal };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BASIC_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const INTEGER = /^[1-9]\d{0,2}$/;

/** A calendar date as a UTC midnight, or undefined if it is not a date (31 February included). */
function toUtc(date: string): Date | undefined {
  const match = DATE.exec(date) ?? BASIC_DATE.exec(date);
  if (!match) return undefined;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(y, m - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d)
    return undefined;
  return at;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A UTC midnight back as `YYYY-MM-DD`. */
function fromUtc(at: Date): string {
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** The weekday of a date, from the calendar and not from the machine's zone. */
export function weekdayOf(date: string): Weekday {
  const at = toUtc(date);
  if (!at) throw new RangeError('not a date');
  return WEEKDAYS[(at.getUTCDay() + 6) % 7] as Weekday;
}

const isWeekday = (value: string): value is Weekday =>
  (WEEKDAYS as readonly string[]).includes(value);
const isFrequency = (value: string): value is Frequency =>
  (FREQUENCIES as readonly string[]).includes(value);

/**
 * Reads a rule against the allow-list of §12.2: `FREQ` (daily to yearly), `INTERVAL` (1 to 999), `BYDAY` (plain weekdays, weekly only) and one of `UNTIL`
 * (`YYYYMMDD`) or `COUNT` (1 to 999), each at most once, in capitals, at most 200 characters. Nothing else: not `DTSTART`, not `BYHOUR`, not a number
 * before a weekday, not a prefix. **What is refused is refused whole;** there is no repair.
 */
export function parseRule(text: string): Parsed {
  if (text === '') return { ok: false, reason: 'empty' };
  if (text.length > LIMITS.ruleChars) return { ok: false, reason: 'too_long' };
  const seen = new Map<string, string>();
  for (const part of text.split(';')) {
    const at = part.indexOf('=');
    if (at <= 0 || at === part.length - 1) return { ok: false, reason: 'syntax' };
    const key = part.slice(0, at);
    if (!/^[A-Z]+$/.test(key)) return { ok: false, reason: 'syntax' };
    if (!['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT'].includes(key))
      return { ok: false, reason: 'unknown_key' };
    if (seen.has(key)) return { ok: false, reason: 'duplicate_key' };
    seen.set(key, part.slice(at + 1));
  }

  const freq = seen.get('FREQ');
  if (freq === undefined || !isFrequency(freq)) return { ok: false, reason: 'freq' };

  let interval = 1;
  const intervalText = seen.get('INTERVAL');
  if (intervalText !== undefined) {
    if (!INTEGER.test(intervalText)) return { ok: false, reason: 'interval' };
    interval = Number(intervalText);
  }

  const byDay: Weekday[] = [];
  const byDayText = seen.get('BYDAY');
  if (byDayText !== undefined) {
    if (freq !== 'WEEKLY') return { ok: false, reason: 'byday_not_weekly' };
    for (const day of byDayText.split(',')) {
      if (!isWeekday(day) || byDay.includes(day)) return { ok: false, reason: 'byday' };
      byDay.push(day);
    }
    byDay.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
  }

  const untilText = seen.get('UNTIL');
  const countText = seen.get('COUNT');
  if (untilText !== undefined && countText !== undefined) return { ok: false, reason: 'end_both' };
  let end: RuleEnd = { kind: 'never' };
  if (untilText !== undefined) {
    const at = BASIC_DATE.test(untilText) ? toUtc(untilText) : undefined;
    if (!at) return { ok: false, reason: 'until' };
    end = { kind: 'until', date: fromUtc(at) };
  }
  if (countText !== undefined) {
    if (!INTEGER.test(countText)) return { ok: false, reason: 'count' };
    end = { kind: 'count', count: Number(countText) };
  }
  return { ok: true, rule: { freq, interval, byDay, end } };
}

/** Whether text is a rule this file reads. The server's validator and the browser's are this one. */
export const isRule = (text: unknown): text is string =>
  typeof text === 'string' && parseRule(text).ok;

/** The rule as its one canonical string: what is stored, so that two devices that mean the same rule write the same text. */
export function formatRule(rule: Rule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length > 0) parts.push(`BYDAY=${rule.byDay.join(',')}`);
  if (rule.end.kind === 'until') parts.push(`UNTIL=${rule.end.date.replaceAll('-', '')}`);
  if (rule.end.kind === 'count') parts.push(`COUNT=${rule.end.count}`);
  return parts.join(';');
}

const isWeekdays = (rule: Rule) =>
  rule.freq === 'WEEKLY' && rule.interval === 1 && rule.byDay.join(',') === 'MO,TU,WE,TH,FR';

const UNITS: Record<Frequency, [one: string, many: string, every: string]> = {
  DAILY: ['day', 'days', 'Daily'],
  WEEKLY: ['week', 'weeks', 'Weekly'],
  MONTHLY: ['month', 'months', 'Monthly'],
  YEARLY: ['year', 'years', 'Yearly'],
};

/** The short form on a card: "Daily", "Weekdays", "Weekly", "Every 2 weeks". */
export function summary(rule: Rule): string {
  if (isWeekdays(rule)) return 'Weekdays';
  const [, many, every] = UNITS[rule.freq];
  return rule.interval === 1 ? every : `Every ${rule.interval} ${many}`;
}

const DAY_NAMES: Record<Weekday, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** The full form in the card's detail: "every week on Monday, Wednesday", "every 2 months, until Dec 31, 2027", "every day, 5 times". English. */
export function describe(rule: Rule): string {
  const [one, many] = UNITS[rule.freq];
  let text = isWeekdays(rule)
    ? 'every weekday'
    : rule.interval === 1
      ? `every ${one}`
      : `every ${rule.interval} ${many}`;
  if (rule.byDay.length > 0 && !isWeekdays(rule))
    text += ` on ${rule.byDay.map((day) => DAY_NAMES[day]).join(', ')}`;
  if (rule.end.kind === 'until') {
    const at = toUtc(rule.end.date);
    if (at)
      text += `, until ${MONTH_NAMES[at.getUTCMonth()]} ${at.getUTCDate()}, ${at.getUTCFullYear()}`;
  }
  if (rule.end.kind === 'count')
    text += rule.end.count === 1 ? ', once' : `, ${rule.end.count} times`;
  return text;
}

/** The `rrule` rule, counted from `anchor` (a UTC midnight): the one place the package is called. */
function engine(rule: Rule, anchor: Date): RRule | undefined {
  const weekly = rule.freq === 'WEEKLY';
  const days = rule.byDay.map((day) => RRule[day]);
  const until = rule.end.kind === 'until' ? toUtc(rule.end.date) : undefined;
  if (rule.end.kind === 'until' && !until) return undefined;
  return new RRule({
    freq: {
      DAILY: RRule.DAILY,
      WEEKLY: RRule.WEEKLY,
      MONTHLY: RRule.MONTHLY,
      YEARLY: RRule.YEARLY,
    }[rule.freq],
    interval: rule.interval,
    byweekday: weekly && days.length > 0 ? days : null,
    until: until ?? null,
    count: rule.end.kind === 'count' ? rule.end.count : null,
    dtstart: anchor,
  });
}

/**
 * The next occurrence of a series (§12.3): **the first one, counted from the anchor, after whichever is later, the card's due date or today.** A card
 * done late does not leave a trail of missed ones; a card done early does not get the one it was done for again. `due` is none for a card with no date.
 * Null when the rule has ended, or when the dates are not dates.
 */
export function nextOccurrence(input: {
  rule: Rule;
  anchor: string;
  due: string | null;
  today: string;
}): string | null {
  const anchor = toUtc(input.anchor);
  const today = toUtc(input.today);
  const due = input.due === null ? undefined : toUtc(input.due);
  if (!anchor || !today || (input.due !== null && !due)) return null;
  const after = due && due.getTime() > today.getTime() ? due : today;
  const next = engine(input.rule, anchor)?.after(after, false);
  return next ? fromUtc(next) : null;
}

/** For a repeat set on a card that has no date (§12.3): the first date the rule matches, from today on (today itself if it does). Null if it never does. */
export function firstOnOrAfter(rule: Rule, today: string): string | null {
  const start = toUtc(today);
  if (!start) return null;
  const next = engine(rule, start)?.after(start, true);
  return next ? fromUtc(next) : null;
}

/** The rule once the series has been moved to `newDate` (§12.4): a weekly rule on one weekday goes to the new date's weekday; any other is as it was. */
export function reanchor(rule: Rule, newDate: string): Rule {
  if (rule.freq !== 'WEEKLY' || rule.byDay.length !== 1) return rule;
  return { ...rule, byDay: [weekdayOf(newDate)] };
}
