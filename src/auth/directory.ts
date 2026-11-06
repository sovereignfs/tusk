import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresAuth from '../db/schema/postgres/auth';
import * as sqliteAuth from '../db/schema/sqlite/auth';

/**
 * What the rest of the app may ask of the accounts (DESIGN.md §13.2): who has this address, and what a person is called. **It is read when it is shown, and
 * never copied** into the app's tables, so a person who changes their name or picture is the same person everywhere, and an account that is gone is not
 * left behind in a workspace's rows with its name. The auth store may be a database of its own, so this is not a join and cannot be one.
 */
export interface Profile {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
}

export interface Directory {
  /** The account that has exactly this address, case aside, or nothing. */
  idOfEmail(email: string): Promise<string | undefined>;
  /** The accounts among these ids that exist, by id. */
  profiles(ids: readonly string[]): Promise<Map<string, Profile>>;
}

const userTable = (database: Database) =>
  database.dialect === 'postgres' ? postgresAuth.user : sqliteAuth.user;

/** The directory over an auth store. */
export function authDirectory(database: Database): Directory {
  return {
    async idOfEmail(email) {
      const rows = await dbAll<{ id: string }>(
        database,
        sql`SELECT id FROM ${userTable(database)} WHERE LOWER(email) = ${email.trim().toLowerCase()} LIMIT 1`,
      );
      return rows[0]?.id;
    },
    async profiles(ids) {
      const found = new Map<string, Profile>();
      const wanted = [...new Set(ids)];
      if (wanted.length === 0) return found;
      const rows = await dbAll<{ id: string; name: string; email: string; image: string | null }>(
        database,
        sql`SELECT id, name, email, image FROM ${userTable(database)}
            WHERE id IN (${sql.join(
              wanted.map((id) => sql`${id}`),
              sql`, `,
            )})`,
      );
      for (const row of rows)
        found.set(row.id, { id: row.id, name: row.name, email: row.email, image: row.image });
      return found;
    },
  };
}
