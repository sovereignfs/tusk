import { hashPassword, symmetricEncrypt } from 'better-auth/crypto';
import { passwordsMoving } from '@sovereignfs/auth/server';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as AuthStore } from '@sovereignfs/auth/database';
import { dbRun } from '../db/exec';
import { runMigrations } from '../db/migrate';
import { authTable } from '../db/tables';
import { freshDatabase, testTarget } from '../db/test-support';
import { type Auth, createAuth } from './auth';
import type { AuthSettings } from './config';
import { migrateAuthStore } from './migrate';
import { openAuthStore } from './store';
import { TestClient, derivedFor } from './test-support';

/**
 * **A released Tusk's auth store signs in after the move** (`sovereign` task 20.15's review checklist), on whichever database the leg
 * runs on: the store as Tusk up to 0.3.0 left it (better-auth's tables under its singular names), with a password stored as a hash of
 * the password itself and the authenticator app on, a passkey, an account that came through core with a session; then the server's
 * start (`migrateAuthStore`) and Tusk's real sign-in on the package.
 */
const { leg } = testTarget();
const OLD_PASSWORD = 'the password Ada always used';
const BACKUP_CODES = ['ADA-BACKUP-1', 'ADA-BACKUP-2'];

const SETTINGS: AuthSettings = {
  url: 'http://localhost:3000',
  secret: 'test-secret-'.padEnd(40, 'x'),
  signUp: 'closed',
  passwordMinLength: 10,
  local: true,
  sovereign: undefined,
};

describe(`a released auth store, moved at start (${leg})`, () => {
  let legacy: Awaited<ReturnType<typeof freshDatabase>>['database'] | undefined;
  let store: AuthStore | undefined;
  let auth: Auth;
  const visitor = (n: number) => new TestClient(auth, SETTINGS.url).from(`10.7.0.${n}`);
  const moved = (): AuthStore => {
    if (!store) throw new Error('the store was not moved');
    return store;
  };

  beforeAll(async () => {
    const fresh = await freshDatabase('auth');
    const db = fresh.database;
    legacy = db;
    await runMigrations(db);
    const pg = db.dialect === 'postgres';
    const at = pg ? sql`now()` : sql`${Date.now()}`;
    const person = (id: string, twoFactor = false) =>
      dbRun(
        db,
        sql`INSERT INTO ${authTable(db, 'user')} (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
            VALUES (${id}, ${id}, ${`${id}@example.test`}, ${true}, ${twoFactor}, ${at}, ${at})`,
      );
    const account = (id: string, provider: string, accountId: string, password: string | null) =>
      dbRun(
        db,
        sql`INSERT INTO ${authTable(db, 'account')} (id, account_id, provider_id, user_id, password, access_token, created_at, updated_at)
            VALUES (${`${id}-${provider}`}, ${accountId}, ${provider}, ${id}, ${password}, ${provider === 'sovereign' ? 'a token genericOAuth kept' : null}, ${at}, ${at})`,
      );
    // Ada: a password as Tusk stored it (a hash of the password itself), the authenticator app on, and a passkey. Grace: through core
    // only, with a session.
    await person('ada', true);
    await account('ada', 'credential', 'ada', await hashPassword(OLD_PASSWORD));
    const secret = await symmetricEncrypt({
      key: SETTINGS.secret,
      data: 'a-totp-secret-of-32-characters!!',
    });
    const codes = await symmetricEncrypt({
      key: SETTINGS.secret,
      data: JSON.stringify(BACKUP_CODES),
    });
    await dbRun(
      db,
      sql`INSERT INTO ${authTable(db, 'two_factor')} (id, secret, backup_codes, user_id, verified)
          VALUES ('tf-ada', ${secret}, ${codes}, 'ada', ${true})`,
    );
    await dbRun(
      db,
      sql`INSERT INTO ${authTable(db, 'passkey')} (id, name, public_key, user_id, credential_id, counter, device_type, backed_up, created_at)
          VALUES ('pk-ada', 'Ada’s phone', 'pQECAyYgASFYI', 'ada', 'credential-of-ada', 3, 'multiDevice', ${true}, ${at})`,
    );
    await person('grace');
    await account('grace', 'sovereign', 'sub-grace', null);
    await dbRun(
      db,
      sql`INSERT INTO ${authTable(db, 'session')} (id, expires_at, token, created_at, updated_at, user_id)
          VALUES ('s-grace', ${pg ? sql`now() + interval '1 day'` : sql`${Date.now() + 86_400_000}`}, 'tok', ${at}, ${at}, 'grace')`,
    );

    // The server's start (`src/db/boot.ts`), twice: the second finds the move done and changes nothing.
    store = await openAuthStore(fresh.config);
    expect(await migrateAuthStore(store)).toBe('moved');
    expect(await migrateAuthStore(store)).toBe('done');
    auth = createAuth({ settings: SETTINGS, name: 'Tusk', database: store });
  });
  afterAll(async () => {
    await store?.close();
    await legacy?.close();
  });

  it('keeps every account, session, second step and passkey, under the package’s tables', async () => {
    const count = async (table: string) =>
      Number((await moved().run(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0]?.n);
    expect(await count('users')).toBe(2);
    expect(await count('accounts')).toBe(2);
    expect(await count('sessions')).toBe(1);
    expect(await count('two_factors')).toBe(1);
    // A passkey is kept as it was made: the relying party is still `TUSK_URL`'s host, so it signs in as before.
    const { rows } = await moved().run(
      'SELECT user_id, credential_id, counter FROM passkeys WHERE id = ?',
      ['pk-ada'],
    );
    expect(rows.map((row) => ({ ...row, counter: Number(row.counter) }))).toEqual([
      { user_id: 'ada', credential_id: 'credential-of-ada', counter: 3 },
    ]);
    // genericOAuth's token is gone: Tusk keeps none of core's.
    const core = await moved().run(
      "SELECT account_id, access_token FROM accounts WHERE provider_id = 'sovereign'",
    );
    expect(core.rows).toEqual([{ account_id: 'sub-grace', access_token: null }]);
  });

  it('marks the password, which Tusk stored as a hash of the password itself, to move', async () => {
    const { rows } = await moved().run('SELECT user_id FROM sv_legacy_passwords');
    expect(rows.map((row) => row.user_id)).toEqual(['ada']);
    expect(await passwordsMoving(moved())).toBe(true);
  });

  it('moves the password once, at its next sign-in, opening no session, then asks for the second step and takes a backup code', async () => {
    const client = visitor(1);
    const value = derivedFor('the password Ada always used');
    const refused = await client.post('/api/auth/sign-in/email', {
      email: 'ada@example.test',
      password: value,
    });
    expect(refused.status).toBe(401);
    // What the page sends once, while the password can still move: the password itself and its sign-in value.
    const move = await client.postRaw('/api/auth/sv/move-password', {
      email: 'ada@example.test',
      previous: OLD_PASSWORD,
      signIn: value,
    });
    expect(move.status).toBe(200);
    expect(client.has('session_token')).toBe(false);
    const signedIn = await client.post('/api/auth/sign-in/email', {
      email: 'ada@example.test',
      password: value,
    });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toMatchObject({ twoFactorRedirect: true });
    expect(client.has('session_token')).toBe(false);
    const second = await client.post('/api/auth/two-factor/verify-backup-code', {
      code: 'ADA-BACKUP-1',
    });
    expect(second.status).toBe(200);
    expect((await client.get('/api/auth/get-session')).body?.user?.email).toBe('ada@example.test');
    expect(await passwordsMoving(moved())).toBe(false);
  });

  it('moves nothing again: the old password, sent once more, opens nothing', async () => {
    const other = derivedFor('a value someone else chose');
    await visitor(2).postRaw('/api/auth/sv/move-password', {
      email: 'ada@example.test',
      previous: OLD_PASSWORD,
      signIn: other,
    });
    const signIn = await visitor(2).post('/api/auth/sign-in/email', {
      email: 'ada@example.test',
      password: other,
    });
    expect(signIn.status).toBe(401);
  });
});
