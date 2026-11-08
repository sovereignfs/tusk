import { index, pgSchema, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { APP_STORE } from '../../config';
import { bool, counter, epochMs, fields, hhmm, id, isoDate, position, ref } from './columns';

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
  /**
   * How the Desk is stored (DESIGN.md §9): `none` (plain), `moving` (being re-sealed in the browser, §9.3) or `personal` (sealed under the person's own key,
   * which the server never has). One way: it does not go back.
   */
  encryption: text('encryption').notNull().default('none'),
  /** The age public key (`age1…`) the Desk's list keys are wrapped to; null unless `encryption` is not `none`. The secret is never here. */
  recipient: text('recipient'),
  /** When the person was offered a key and chose (made one, brought one or skipped), so that the offer is made once. Null until they have. */
  keyOfferedAt: epochMs('key_offered_at'),
  /** The daily brief (DESIGN.md §25.2, task 8.5): sent once a day at `brief_at` in the person's zone, when it is on. */
  briefOn: bool('brief_on').notNull().default(false),
  /** When the brief is sent, `HH:MM` in the account's zone. */
  briefAt: hhmm('brief_at').notNull().default('08:00'),
  /** Reminders when a card is due, at its time (task 8.6). */
  remindersOn: bool('reminders_on').notNull().default(false),
  /** Whether what is sent outside the app goes by email too (task 8.3); only where the server has mail. */
  emailOn: bool('email_on').notNull().default(false),
  /** The kinds of Inbox notice that are also sent outside the app (§19), comma-separated; empty: none. */
  sentKinds: text('sent_kinds').notNull().default(''),
  /** The local day (`YYYY-MM-DD`, in the account's zone) the daily brief was last claimed for: the one claim that makes it once a day (task 8.5). */
  lastDigestOn: isoDate('last_digest_on'),
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
    /** The due date and time (`YYYY-MM-DD HH:MM`) a reminder was last claimed for: a card reminded for the time it is due is not reminded again, and one given another time is (task 8.6). */
    remindedFor: text('reminded_for'),
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
export const backupConnection = app.table(
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
    /** Why the last backup failed (a `RunProblem`), and how many in a row have; null and 0 after one that worked (§21.4). */
    failureKind: text('failure_kind'),
    failures: counter('failures').notNull().default(0),
    /** When automatic backups were stopped by a failure that will not mend itself: a token that no longer works, a repository gone or made public. Null while they run. */
    stoppedAt: epochMs('stopped_at'),
    /** For a connection made through the GitHub App (§21.2): the installation, which holds no secret and is looked up when GitHub says an installation was removed. Null for a token. */
    installationId: counter('installation_id'),
  },
  (table) => [index('backup_connection_due_idx').on(table.nextBackupAt)],
);

/** See `schema/sqlite/app.ts`. */
export const pushSubscription = app.table(
  'push_subscription',
  {
    id: id('id'),
    accountId: ref('account_id').notNull(),
    endpoint: text('endpoint').notNull(),
    credentialId: ref('credential_id').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('push_subscription_endpoint_idx').on(table.endpoint),
    index('push_subscription_account_idx').on(table.accountId),
  ],
);
