/**
 * Input is parsed at the edge (DESIGN.md §7): what comes in from a request, or from a device, is `unknown` until a parser has said what it is, and
 * a value that has not passed one reaches no statement. Small functions with no dependency, so that the browser uses the same ones to check a change
 * before it is queued (DESIGN.md §8.2) and the server uses them on what it receives.
 *
 * A parser answers with a result and not a throw, so that a caller must look at it, and **its reason never contains the input**: a reason is for a
 * response or a log, and what a hostile client sent is neither.
 */
export type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

export type Parser<T> = (value: unknown) => Parsed<T>;

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const no = (reason: string): Parsed<never> => ({ ok: false, reason });

/** The longest list of ids a request may name (DESIGN.md §7: bulk actions, a pull's tombstones). */
export const MAX_IDS = 500;

/** Lower case, in the canonical 8-4-4-4-12 form, of a version from 1 to 8 and the RFC variant: what `crypto.randomUUID()` makes. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * An id (DESIGN.md §8.2: made by the client). **Only the canonical lower-case form**, since two spellings of one id would be two rows to a
 * database that compares text.
 */
export const uuid: Parser<string> = (value) =>
  typeof value === 'string' && UUID.test(value) ? ok(value) : no('not an id');

/**
 * Text of `min` to `max` characters, counted as a person counts them (a letter outside the basic plane is one). No NUL: PostgreSQL refuses it in
 * text, so it would be an error from the database and not from us. A line break is allowed; a field that must not have one says so itself.
 */
export function text(min: number, max: number): Parser<string> {
  return (value) => {
    if (typeof value !== 'string') return no('not text');
    // A cheap bound first, so that a huge string is not walked: no string with more code units than `max * 2` is within `max` characters.
    if (value.length > max * 2) return no(`longer than ${max} characters`);
    if (value.includes('\u0000')) return no('contains a character that is not allowed');
    const length = [...value].length;
    if (length < min) return no(min === 1 ? 'empty' : `shorter than ${min} characters`);
    if (length > max) return no(`longer than ${max} characters`);
    return ok(value);
  };
}

/** A calendar date, `YYYY-MM-DD`, that exists (not the 30th of February), in no time zone (DESIGN.md §12). */
export const isoDate: Parser<string> = (value) => {
  if (typeof value !== 'string') return no('not a date');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return no('not a date');
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1) return no('not a date');
  return day <= daysIn(month, year) ? ok(value) : no('not a date');
};

/** A time of day, `HH:MM` on a 24-hour clock, in no time zone (DESIGN.md §12). */
export const hhmm: Parser<string> = (value) =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? ok(value)
    : no('not a time');

/** A list of ids, at most `max` (500 by default), each one an id. The list may be empty. It is not de-duplicated: that is for the caller who minds. */
export function idArray(max: number = MAX_IDS): Parser<string[]> {
  return (value) => {
    if (!Array.isArray(value)) return no('not a list');
    if (value.length > max) return no(`more than ${max} ids`);
    const out: string[] = [];
    for (const each of value) {
      const parsed = uuid(each);
      if (!parsed.ok) return no('a list that holds something that is not an id');
      out.push(parsed.value);
    }
    return ok(out);
  };
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysIn(month: number, year: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `true` or `false`, and nothing that merely behaves like one. */
export const bool: Parser<boolean> = (value) =>
  typeof value === 'boolean' ? ok(value) : no('not true or false');

/** A whole number from `min` to `max`, both included. A string that looks like one is not one. */
export function integer(min: number, max: number): Parser<number> {
  return (value) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
      ? ok(value)
      : no('not a whole number in range');
}

/** One of a fixed list of words. */
export function oneOf<T extends string>(...words: readonly T[]): Parser<T> {
  return (value) =>
    typeof value === 'string' && (words as readonly string[]).includes(value)
      ? ok(value as T)
      : no('not one of the allowed words');
}

/** What `parser` takes, or null. */
export function nullable<T>(parser: Parser<T>): Parser<T | null> {
  return (value) => (value === null ? ok(null) : parser(value));
}
