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
