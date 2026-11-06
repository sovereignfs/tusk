import type { Database } from '../db/client';
import * as postgres from '../db/schema/postgres/app';
import * as sqlite from '../db/schema/sqlite/app';

/** The credential table on the database's dialect. */
export const credentialTable = (database: Database) =>
  database.dialect === 'postgres' ? postgres.credential : sqlite.credential;
