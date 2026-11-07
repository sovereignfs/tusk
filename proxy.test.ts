import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from './proxy';

const request = (path: string, base = 'https://tusk.example.com') =>
  new NextRequest(`${base}${path}`);

/** The `x-middleware-request-*` headers Next copies onto a response: what the page will see as its request's. */
const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);

afterEach(() => vi.unstubAllEnvs());

describe('the proxy', () => {
  it('sends a page with a Content-Security-Policy that carries the nonce the page is given', () => {
    vi.stubEnv('TUSK_URL', 'https://tusk.example.com');
    const response = proxy(request('/'));
    const policy = response.headers.get('content-security-policy') ?? '';
    const nonce = forwarded(response, 'x-nonce') ?? '';
    expect(nonce).not.toBe('');
    expect(policy).toContain(`'nonce-${nonce}'`);
    // The page's own copy of the request is given the same policy, which is where Next reads the nonce from.
    expect(forwarded(response, 'content-security-policy')).toBe(policy);
  });

  it('makes a new nonce for every request', () => {
    const nonces = new Set(
      Array.from({ length: 50 }, () => forwarded(proxy(request('/desk/1')), 'x-nonce')),
    );
    expect(nonces.size).toBe(50);
  });

  it('puts the policy on every kind of page: the landing page, a list, a missing route and sign-in', () => {
    for (const path of ['/', '/desk/abc', '/no-such-page', '/sign-in', '/settings']) {
      expect(proxy(request(path)).headers.get('content-security-policy'), path).toContain(
        "script-src 'self' 'nonce-",
      );
    }
  });

  it('turns the sign-in pages into a page that is not found when local sign-in is off, and leaves them when it is on', () => {
    const rewrite = (response: Response) => response.headers.get('x-middleware-rewrite');
    vi.stubEnv('TUSK_AUTH_LOCAL', '');
    for (const path of ['/sign-in', '/sign-up']) {
      expect(rewrite(proxy(request(path))), path).toMatch(/\/not-found$/);
      // Still a page with a policy: the page that is not found is sent like any other.
      expect(proxy(request(path)).headers.get('content-security-policy'), path).toContain('nonce-');
    }
    expect(rewrite(proxy(request('/')))).toBeNull();
    vi.stubEnv('TUSK_AUTH_LOCAL', '1');
    expect(rewrite(proxy(request('/sign-in')))).toBeNull();
    expect(rewrite(proxy(request('/sign-up')))).toBeNull();
  });

  it('sends the other addresses of Home to the front one for someone with a cookie, and leaves them to the page for anyone else', () => {
    for (const path of ['/home', '/boards']) {
      const reply = proxy(
        new NextRequest(`https://tusk.example.com${path}`, {
          headers: { cookie: 'tusk.session_token=x' },
        }),
      );
      expect(reply.status, path).toBe(308);
      expect(reply.headers.get('location'), path).toBe('https://tusk.example.com/');
      expect(
        proxy(new NextRequest(`https://tusk.example.com${path}`)).headers.get('location'),
        path,
      ).toBeNull();
    }
  });

  it('shows Home at the front address for a request with a session cookie, and keeps the address', () => {
    const rewrite = (response: Response) => response.headers.get('x-middleware-rewrite');
    for (const name of ['tusk.session_token', '__Secure-tusk.session_token']) {
      const signedIn = new NextRequest('https://tusk.example.com/', {
        headers: { cookie: `${name}=anything` },
      });
      expect(rewrite(proxy(signedIn)), name).toMatch(/\/home$/);
    }
    vi.stubEnv('TUSK_AUTH_LOCAL', '1');
    // Only for the front address, and only for a cookie that is there: not for another page, an empty value, or a cookie of another name.
    expect(rewrite(proxy(request('/')))).toBeNull();
    expect(
      rewrite(
        proxy(
          new NextRequest('https://tusk.example.com/', {
            headers: { cookie: 'tusk.session_token=' },
          }),
        ),
      ),
    ).toBeNull();
    expect(
      rewrite(
        proxy(
          new NextRequest('https://tusk.example.com/', {
            headers: { cookie: 'other=1; session_token=1' },
          }),
        ),
      ),
    ).toBeNull();
    expect(
      rewrite(
        proxy(
          new NextRequest('https://tusk.example.com/sign-in', {
            headers: { cookie: 'tusk.session_token=x' },
          }),
        ),
      ),
    ).toBeNull();
    // A policy and a nonce are on it all the same.
    const signedIn = new NextRequest('https://tusk.example.com/', {
      headers: { cookie: 'tusk.session_token=x' },
    });
    expect(proxy(signedIn).headers.get('content-security-policy')).toContain('nonce-');
  });

  it('does not make a page of an API: its answer is data, and has no nonce to leak', () => {
    for (const path of ['/api/health', '/api/sync']) {
      const response = proxy(request(path));
      expect(response.headers.get('content-security-policy'), path).toBeNull();
      expect(forwarded(response, 'x-nonce'), path).toBeNull();
    }
  });

  it('never trusts a nonce or a policy that the client sent', () => {
    const hostile = new NextRequest('https://tusk.example.com/', {
      headers: { 'x-nonce': 'attacker', 'content-security-policy': "script-src 'unsafe-inline'" },
    });
    const response = proxy(hostile);
    expect(forwarded(response, 'x-nonce')).not.toBe('attacker');
    const policy = forwarded(response, 'content-security-policy') ?? '';
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(policy).toContain(`'nonce-${forwarded(response, 'x-nonce')}'`);
  });

  it('sends HSTS over https only', () => {
    vi.stubEnv('TUSK_URL', 'https://tusk.example.com');
    expect(proxy(request('/')).headers.get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
    vi.stubEnv('TUSK_URL', 'http://localhost:3000');
    expect(
      proxy(request('/', 'http://localhost:3000')).headers.get('strict-transport-security'),
    ).toBeNull();
  });

  it('upgrades insecure requests only where the app is served over https', () => {
    vi.stubEnv('TUSK_URL', 'http://localhost:3000');
    expect(
      proxy(request('/', 'http://localhost:3000')).headers.get('content-security-policy'),
    ).not.toContain('upgrade-insecure-requests');
    vi.stubEnv('TUSK_URL', 'https://tusk.example.com');
    expect(proxy(request('/')).headers.get('content-security-policy')).toContain(
      'upgrade-insecure-requests',
    );
  });
});

describe('what the proxy looks at', () => {
  const [matcher] = config.matcher;
  const matches = (path: string) => new RegExp(`^${matcher?.source}$`).test(path);

  it('is every request but the build’s static files and the icon, which cannot carry a nonce', () => {
    for (const path of ['/', '/desk/1', '/api/health', '/sign-in', '/shell', '/iconsx']) {
      expect(matches(path), path).toBe(true);
    }
    // The worker and the manifest are files, not pages, and carry no policy of a page.
    for (const path of [
      '/_next/static/chunks/a.js',
      '/_next/image',
      '/favicon.ico',
      '/icon.svg',
      // The app’s icons (the manifest’s `icon` is one), served to a launcher that has no session here.
      '/icons/icon.svg',
      '/icons/icon-192.png',
      '/sw.js',
      '/manifest.webmanifest',
      // An import's body may be far larger than the proxy buffers; the route adds the one header the proxy would.
      '/api/import',
    ]) {
      expect(matches(path), path).toBe(false);
    }
  });

  it('leaves out prefetches, which are not pages', () => {
    expect(matcher?.missing).toEqual([
      { type: 'header', key: 'next-router-prefetch' },
      { type: 'header', key: 'purpose', value: 'prefetch' },
    ]);
  });
});
