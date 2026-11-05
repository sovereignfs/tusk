/**
 * What a device may send, and what the server stores (DESIGN.md §8.2, §22.3): **one definition, used by the browser before it queues a change and by
 * the server when it applies one.** Nothing here depends on the server, a browser or a database, so both can import it. `validate.ts` is the rules.
 *
 * A **mutation** is what one user action changes, applied once or not at all: its id makes replaying it harmless. It holds **changes**, each to one
 * row of one table, and a change carries only what changed: a field, not a row, which is what makes conflicts mostly vanish (§8.4).
 *
 * ```json
 * {
 *   "mutationId": "6f1c…",
 *   "changes": [
 *     { "table": "task", "id": "a3d9…", "listId": "7b20…", "position": "a1",
 *       "fields": { "title": { "v": "Water the plants" }, "completedAt": { "v": 1793000000000 } } }
 *   ]
 * }
 * ```
 */

/** Bumped when a device and the server stop understanding each other. A device that is too old is told to update; its outbox is kept (§8.3). */
export const PROTOCOL_VERSION = 1;

/** The tables that sync (§22.3). */
export const TABLES = ['list', 'task', 'series'] as const;
export type SyncTable = (typeof TABLES)[number];

/**
 * A plain field's value. Every field there is today is one of these; a field that holds more says so here, and in `validate.ts`, together.
 */
export type Scalar = string | number | boolean | null;

/** A field's value: `{ v }` plain, or `{ c }` ciphertext (§9). Everything above a field is the same either way. Exactly one of the two. */
export type FieldValue = { readonly v: Scalar } | { readonly c: string };

/** The fields a change sets, by name. */
export type Fields = Readonly<Record<string, FieldValue>>;

/**
 * The names of the fields each table has (§22.3). The server refuses any other, so a device cannot store what the app never reads. The first of each
 * is the one a new row cannot do without.
 */
export const FIELD_NAMES = {
  list: ['title', 'color', 'sort', 'showCompleted'],
  task: [
    'title',
    'notes',
    'starred',
    'dueDate',
    'dueTime',
    'seriesId',
    'completedAt',
    'reviewedAt',
    'dismissedOn',
  ],
  series: ['rule', 'anchor'],
} as const satisfies Record<SyncTable, readonly string[]>;

/**
 * What a change may say beyond its fields. Everything is optional, because an update says only what it changes; a *new* row must give the columns
 * its table needs (`validate.ts`, `creating`).
 *
 * - `deleted`  `true` deletes the row and `false` restores it. The server stamps the time, so a device's clock decides nothing about when a row goes.
 * - `listId`   the row's list. A subtask's is its parent's.
 * - `parentId` a top-level task, or `null`.
 * - `position` the row's place among its siblings (§11.3).
 *
 * **There is no `ownerId`, `seq` or `createdAt`:** who owns a row is the session's, not the device's (§7), and the order and the time are the
 * server's. A change that names one is refused, not ignored.
 */
interface Common {
  readonly id: string;
  readonly fields?: Fields;
  readonly deleted?: boolean;
}

export interface ListChange extends Common {
  readonly table: 'list';
  readonly position?: string;
}

export interface TaskChange extends Common {
  readonly table: 'task';
  readonly listId?: string;
  readonly parentId?: string | null;
  readonly position?: string;
}

export interface SeriesChange extends Common {
  readonly table: 'series';
  readonly listId?: string;
}

export type Change = ListChange | TaskChange | SeriesChange;

/** What one user action changes (§8.2). */
export interface Mutation {
  readonly mutationId: string;
  readonly changes: readonly Change[];
}

/** The structural columns a change may carry, by table. */
export const STRUCTURE = {
  list: ['position'],
  task: ['listId', 'parentId', 'position'],
  series: ['listId'],
} as const satisfies Record<SyncTable, readonly string[]>;

/** The structural columns a new row cannot do without; `parentId` is not here, since `null` is a top-level task. */
export const REQUIRED_ON_CREATE = {
  list: ['position'],
  task: ['listId', 'position'],
  series: ['listId'],
} as const satisfies Record<SyncTable, readonly string[]>;

/** The fields a new row cannot do without: a list and a task need a title, and a series a rule and where it starts. */
export const REQUIRED_FIELDS_ON_CREATE = {
  list: ['title'],
  task: ['title'],
  series: ['rule', 'anchor'],
} as const satisfies Record<SyncTable, readonly string[]>;

/**
 * Limits, so that one account cannot fill the server (§7). They hold for ciphertext as for text: the server cannot read it, but it can measure it.
 * Sizes are in characters of the JSON text.
 */
export const LIMITS = {
  /** Changes in one mutation. */
  changes: 500,
  /** Everything one mutation says, summed over its fields: a few full notes, or a great many titles. */
  mutationChars: 1_000_000,
  /** A position key: base 62 digits, and a long run of insertions makes a longer one. */
  positionChars: 64,
  /** A title, of a list or a task, in characters. */
  titleChars: 500,
  /** A task's notes, in characters. */
  notesChars: 20_000,
  /** A recurrence rule (RRULE), in characters (§13.2). */
  ruleChars: 200,
  /** Mutations in one request, so that one request is one short piece of work. */
  mutationsPerRequest: 20,
  /** What an account may have (§7). A deleted row counts until it is removed for good. */
  listsPerAccount: 200,
  tasksPerAccount: 50_000,
  /** A request body, in bytes: a mutation of a million characters is well within it, even if every character is escaped. */
  bodyBytes: 8 * 1024 * 1024,
  /** The rows a pull aims to return at once, and the most a device may ask for. */
  pullDefault: 1000,
  pullMax: 2000,
} as const;

/**
 * What a row's `fields` column holds: each field's value and **the `seq` that last wrote it** (§22.2), which is how two devices' changes to
 * different fields both stand and the later of two to one field wins (§8.4).
 */
export type StoredField = FieldValue & { readonly s: number };
export type StoredFields = Readonly<Record<string, StoredField>>;

/** The text of a `fields` column. Plain and ciphertext alike, and in the same form on all three databases (§22.2). */
export function encodeFields(fields: StoredFields): string {
  return JSON.stringify(fields);
}

/**
 * The request a device makes to `POST /api/sync` (DESIGN.md §8.3): the protocol it speaks, how far it has pulled, and the mutations it has not had
 * answered. At most `LIMITS.mutationsPerRequest`, in the order they were made.
 */
export interface SyncRequest {
  readonly protocol: number;
  /** The `seq` the device has pulled to; zero for a device that has nothing, which is the snapshot (§8.5). */
  readonly cursor: number;
  readonly mutations: readonly unknown[];
  /** How many rows the answer may carry, about; a page ends at a `seq`, so a page may carry a few more. */
  readonly limit?: number;
}

/**
 * Why a mutation was not applied. None says more than the device needs, and none says whether a row belongs to someone else.
 *
 * - `invalid`      it is not a mutation (`validate.ts`), or a value in it is not allowed.
 * - `unavailable`  a row, or a list or parent it points at, is not there for this account: the same answer whether it does not exist or is another's.
 * - `structure`    it would break the shape of the data: a subtask of a subtask, a parent in another list, a subtask left behind in a moved task's list.
 * - `limit`        the account has as many lists or tasks as it may.
 */
export type RefusalCode = 'invalid' | 'unavailable' | 'structure' | 'limit';

/** The answer to one mutation, in the order the request had them. `mutationId` is null when the mutation was too malformed to have one. */
export type MutationResult =
  | { readonly mutationId: string; readonly status: 'applied'; readonly seq: number }
  | { readonly mutationId: string | null; readonly status: 'refused'; readonly code: RefusalCode };

/** A row as a device is sent it. Mirrors and the owner are the server's and are not sent. */
interface RowBase {
  readonly id: string;
  /** Null for a row that is not deleted. */
  readonly deletedAt: number | null;
  readonly seq: number;
  readonly createdAt: number;
  readonly fields: StoredFields;
}
export type PulledRow =
  | (RowBase & { readonly table: 'list'; readonly position: string })
  | (RowBase & {
      readonly table: 'task';
      readonly listId: string;
      readonly parentId: string | null;
      readonly position: string;
    })
  | (RowBase & { readonly table: 'series'; readonly listId: string });

/** A row that was removed for good (§8.7). */
export interface PulledTombstone {
  readonly table: SyncTable;
  readonly id: string;
  readonly seq: number;
}

/** What changed since a cursor, up to a point that is the same for every table, so that a cursor never skips a row. */
export interface Pull {
  /** Where the device is up to now: the `seq` of the last thing in this page, or the cursor it sent if there was nothing. */
  readonly cursor: number;
  /** There may be more past `cursor`: ask again. */
  readonly more: boolean;
  readonly rows: readonly PulledRow[];
  readonly tombstones: readonly PulledTombstone[];
}

export interface SyncResponse {
  readonly protocol: number;
  readonly results: readonly MutationResult[];
  readonly pull: Pull;
}
