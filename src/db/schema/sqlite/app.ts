import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { counter, epochMs, ref } from './columns';

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
