import { type Operator, openColumn, sealColumn } from '../crypto/operator';
import type { Database } from '../db/client';
import { tablesOf } from './tables';

/**
 * **The one boundary for a workspace's content** (DESIGN.md §9.5, task 14.7). Under `TUSK_DB_ENCRYPTION=on` every content column below holds ciphertext, sealed
 * with the instance key to its table, row and column; everything that reads or writes one goes through `seal` and `open` here, and nothing else touches the
 * key. With the mode off both return the value they were given, so a caller is the same code either way.
 *
 * **What stays readable** is what a query needs (§9.5): structure, positions, due dates, archive and delete times and colours, and a column that holds nothing:
 * `NULL` and the empty text are not sealed, so that "has a description" is still a question the database can answer.
 *
 * The ring is set once, at start-up (`configureOperator`), and kept on `globalThis`, because Next may bundle the routes apart from the file that starts the server
 * and a plain module variable would then be set in one copy and read in another. A test sets it for itself and puts it back.
 */
export const CONTENT_COLUMNS = {
  workspace: ['name'],
  board: ['name', 'description'],
  board_list: ['name'],
  card: ['title', 'description'],
  label: ['name'],
  checklist_item: ['title'],
  comment: ['body'],
  activity: ['details'],
  notice: ['details'],
} as const satisfies Record<string, readonly string[]>;

export type ContentTable = keyof typeof CONTENT_COLUMNS;

/**
 * Every text column of the workspace tables that is **not** content, with the table it is in: an id, a reference, a role, a kind, a position, a colour, a date or
 * a token. `operator.test.ts` asks the schema for its text columns and fails for one that is in neither this list nor `CONTENT_COLUMNS`, so a new column is a
 * decision made in this file, and not a plain value that was forgotten.
 */
export const STRUCTURAL_TEXT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  workspace: ['id', 'created_by'],
  workspace_member: ['workspace_id', 'account_id', 'role', 'added_by'],
  board: ['id', 'workspace_id', 'color', 'visibility', 'created_by'],
  board_member: ['board_id', 'account_id', 'workspace_id', 'role'],
  board_list: ['id', 'board_id', 'position'],
  card: [
    'id',
    'board_id',
    'list_id',
    'due_date',
    'due_time',
    'due_end',
    'reminded_for',
    'position',
    'created_by',
  ],
  label: ['id', 'board_id', 'color'],
  card_label: ['card_id', 'label_id', 'board_id'],
  card_assignee: ['card_id', 'account_id', 'board_id', 'assigned_by'],
  checklist_item: ['id', 'card_id', 'board_id', 'position'],
  comment: ['id', 'card_id', 'board_id', 'author_id'],
  activity: ['id', 'board_id', 'card_id', 'actor_id', 'kind'],
  publication: ['board_id', 'token', 'created_by'],
  notice: ['id', 'account_id', 'kind', 'actor_id', 'workspace_id', 'board_id', 'card_id'],
};

const KEY = Symbol.for('tusk.operator-ring');
type Holder = { [KEY]?: { ring: Operator } };
const holder = globalThis as unknown as Holder;

/** Sets the ring content is sealed with, or `undefined` for the mode off. Called once by the server at start-up, and by a test or a script that needs it. */
export function configureOperator(ring: Operator): void {
  holder[KEY] = { ring };
}

export const operatorRing = (): Operator => holder[KEY]?.ring;

const sealed = (value: string | null) => value !== null && value !== '';

/** A value to be stored: sealed to its table, row and column when the mode is on. `null` and the empty text are kept as they are. */
export function seal(
  table: ContentTable,
  id: string,
  column: string,
  value: string | null,
): string | null {
  const ring = operatorRing();
  if (!ring || !sealed(value)) return value;
  return sealColumn(ring, table, id, column, value as string);
}

/** A value read: opened when the mode is on. Throws for a value that is not this column's or whose key the server does not have, and never returns one wrong. */
export function open(
  table: ContentTable,
  id: string,
  column: string,
  value: string | null,
): string | null {
  const ring = operatorRing();
  if (!ring || !sealed(value)) return value;
  return openColumn(ring, table, id, column, value as string);
}

/** For the text columns that are not null: `open` for a value that is certainly there. */
export const openText = (table: ContentTable, id: string, column: string, value: string): string =>
  open(table, id, column, value) as string;
export const sealText = (table: ContentTable, id: string, column: string, value: string): string =>
  seal(table, id, column, value) as string;

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * Rows in the order of their (opened) name, then id, **for the mode that cannot ask the database**: sealed names sort as ciphertext, so with the mode on a
 * statement is ordered by id and the order of names is made here, over the rows it returned, and cut to `limit` after. With the mode off the rows are as the
 * database ordered them, and untouched.
 */
export function inNameOrder<T extends { id: string }>(
  rows: T[],
  nameOf: (row: T) => string,
  limit?: number,
): T[] {
  if (!operatorRing()) return rows;
  const sorted = [...rows].sort(
    (a, b) => collator.compare(nameOf(a), nameOf(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

/** The ordering and limit of a statement that lists by name: by name and id in the database, or by id alone when the mode is on (see `inNameOrder`). */
export const nameOrderSql = (column: string, idColumn: string): string =>
  operatorRing() ? `ORDER BY ${idColumn}` : `ORDER BY ${column}, ${idColumn}`;

const TABLE_KEY: Record<ContentTable, keyof ReturnType<typeof tablesOf>> = {
  workspace: 'workspace',
  board: 'board',
  board_list: 'boardList',
  card: 'card',
  label: 'label',
  checklist_item: 'checklistItem',
  comment: 'comment',
  activity: 'activity',
  notice: 'notice',
};

/** The schema's table of a content table's name, on the database's dialect: for the start-up check and the explicit move (`src/crypto/operator-data.ts`), which look at every one. */
export const contentTableOf = (database: Database, table: ContentTable) =>
  tablesOf(database)[TABLE_KEY[table]];
