import { describe, expect, it } from 'vitest';
import { SESSION_COOKIES, hasSessionCookie } from './cookie';

const jar = (values: Record<string, string>) => ({
  get: (name: string) => (name in values ? { value: values[name] ?? '' } : undefined),
});

describe('the session cookie', () => {
  it('is named as @sovereignfs/auth names it, over http and over https, so the proxy and the server agree', () => {
    expect([...SESSION_COOKIES]).toEqual([
      'better-auth.session_token',
      '__Host-better-auth.session_token',
      '__Secure-better-auth.session_token',
    ]);
  });

  it('is found when it is there with a value, any name, and only then', () => {
    for (const name of SESSION_COOKIES) expect(hasSessionCookie(jar({ [name]: 'x' }))).toBe(true);
    expect(hasSessionCookie(jar({ 'better-auth.session_token': '' }))).toBe(false);
    expect(
      hasSessionCookie(
        jar({
          session_token: 'x',
          'better-auth.session_data': 'y',
          'tusk.session_token': 'z',
        }),
      ),
    ).toBe(false);
    expect(hasSessionCookie(jar({}))).toBe(false);
  });
});
