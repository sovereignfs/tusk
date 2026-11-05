import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from './proxy';

const request = (path: string, base = 'https://tasks.example.com') =>
  new NextRequest(`${base}${path}`);

/** The `x-middleware-request-*` headers Next copies onto a response: what the page will see as its request's. */
const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);

afterEach(() => vi.unstubAllEnvs());

describe('the proxy', () => {
  it('sends a page with a Content-Security-Policy that carries the nonce the page is given', () => {
    vi.stubEnv('TASKS_URL', 'https://tasks.example.com');
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
      Array.from({ length: 50 }, () => forwarded(proxy(request('/lists/1')), 'x-nonce')),
    );
    expect(nonces.size).toBe(50);
  });

  it('puts the policy on every kind of page: the landing page, a list, a missing route and sign-in', () => {
    for (const path of ['/', '/lists/abc', '/no-such-page', '/sign-in', '/settings']) {
      expect(proxy(request(path)).headers.get('content-security-policy'), path).toContain(
        "script-src 'self' 'nonce-",
      );
    }
  });

  it('does not make a page of an API: its answer is data, and has no nonce to leak', () => {
    for (const path of ['/api/health', '/api/sync']) {
      const response = proxy(request(path));
      expect(response.headers.get('content-security-policy'), path).toBeNull();
      expect(forwarded(response, 'x-nonce'), path).toBeNull();
    }
  });

  it('never trusts a nonce or a policy that the client sent', () => {
    const hostile = new NextRequest('https://tasks.example.com/', {
      headers: { 'x-nonce': 'attacker', 'content-security-policy': "script-src 'unsafe-inline'" },
    });
    const response = proxy(hostile);
    expect(forwarded(response, 'x-nonce')).not.toBe('attacker');
    const policy = forwarded(response, 'content-security-policy') ?? '';
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(policy).toContain(`'nonce-${forwarded(response, 'x-nonce')}'`);
  });

  it('sends HSTS over https only', () => {
    vi.stubEnv('TASKS_URL', 'https://tasks.example.com');
    expect(proxy(request('/')).headers.get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
    vi.stubEnv('TASKS_URL', 'http://localhost:3000');
    expect(
      proxy(request('/', 'http://localhost:3000')).headers.get('strict-transport-security'),
    ).toBeNull();
  });

  it('upgrades insecure requests only where the app is served over https', () => {
    vi.stubEnv('TASKS_URL', 'http://localhost:3000');
    expect(
      proxy(request('/', 'http://localhost:3000')).headers.get('content-security-policy'),
    ).not.toContain('upgrade-insecure-requests');
    vi.stubEnv('TASKS_URL', 'https://tasks.example.com');
    expect(proxy(request('/')).headers.get('content-security-policy')).toContain(
      'upgrade-insecure-requests',
    );
  });
});

describe('what the proxy looks at', () => {
  const [matcher] = config.matcher;
  const matches = (path: string) => new RegExp(`^${matcher?.source}$`).test(path);

  it('is every request but the build’s static files and the icon, which cannot carry a nonce', () => {
    for (const path of ['/', '/lists/1', '/api/health', '/sign-in', '/sw.js']) {
      expect(matches(path), path).toBe(true);
    }
    for (const path of ['/_next/static/chunks/a.js', '/_next/image', '/favicon.ico', '/icon.svg']) {
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
