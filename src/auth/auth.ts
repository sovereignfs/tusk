import { betterAuth } from 'better-auth';
import { APIError, getSessionFromCtx } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { sovereignSignIn, type SovereignSteps } from '@sovereignfs/auth/core';
import type { Database } from '@sovereignfs/auth/database';
import {
  accountTables,
  createAuthPreset,
  movePasswords,
  resolveAuthSettings,
  signUpPolicy,
} from '@sovereignfs/auth/server';
import type { Mailer } from '../mail/mailer';
import { resetMessage, verificationMessage } from '../mail/templates';
import type { AuthSettings } from './config';

/**
 * Sign-in (DESIGN.md §6) on `@sovereignfs/auth`: better-auth on the package's preset, in the auth store, with Tusk's settings and mail. The
 * package holds every rule a sign-in keeps (auth.md §4): the server is sent the sign-in value the page derives and never a password, the
 * second step and passkeys are its own, a session is opened only through better-auth's adapter, and a sign-in through core is matched by
 * its `sub`, never by an address. Built from what it is given and nothing global, so a test makes one against any of the three databases
 * (`test-support.ts`); the server makes the one it serves (`server.ts`).
 */
export interface AuthDependencies {
  settings: AuthSettings;
  /** What the app calls itself, for the places a person sees it. */
  name: string;
  /** The auth store, as the package takes it (`src/auth/store.ts`). */
  database: Database;
  /**
   * Where mail goes, if there is any. **With a mailer an address is verified before the first sign-in and a forgotten password is reset by
   * a single-use link; without one, neither exists** and the routes that would do them are not mounted (`app/api/auth`).
   */
  mailer?: Mailer | undefined;
  /** Core's steps (the SDK's `createSovereign`), when core is a way in. */
  sovereign?: SovereignSteps | undefined;
  /** Runs a send without the request waiting for it; a test passes one it can wait on. */
  background?: ((task: Promise<unknown>) => void) | undefined;
}

/**
 * How recently a session must have been made to stand in for a password an account does not have: deleting an account that came in
 * through Sovereign alone (`/api/account/delete`). Tusk's own check, on the session's `createdAt`; better-auth's `freshAge` stays 0, and
 * an account with a password is asked for it again.
 */
export const FRESH_SESSION_SECONDS = 10 * 60;

/**
 * The paths that set up a second step or a passkey. An account that has no password (it came in through Sovereign alone) has neither:
 * Sovereign has its own (DESIGN.md §6). The pages do not show them, and these refuse, so that the page is not the only thing that says so.
 */
const FOR_PASSWORD_ACCOUNTS = new Set([
  '/two-factor/enable',
  '/two-factor/get-totp-uri',
  '/two-factor/generate-backup-codes',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
]);

/** The package's settings from Tusk's (`src/auth/config.ts`), which were checked at start-up. */
function packageSettings(settings: AuthSettings, mail: boolean) {
  return resolveAuthSettings(
    {
      url: settings.url,
      authSecret: { reveal: () => settings.secret },
      authTrustedOrigins: [],
      authTrustedProxies: [],
      authCookieDomain: undefined,
      authPasswordMinLength: settings.passwordMinLength,
      authPasswordRequireUppercase: false,
      authPasswordRequireLowercase: false,
      authPasswordRequireNumber: false,
      authPasswordRequireSymbol: false,
      // With mail, an address is verified before the first sign-in; without it, there is nothing to verify it with.
      authRequireEmailVerification: mail,
      // The relying party is the address people use (`TUSK_URL`), as before: every passkey made here still works.
      authWebauthnRpId: undefined,
      authWebauthnRpName: 'Tusk',
      authWebauthnOrigin: [],
    },
    { prefix: 'TUSK', appName: 'Tusk' },
  );
}

export function createAuth({
  settings,
  name,
  database,
  mailer,
  sovereign,
  background,
}: AuthDependencies) {
  // Mail is for the password's account: an address is verified, and a password reset, only where there is a password.
  const mail = settings.local ? mailer : undefined;
  return betterAuth(
    createAuthPreset({
      appName: name,
      database,
      tables: accountTables(database.family),
      settings: packageSettings(settings, mail !== undefined),
      mail: {
        unavailable: () => Promise.resolve(mail ? undefined : 'This instance sends no mail.'),
        verification: async (to, link) => {
          await mail?.send(verificationMessage(name, to.email, link));
        },
        passwordReset: async (to, link) => {
          await mail?.send(resetMessage(name, to.email, link));
        },
        // Tusk has never written to say an account was made.
        accountCreated: () => Promise.resolve(),
      },
      // One policy for every way an account can come to be (DESIGN.md §6); a sign-in through core always gets an account.
      registration: signUpPolicy(database, settings.signUp),
      localAccounts: settings.local,
      // Linking to core is the package's route, after the password (auth.md §8.2); unlinking is Tusk's own, after the password too
      // (`/api/account/unlink-sovereign`). better-auth's own link and unlink, which asked for neither, are off.
      disabledPaths: ['/link-social', '/unlink-account'],
      ...(background ? { background } : {}),
      hooks: {
        beforeRequest: async (ctx) => {
          if (!FOR_PASSWORD_ACCOUNTS.has(ctx.path)) return;
          const session = await getSessionFromCtx(ctx);
          if (!session) return; // the route says so itself
          const accounts = await ctx.context.internalAdapter.findAccounts(session.user.id);
          if (accounts.some((account) => account.providerId === 'credential')) return;
          throw new APIError('FORBIDDEN', {
            message: 'This account signs in through Sovereign, which has its own.',
            code: 'NO_PASSWORD_ACCOUNT',
          });
        },
      },
      plugins: [
        ...(sovereign ? [sovereignSignIn({ sovereign, database })] : []),
        // A password Tusk stored before the package (a hash of the password itself) moves at its next sign-in, for 90 days (auth.md §8.1).
        ...(settings.local ? [movePasswords({ database })] : []),
        // Last: it turns the cookies a server action sets into the response's.
        nextCookies(),
      ],
    }),
  );
}

export type Auth = ReturnType<typeof createAuth>;
