import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { counter, epochMs, fields, hhmm, id, isoDate, position, ref } from './columns';

/**
 * What the server holds of an account that is not a task (DESIGN.md §23.3). The account itself is better-auth's, in the other store, so
 * `account_id` is a reference by value and not a foreign key. The columns of later tasks are added by their own migrations.
 */
export const accountSettings = sqliteTable('account_settings', {
  accountId: ref('account_id').primaryKey(),
  /** The account's change counter (§8.3): every applied mutation increments it, and rows are stamped with it. */
  seq: counter('seq').notNull().default(0),
  /** An IANA zone, for the jobs; the browser reports it (§12). */
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
  /**
   * How the Desk is stored (DESIGN.md §9): `none` (plain), `moving` (being re-sealed in the browser, §9.3) or `personal` (sealed under the person's own key,
   * which the server never has). One way: it does not go back.
   */
  encryption: text('encryption').notNull().default('none'),
  /** The age public key (`age1…`) the Desk's list keys are wrapped to; null unless `encryption` is not `none`. The secret is never here. */
  recipient: text('recipient'),
  /** When the person was offered a key and chose (made one, brought one or skipped), so that the offer is made once. Null until they have. */
  keyOfferedAt: epochMs('key_offered_at'),
  createdAt: epochMs('created_at').notNull(),
});

/**
 * The four tables that sync (DESIGN.md §23.3). A row has the **structural columns the server uses** and a `fields` column it mostly does not: a
 * JSON map of field name to the field's value, plain or ciphertext, and the `seq` that last wrote it (`src/sync/format.ts` is the one definition).
 * Each has `owner_id`, which is the better-auth user id, a reference by value because it lives in the other store; there are no foreign keys, so
 * every deletion names what it deletes (`People.deletePerson`, task 2.8).
 *
 * - `seq`         the account's change counter at the last change to the row, which is what a device pulls by (§8.3).
 * - `deleted_at`  when it was deleted, or null. A deleted row stays for seven days so that Undo works and devices learn of it (§8.7).
 * - `created_at`  when the server first stored it.
 */
export const deskList = sqliteTable(
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

/**
 * A card: one thing to do (DESIGN.md §10.2). `due_date`, `due_time` and `completed_at` mirror their fields for the Planner and the reminders of phase 2
 * (§25), which the server fills in when it can read them and which stay null on an account with a key of its own (§23.3). A card's checklist is
 * `desk_check`; its list is `list_id`, and a card of a deleted list is not shown anywhere (§10.6).
 */
export const deskCard = sqliteTable(
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

/**
 * One item of a card's checklist (DESIGN.md §10.3): a title and a tick, in an order of its own. It is a row of its own and not a card with a parent,
 * so that it cannot be given a date, a star or a repeat, and a card has no self-reference. It has no list: it is where its card is.
 */
export const deskCheck = sqliteTable(
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

/** A repeating card's rule and anchor (§12.1). Its occurrences are ordinary cards that point at it. */
export const deskSeries = sqliteTable(
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

/**
 * A secret a person gave Tusk, kept sealed (DESIGN.md §9.2, §21.2): a repository's token for backup. **Only `src/crypto/` writes or reads `sealed`**, which is
 * envelope-encrypted under the instance key and bound to this row's `id` and `purpose`. `key_fingerprint` is the fingerprint of the key that wraps it, kept
 * beside it so that a start-up can tell which keys the rows need, and rotation can find the rows it has to move. It is the person's, and goes with them.
 */
export const credential = sqliteTable(
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
export const backupConnection = sqliteTable(
  'backup_connection',
  {
    accountId: ref('account_id').primaryKey(),
    kind: text('kind').notNull(),
    repository: text('repository').notNull(),
    branch: text('branch').notNull(),
    credentialId: ref('credential_id').notNull(),
    createdAt: epochMs('created_at').notNull(),
    /** The last backup that was confirmed written (§21.4), when, to which file, and the fingerprint of what it held: all null until there is one. */
    lastBackupAt: epochMs('last_backup_at'),
    lastBackupPath: text('last_backup_path'),
    lastFingerprint: text('last_fingerprint'),
    /** When an automatic backup last looked and found nothing changed, or made one: the "last checked" a person sees (§21.4). */
    lastCheckedAt: epochMs('last_checked_at'),
    /** `manual` (only on Back up now) or `auto` (§21.1). */
    mode: text('mode').notNull().default('manual'),
    /** `hourly`, `6h`, `daily` or `weekly`: how often `auto` looks. */
    frequency: text('frequency').notNull().default('daily'),
    /** When `auto` is next due; null for `manual`. A process claims a due connection by a conditional update on this (§21.4). */
    nextBackupAt: epochMs('next_backup_at'),
    /** When the person confirmed that backups continue once their Desk has a key of its own: files written before stay plain and readable (§9.3, §21.3). Null until they have. */
    keyConfirmedAt: epochMs('key_confirmed_at'),
  },
  (table) => [index('backup_connection_due_idx').on(table.nextBackupAt)],
);
