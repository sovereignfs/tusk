import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { counter, epochMs, fields, hhmm, id, isoDate, position, ref } from './columns';

/**
 * What the server holds of an account that is not a task (DESIGN.md §22.3). The account itself is better-auth's, in the other store, so
 * `account_id` is a reference by value and not a foreign key. The columns of later tasks are added by their own migrations.
 */
export const accountSettings = sqliteTable('account_settings', {
  accountId: ref('account_id').primaryKey(),
  /** The account's change counter (§8.3): every applied mutation increments it, and rows are stamped with it. */
  seq: counter('seq').notNull().default(0),
  /** An IANA zone, for the jobs; the browser reports it (§12). */
  timeZone: text('time_zone').notNull().default('UTC'),
  createdAt: epochMs('created_at').notNull(),
});

/**
 * The three tables that sync (DESIGN.md §22.3). A row has the **structural columns the server uses** and a `fields` column it mostly does not: a
 * JSON map of field name to the field's value, plain or ciphertext, and the `seq` that last wrote it (`src/sync/format.ts` is the one definition).
 * Each has `owner_id`, which is the better-auth user id, a reference by value because it lives in the other store; there are no foreign keys, so
 * every deletion names what it deletes (`People.deletePerson`, task 2.8).
 *
 * - `seq`         the account's change counter at the last change to the row, which is what a device pulls by (§8.3).
 * - `deleted_at`  when it was deleted, or null. A deleted row stays for seven days so that Undo works and devices learn of it (§8.7).
 * - `created_at`  when the server first stored it.
 */
export const list = sqliteTable(
  'list',
  {
    id: id('id'),
    ownerId: ref('owner_id').notNull(),
    position: position('position').notNull(),
    deletedAt: epochMs('deleted_at'),
    seq: counter('seq').notNull(),
    createdAt: epochMs('created_at').notNull(),
    fields: fields('fields').notNull().default('{}'),
  },
  // Pull is the rows of an account past a cursor.
  (table) => [index('list_owner_seq_idx').on(table.ownerId, table.seq)],
);

/**
 * A task or a subtask (`parent_id` is set, to a top-level task of the same list). `due_date`, `due_time` and `completed_at` mirror their fields
 * for the reminder job, which the server fills in when it can read them and which stay null on an account with a key of its own (§22.3).
 */
export const task = sqliteTable(
  'task',
  {
    id: id('id'),
    ownerId: ref('owner_id').notNull(),
    listId: ref('list_id').notNull(),
    parentId: ref('parent_id'),
    position: position('position').notNull(),
    deletedAt: epochMs('deleted_at'),
    seq: counter('seq').notNull(),
    createdAt: epochMs('created_at').notNull(),
    reminderSentAt: epochMs('reminder_sent_at'),
    dueDate: isoDate('due_date'),
    dueTime: hhmm('due_time'),
    completedAt: epochMs('completed_at'),
    fields: fields('fields').notNull().default('{}'),
  },
  (table) => [index('task_owner_seq_idx').on(table.ownerId, table.seq)],
);

/** A repeating task's rule and anchor (§13.1). Its occurrences are ordinary tasks that point at it. */
export const series = sqliteTable(
  'series',
  {
    id: id('id'),
    ownerId: ref('owner_id').notNull(),
    listId: ref('list_id').notNull(),
    deletedAt: epochMs('deleted_at'),
    seq: counter('seq').notNull(),
    createdAt: epochMs('created_at').notNull(),
    fields: fields('fields').notNull().default('{}'),
  },
  (table) => [index('series_owner_seq_idx').on(table.ownerId, table.seq)],
);

/**
 * A mutation that was applied, so that sending it again changes nothing and is answered as it was (DESIGN.md §8.2, §8.3). Kept by account: one
 * account's mutation ids are nothing to another's, and a mutation id another account used is not an answer to anyone. Removed after 90 days (§8.7).
 */
export const appliedMutation = sqliteTable(
  'applied_mutation',
  {
    accountId: ref('account_id').notNull(),
    id: ref('id').notNull(),
    /** The `seq` the mutation was applied at, which is what a repeat is told. */
    seq: counter('seq').notNull(),
    appliedAt: epochMs('applied_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.id] })],
);

/**
 * What a row that was removed for good was, so that a device whose cursor is behind learns of it (§8.7). Written by the job that removes deleted
 * rows after seven days (task 13.7) and read by pull. Removed after 90 days, when a device that old is sent a fresh
 * snapshot instead.
 */
export const tombstone = sqliteTable(
  'tombstone',
  {
    tableName: ref('table_name').notNull(),
    id: ref('id').notNull(),
    accountId: ref('account_id').notNull(),
    seq: counter('seq').notNull(),
    deletedAt: epochMs('deleted_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tableName, table.id] }),
    index('tombstone_account_seq_idx').on(table.accountId, table.seq),
  ],
);

/**
 * Counts for rate limits, in the database so that a limit holds across every process (§7): a key, when its window began, and how many have been
 * counted in it (`src/limits/rate.ts`). Swept when a window is long over.
 */
export const rateBucket = sqliteTable(
  'rate_bucket',
  {
    key: id('key'),
    windowStart: epochMs('window_start').notNull(),
    count: counter('count').notNull(),
  },
  (table) => [index('rate_bucket_window_idx').on(table.windowStart)],
);
