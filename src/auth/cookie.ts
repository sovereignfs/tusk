import { sessionCookieName } from '@sovereignfs/auth';

/**
 * The names the session cookie can have, as `@sovereignfs/auth` names it (ADR 0001): bare over http, `__Host-` over https on the app's own
 * host, `__Secure-` with a shared cookie domain. All three are looked for, so this needs no settings. Kept apart from `auth.ts` since the
 * proxy reads it and **the proxy runs on the Edge**: it may import no Node built-in and no database, and the package's root entry imports
 * nothing.
 */
export const SESSION_COOKIES = [
  sessionCookieName({ secure: false, domain: undefined }),
  sessionCookieName({ secure: true, domain: undefined }),
  sessionCookieName({ secure: true, domain: 'shared' }),
] as const;

/**
 * Whether a request carries a session cookie. **Only that it is there**: the proxy cannot check it and does not try, and a forged one gets the app's
 * page, which checks the session itself and sends the visitor to sign in. A proxy is never the only thing standing in the way (DESIGN.md §7).
 */
export function hasSessionCookie(cookies: {
  get(name: string): { value: string } | undefined;
}): boolean {
  return SESSION_COOKIES.some((name) => (cookies.get(name)?.value ?? '') !== '');
}
