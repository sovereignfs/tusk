import { MAX_PASSWORD_LENGTH, type PasswordPolicy } from '@sovereignfs/auth';

/**
 * The password policy the pages check before they derive the sign-in value (auth.md §4): the server never sees the password, so it cannot
 * check it. Tusk asks only for a length (`TUSK_AUTH_PASSWORD_MIN_LENGTH`).
 */
export function passwordPolicy(minLength: number): PasswordPolicy {
  return {
    minLength,
    maxLength: MAX_PASSWORD_LENGTH,
    requireUppercase: false,
    requireLowercase: false,
    requireNumber: false,
    requireSymbol: false,
  };
}
