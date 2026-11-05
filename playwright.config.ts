import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

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
 * The secret below is for this throwaway instance only.
 */
const PORT = 3999;
const SECRET = 'e2e-only-secret-not-for-anything-real-0123456789';
const directory = mkdtempSync(join(tmpdir(), 'tusk-e2e-'));

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
    'TUSK_SMTP_HOST',
    'TUSK_WORKER',
    'TUSK_ENCRYPTION_KEY',
  ].map((name) => [name, '']),
);

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
  webServer: {
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
    } as Record<string, string>,
  },
});
