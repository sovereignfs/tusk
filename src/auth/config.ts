import type { Problem } from '../config';

/**
 * How people sign in (DESIGN.md §6), checked once at start-up with the other settings (`src/config/index.ts`), which is why this reads through
 * a function it is given and not the environment. A wrong setting is a problem that stops the server, and no message carries a value.
 *
 *   TASKS_AUTH_LOCAL                 1 or true: email and password. Off means off: `/sign-in`, `/sign-up` and `/api/auth` answer 404.
 *   TASKS_AUTH_SECRET[_FILE]         32 characters or more, to sign sessions and tokens. Required with local sign-in.
 *   TASKS_AUTH_SIGNUP                `closed` (the default): the first account is made and then sign-up is refused, by the server. `open`:
 *                                    anyone who can reach the page. A self-hoster who forgets is not an open registration.
 *   TASKS_AUTH_PASSWORD_MIN_LENGTH   the shortest password, 10 by default.
 *   TASKS_URL                        the address people use; required with local sign-in (links, cookies and passkeys are made from it).
 *
 * With none of the ways on there is no sign-in at all, and the other settings here are not read.
 */
export interface AuthSettings {
  /** The address people use, an origin with no path. */
  readonly url: string;
  readonly secret: string;
  readonly signUp: 'open' | 'closed';
  readonly passwordMinLength: number;
}

export const MIN_SECRET_LENGTH = 32;
const DEFAULT_PASSWORD_MIN_LENGTH = 10;
const LONGEST_MIN_PASSWORD = 128;

/** The code a refused sign-up carries, in the API's answer. */
export const SIGNUP_CLOSED = 'SIGNUP_CLOSED';

/** Reads a setting by name, as `loadConfig` does: a secret may be a file, and an empty value is no value. */
export type Read = (name: string) => string | undefined;

/**
 * `url` is `TASKS_URL` once checked, and absent when it was not given or was wrong (which `loadConfig` has already reported). Returns the
 * settings, or `undefined` when sign-in is off; a wrong setting is pushed to `problems`.
 */
export function resolveAuth(
  read: Read,
  url: string | undefined,
  problems: Problem[],
): AuthSettings | undefined {
  const local = readFlag(read, 'TASKS_AUTH_LOCAL', problems);
  if (!local) return undefined;

  if (url === undefined && read('TASKS_URL') === undefined) {
    problems.push(
      'TASKS_AUTH_LOCAL is on, so TASKS_URL (the address people use) is required: links and cookies are made from it.',
    );
  }

  const secret = read('TASKS_AUTH_SECRET');
  if (secret === undefined) {
    problems.push(
      'TASKS_AUTH_LOCAL is on, so TASKS_AUTH_SECRET (or TASKS_AUTH_SECRET_FILE) is required.',
    );
  } else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(
      `TASKS_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters (openssl rand -base64 48 makes one).`,
    );
  }

  const rawSignUp = (read('TASKS_AUTH_SIGNUP') ?? '').toLowerCase() || 'closed';
  if (rawSignUp !== 'open' && rawSignUp !== 'closed') {
    problems.push('TASKS_AUTH_SIGNUP is open or closed.');
  }

  const rawLength = read('TASKS_AUTH_PASSWORD_MIN_LENGTH');
  let passwordMinLength = DEFAULT_PASSWORD_MIN_LENGTH;
  if (rawLength !== undefined) {
    const parsed = Number(rawLength);
    if (!Number.isInteger(parsed) || parsed < 8 || parsed > LONGEST_MIN_PASSWORD) {
      problems.push(
        `TASKS_AUTH_PASSWORD_MIN_LENGTH is a whole number from 8 to ${LONGEST_MIN_PASSWORD}.`,
      );
    } else passwordMinLength = parsed;
  }

  if (url === undefined || secret === undefined) return undefined;
  if (secret.length < MIN_SECRET_LENGTH || (rawSignUp !== 'open' && rawSignUp !== 'closed')) {
    return undefined;
  }
  return { url, secret, signUp: rawSignUp, passwordMinLength };
}

/** A switch is 1 or true to be on, 0 or false (or nothing) to be off; anything else is a mistake and is not guessed at. */
function readFlag(read: Read, name: string, problems: Problem[]): boolean {
  const value = read(name)?.toLowerCase();
  if (value === undefined || value === '0' || value === 'false') return false;
  if (value === '1' || value === 'true') return true;
  problems.push(`${name} is 1 or 0.`);
  return false;
}
