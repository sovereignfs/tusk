import { getAuthStore } from '../db/boot';

/**
 * The address a password-reset link was sent to, while the link is good: the new password is derived with it (auth.md §4, rule 1). Whoever
 * holds the link was sent it at that address, so it tells them nothing new; a token that is not good gives nothing.
 */
export async function resetAddress(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) return null;
  const store = await getAuthStore();
  const { rows } = await store.run(
    `SELECT u.email AS email, v.expires_at AS expires_at FROM verifications v JOIN users u ON u.id = v.value
     WHERE v.identifier = ?`,
    [`reset-password:${token}`],
  );
  const row = rows[0];
  if (!row) return null;
  const expires =
    row.expires_at instanceof Date ? row.expires_at.getTime() : Number(row.expires_at);
  return Number.isFinite(expires) && expires > Date.now() ? String(row.email) : null;
}
