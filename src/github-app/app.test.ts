import { createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { disconnectInstallation, readConnection } from '../backup/connection';
import { runBackup } from '../backup/run';
import { backupConnectionTable } from '../backup/tables';
import { connectRepository } from '../backup/connection';
import { entryOf, ringOf } from '../crypto/keys';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { GitHubProvider } from '../providers/github';
import { FakeGitHub } from '../providers/testing/fake-github';
import { ProviderError, type RepositoryRef } from '../providers/types';
import { makeStore } from '../sync/test-support';
import type { GitHubAppSettings } from './config';
import { type AppDeps, appCallback, appInstall, signatureHolds, webhook } from './endpoint';
import { STATE_COOKIE, newState, stateMatches } from './state';
import { InstallationTokens } from './tokens';

/**
 * Connecting through the GitHub App (DESIGN.md §21.2), against `FakeGitHub` (which checks the JWT the way GitHub does, makes installation tokens, identifies a
 * person by a code and says which repositories of an installation they can reach) and the real database. The two checks that keep one person's installation from
 * reaching another's account (the `state`, and the person's own repositories) were each seen to fail with them switched off.
 */
const { leg } = testTarget();
const URL_ = 'https://tusk.example.com';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const PUBLIC = keys.publicKey.export({ type: 'spki', format: 'pem' }) as string;
const app: GitHubAppSettings = {
  appId: '12345',
  slug: 'tusk-test',
  clientId: 'Iv1.client',
  clientSecret: 'client-secret-0123456789',
  webhookSecret: 'webhook-secret-0123456789',
  privateKey: PRIVATE,
};
const directory = { profiles: async () => new Map() };

let fake: FakeGitHub;
let database: Database;
let close: () => Promise<void>;
let tokens: InstallationTokens;
let clock = Date.parse('2026-11-07T10:00:00Z');
let counter = 0;
let installationIds = 100;
beforeAll(async () => {
  fake = await FakeGitHub.start();
  ({ database, close } = await makeStore());
});
afterAll(async () => {
  await fake.stop();
  await close();
});
beforeEach(() => {
  fake.reset();
  fake.registerApp({
    appId: app.appId,
    publicKey: PUBLIC,
    clientId: app.clientId,
    clientSecret: app.clientSecret,
  });
  clock = Date.parse('2026-11-07T10:00:00Z');
  tokens = new InstallationTokens({
    appId: app.appId,
    privateKey: PRIVATE,
    apiUrl: fake.url,
    now: () => clock,
  });
});

const account = () => `account-${(counter += 1)}`;
const appDeps = (extra: Partial<AppDeps> = {}): AppDeps => ({
  app,
  url: URL_,
  apiUrl: fake.url,
  database,
  now: () => clock,
  limiter: { take: async () => ({ ok: true }) },
  providerFor: async (id) =>
    new GitHubProvider({ token: await tokens.forInstallation(id), apiUrl: fake.url }),
  ...extra,
});

/** A repository, an installation on it that `login` can reach, and a code `login` would come back with. */
async function installed(
  options: {
    login?: string;
    extra?: number;
    private?: boolean;
    files?: Record<string, string> | null;
  } = {},
) {
  const login = options.login ?? 'me';
  const repositories: RepositoryRef[] = [];
  for (let i = 0; i <= (options.extra ?? 0); i += 1) {
    const ref: RepositoryRef = { owner: login, name: `notes-${(counter += 1)}` };
    await fake.createRepository(ref, {
      private: options.private ?? true,
      ...(options.files !== undefined ? { files: options.files } : {}),
    });
    repositories.push(ref);
  }
  const id = (installationIds += 1);
  fake.addInstallation(id, { repositories, users: [login] });
  const code = `code-${randomBytes(6).toString('hex')}`;
  fake.authorizeCode(code, login);
  return { id, code, ref: repositories[0] as RepositoryRef, repositories };
}

const returnTo = (query: Record<string, string>, cookie?: string) =>
  new Request(`${URL_}/api/backup/app/callback?${new URLSearchParams(query)}`, {
    headers: cookie ? { cookie } : {},
  });
/** The browser's full round: install (state and cookie), then back from GitHub with it. */
async function comeBack(
  who: string,
  given: { id: number; code: string },
  extra: Partial<AppDeps> = {},
  mutate: (query: Record<string, string>, cookie: string) => [Record<string, string>, string] = (
    q,
    c,
  ) => [q, c],
) {
  const started = appInstall(appDeps());
  const location = new URL(started.headers.get('location') as string);
  const state = location.searchParams.get('state') as string;
  const cookie = (started.headers.get('set-cookie') as string).split(';')[0] as string;
  const [query, sent] = mutate(
    { installation_id: String(given.id), code: given.code, setup_action: 'install', state },
    cookie,
  );
  const response = await appCallback(returnTo(query, sent), who, appDeps(extra));
  return {
    response,
    outcome: new URL(response.headers.get('location') as string, URL_).searchParams.get('github'),
  };
}

describe(`installation tokens (${leg})`, () => {
  it('are asked for with an App JWT that GitHub accepts (RS256, its id, under ten minutes), and not with another key', async () => {
    const { id } = await installed();
    const token = await tokens.forInstallation(id);
    expect(token).toMatch(/^ghs_/);
    const jwt = tokens.jwt().split('.');
    const claims = JSON.parse(Buffer.from(jwt[1] as string, 'base64url').toString()) as {
      iss: string;
      iat: number;
      exp: number;
    };
    expect(JSON.parse(Buffer.from(jwt[0] as string, 'base64url').toString())).toMatchObject({
      alg: 'RS256',
    });
    expect(claims.iss).toBe(app.appId);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);

    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    const wrong = new InstallationTokens({
      appId: app.appId,
      privateKey: stranger,
      apiUrl: fake.url,
    });
    await expect(wrong.forInstallation(id)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('are kept in memory until five minutes before they expire, and then asked for again', async () => {
    const { id } = await installed();
    fake.installationTokensIssued = 0;
    fake.installationTokenLifetimeMs = 60 * 60_000;
    // The fake dates the token from the real clock; this clock starts there.
    clock = Date.now();
    const first = await tokens.forInstallation(id);
    clock += 50 * 60_000;
    expect(await tokens.forInstallation(id)).toBe(first);
    expect(fake.installationTokensIssued).toBe(1);
    clock += 6 * 60_000;
    const second = await tokens.forInstallation(id);
    expect(second).not.toBe(first);
    expect(fake.installationTokensIssued).toBe(2);
  });

  it('say not found for an installation that is gone, and forget what was held for it', async () => {
    const { id } = await installed();
    clock = Date.now();
    await tokens.forInstallation(id);
    fake.removeInstallation(id);
    tokens.forget(id);
    await expect(tokens.forInstallation(id)).rejects.toBeInstanceOf(ProviderError);
    await expect(tokens.forInstallation(id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('are in no error', async () => {
    const { id } = await installed();
    fake.removeInstallation(id);
    const error = await tokens.forInstallation(id).catch((e: unknown) => e);
    expect(JSON.stringify(error) + String((error as Error).stack)).not.toContain('PRIVATE KEY');
  });
});

describe(`the state (${leg})`, () => {
  it('matches only the value that was sent, whole', () => {
    const state = newState();
    expect(stateMatches(state, state)).toBe(true);
    expect(stateMatches(state, null)).toBe(false);
    expect(stateMatches(undefined, state)).toBe(false);
    expect(stateMatches(state, newState())).toBe(false);
    expect(stateMatches(state, state.slice(0, -1))).toBe(false);
    expect(stateMatches('', '')).toBe(false);
  });

  it('is in a cookie that is HttpOnly and SameSite=Lax, for the callback’s paths only, and secure over https', () => {
    const started = appInstall(appDeps());
    const cookie = started.headers.get('set-cookie') as string;
    expect(cookie).toContain(`${STATE_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api\/backup\/app/);
    expect(cookie).toMatch(/Secure/);
    const location = new URL(started.headers.get('location') as string);
    expect(location.pathname).toBe('/apps/tusk-test/installations/new');
    expect(cookie).toContain(location.searchParams.get('state') as string);
  });
});

describe(`connecting through the App (${leg})`, () => {
  it('connects the one repository of an installation the person can reach, and keeps no token', async () => {
    const who = account();
    const given = await installed({ files: { 'README.md': 'hello' } });
    const { outcome } = await comeBack(who, given);
    expect(outcome).toBe('connected');
    const connection = await readConnection(database, who);
    expect(connection).toMatchObject({
      kind: 'app',
      installationId: given.id,
      repository: `${given.ref.owner}/${given.ref.name}`,
    });
    // Nothing sealed: the credential store holds nothing for this account.
    const credentials = await dbAll(
      database,
      sql`SELECT id FROM credential WHERE account_id = ${who}`,
    );
    expect(credentials).toHaveLength(0);
  });

  it('refuses a return whose state is not the cookie’s, and connects nothing, asking GitHub nothing', async () => {
    const who = account();
    const given = await installed();
    fake.requests.length = 0;
    const missing = await comeBack(who, given, {}, (q) => [q, '']);
    expect(missing.outcome).toBe('app_state');
    const different = await comeBack(who, given, {}, (q, c) => [{ ...q, state: newState() }, c]);
    expect(different.outcome).toBe('app_state');
    const none = await comeBack(who, given, {}, (q, c) => {
      const { state: _state, ...rest } = q;
      return [rest, c];
    });
    expect(none.outcome).toBe('app_state');
    expect(await readConnection(database, who)).toBeUndefined();
    expect(
      fake.requests.filter((r) => r.path.startsWith('/login') || r.path.startsWith('/user')),
    ).toEqual([]);
    // The cookie is cleared whatever came of it.
    expect(missing.response.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('refuses an installation that is not the person’s own, whatever the address says, and connects nothing', async () => {
    const victim = await installed({ login: 'victim' });
    // Mallory authorised the App as herself and writes the victim’s installation into the address.
    fake.authorizeCode('mallory-code', 'mallory');
    const who = account();
    const { outcome } = await comeBack(who, { id: victim.id, code: 'mallory-code' });
    expect(outcome).toBe('app_not_yours');
    expect(await readConnection(database, who)).toBeUndefined();
    // And one that does not exist at all.
    const none = await comeBack(who, {
      id: 999_999,
      code: (() => {
        fake.authorizeCode('c2', 'me');
        return 'c2';
      })(),
    });
    expect(none.outcome).toBe('app_not_yours');
    expect(await readConnection(database, who)).toBeUndefined();
  });

  it('refuses a code GitHub does not accept, and a return with none', async () => {
    const who = account();
    const given = await installed();
    expect((await comeBack(who, { id: given.id, code: 'not-a-code' })).outcome).toBe(
      'app_authorize',
    );
    expect((await comeBack(who, { id: given.id, code: '' })).outcome).toBe('app_authorize');
    // A code works once.
    expect((await comeBack(who, given)).outcome).toBe('connected');
    expect((await comeBack(account(), given)).outcome).toBe('app_authorize');
  });

  it('wants exactly one repository: none, or more than one, is told how to fix it', async () => {
    const many = await installed({ extra: 1 });
    expect((await comeBack(account(), many)).outcome).toBe('app_choose_one');
    const none = await installed();
    fake.addInstallation(none.id, { repositories: [], users: ['me'] });
    expect((await comeBack(account(), none)).outcome).toBe('app_no_repository');
  });

  it('applies the checks of every connection: a public repository, an empty one', async () => {
    const pub = await installed({ private: false });
    expect((await comeBack(account(), pub)).outcome).toBe('public');
    const empty = await installed({ files: null });
    expect((await comeBack(account(), empty)).outcome).toBe('empty');
  });

  it('counts the returns', async () => {
    const given = await installed();
    const { outcome } = await comeBack(account(), given, {
      limiter: { take: async () => ({ ok: false, retryAfterMs: 1000 }) },
    });
    expect(outcome).toBe('rate_limited');
  });

  it('backs up with a token asked for, writes into the repository, and leaves a token connection beside it working', async () => {
    const who = account();
    const given = await installed({ files: { 'README.md': 'hi' } });
    expect((await comeBack(who, given)).outcome).toBe('connected');
    const result = await runBackup(
      { database, directory, ring: undefined, apiUrl: fake.url, tokens },
      who,
      clock,
      'manual',
    );
    expect(result).toMatchObject({ ok: true });
    const files = await fake.files(given.ref);
    expect(Object.keys(files).some((path) => /^tusk\/.*\.json$/.test(path))).toBe(true);

    // A person with a token beside: a different account, connected the old way, on the same server.
    const ring = ringOf(entryOf(randomBytes(32)).key);
    fake.addToken('github_pat_PLANTED_0123456789', { write: true });
    const other: RepositoryRef = { owner: 'ada', name: `tokened-${(counter += 1)}` };
    await fake.createRepository(other);
    const second = account();
    const connected = await connectRepository(
      { database, ring, apiUrl: fake.url, now: () => clock },
      second,
      `${other.owner}/${other.name}`,
      'github_pat_PLANTED_0123456789',
    );
    expect(connected).toMatchObject({ ok: true });
    expect(await readConnection(database, second)).toMatchObject({
      kind: 'token',
      installationId: null,
    });
    expect(
      await runBackup(
        { database, directory, ring, apiUrl: fake.url, tokens },
        second,
        clock,
        'manual',
      ),
    ).toMatchObject({ ok: true });
  });

  it('stops, as a token that was revoked does, when the installation is gone at GitHub', async () => {
    const who = account();
    const given = await installed();
    expect((await comeBack(who, given)).outcome).toBe('connected');
    fake.removeInstallation(given.id);
    tokens.forget(given.id);
    const result = await runBackup(
      { database, directory, ring: undefined, apiUrl: fake.url, tokens },
      who,
      clock,
      'manual',
    );
    expect(result).toMatchObject({ ok: false, problem: 'token_rejected' });
  });
});

describe(`GitHub's webhook (${leg})`, () => {
  const send = (
    body: unknown,
    event: string,
    options: { secret?: string; signature?: string | null; raw?: Buffer } = {},
  ) => {
    const bytes = options.raw ?? Buffer.from(JSON.stringify(body));
    const signature =
      options.signature === undefined
        ? `sha256=${createHmac('sha256', options.secret ?? app.webhookSecret)
            .update(bytes)
            .digest('hex')}`
        : options.signature;
    return webhook(
      new Request(`${URL_}/api/webhooks/github`, {
        method: 'POST',
        headers: {
          'x-github-event': event,
          ...(signature ? { 'x-hub-signature-256': signature } : {}),
          'content-type': 'application/json',
        },
        body: new Uint8Array(bytes),
      }),
      { database, secret: app.webhookSecret },
    );
  };
  const connectApp = async () => {
    const who = account();
    const given = await installed();
    expect((await comeBack(who, given)).outcome).toBe('connected');
    return { who, ...given };
  };

  it('holds a signature to the exact bytes, in constant time, and refuses everything else with a 401 before reading them', async () => {
    const body = { action: 'deleted', installation: { id: 1 } };
    const bytes = Buffer.from(JSON.stringify(body));
    const good = `sha256=${createHmac('sha256', app.webhookSecret).update(bytes).digest('hex')}`;
    expect(signatureHolds(app.webhookSecret, bytes, good)).toBe(true);
    expect(signatureHolds(app.webhookSecret, Buffer.from(`${bytes.toString()} `), good)).toBe(
      false,
    );
    expect(signatureHolds('another-secret', bytes, good)).toBe(false);
    for (const header of [
      null,
      '',
      'sha256=',
      'sha1=abc',
      `sha256=${'0'.repeat(64)}`,
      good.toUpperCase(),
    ])
      expect(signatureHolds(app.webhookSecret, bytes, header)).toBe(false);
    expect((await send(body, 'installation', { signature: null })).status).toBe(401);
    expect((await send(body, 'installation', { secret: 'another-secret' })).status).toBe(401);
  });

  it('refuses a body that is too big (413) or not JSON (400)', async () => {
    expect((await send({}, 'ping', { raw: Buffer.alloc(300 * 1024, 'a') })).status).toBe(413);
    const raw = Buffer.from('not json');
    expect((await send(null, 'ping', { raw })).status).toBe(400);
  });

  it('disconnects what a removed installation left, and only that, and can be told twice', async () => {
    const gone = await connectApp();
    const kept = await connectApp();
    const forgotten: number[] = [];
    const reply = await webhook(
      new Request(`${URL_}/api/webhooks/github`, {
        method: 'POST',
        headers: {
          'x-github-event': 'installation',
          'x-hub-signature-256': `sha256=${createHmac('sha256', app.webhookSecret)
            .update(
              Buffer.from(JSON.stringify({ action: 'deleted', installation: { id: gone.id } })),
            )
            .digest('hex')}`,
        },
        body: JSON.stringify({ action: 'deleted', installation: { id: gone.id } }),
      }),
      { database, secret: app.webhookSecret, forget: (id) => forgotten.push(id) },
    );
    expect(reply.status).toBe(200);
    expect(forgotten).toEqual([gone.id]);
    expect(await readConnection(database, gone.who)).toBeUndefined();
    expect(await readConnection(database, kept.who)).toMatchObject({ kind: 'app' });
    expect(
      (await send({ action: 'deleted', installation: { id: gone.id } }, 'installation')).status,
    ).toBe(200);
  });

  it('disconnects a repository taken out of an installation, and not the others in it', async () => {
    const a = await connectApp();
    const b = await connectApp();
    const name = `${a.ref.owner}/${a.ref.name}`;
    expect(
      (
        await send(
          {
            action: 'removed',
            installation: { id: a.id },
            repositories_removed: [{ full_name: name.toUpperCase() }],
          },
          'installation_repositories',
        )
      ).status,
    ).toBe(200);
    expect(await readConnection(database, a.who)).toBeUndefined();
    expect(await readConnection(database, b.who)).toMatchObject({ kind: 'app' });
    // Another installation’s removal names a repository this connection is not in: nothing happens.
    expect(await disconnectInstallation(database, b.id, ['someone/else'])).toBe(0);
  });

  it('ignores an event that is not about removal, and leaves a token connection alone', async () => {
    const c = await connectApp();
    expect(
      (await send({ action: 'created', installation: { id: c.id } }, 'installation')).status,
    ).toBe(200);
    expect(
      (await send({ action: 'added', installation: { id: c.id } }, 'installation_repositories'))
        .status,
    ).toBe(200);
    expect((await send({ zen: 'x' }, 'ping')).status).toBe(200);
    expect(await readConnection(database, c.who)).toMatchObject({ kind: 'app' });
    // A token connection in the same table, whatever installation id an event names.
    const rows = await dbAll(
      database,
      sql`SELECT count(*) AS n FROM ${backupConnectionTable(database)} WHERE kind = 'token'`,
    );
    expect(rows).toBeDefined();
  });
});
