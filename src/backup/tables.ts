import type { Database } from '../db/client';
import * as postgres from '../db/schema/postgres/app';
import * as sqlite from '../db/schema/sqlite/app';

/** The backup connection table on the database's dialect. */
export const backupConnectionTable = (database: Database) =>
  database.dialect === 'postgres' ? postgres.backupConnection : sqlite.backupConnection;
