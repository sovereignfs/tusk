import { FILTERS } from '../lists/filter';
import { isRule } from '../recurrence';
import { HEX_COLOR } from '../lists/colors';
import {
  type Parsed,
  type Parser,
  bool,
  integer,
  isoDate,
  hhmm,
  nullable,
  oneOf,
  text,
  uuid,
} from '../access/parse';
import {
  type Change,
  type FieldValue,
  LIMITS,
  type Mutation,
  REQUIRED_FIELDS_ON_CREATE,
  REQUIRED_ON_CREATE,
  type Scalar,
  STRUCTURE,
  type RowFields,
  type SyncTable,
  TABLES,
} from './format';

/**
 * The rules for what `format.ts` describes (DESIGN.md §8.2), **in one module, run in both places**: in the browser before a change is queued, so a
 * person is told at once and nothing the server would refuse is ever sent, and on the server for everything it receives. Pure: no clock, no
 * database, nothing global.
 *
 * Two layers, because the server can read a field only on some accounts (§9):
 *
 *  - **Structure**, which the server always checks, whatever the mode: the shape of a mutation and of a change, ids that are ids, a position that
 *    is a position, fields that are fields of the table, a value that is plain or ciphertext and within its size. `parseStructure`.
 *  - **Content**, which it checks when it can read: a title of 1 to 500 characters, a date that exists. `parseField`, and `parseStructure` and
 *    `parseMutation` call it for a plain value, unless they are told the account takes none (`plain: 'refuse'`).
 *
 * Every parser answers with a result; a reason never contains the input.
 */

const no = (reason: string): Parsed<never> => ({ ok: false, reason });
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });

/** The latest moment a JavaScript date can name, in milliseconds: the bound of every time stored as a number. */
const MAX_EPOCH_MS = 8_640_000_000_000_000;
const epochMs = integer(0, MAX_EPOCH_MS);

/** A colour: `#rrggbb` in lower case, which is what the colour picker writes (`src/lists/colors.ts`). */
const color: Parser<string> = (value) =>
  typeof value === 'string' && HEX_COLOR.test(value) ? ok(value) : no('not a colour');

/** The four orders a list can be shown in (§10.5); its colours are `lists/colors.ts`'s. */
const SORTS = ['custom', 'created', 'due', 'title'] as const;

/**
 * A position key: the digits of base 62, which is what the fractional index writes (§10.4, §23.2). Only the alphabet and the length are checked
 * here; that it sorts between its neighbours is the position module's (task 3.2).
 */
const position: Parser<string> = (value) =>
  typeof value === 'string' && /^[0-9A-Za-z]+$/.test(value) && value.length <= LIMITS.positionChars
    ? ok(value)
    : no('not a position');

interface FieldSpec {
  /** The rule for the plain value. */
  readonly plain: Parser<Scalar>;
  /** The longest the plain value's text can be, which bounds the ciphertext of it as well. */
  readonly chars: number;
}

/** A plain rule is one `src/recurrence.ts` reads; one that is ciphertext cannot be checked, and is only measured. */
const ruleText: Parser<Scalar> = (value) =>
  typeof value === 'string' && isRule(value) ? ok(value) : no('not a repeat rule');

/** The text of a wrapped list key: base64url, and short. It is the one field that is never ciphertext. */
const WRAPPED_KEY_CHARS = 600;
const wrappedKey: Parser<Scalar> = (value) =>
  typeof value === 'string' &&
  value.length >= 100 &&
  value.length <= WRAPPED_KEY_CHARS &&
  /^[A-Za-z0-9_-]+$/.test(value)
    ? ok(value)
    : no('not a wrapped key');

/** The fields that are structure and not content (§9.2): plain on every account, because they are what the server and a new device need to read. */
export const STRUCTURAL_FIELDS: Partial<Record<SyncTable, readonly string[]>> = {
  desk_list: ['key'],
};
const isStructural = (table: SyncTable, name: string): boolean =>
  STRUCTURAL_FIELDS[table]?.includes(name) === true;

const TITLE: FieldSpec = { plain: text(1, LIMITS.titleChars), chars: LIMITS.titleChars };
/** A field whose value is short whatever it holds: a flag, a date, a time, an id, a word, a number. */
const SHORT = 64;
const short = (plain: Parser<Scalar>): FieldSpec => ({ plain, chars: SHORT });

/** What each field of each table holds (§23.3). **Every field in `FIELD_NAMES` has a rule, and a test holds the two together.** */
const FIELDS: Record<SyncTable, Record<string, FieldSpec>> = {
  desk_list: {
    title: TITLE,
    color: short(color),
    sort: short(oneOf(...SORTS)),
    showCompleted: short(bool),
    filter: short(oneOf(...FILTERS)),
    // A list key wrapped to an age recipient (§9.2): an age file as base64url, about 330 characters.
    key: { plain: wrappedKey, chars: WRAPPED_KEY_CHARS },
  },
  desk_card: {
    title: TITLE,
    description: { plain: text(0, LIMITS.descriptionChars), chars: LIMITS.descriptionChars },
    starred: short(bool),
    dueDate: short(nullable(isoDate)),
    dueTime: short(nullable(hhmm)),
    dueEnd: short(nullable(hhmm)),
    seriesId: short(nullable(uuid)),
    startedAt: short(nullable(epochMs)),
    completedAt: short(nullable(epochMs)),
    dismissedOn: short(nullable(isoDate)),
    reviewedAt: short(nullable(epochMs)),
  },
  desk_check: {
    title: TITLE,
    completedAt: short(nullable(epochMs)),
  },
  // A rule is an RRULE string held to the allow-list of §12.2 (`src/recurrence.ts`), the one the browser reads it with.
  desk_series: {
    rule: { plain: ruleText, chars: LIMITS.ruleChars },
    anchor: short(isoDate),
  },
};

/**
 * The longest the ciphertext of a value can be. A character is at most four bytes of UTF-8, the cipher adds a header and a tag, and base64 makes
 * three bytes four characters; this is that, rounded up. A limit a little above what is possible is no weaker than one at it, and one below would
 * refuse a person's own words.
 */
function cipherChars(plainChars: number): number {
  return Math.ceil(((plainChars * 4 + 256) * 4) / 3);
}

/** The base64 and base64url alphabets, with padding. Task 14.1 fixes the cipher's own form; if it needs more, this is where it widens. */
const CIPHERTEXT = /^[A-Za-z0-9+/_-]+={0,2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** The own keys of a record that are not among `allowed`. */
const stray = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).some((key) => !allowed.includes(key));

function specOf(table: SyncTable, name: string): FieldSpec | undefined {
  const fields = FIELDS[table];
  return Object.hasOwn(fields, name) ? fields[name] : undefined;
}

/** How a field's value is written, and how big, without reading what it says. Plain or ciphertext, and nothing else. */
function parseShape(table: SyncTable, name: string, value: unknown): Parsed<FieldValue> {
  const spec = specOf(table, name);
  if (!spec) return no('not a field of this table');
  if (!isRecord(value)) return no('a field is { v } or { c }');
  const keys = Object.keys(value);
  if (keys.length !== 1) return no('a field is { v } or { c }, and not both');

  if (keys[0] === 'c') {
    if (isStructural(table, name)) return no('a structural field is never ciphertext');
    const cipher = value.c;
    if (typeof cipher !== 'string') return no('ciphertext is text');
    if (cipher.length === 0) return no('ciphertext is empty');
    if (cipher.length > cipherChars(spec.chars)) return no('ciphertext is too long');
    if (!CIPHERTEXT.test(cipher)) return no('ciphertext is not in the alphabet');
    return ok({ c: cipher });
  }
  if (keys[0] === 'v') {
    const plain = value.v;
    if (
      plain !== null &&
      typeof plain !== 'string' &&
      typeof plain !== 'number' &&
      typeof plain !== 'boolean'
    ) {
      return no('a plain value is text, a number, true or false, or null');
    }
    // Bounded before anything reads it, so that a long string is not walked for nothing.
    if (typeof plain === 'string' && plain.length > spec.chars * 2) return no('too long');
    return ok({ v: plain });
  }
  return no('a field is { v } or { c }');
}

/**
 * A field of a table, whole: how it is written and, for a plain value, what it says. Ciphertext is checked for its form and size only, since
 * nothing else of it can be known (§9.4). Used in the browser before a change is queued and by the server when it can read.
 */
export function parseField(table: SyncTable, name: string, value: unknown): Parsed<FieldValue> {
  const shaped = parseShape(table, name, value);
  if (!shaped.ok || !('v' in shaped.value)) return shaped;
  const spec = specOf(table, name);
  const content = spec ? spec.plain(shaped.value.v) : no('not a field of this table');
  return content.ok ? shaped : no(`${name}: ${content.reason}`);
}

export interface ChangeOptions {
  /**
   * The row is new, so the columns and fields it cannot do without must be there. The server knows after it has looked the row up; a device
   * need not say.
   */
  creating?: boolean;
  /**
   * `check` (the default) holds a plain value to the rule for its field. `refuse` turns it away: an account with a key of its own sends no plain
   * field, and none ever reaches the server (§9.4).
   */
  plain?: 'check' | 'refuse';
}

/** The structure of one change, and with it the content of its plain fields unless told otherwise (see `ChangeOptions`). */
export function parseStructure(value: unknown, options: ChangeOptions = {}): Parsed<Change> {
  const { creating = false, plain = 'check' } = options;
  if (!isRecord(value)) return no('a change is an object');

  const table = value.table;
  if (typeof table !== 'string' || !(TABLES as readonly string[]).includes(table)) {
    return no('not a table that syncs');
  }
  const kind = table as SyncTable;
  if (stray(value, ['table', 'id', 'fields', 'deleted', ...STRUCTURE[kind]])) {
    return no('a change names something a device may not set');
  }

  const id = uuid(value.id);
  if (!id.ok) return no('id: not an id');

  const out: Record<string, unknown> = { table: kind, id: id.value };
  const structural: Record<string, Parser<unknown>> = {
    listId: uuid,
    cardId: uuid,
    position,
  };
  for (const key of STRUCTURE[kind]) {
    if (!Object.hasOwn(value, key)) continue;
    const parsed = structural[key]?.(value[key]);
    if (!parsed?.ok) return no(`${key}: not allowed`);
    out[key] = parsed.value;
  }

  if (Object.hasOwn(value, 'deleted')) {
    const deleted = bool(value.deleted);
    if (!deleted.ok) return no('deleted: not true or false');
    out.deleted = deleted.value;
  }

  const fields: Record<string, FieldValue> = {};
  if (Object.hasOwn(value, 'fields')) {
    if (!isRecord(value.fields)) return no('fields: not an object');
    for (const name of Object.keys(value.fields)) {
      // A structural field is plain whatever the account takes, and held to its rule.
      const shaped =
        plain === 'refuse' && !isStructural(kind, name)
          ? parseShape(kind, name, value.fields[name])
          : parseField(kind, name, value.fields[name]);
      // A name is repeated in the reason only if it is one of ours: a device chose the others, and they are not ours to echo.
      const label = specOf(kind, name) ? name : 'fields';
      if (!shaped.ok) return no(`${label}: ${shaped.reason}`);
      if (plain === 'refuse' && 'v' in shaped.value && !isStructural(kind, name))
        return no(`${name}: this account sends no plain content`);
      fields[name] = shaped.value;
    }
    if (Object.keys(fields).length > 0) out.fields = fields;
  }

  // There is no time without a date (DESIGN.md §11). A change says both together (`actions/due.ts`), so a time given with no date, or with a date that is
  // none, is not one an action made. A date that is ciphertext cannot be read, and is taken to be there.
  if (kind === 'desk_card') {
    const time = fields.dueTime;
    const date = fields.dueDate;
    if (time && 'v' in time && time.v !== null) {
      const dated = date !== undefined && ('c' in date || date.v !== null);
      if (!dated) return no('dueTime: a time needs a date');
    }
    // Nor an end without a start, nor one that is not after it (task 19.5). A start that is ciphertext cannot be compared, and is taken to be there and
    // before it: a device that seals its Desk checked it before sealing.
    const end = fields.dueEnd;
    if (end && 'v' in end && end.v !== null) {
      const timed = time !== undefined && ('c' in time || time.v !== null);
      if (!timed) return no('dueEnd: an end needs a time');
      if (time && 'v' in time && time.v !== null && end.v <= time.v)
        return no('dueEnd: an end must be after the time');
    }
  }

  if (creating) {
    for (const key of REQUIRED_ON_CREATE[kind])
      if (!Object.hasOwn(out, key)) return no(`${key}: a new row needs it`);
    for (const name of REQUIRED_FIELDS_ON_CREATE[kind])
      if (!Object.hasOwn(fields, name)) return no(`${name}: a new row needs it`);
  } else if (Object.keys(out).length === 2) {
    return no('a change that changes nothing');
  }

  return ok(out as unknown as Change);
}

export interface MutationOptions {
  plain?: ChangeOptions['plain'];
}

/**
 * A mutation: its id, and from one to 500 changes that say at most a million characters between them (`LIMITS`). One bad change refuses the
 * whole mutation, because a mutation is what one action changes and half of it would be a state no action made.
 */
export function parseMutation(value: unknown, options: MutationOptions = {}): Parsed<Mutation> {
  if (!isRecord(value)) return no('a mutation is an object');
  if (stray(value, ['mutationId', 'changes']))
    return no('a mutation names something a device may not set');

  const mutationId = uuid(value.mutationId);
  if (!mutationId.ok) return no('mutationId: not an id');

  const list = value.changes;
  if (!Array.isArray(list)) return no('changes: not a list');
  if (list.length === 0) return no('changes: none');
  if (list.length > LIMITS.changes) return no(`changes: more than ${LIMITS.changes}`);

  const changes: Change[] = [];
  let chars = 0;
  for (const each of list) {
    const parsed = parseStructure(each, options.plain ? { plain: options.plain } : {});
    if (!parsed.ok) return no(`changes: ${parsed.reason}`);
    chars += sizeOf(parsed.value);
    if (chars > LIMITS.mutationChars) return no('too large');
    changes.push(parsed.value);
  }
  return ok({ mutationId: mutationId.value, changes });
}

/** What a change says, in characters, counted from its parsed (and so bounded) fields. A row's own ids and keys are a fixed cost, counted as 200. */
function sizeOf(change: Change): number {
  let size = 200;
  for (const field of Object.values(change.fields ?? {})) {
    size += 'c' in field ? field.c.length : String(JSON.stringify(field.v)).length;
  }
  return size;
}

/** The text of a `fields` column back into what it holds, or why it cannot be: a row the server wrote is trusted, but not so far that a bad one crashes a pull. */
export function decodeFields(textValue: string): Parsed<RowFields> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(textValue);
  } catch {
    return no('not JSON');
  }
  if (!isRecord(parsed)) return no('not a map of fields');
  const out: Record<string, RowFields[string]> = {};
  for (const [name, entry] of Object.entries(parsed)) {
    if (!isRecord(entry) || stray(entry, ['v', 'c', 'o', 's']))
      return no('a field is { v, c or o, s }');
    const s = entry.s;
    if (typeof s !== 'number' || !Number.isSafeInteger(s) || s < 0) {
      return no('a field has the seq that wrote it');
    }
    const hasV = Object.hasOwn(entry, 'v');
    if (Object.hasOwn(entry, 'o')) {
      // The operator's: sealed by the server, and the only one of the three that is.
      if (hasV || Object.hasOwn(entry, 'c') || typeof entry.o !== 'string')
        return no('a field is { o } alone');
      out[name] = { o: entry.o, s };
      continue;
    }
    if (hasV === Object.hasOwn(entry, 'c')) return no('a field is { v } or { c }');
    if (hasV) {
      const v = entry.v;
      if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        return no('a plain value is a scalar');
      }
      out[name] = { v, s };
    } else {
      if (typeof entry.c !== 'string') return no('ciphertext is text');
      out[name] = { c: entry.c, s };
    }
  }
  return ok(out);
}
