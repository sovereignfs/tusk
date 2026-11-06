import type { Database } from '../db/client';
import * as postgres from '../db/schema/postgres/workspaces';
import * as sqlite from '../db/schema/sqlite/workspaces';

/** The workspace tables on the database's dialect (DESIGN.md §23.3). */
export function tablesOf(database: Database) {
  return database.dialect === 'postgres' ? postgres : sqlite;
}
