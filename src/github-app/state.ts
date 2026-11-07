import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The `state` of an installation (DESIGN.md §21.2): a random value that goes to GitHub in the address and to the person's browser in a cookie, and must come back
 * as both. It is what stops someone else's installation being tied to this person's account by a link they were sent. The cookie is `HttpOnly` and
 * `SameSite=Lax` (it has to come back on the redirect from GitHub, a top-level navigation), `Secure` over https, kept ten minutes, and only for the callback's path.
 */
export const STATE_COOKIE = 'tusk.gh_state';
const PATH = '/api/backup/app';

export const newState = (): string => randomBytes(32).toString('base64url');

export function stateCookie(value: string, secure: boolean): string {
  return `${STATE_COOKIE}=${value}; Path=${PATH}; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`;
}

export function clearedStateCookie(secure: boolean): string {
  return `${STATE_COOKIE}=; Path=${PATH}; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

/** Whether the state that came back is the one that was sent, in constant time. A missing or different one is not. */
export function stateMatches(sent: string | undefined, back: string | null): boolean {
  if (!sent || !back || sent.length !== back.length) return false;
  return timingSafeEqual(Buffer.from(sent), Buffer.from(back));
}
