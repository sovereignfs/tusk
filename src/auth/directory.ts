import type { Database as AuthStore } from '@sovereignfs/auth/database';

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

/** The directory over an auth store, `@sovereignfs/auth`'s `users` table. */
export function authDirectory(database: AuthStore): Directory {
  return {
    async idOfEmail(email) {
      const { rows } = await database.run('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [
        email.trim().toLowerCase(),
      ]);
      return rows[0] ? String(rows[0].id) : undefined;
    },
    async profiles(ids) {
      const found = new Map<string, Profile>();
      const wanted = [...new Set(ids)];
      if (wanted.length === 0) return found;
      const { rows } = await database.run(
        `SELECT id, name, email, image FROM users WHERE id IN (${wanted.map(() => '?').join(', ')})`,
        wanted,
      );
      for (const row of rows) {
        const id = String(row.id);
        found.set(id, {
          id,
          name: String(row.name),
          email: String(row.email),
          image: row.image === null || row.image === undefined ? null : String(row.image),
        });
      }
      return found;
    },
  };
}
