import { sql, type SQL } from 'drizzle-orm';
import type { Database } from './client';
import { AUTH_STORE } from './config';

/**
 * The name of an auth-store table as raw SQL on Tusk's own handle needs it: qualified by the schema on PostgreSQL, where the store is
 * `tusk_auth`, and bare on SQLite, where the store is a database of its own. The tests that read the package's tables directly name them
 * through this.
 */
export function authTable(database: Database, name: string): SQL {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('not a table name');
  return database.dialect === 'postgres'
    ? sql.raw(`"${AUTH_STORE}"."${name}"`)
    : sql.raw(`"${name}"`);
}
