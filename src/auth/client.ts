'use client';

import {
  passwordMove,
  saltReader,
  SIGN_IN_CLIENT,
  SIGN_IN_USER_FIELDS,
  signInClientPlugins,
  signInDerivation,
} from '@sovereignfs/auth/client';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** better-auth in the browser, on `@sovereignfs/auth`'s client (auth.md §2): it never follows a redirect by itself. */
export const authClient = createAuthClient({
  ...SIGN_IN_CLIENT,
  plugins: [...signInClientPlugins(), inferAdditionalFields({ user: { ...SIGN_IN_USER_FIELDS } })],
});

/** Where the page reads the salt of the sign-in value, and whether a password from before the package can still move (`/api/sign-in-salt`). */
const SALT_DOCUMENT = '/api/sign-in-salt';

/**
 * The sign-in value, made in the page from the password, the address and the instance's vault id (auth.md §4, rule 1): the password never
 * leaves the browser. Tusk's keys do not come from the password (DESIGN.md §9), so nothing is opened with what else it makes.
 */
export const { deriveForSignIn, signInValue } = signInDerivation(
  saltReader(SALT_DOCUMENT, 'vaultId'),
);

/**
 * Moving a password stored before the package (auth.md §8.1): Tusk stored a hash of the password itself, so only while one can still
 * move, and only after an answer that is a wrong password, the page sends the password and the sign-in value once to the package's
 * route, which opens no session, and signs in again.
 */
export const passwordMoves = passwordMove({ saltDocument: SALT_DOCUMENT });
