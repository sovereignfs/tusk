import type { SessionStore, StoredRecord, TokenStore } from '@sovereignfs/sdk';
import type { Database, Migration } from '@sovereignfs/auth/database';

/**
 * What the SDK keeps for signing in through core (sdk §9.1, §5.1), in the auth store: the sign-ins still pending (and no refresh
 * token, below). `@sovereignfs/auth/core` signs in on the SDK's steps; the session itself is the package's.
 */
export const SDK_STORE_MIGRATIONS_TABLE = 'tusk_sdk_store_migrations';

export function sdkStoreMigrations(family: Database['family']): Migration[] {
  const time = family === 'postgres' ? 'bigint' : 'integer';
  return [
    {
      name: '0000_sdk_stores',
      sql: [
        `CREATE TABLE sv_sessions (id text PRIMARY KEY, kind text NOT NULL, sub text, sid text, data text NOT NULL, expires_at ${time} NOT NULL)`,
        'CREATE INDEX sv_sessions_sub ON sv_sessions (sub)',
        'CREATE INDEX sv_sessions_sid ON sv_sessions (sid)',
        'CREATE INDEX sv_sessions_expires ON sv_sessions (expires_at)',
      ].join('\n--> statement-breakpoint\n'),
    },
  ];
}

/** The SDK's pending sign-ins (sdk §9.1). Nothing is returned after its expiry. */
export function sdkSessionStore(database: () => Promise<Database>): SessionStore {
  return {
    async get(id) {
      const { rows } = await (
        await database()
      ).run('SELECT kind, sub, sid, data FROM sv_sessions WHERE id = ? AND expires_at > ?', [
        id,
        Date.now(),
      ]);
      const row = rows[0];
      if (!row) return undefined;
      return {
        kind: row.kind as StoredRecord['kind'],
        ...(row.sub ? { sub: String(row.sub) } : {}),
        ...(row.sid ? { sid: String(row.sid) } : {}),
        data: JSON.parse(String(row.data)) as Record<string, unknown>,
      };
    },
    async set(id, record, expiresAt) {
      const db = await database();
      await db.run(
        `INSERT INTO sv_sessions (id, kind, sub, sid, data, expires_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, sub = excluded.sub, sid = excluded.sid, data = excluded.data,
           expires_at = excluded.expires_at`,
        [
          id,
          record.kind,
          record.sub ?? null,
          record.sid ?? null,
          JSON.stringify(record.data),
          expiresAt,
        ],
      );
      // What has expired is of no use to anyone; a small share of writes clears it.
      if (Math.random() < 0.02)
        await db.run('DELETE FROM sv_sessions WHERE expires_at <= ?', [Date.now()]);
    },
    async delete(id) {
      await (await database()).run('DELETE FROM sv_sessions WHERE id = ?', [id]);
    },
    async deleteMatching(match) {
      const db = await database();
      if (match.sub !== undefined)
        await db.run('DELETE FROM sv_sessions WHERE sub = ?', [match.sub]);
      if (match.sid !== undefined)
        await db.run('DELETE FROM sv_sessions WHERE sid = ?', [match.sid]);
    },
  };
}

/**
 * **Tusk keeps no refresh token of core's.** It calls core for nobody (no directory, no notification is sent through core), so a token kept
 * would be a credential at rest for nothing. The SDK hands one over at every sign-in through core: this store takes it and lets it go, and
 * has nothing to give back. A feature that calls core for a person brings a sealed store with it.
 */
export const discardingTokenStore: TokenStore = {
  read: () => Promise.resolve(undefined),
  write: () => Promise.resolve(true),
  lock: (_sub, work) => work(),
  delete: () => Promise.resolve(),
};
