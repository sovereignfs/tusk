import { index, pgSchema, text } from 'drizzle-orm/pg-core';
import { APP_STORE } from '../../config';
import { counter, epochMs, fields, hhmm, id, isoDate, position, ref } from './columns';

/** The app's schema; better-auth's is `tasks_auth` (DESIGN.md §22.1). */
export const app = pgSchema(APP_STORE);

/** See `schema/sqlite/app.ts`. */
export const accountSettings = app.table('account_settings', {
  accountId: ref('account_id').primaryKey(),
  seq: counter('seq').notNull().default(0),
  timeZone: text('time_zone').notNull().default('UTC'),
  createdAt: epochMs('created_at').notNull(),
});

/** The three tables that sync; see `schema/sqlite/app.ts`, which says what each column is. */
export const list = app.table(
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

export const task = app.table(
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

export const series = app.table(
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
