import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { PORTS } from './e2e/ports.ts';

/**
 * Browser tests (`pnpm build && pnpm e2e`): the real app, built, in a real browser. They are where the things a unit test cannot show are shown:
 * a page as a visitor sees it, a policy a browser enforces, a service worker, a network that goes away, and a phone's width.
 *
 * One instance of the app runs, on the database form the environment names: a leg of CI sets the variables an operator would set
 * (`TUSK_DB_DIALECT` and its address) and this uses them as they are, and with none it is a SQLite file in a directory of its own. The three
 * forms are three runs of this, as the data-layer tests are.
 *
 * Two browsers: Chromium, and WebKit, which is Safari's engine and where iOS's scrolling and compositing differ most (DESIGN.md §15.8). WebKit here
 * is a desktop build: it does not check touch, which the iOS Simulator does, by hand, and says so in the PR.
 *
 * The ports are `e2e/ports.ts`'s, shifted by `TUSK_E2E_PORT_OFFSET`, which is how `scripts/e2e-shard.mjs` runs several of these at once.
 *
 * The secret below is for this throwaway instance only.
 */
const PORT = PORTS.app;
/** Where the fake GitHub of `e2e/backup.spec.ts` listens: the app under test is told this before the test starts it. */
const GITHUB_PORT = PORTS.github;
/**
 * A second instance, for the journeys that change an account for good (a key of one's own is one way, DESIGN.md §9.1): its own SQLite file whatever the
 * first instance runs on, and its own first account, so that nothing the first instance's tests share is touched. `e2e/key.spec.ts` is the one that uses it.
 */
const KEYS_PORT = PORTS.keys;
/**
 * A third, for the journeys that change how an account signs in (an authenticator app, passkeys): the shared account of the first instance would be left needing
 * a code by one that failed half way. Its own SQLite file and its own first account, like the second's. `e2e/security.spec.ts` uses it.
 */
const SECURITY_PORT = PORTS.security;
/**
 * Two more, for signing in through Sovereign, a fake one run by `e2e/fake-sovereign-server.ts` (its ports are in `e2e/ports.ts`, and a control port says who the next
 * person to sign in is): one that takes only Sovereign and only the first account, and one that takes both ways and anyone. `e2e/sovereign.spec.ts`.
 */
const SOVEREIGN_PORT = PORTS.sovereign;
const BOTH_PORT = PORTS.both;
const CORE = {
  TUSK_CORE_URL: `http://localhost:${PORTS.coreAuth}/api/auth`,
  TUSK_CORE_CLIENT_ID: 'tusk-e2e-client',
  TUSK_CORE_CLIENT_SECRET: 'tusk-e2e-secret',
};
const SECRET = 'e2e-only-secret-not-for-anything-real-0123456789';
// Playwright loads this file again in every worker: the first load makes the directory and the others, which inherit the variable, use it.
const directory = process.env.TUSK_E2E_DIR ?? mkdtempSync(join(tmpdir(), 'tusk-e2e-'));
// The tests are told where this run keeps its files: a key one test saves is opened by the same test in the other browser (`e2e/key.spec.ts`).
process.env.TUSK_E2E_DIR = directory;

// Next reads `.env.local` and does not override what is already set, so a developer's own settings there would reach this instance. Setting a
// name, even to nothing, keeps it out: an empty value is "not set" to the app.
const BLANK = Object.fromEntries(
  [
    'TUSK_URL',
    'TUSK_AUTH_LOCAL',
    'TUSK_AUTH_SECRET',
    'TUSK_AUTH_SIGNUP',
    'TUSK_CORE_URL',
    'TUSK_CORE_CLIENT_ID',
    'TUSK_CORE_CLIENT_SECRET',
    'TUSK_CORE_CLIENT_SECRET_FILE',
    'TUSK_SMTP_HOST',
    'TUSK_WORKER',
    'TUSK_ENCRYPTION_KEY',
  ].map((name) => [name, '']),
);

// A directory of its own for each of the other instances: the auth database is `tusk_auth.db` beside the app's, so two instances in one directory would share
// their accounts, and a session cookie (which a port does not separate) would sign a person in on both.
const own = (name: string): string => {
  const folder = join(directory, name);
  mkdirSync(folder, { recursive: true });
  return join(folder, 'tusk.db');
};

// With no database named, a file in a directory of its own: the auth database is `tusk_auth.db` beside the app's, and a developer's data is not
// touched.
const database = process.env.TUSK_DB_DIALECT
  ? {}
  : { TUSK_DB_DIALECT: 'sqlite', TUSK_SQLITE_URL: `file:${join(directory, 'tusk.db')}` };

export default defineConfig({
  testDir: 'e2e',
  // One at a time: the instance shares one database, and the tests are quick.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    // First, so that it is up when the instances that sign in through it start and discover it.
    {
      command: 'node e2e/fake-sovereign-server.ts',
      url: `http://localhost:${PORTS.coreControl}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: `node scripts/serve-standalone.mjs ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        ...BLANK,
        ...database,
        TUSK_URL: `http://localhost:${PORT}`,
        TUSK_AUTH_LOCAL: '1',
        TUSK_AUTH_SECRET: SECRET,
        TUSK_AUTH_SIGNUP: 'closed',
        // A key, so that a repository can be connected, and a GitHub that is on this machine: for this throwaway instance only.
        TUSK_ENCRYPTION_KEY: 'e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0',
        TUSK_GITHUB_API_URL: `http://127.0.0.1:${GITHUB_PORT}`,
      } as Record<string, string>,
    },
    {
      command: `node scripts/serve-standalone.mjs ${KEYS_PORT}`,
      url: `http://localhost:${KEYS_PORT}/api/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        ...BLANK,
        TUSK_DB_DIALECT: 'sqlite',
        TUSK_SQLITE_URL: `file:${own('keys')}`,
        TUSK_URL: `http://localhost:${KEYS_PORT}`,
        TUSK_AUTH_LOCAL: '1',
        TUSK_AUTH_SECRET: SECRET,
        TUSK_AUTH_SIGNUP: 'closed',
      } as Record<string, string>,
    },
    {
      command: `node scripts/serve-standalone.mjs ${SECURITY_PORT}`,
      url: `http://localhost:${SECURITY_PORT}/api/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        ...BLANK,
        TUSK_DB_DIALECT: 'sqlite',
        TUSK_SQLITE_URL: `file:${own('security')}`,
        TUSK_URL: `http://localhost:${SECURITY_PORT}`,
        TUSK_AUTH_LOCAL: '1',
        TUSK_AUTH_SECRET: SECRET,
        TUSK_AUTH_SIGNUP: 'closed',
      } as Record<string, string>,
    },
    {
      command: `node scripts/serve-standalone.mjs ${SOVEREIGN_PORT}`,
      url: `http://localhost:${SOVEREIGN_PORT}/api/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        ...BLANK,
        TUSK_DB_DIALECT: 'sqlite',
        TUSK_SQLITE_URL: `file:${own('sovereign')}`,
        TUSK_URL: `http://localhost:${SOVEREIGN_PORT}`,
        TUSK_AUTH_SECRET: SECRET,
        TUSK_AUTH_SIGNUP: 'closed',
        ...CORE,
      } as Record<string, string>,
    },
    {
      command: `node scripts/serve-standalone.mjs ${BOTH_PORT}`,
      url: `http://localhost:${BOTH_PORT}/api/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        ...BLANK,
        TUSK_DB_DIALECT: 'sqlite',
        TUSK_SQLITE_URL: `file:${own('both')}`,
        TUSK_URL: `http://localhost:${BOTH_PORT}`,
        TUSK_AUTH_LOCAL: '1',
        TUSK_AUTH_SECRET: SECRET,
        TUSK_AUTH_SIGNUP: 'open',
        ...CORE,
      } as Record<string, string>,
    },
  ],
});
