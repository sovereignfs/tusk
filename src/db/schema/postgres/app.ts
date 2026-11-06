import { index, pgSchema, primaryKey, text } from 'drizzle-orm/pg-core';
import { APP_STORE } from '../../config';
import { counter, epochMs, fields, hhmm, id, isoDate, position, ref } from './columns';

/** The app's schema; better-auth's is `tusk_auth` (DESIGN.md §22.1). */
export const app = pgSchema(APP_STORE);

/** See `schema/sqlite/app.ts`. */
export const accountSettings = app.table('account_settings', {
  accountId: ref('account_id').primaryKey(),
  seq: counter('seq').notNull().default(0),
  timeZone: text('time_zone').notNull().default('UTC'),
  /**
   * The highest `seq` of any tombstone that was removed for being old (DESIGN.md §8.7). A device whose cursor is below it may have missed a purge whose
   * tombstone is gone, and takes a fresh snapshot instead of a pull.
   */
  prunedThrough: counter('pruned_through').notNull().default(0),
  /**
   * How the boards index sorts the person's own workspaces: `name`, `created` or `updated` (DESIGN.md §17.3). Saved with the account so that it is the same on
   * every device (§19).
   */
  workspaceSort: text('workspace_sort').notNull().default('name'),
  /**
   * When the person last opened their Inbox (DESIGN.md §16): the notices newer than this are unread, on every device. Zero until they have.
   */
  inboxSeenAt: epochMs('inbox_seen_at').notNull().default(0),
  /** The kinds of notice the person has turned off (§19), comma-separated; a kind turned off is not written. Empty: none. */
  noticesOff: text('notices_off').notNull().default(''),
  createdAt: epochMs('created_at').notNull(),
});

/** The four tables that sync; see `schema/sqlite/app.ts`, which says what each column is. */
export const deskList = app.table(
  'desk_list',
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
  (table) => [index('desk_list_owner_seq_idx').on(table.ownerId, table.seq)],
);

/** See `schema/sqlite/app.ts`. */
export const deskCard = app.table(
  'desk_card',
  {
    id: id('id'),
    ownerId: ref('owner_id').notNull(),
    listId: ref('list_id').notNull(),
    position: position('position').notNull(),
    deletedAt: epochMs('deleted_at'),
    seq: counter('seq').notNull(),
    createdAt: epochMs('created_at').notNull(),
    dueDate: isoDate('due_date'),
    dueTime: hhmm('due_time'),
    completedAt: epochMs('completed_at'),
    fields: fields('fields').notNull().default('{}'),
  },
  (table) => [index('desk_card_owner_seq_idx').on(table.ownerId, table.seq)],
);

/** See `schema/sqlite/app.ts`. */
export const deskCheck = app.table(
  'desk_check',
  {
    id: id('id'),
    ownerId: ref('owner_id').notNull(),
    cardId: ref('card_id').notNull(),
    position: position('position').notNull(),
    deletedAt: epochMs('deleted_at'),
    seq: counter('seq').notNull(),
    createdAt: epochMs('created_at').notNull(),
    fields: fields('fields').notNull().default('{}'),
  },
  (table) => [index('desk_check_owner_seq_idx').on(table.ownerId, table.seq)],
);

/** See `schema/sqlite/app.ts`. */
export const deskSeries = app.table(
  'desk_series',
  {
    id: id('id'),
    ownerId: ref('owner_id').notNull(),
    listId: ref('list_id').notNull(),
    deletedAt: epochMs('deleted_at'),
    seq: counter('seq').notNull(),
    createdAt: epochMs('created_at').notNull(),
    fields: fields('fields').notNull().default('{}'),
  },
  (table) => [index('desk_series_owner_seq_idx').on(table.ownerId, table.seq)],
);

/** See `schema/sqlite/app.ts`. */
export const appliedMutation = app.table(
  'applied_mutation',
  {
    accountId: ref('account_id').notNull(),
    id: ref('id').notNull(),
    seq: counter('seq').notNull(),
    appliedAt: epochMs('applied_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.id] })],
);

/** See `schema/sqlite/app.ts`. */
export const tombstone = app.table(
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

/** See `schema/sqlite/app.ts`. */
export const rateBucket = app.table(
  'rate_bucket',
  {
    key: id('key'),
    windowStart: epochMs('window_start').notNull(),
    count: counter('count').notNull(),
  },
  (table) => [index('rate_bucket_window_idx').on(table.windowStart)],
);

/** See `schema/sqlite/app.ts`. */
export const credential = app.table(
  'credential',
  {
    id: id('id'),
    accountId: ref('account_id').notNull(),
    purpose: text('purpose').notNull(),
    sealed: text('sealed').notNull(),
    keyFingerprint: text('key_fingerprint').notNull(),
    createdAt: epochMs('created_at').notNull(),
    updatedAt: epochMs('updated_at').notNull(),
  },
  (table) => [
    index('credential_account_idx').on(table.accountId),
    index('credential_key_idx').on(table.keyFingerprint),
  ],
);

/**
 * The repository an account backs up to (DESIGN.md §21), one per account. **The credential is not here:** `credential_id` names the sealed token in
 * `credential` (`src/crypto/`), so this row can be read, logged and exported by the same code that touches nothing secret. `kind` is how it was connected
 * (`token`; `app` with task 10.7); `repository` is `owner/name` and `branch` the default branch it was found to have. The columns for the backups themselves
 * (mode, times, failures) are added by the tasks that make them.
 */
export const backupConnection = app.table('backup_connection', {
  accountId: ref('account_id').primaryKey(),
  kind: text('kind').notNull(),
  repository: text('repository').notNull(),
  branch: text('branch').notNull(),
  credentialId: ref('credential_id').notNull(),
  createdAt: epochMs('created_at').notNull(),
});
