import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import type { Database } from '../db/client';
import * as postgresAuth from '../db/schema/postgres/auth';
import * as sqliteAuth from '../db/schema/sqlite/auth';
import { type AuthSettings, SIGNUP_CLOSED } from './config';
import { countUsers } from './users';

/**
 * Sign-in (DESIGN.md §6) on better-auth, stored in the auth store through its Drizzle adapter. Built from settings and a database and nothing
 * global, so a test can make one against any of the three databases (`test-support.ts`); the server makes the one it serves (`server.ts`).
 */
export interface AuthDependencies {
  settings: AuthSettings;
  /** What the app calls itself, for the places a person sees it. */
  name: string;
  /** The auth store's database. */
  database: Database;
}

/** The prefix of better-auth's cookies, so that ours do not collide with another app's on localhost. */
export const COOKIE_PREFIX = 'tusk';

export function createAuth({ settings, name, database }: AuthDependencies) {
  const schema = database.dialect === 'postgres' ? postgresAuth : sqliteAuth;

  return betterAuth({
    appName: name,
    secret: settings.secret,
    baseURL: settings.url,
    trustedOrigins: [settings.url],
    database: drizzleAdapter(database.db, {
      provider: database.dialect === 'postgres' ? 'pg' : 'sqlite',
      schema,
    }),
    // Without email (task 2.3) there is nothing to verify an address with, so sign-up is immediate and signs the person in.
    emailAndPassword: {
      enabled: true,
      minPasswordLength: settings.passwordMinLength,
      autoSignIn: true,
    },
    // Counted in the database, not in memory, so that a limit holds across every process.
    rateLimit: { enabled: true, storage: 'database' },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: settings.url.startsWith('https:'),
      // better-auth skips its origin check when NODE_ENV is "test", which would let a test pass on behaviour production does not have. Say
      // so, so that the two are the same.
      disableOriginCheck: false,
    },
    databaseHooks: {
      user: {
        create: {
          // One policy for every way an account can come to be (DESIGN.md §6), here and not in a route, so that it holds for all of them.
          before: async () => {
            if (settings.signUp === 'open') return;
            if ((await countUsers(database)) > 0) {
              // With a code, so that a refusal can be told apart from any other 403.
              throw new APIError('FORBIDDEN', {
                message: 'Sign-up is closed on this instance.',
                code: SIGNUP_CLOSED,
              });
            }
          },
        },
      },
    },
    // Must be last: it turns cookies set while handling a Server Action into real ones.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
