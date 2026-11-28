import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbAll, dbRun } from '../db/exec';
import { authTable } from '../db/tables';
import { testTarget } from '../db/test-support';
import {
  type FakeSovereign,
  type FakeUser,
  type LoginOverrides,
  startFakeSovereign,
} from './testing/fake-sovereign';
import { type TestAuth, type TestClient, makeAuth } from './test-support';
import { totpFor } from './testing/totp';
import { accountOfSub } from '../sovereign/identity';

/**
 * Sign-in through Sovereign (DESIGN.md §6), over real requests: better-auth's own handler on one
 * side, a fake Sovereign (`testing/fake-sovereign.ts`) on the other, and whichever database the
 * leg runs on in between. What is tested is what the sign-in promises: who gets in, as whom, and
 * what a forged or refused login leaves behind.
 */
const { leg } = testTarget();

/** What a test expects to be there, and says so plainly when it is not. */
function got<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('expected a value, and there was none');
  return value;
}

let addresses = 0;
const visitor = (t: TestAuth): TestClient =>
  t.client().from(`10.9.${Math.floor(addresses / 250)}.${(addresses++ % 250) + 1}`);

let people = 0;
const person = (extra: Partial<FakeUser> = {}): FakeUser => {
  const n = ++people;
  return {
    sub: `sovereign-user-${n}`,
    email: `person${n}@sovereign.test`,
    name: `Person ${n}`,
    ...extra,
  };
};

interface Login {
  /** Where the callback sent the browser. */
  location: URL;
  status: number;
  signedIn: boolean;
}

/** The whole dance a browser does, without the browser: start, go to Sovereign, come back. */
async function login(
  t: TestAuth,
  fake: FakeSovereign,
  client: TestClient,
  user: FakeUser,
  overrides?: LoginOverrides,
): Promise<Login> {
  fake.signInAs(user, overrides);
  // The package's route (auth.md §8): the SDK's pending sign-in in its cookie, and the browser sent to core.
  const start = await client.get('/api/auth/sign-in/sovereign?returnTo=%2F');
  expect(start.status).toBe(302);
  const authorize = await fetch(got(start.headers.get('location')), { redirect: 'manual' });
  const back = authorize.headers.get('location');
  expect(back).toBeTruthy();
  const callback = await client.follow(back as string);
  const location = new URL(callback.headers.get('location') ?? '/', t.settings.url);
  return { location, status: callback.status, signedIn: client.has('session_token') };
}

/** The auth store's tables, `@sovereignfs/auth`'s since the move (ADR 0001). */
const tables = (t: TestAuth) => ({
  user: authTable(t.database, 'users'),
  account: authTable(t.database, 'accounts'),
  session: authTable(t.database, 'sessions'),
});
const accounts = (t: TestAuth) =>
  dbAll<{
    provider_id: string;
    account_id: string;
    access_token: string | null;
    id_token: string | null;
  }>(
    t.database,
    sql`SELECT provider_id, account_id, access_token, id_token FROM ${tables(t).account}`,
  );
const users = (t: TestAuth) =>
  dbAll<{ id: string; email: string; name: string; email_verified: boolean | number }>(
    t.database,
    sql`SELECT id, email, name, email_verified FROM ${tables(t).user}`,
  );

describe(`Sovereign sign-in, open sign-up (${leg})`, () => {
  let fake: FakeSovereign;
  let t: TestAuth;
  beforeAll(async () => {
    fake = await startFakeSovereign();
    t = await makeAuth({
      local: false,
      signUp: 'open',
      sovereign: { issuer: fake.issuer, clientId: fake.clientId, clientSecret: fake.clientSecret },
    });
  });
  afterAll(async () => {
    await t.close();
    await fake.close();
  });

  it('signs a new person in as the account Sovereign says they are: its sub, email and name', async () => {
    const who = person();
    const result = await login(t, fake, visitor(t), who);
    expect(result.signedIn).toBe(true);
    expect(result.location.pathname).toBe('/');

    const user = (await users(t)).find((u) => u.email === who.email);
    expect(user).toMatchObject({ email: who.email, name: who.name });
    expect(Boolean(user?.email_verified)).toBe(true);
    const account = (await accounts(t)).find((a) => a.account_id === who.sub);
    expect(account).toMatchObject({ provider_id: 'sovereign', account_id: who.sub });
  });

  it('asks Sovereign the way its client was registered: the exact callback, PKCE S256, the client secret by basic auth', async () => {
    const before = fake.authorizations.length;
    await login(t, fake, visitor(t), person());
    const asked = got(fake.authorizations[before]).searchParams;
    expect(asked.get('redirect_uri')).toBe(`${t.settings.url}/api/auth/callback/sovereign`);
    expect(asked.get('client_id')).toBe(fake.clientId);
    expect(asked.get('code_challenge_method')).toBe('S256');
    expect(asked.get('scope')?.split(/[ +]/)).toEqual(
      expect.arrayContaining(['openid', 'profile', 'email']),
    );
    expect(asked.get('nonce')).toBeTruthy();
    const token = got(fake.tokenRequests.at(-1));
    expect(token.authorization).toMatch(/^Basic /);
    expect(token.form.get('code_verifier')).toBeTruthy();
  });

  it('recognises the same person next time by their sub, and does not make another account', async () => {
    const who = person();
    await login(t, fake, visitor(t), who);
    const first = (await users(t)).length;
    const again = await login(t, fake, visitor(t), who);
    expect(again.signedIn).toBe(true);
    expect((await users(t)).length).toBe(first);
  });

  it('signs in by sub even when the email address has changed at Sovereign', async () => {
    const who = person();
    await login(t, fake, visitor(t), who);
    const before = (await users(t)).length;
    const result = await login(t, fake, visitor(t), { ...who, email: `moved-${who.email}` });
    expect(result.signedIn).toBe(true);
    expect((await users(t)).length).toBe(before);
  });

  it('falls back to the part of the email before the @ when Sovereign sends no name', async () => {
    const who = person({ name: undefined as unknown as string });
    delete (who as { name?: string }).name;
    const result = await login(t, fake, visitor(t), who);
    expect(result.signedIn).toBe(true);
    expect((await users(t)).find((u) => u.email === who.email)?.name).toBe(who.email.split('@')[0]);
  });

  it('keeps none of the tokens Sovereign handed over, anywhere', async () => {
    await login(t, fake, visitor(t), person());
    const stored = await accounts(t);
    expect(stored.length).toBeGreaterThan(0);
    // Core's tokens are the SDK's, and Tusk's token store keeps none (`src/auth/sdk-stores.ts`): better-auth's row holds none either.
    for (const row of stored) expect([row.access_token, row.id_token]).toEqual([null, null]);
    const tables = await t.store.run(
      t.store.family === 'postgres'
        ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'sv_tokens'"
        : "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sv_tokens'",
    );
    expect(tables.rows).toEqual([]);
  });

  // **Fails today, and is kept so:** `@sovereignfs/sdk` 2.11's `finishSignIn` does not check the signature of the ID token it takes from
  // core's token endpoint (openid-client checks it only with `enableNonRepudiationChecks`), though sdk §9.1 says it does. It is the SDK's
  // to fix; once Tusk is on a release that does, this passes, `fails` must go, and the test holds it.
  it.fails(
    'refuses an ID token signed by a key Sovereign does not publish, and leaves no account',
    async () => {
      const who = person();
      const before = (await users(t)).length;
      const result = await login(t, fake, visitor(t), who, { signWithWrongKey: true });
      expect(result.signedIn).toBe(false);
      expect(result.location.searchParams.get('error')).toBeTruthy();
      expect((await users(t)).length).toBe(before);
      expect((await users(t)).some((u) => u.email === who.email)).toBe(false);
    },
  );

  it('refuses an ID token meant for another client', async () => {
    const result = await login(t, fake, visitor(t), person(), { claims: { aud: 'someone-else' } });
    expect(result.signedIn).toBe(false);
    expect(result.location.searchParams.get('error')).toBeTruthy();
  });

  it('refuses an ID token that does not carry the nonce it was asked to', async () => {
    const result = await login(t, fake, visitor(t), person(), { omitNonce: true });
    expect(result.signedIn).toBe(false);
    expect(result.location.searchParams.get('error')).toBeTruthy();
  });

  it('brings the person back to the sign-in page with a reason when they decline', async () => {
    const client = visitor(t);
    fake.denyNext();
    const start = await client.get('/api/auth/sign-in/sovereign?returnTo=%2F');
    const authorize = await fetch(got(start.headers.get('location')), { redirect: 'manual' });
    const callback = await client.follow(authorize.headers.get('location') as string);
    const location = new URL(callback.headers.get('location') ?? '', t.settings.url);
    expect(location.pathname).toBe('/sign-in');
    // The package's one word for a sign-in through core that did not work (auth.md §8), which the page says in words.
    expect(location.searchParams.get('error')).toBe('sovereign');
    expect(client.has('session_token')).toBe(false);
  });

  it('does not accept a callback twice', async () => {
    const client = visitor(t);
    fake.signInAs(person());
    const start = await client.get('/api/auth/sign-in/sovereign?returnTo=%2F');
    const authorize = await fetch(got(start.headers.get('location')), { redirect: 'manual' });
    const back = authorize.headers.get('location') as string;
    await client.follow(back);
    const replay = visitor(t);
    const second = await replay.follow(back);
    expect(replay.has('session_token')).toBe(false);
    expect(
      new URL(second.headers.get('location') ?? '', t.settings.url).searchParams.get('error'),
    ).toBeTruthy();
  });

  it('ends the session on sign-out without sending the person to Sovereign to sign out there', async () => {
    const client = visitor(t);
    await login(t, fake, client, person());
    const out = await client.post('/api/auth/sign-out', {});
    expect(out.status).toBe(200);
    expect(JSON.stringify(out.body ?? {})).not.toContain(fake.issuer);
    expect(client.has('session_token')).toBe(false);
  });

  it('has no email and password, passkeys or two-factor: none of their routes is there', async () => {
    const before = (await users(t)).length;
    const client = visitor(t);
    for (const path of ['/api/auth/sign-in/email', '/api/auth/sign-up/email']) {
      const reply = await client.post(path, {
        name: 'Mallory',
        email: 'mallory@example.com',
        password: 'correct horse battery',
      });
      expect(reply.status, path).toBe(404);
    }
    for (const path of [
      '/api/auth/two-factor/enable',
      '/api/auth/passkey/generate-register-options',
    ]) {
      expect((await client.post(path, { password: 'x' })).status, path).toBe(404);
    }
    expect(client.has('session_token')).toBe(false);
    expect((await users(t)).length).toBe(before);
  });
});

describe(`Sovereign sign-in, first account only (${leg})`, () => {
  let fake: FakeSovereign;
  let t: TestAuth;
  beforeAll(async () => {
    fake = await startFakeSovereign();
    t = await makeAuth({
      local: false,
      signUp: 'closed',
      sovereign: { issuer: fake.issuer, clientId: fake.clientId, clientSecret: fake.clientSecret },
    });
  });
  afterAll(async () => {
    await t.close();
    await fake.close();
  });

  // `TUSK_AUTH_SIGNUP` is for Tusk's own accounts: who may sign in through core is core's to say (auth.md §5).
  it('lets everyone core signs in through, whatever the sign-up setting', async () => {
    const first = await login(t, fake, visitor(t), person());
    expect(first.signedIn).toBe(true);
    const second = person();
    const also = await login(t, fake, visitor(t), second);
    expect(also.signedIn).toBe(true);
    expect((await users(t)).some((u) => u.email === second.email)).toBe(true);
  });

  it('still lets the first person back in', async () => {
    const [existing] = await users(t);
    const sub = got((await accounts(t))[0]).account_id;
    const again = await login(t, fake, visitor(t), {
      sub,
      email: got(existing).email,
      name: got(existing).name,
    });
    expect(again.signedIn).toBe(true);
  });
});

describe(`Sovereign beside local sign-in (${leg})`, () => {
  let fake: FakeSovereign;
  let t: TestAuth;
  beforeAll(async () => {
    fake = await startFakeSovereign();
    t = await makeAuth({
      signUp: 'open',
      sovereign: { issuer: fake.issuer, clientId: fake.clientId, clientSecret: fake.clientSecret },
    });
  });
  afterAll(async () => {
    await t.close();
    await fake.close();
  });

  it('does not attach a Sovereign login to a local account because the email address is the same', async () => {
    const email = 'shared@example.com';
    const signedUp = await visitor(t).post('/api/auth/sign-up/email', {
      name: 'Local Ada',
      email,
      password: 'correct horse battery',
    });
    expect(signedUp.status).toBe(200);
    // An address that has been confirmed is the strongest case for linking by email: it is the
    // one that better-auth's own safeguards would allow, so what refuses is ours.
    await dbRun(
      t.database,
      sql`UPDATE ${tables(t).user} SET email_verified = ${t.database.dialect === 'postgres' ? true : 1} WHERE email = ${email}`,
    );
    const before = (await users(t)).length;

    const result = await login(t, fake, visitor(t), person({ email }));
    expect(result.signedIn).toBe(false);
    expect(result.location.searchParams.get('error')).toBe('account_not_linked');
    expect((await users(t)).length).toBe(before);
    expect((await accounts(t)).some((a) => a.provider_id === 'sovereign')).toBe(false);
  });

  it('still signs a local account in with its password', async () => {
    const email = 'local-only@example.com';
    await visitor(t).post('/api/auth/sign-up/email', {
      name: 'Local',
      email,
      password: 'correct horse battery',
    });
    const client = visitor(t);
    const reply = await client.post('/api/auth/sign-in/email', {
      email,
      password: 'correct horse battery',
    });
    expect(reply.status).toBe(200);
    expect(client.has('session_token')).toBe(true);
  });

  it('lets a Sovereign login with a different email make its own account', async () => {
    const result = await login(t, fake, visitor(t), person());
    expect(result.signedIn).toBe(true);
  });
});

const PASSWORD = 'correct horse battery';

describe(`linking a Sovereign account to a local one (${leg})`, () => {
  let fake: FakeSovereign;
  let t: TestAuth;
  beforeAll(async () => {
    fake = await startFakeSovereign();
    t = await makeAuth({
      signUp: 'open',
      sovereign: { issuer: fake.issuer, clientId: fake.clientId, clientSecret: fake.clientSecret },
    });
  });
  afterAll(async () => {
    await t.close();
    await fake.close();
  });

  /** A local account, signed in. */
  async function localAccount(email: string, name = 'Local Ada'): Promise<TestClient> {
    const client = visitor(t);
    const made = await client.post('/api/auth/sign-up/email', { name, email, password: PASSWORD });
    expect(made.status).toBe(200);
    return client;
  }

  /**
   * Linking as the package does it (auth.md §8.2): the password first, then to Sovereign as `user`, and back: where the callback sent the
   * browser, with `link=done`, `taken` or `address`.
   */
  async function link(client: TestClient, user: FakeUser): Promise<URL> {
    fake.signInAs(user);
    const start = await client.post('/api/auth/sv/link-sovereign', {
      password: PASSWORD,
      returnTo: '/settings',
    });
    expect(start.status).toBe(200);
    const authorize = await fetch(start.body.url as string, { redirect: 'manual' });
    const callback = await client.follow(authorize.headers.get('location') as string);
    return new URL(callback.headers.get('location') ?? '/', t.settings.url);
  }

  const providers = async (client: TestClient) =>
    ((await client.get('/api/auth/list-accounts')).body as { id: string; providerId: string }[])
      .map((a) => a.providerId)
      .sort();
  const sovereignAccounts = async () =>
    (await accounts(t)).filter((a) => a.provider_id === 'sovereign');

  it('links a Sovereign account from a signed-in session, after the password', async () => {
    const email = 'link-ok@example.com';
    const client = await localAccount(email);
    const who = person({ email });
    const before = (await users(t)).length;

    const back = await link(client, who);
    expect(back.pathname).toBe('/settings');
    expect(back.searchParams.get('link')).toBe('done');
    expect(await providers(client)).toEqual(['credential', 'sovereign']);
    expect((await sovereignAccounts()).some((a) => a.account_id === who.sub)).toBe(true);
    expect((await users(t)).length).toBe(before);
  });

  it('asks for the password first, and links nothing without it', async () => {
    const client = await localAccount('link-wrong-password@example.com');
    const refused = await client.post('/api/auth/sv/link-sovereign', {
      password: 'not my password at all',
      returnTo: '/settings',
    });
    expect(refused.status).toBe(401);
    expect(refused.body?.url).toBeUndefined();
    expect(await providers(client)).toEqual(['credential']);
  });

  it("then signs that same account in through Sovereign, by the sub, whatever Sovereign's address becomes", async () => {
    const email = 'link-then-login@example.com';
    const client = await localAccount(email, 'Local Grace');
    const who = person({ email, name: "Sovereign's name for her" });
    await link(client, who);
    const before = (await users(t)).length;

    const fresh = visitor(t);
    const result = await login(t, fake, fresh, { ...who, email: `renamed-${email}` });
    expect(result.signedIn).toBe(true);
    expect((await users(t)).length).toBe(before);
    // The account is still the local one: its name and its email are not Sovereign's.
    const session = (await fresh.get('/api/auth/get-session')).body;
    expect(session.user).toMatchObject({ email, name: 'Local Grace' });
  });

  it('refuses a Sovereign account whose address is another account’s here, and links nothing', async () => {
    const client = await localAccount('link-mine-address@example.com');
    await localAccount('link-someone-else@example.com');
    const before = (await sovereignAccounts()).length;
    const back = await link(client, person({ email: 'link-someone-else@example.com' }));
    expect(back.searchParams.get('link')).toBe('address');
    expect(await providers(client)).toEqual(['credential']);
    expect((await sovereignAccounts()).length).toBe(before);
  });

  it('refuses a Sovereign identity that is already linked to another account', async () => {
    const first = await localAccount('link-first@example.com');
    const second = await localAccount('link-second@example.com');
    const who = person({ email: 'link-first@example.com' });
    await link(first, who);

    const back = await link(second, { ...who, email: 'link-second@example.com' });
    expect(back.searchParams.get('link')).toBe('taken');
    expect(await providers(second)).toEqual(['credential']);
    expect(await providers(first)).toContain('sovereign');
  });

  it('needs a signed-in session: nobody who is not signed in can start it', async () => {
    const reply = await visitor(t).post('/api/auth/sv/link-sovereign', {
      password: PASSWORD,
      returnTo: '/settings',
    });
    expect(reply.status).toBe(401);
    expect(reply.body?.url).toBeUndefined();
  });

  it('is still refused at sign-in for an address nobody has linked, and the message is the one the page shows', async () => {
    await localAccount('never-linked@example.com');
    const result = await login(t, fake, visitor(t), person({ email: 'never-linked@example.com' }));
    expect(result.signedIn).toBe(false);
    expect(result.location.searchParams.get('error')).toBe('account_not_linked');
  });

  it('has no other way to link or unlink: better-auth’s own routes are off', async () => {
    const client = await localAccount('link-other-ways@example.com');
    await link(client, person({ email: 'link-other-ways@example.com' }));
    const row = (
      (await client.get('/api/auth/list-accounts')).body as { id: string; providerId: string }[]
    ).find((a) => a.providerId === 'sovereign');
    const unlink = await client.post('/api/auth/unlink-account', { accountId: got(row).id });
    expect(unlink.status).toBe(404);
    const social = await client.post('/api/auth/link-social', {
      provider: 'sovereign',
      callbackURL: '/settings',
    });
    expect(social.status).toBe(404);
    expect(await providers(client)).toContain('sovereign');
  });

  it('lets a person with two-factor on sign in through Sovereign without being asked for a code: Sovereign has its own', async () => {
    const email = 'link-2fa@example.com';
    const client = await localAccount(email);
    // The second step is turned on only for a verified address (auth.md §4); this instance sends no mail.
    await t.store.run('UPDATE users SET email_verified = ? WHERE email = ?', [
      t.store.family === 'postgres' ? true : 1,
      email,
    ]);
    const enabled = await client.post('/api/auth/two-factor/enable', { password: PASSWORD });
    expect(enabled.status).toBe(200);
    expect(
      (
        await client.post('/api/auth/two-factor/verify-totp', {
          code: await totpFor(enabled.body.totpURI),
        })
      ).status,
    ).toBe(200);

    const who = person({ email });
    await link(client, who);
    const fresh = visitor(t);
    const result = await login(t, fake, fresh, who);
    expect(result.signedIn).toBe(true);
    expect((await fresh.get('/api/auth/get-session')).body.user.email).toBe(email);
  });

  it('gives an account that came in through Sovereign alone no second factor or passkey to set up, and does not refuse one that has a password', async () => {
    const client = visitor(t);
    await login(t, fake, client, person());
    for (const path of [
      '/api/auth/two-factor/enable',
      '/api/auth/two-factor/generate-backup-codes',
      '/api/auth/passkey/generate-register-options',
    ]) {
      const reply = path.includes('/passkey/')
        ? await client.get(path)
        : await client.post(path, { password: 'x' });
      expect(reply.status, path).toBe(403);
      expect(reply.body?.code, path).toBe('NO_PASSWORD_ACCOUNT');
    }
    // The same routes for an account with a password are answered by what they are for (here, a wrong password), not by this rule.
    const withPassword = await localAccount('has-password-2fa@example.com');
    const asked = await withPassword.post('/api/auth/two-factor/enable', {
      password: 'not my password',
    });
    expect(asked.body?.code).not.toBe('NO_PASSWORD_ACCOUNT');
  });
});

describe(`Sovereign sign-in against a provider that cannot be checked (${leg})`, () => {
  it('does not offer sign-in at all when discovery publishes no signing keys, rather than trusting unverified tokens', async () => {
    const fake = await startFakeSovereign({ omitFromDiscovery: ['jwks_uri'] });
    const t = await makeAuth({
      local: false,
      signUp: 'open',
      sovereign: { issuer: fake.issuer, clientId: fake.clientId, clientSecret: fake.clientSecret },
    });
    try {
      const reply = await visitor(t).post('/api/auth/sign-in/social', {
        provider: 'sovereign',
        callbackURL: '/',
      });
      expect(reply.status).toBeGreaterThanOrEqual(400);
      expect(reply.body?.url).toBeUndefined();
      expect(fake.authorizations).toHaveLength(0);
    } finally {
      await t.close();
      await fake.close();
    }
  });
});

describe(`Sovereign sign-in when only local is on (${leg})`, () => {
  let t: TestAuth;
  beforeAll(async () => {
    t = await makeAuth({ signUp: 'open' });
  });
  afterAll(async () => t.close());

  it('has no Sovereign sign-in to start', async () => {
    const reply = await visitor(t).post('/api/auth/sign-in/social', {
      provider: 'sovereign',
      callbackURL: '/',
    });
    expect(reply.status).toBeGreaterThanOrEqual(400);
    expect(reply.body?.url).toBeUndefined();
  });
});

describe(`Sovereign sign-in when core cannot be reached (${leg})`, () => {
  let t: TestAuth;
  beforeAll(async () => {
    // Nothing listens here: the instance is up, and its core is not.
    t = await makeAuth({
      signUp: 'open',
      sovereign: { issuer: 'http://localhost:1', clientId: 'x', clientSecret: 'y' },
    });
  });
  afterAll(async () => t.close());

  it('starts anyway, answers a Sovereign sign-in with a refusal and not a crash, and signs in with a password as before', async () => {
    const email = 'core-down@example.com';
    const made = await visitor(t).post('/api/auth/sign-up/email', {
      name: 'Local',
      email,
      password: 'correct horse battery',
    });
    expect(made.status).toBe(200);

    const client = visitor(t);
    const start = await client.post('/api/auth/sign-in/social', {
      provider: 'sovereign',
      callbackURL: '/',
    });
    expect(start.status).toBeGreaterThanOrEqual(400);
    expect(start.body?.url).toBeUndefined();
    expect(client.has('session_token')).toBe(false);

    const password = await client.post('/api/auth/sign-in/email', {
      email,
      password: 'correct horse battery',
    });
    expect(password.status).toBe(200);
    expect(client.has('session_token')).toBe(true);
  });
});

describe(`what Sovereign's notices find here (${leg})`, () => {
  let fake: FakeSovereign;
  let t: TestAuth;
  beforeAll(async () => {
    fake = await startFakeSovereign();
    t = await makeAuth({
      signUp: 'open',
      sovereign: { issuer: fake.issuer, clientId: fake.clientId, clientSecret: fake.clientSecret },
    });
  });
  afterAll(async () => {
    await t.close();
    await fake.close();
  });

  // Ending the sessions a notice names is the package's (`coreNotices`, src/sovereign/notices.test.ts); this is Tusk's lookup of the account.
  it('finds the account by the sub, the same one at every sign-in', async () => {
    const ada = person();
    await login(t, fake, visitor(t), ada);
    const account = got(await accountOfSub(t.store, ada.sub));
    expect(await accountOfSub(t.store, 'nobody-knows-this-sub')).toBeNull();
    expect(await login(t, fake, visitor(t), ada)).toMatchObject({ signedIn: true });
    expect(await accountOfSub(t.store, ada.sub)).toBe(account);
  });

  it('does not find a local account by a sub it has not linked', async () => {
    const email = 'local-notice@example.com';
    await visitor(t).post('/api/auth/sign-up/email', {
      name: 'Local',
      email,
      password: 'correct horse battery',
    });
    expect(await accountOfSub(t.store, email)).toBeNull();
    expect(await accountOfSub(t.store, 'local-notice')).toBeNull();
  });
});
