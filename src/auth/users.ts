import type { Database } from '@sovereignfs/auth/database';

/** How many accounts there are. The sign-up policy and the sign-up page both ask. */
export async function countUsers(database: Database): Promise<number> {
  const { rows } = await database.run('SELECT COUNT(*) AS n FROM users');
  return Number(rows[0]?.n ?? 0);
}
