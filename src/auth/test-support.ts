import { createHash } from 'node:crypto';
import type { Database as AuthStore } from '@sovereignfs/auth/database';
import { createSovereign } from '@sovereignfs/sdk';
import { runMigrations } from '../db/migrate';
import { freshDatabase } from '../db/test-support';
import type { Mailer } from '../mail/mailer';
import { createAuth } from './auth';
import { SOVEREIGN_SCOPES, type AuthSettings } from './config';
import { migrateAuthStore } from './migrate';
import { discardingTokenStore, sdkSessionStore } from './sdk-stores';
import { openAuthStore } from './store';

/**
 * Everything a test of the sign-in flows needs: a better-auth instance on a freshly migrated auth store (on whichever database the leg is running),
 * and a client that talks to it the way a browser does: real requests with an Origin, and cookies kept between them. Through `auth.handler`, so
 * what is tested is the HTTP interface and not a shortcut.
 */
export interface TestAuth {
  auth: ReturnType<typeof createAuth>;
  settings: AuthSettings;
  /** The auth store through Tusk's own handle, for a test that reads its tables. */
  database: Awaited<ReturnType<typeof freshDatabase>>['database'];
  /** The same store as `@sovereignfs/auth` takes it. */
  store: AuthStore;
  client(): TestClient;
  /** Waits for every send the instance started in the background (mail), as a request never does. */
  settled(): Promise<void>;
  close(): Promise<void>;
}

const SETTINGS: AuthSettings = {
  url: 'http://localhost:3000',
  secret: 'test-secret-'.padEnd(40, 'x'),
  signUp: 'closed',
  passwordMinLength: 10,
  local: true,
  sovereign: undefined,
};

/** What a test changes about the instance it gets. */
export type AuthOverrides = Partial<AuthSettings>;

export async function makeAuth(overrides: AuthOverrides = {}, mailer?: Mailer): Promise<TestAuth> {
  const { database, config } = await freshDatabase('auth');
  // As the server starts: 0.2.x's tables, then onto the package's (`src/auth/migrate.ts`).
  await runMigrations(database);
  const store = await openAuthStore(config);
  await migrateAuthStore(store);
  const settings: AuthSettings = { ...SETTINGS, ...overrides };
  const pending: Promise<unknown>[] = [];
  // With core on, the SDK's client as the server makes it (`server.ts`), its stores in the same auth store.
  const sovereign = settings.sovereign
    ? createSovereign({
        appUrl: settings.url,
        coreUrl: settings.sovereign.issuer,
        clientId: settings.sovereign.clientId,
        clientSecret: settings.sovereign.clientSecret,
        scopes: SOVEREIGN_SCOPES,
        redirectPath: '/api/auth/callback/sovereign',
        postLogoutPath: '/sign-in',
        sessionStore: sdkSessionStore(() => Promise.resolve(store)),
        tokenStore: discardingTokenStore,
      })
    : undefined;
  const auth = createAuth({
    settings,
    name: 'Tusk',
    database: store,
    mailer,
    sovereign,
    background: (task) => void pending.push(task.catch(() => undefined)),
  });
  return {
    auth,
    settings,
    database,
    store,
    client: () => new TestClient(auth, settings.url),
    settled: async () => {
      while (pending.length > 0) await Promise.all(pending.splice(0));
    },
    close: async () => {
      while (pending.length > 0) await Promise.all(pending.splice(0));
      await store.close();
      await database.close();
    },
  };
}

export interface Reply {
  status: number;
  headers: Headers;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- a test reads whatever shape better-auth answers with
  setCookies: string[];
}

/** A browser, in miniature: it keeps the cookies it is given and sends them back. */
export class TestClient {
  readonly jar = new Map<string, string>();

  constructor(
    private readonly auth: { handler(request: Request): Promise<Response> },
    private readonly origin: string,
    private readonly ip = '203.0.113.7',
  ) {}

  /** As another visitor, so that a rate limit on one address does not cross into another test. */
  from(ip: string): TestClient {
    const other = new TestClient(this.auth, this.origin, ip);
    for (const [k, v] of this.jar) other.jar.set(k, v);
    return other;
  }

  /**
   * Posts as a page does: a password in the body (`password`, `newPassword`, `currentPassword`) is sent as the sign-in value a page derives
   * from it (`derivedFor`), never as itself (auth.md §4, rule 1). `postRaw` sends the body as it is, for the tests that the server refuses a
   * password and for moving a password stored before the package.
   */
  post(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    return this.request('POST', path, derivedBody(body), headers);
  }

  postRaw(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    return this.request('POST', path, body, headers);
  }

  get(path: string, headers: Record<string, string> = {}): Promise<Reply> {
    return this.request('GET', path, undefined, headers);
  }

  /** What a browser would send as `Cookie`, for a test that builds its own request (a route handler is called with one, not with a client). */
  cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** Follow a full URL (the address a sign-in sends the browser back to) as a GET, without following redirects. */
  follow(url: string): Promise<Reply> {
    const target = new URL(url);
    return this.request('GET', target.pathname + target.search, undefined, {});
  }

  has(cookieNameFragment: string): boolean {
    return [...this.jar.keys()].some((name) => name.includes(cookieNameFragment));
  }

  async request(
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<Reply> {
    const cookie = this.cookieHeader();
    const request = new Request(new URL(path, this.origin), {
      method,
      redirect: 'manual',
      headers: {
        origin: this.origin,
        'x-forwarded-for': this.ip,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const response = await this.auth.handler(request);
    const setCookies = response.headers.getSetCookie();
    for (const line of setCookies) {
      const pair = line.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '' || /max-age=0/i.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      // not JSON (a redirect, say): leave it as text
    }
    return { status: response.status, headers: response.headers, body: parsed, setCookies };
  }
}

/**
 * What a page sends for `password`: a sign-in value of the right shape, the same for the same password. A stand-in for the page's
 * derivation, whose Argon2id takes a second, since the server sees only the value: it checks the shape and hashes what it is given.
 */
export function derivedFor(password: string): string {
  return `svp1.${createHash('sha256').update(password).digest('base64url')}`;
}

const SIGN_IN_VALUE = /^svp1\.[A-Za-z0-9_-]{43}$/;
const PASSWORD_KEYS = ['password', 'newPassword', 'currentPassword'];

function derivedBody(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const key of PASSWORD_KEYS) {
    const value = out[key];
    if (typeof value === 'string' && !SIGN_IN_VALUE.test(value)) out[key] = derivedFor(value);
  }
  return out;
}
