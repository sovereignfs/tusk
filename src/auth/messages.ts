/**
 * What to tell a person when sign-in goes wrong. better-auth answers with a code and an English message meant for developers; these say what the
 * person can do. A code that is not here falls back to better-auth's own message if it is short, and failing that to a plain sentence. **No message
 * says whether an email address has an account** (DESIGN.md §6).
 */
const BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD:
    'That email address and password do not match. Check them and try again.',
  INVALID_PASSWORD: 'That password is not right.',
  PASSWORD_TOO_SHORT: 'That password is too short.',
  PASSWORD_TOO_LONG: 'That password is too long.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'There is already an account with that email address. Try signing in instead.',
  SIGNUP_CLOSED: 'Sign-up is closed on this instance.',
  UNAUTHORIZED: 'You need to sign in first.',
  SESSION_NOT_FRESH: 'For your security, sign out, sign in again, and then try this once more.',
  FAILED_TO_UNLINK_LAST_ACCOUNT:
    'Sovereign is the only way you can sign in here, so it cannot be unlinked.',
  LINKING_DIFFERENT_EMAILS_NOT_ALLOWED:
    'That Sovereign account uses a different email address from this account. Both must use the same one.',
  NO_PASSWORD_ACCOUNT: 'This account signs in through Sovereign, which has its own.',
  EMAIL_NOT_VERIFIED:
    'Confirm your email address first: a link was sent to it. Open the link, and you are signed in.',
  INVALID_TOKEN: 'That link is not good any more. Ask for a new one.',
};

export interface AuthError {
  code?: string | undefined;
  message?: string | undefined;
  status?: number | undefined;
}

export function messageFor(
  error: AuthError | null | undefined,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (!error) return fallback;
  if (error.status === 429) return 'Too many tries. Wait a few seconds and try again.';
  const known = error.code ? BY_CODE[error.code] : undefined;
  if (known) return known;
  if (error.status === 403 && /closed/i.test(error.message ?? ''))
    return 'Sign-up is closed on this instance.';
  return error.message && error.message.length < 140 ? error.message : fallback;
}

/**
 * The `?error=` code `@sovereignfs/auth/core` puts on the sign-in page when a sign-in through Sovereign fails after the person has left and come back
 * (auth.md §8). Each says what the person can do, and none says more about an account than they already know.
 */
const BY_OAUTH_ERROR: Record<string, string> = {
  sovereign: 'Signing in with Sovereign did not complete. Try again.',
  sovereign_email: 'Sovereign did not share an email address, which this app needs.',
  sovereign_refused: 'This account cannot sign in here. Ask whoever runs this instance.',
  link_taken:
    'That Sovereign account is already linked to another account here, so nothing was linked.',
  link_address:
    'That Sovereign account’s email address belongs to another account here, so nothing was linked.',
  account_not_linked:
    'There is already an account here with that email address, signed in another way. Sign in with its password instead.',
};

/** A message for the `?error=` on the sign-in page, or null when there is none to show. */
export function oauthErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return (
    BY_OAUTH_ERROR[code] ??
    'Something went wrong with Sovereign. Try again, or ask whoever runs this instance.'
  );
}
