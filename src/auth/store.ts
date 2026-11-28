import { openDatabase, type Database } from '@sovereignfs/auth/database';
import { postgresDatabase } from '@sovereignfs/auth/postgres';
import { pgConnectionOptions } from '../db/client';
import { AUTH_STORE, type DatabaseConfig } from '../db/config';

/**
 * The auth store as `@sovereignfs/auth` takes it (ADR 0001): the same database Tusk's own code reaches through `src/db/client.ts`,
 * opened again in the package's shape. It stays a store of its own: the `tusk_auth` file beside the app's, the `tusk_auth`
 * namespace on sqld, and the `tusk_auth` schema on PostgreSQL, which the package's unqualified tables reach through the pool's
 * `search_path`. The namespace and the schema are made by `provisionStores` before this opens them.
 */
export async function openAuthStore(config: DatabaseConfig): Promise<Database> {
  if (config.dialect === 'postgres') {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      ...pgConnectionOptions(config),
      max: config.poolMax,
      // Every connection of this pool looks in the auth store's schema first: the package names no schema (auth.md §10).
      options: `-c search_path=${AUTH_STORE}`,
    });
    return postgresDatabase(pool);
  }
  // A store opened by its own variables, with a prefix nothing else reads, so that the app's `TUSK_DB_*` stay the app store's.
  const prefix = 'TUSKAUTHSTORE';
  return openDatabase({
    prefix,
    env:
      config.form === 'file'
        ? {
            [`${prefix}_DB_DIALECT`]: 'sqlite',
            [`${prefix}_SQLITE_URL`]: `file:${config.authPath}`,
          }
        : {
            [`${prefix}_DB_DIALECT`]: 'sqld',
            [`${prefix}_SQLD_URL`]: config.url,
            [`${prefix}_SQLD_NAMESPACE`]: AUTH_STORE,
          },
  });
}
