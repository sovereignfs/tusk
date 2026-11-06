import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CACHE_PREFIX, workerSource } from './source';

/**
 * The service worker (DESIGN.md §17.9): **what it keeps is an allow-list, and nothing else gets in.** This evaluates the very text that is served, with a
 * cache and a network that the test controls, and looks at what is in the cache after everything a signed-in person does: no page with a person's data, no
 * answer from an API, no board, no Inbox, no Settings.
 */
const ORIGIN = 'https://tusk.test';
const FILES = [
  '/_next/static/chunks/a.js',
  '/_next/static/chunks/b.css',
  '/_next/static/media/font.woff2',
];
const SHELL_HEADERS = {
  'content-type': 'text/html',
  'content-security-policy': "script-src 'nonce-ABC'",
};

interface Listener {
  (event: Record<string, unknown>): void;
}

function load(version = 'v1', files: readonly string[] = FILES) {
  const stores = new Map<string, Map<string, Response>>();
  const requested: string[] = [];
  const state = { online: true };
  /** What the network says: a page of a person for the Desk, the shell for `/shell`, and a body for anything else. */
  const network = async (input: Request | string): Promise<Response> => {
    const request = typeof input === 'string' ? new Request(`${ORIGIN}${input}`) : input;
    requested.push(new URL(request.url).pathname);
    if (!state.online) throw new TypeError('no network');
    const path = new URL(request.url).pathname;
    if (path === '/shell')
      return new Response('<html>the shell, for everyone</html>', { headers: SHELL_HEADERS });
    if (/^\/(icons\/|manifest\.webmanifest|icon\.svg|favicon\.ico)/.test(path))
      return new Response('an icon', { headers: { 'content-type': 'image/png' } });
    if (path.startsWith('/_next/static/'))
      return new Response('file', { headers: { 'content-type': 'text/javascript' } });
    if (path.startsWith('/api/'))
      return new Response('{"name":"Ada","email":"ada@example.com"}', {
        headers: { 'content-type': 'application/json' },
      });
    return new Response(`<html>Ada Lovelace, ada@example.com ${path}</html>`, {
      headers: { 'content-type': 'text/html' },
    });
  };
  const cacheOf = (name: string) => {
    let store = stores.get(name);
    if (!store) stores.set(name, (store = new Map()));
    const keyOf = (r: Request | string) =>
      (typeof r === 'string' ? new Request(`${ORIGIN}${r}`) : r).url;
    return {
      match: async (r: Request | string) => store.get(keyOf(r))?.clone(),
      put: async (r: Request | string, response: Response) => void store.set(keyOf(r), response),
      add: async (r: Request | string) => {
        const request = typeof r === 'string' ? new Request(`${ORIGIN}${r}`) : r;
        const response = await network(request);
        if (!response.ok) throw new TypeError('not ok');
        store.set(keyOf(request), response);
      },
    };
  };
  const listeners: Record<string, Listener> = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => void (listeners[type] = fn),
  };
  const context = vm.createContext({
    self,
    caches: {
      open: async (name: string) => cacheOf(name),
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
    fetch: network,
    Request,
    Response,
    URL,
    TypeError,
    Promise,
    JSON,
    Math,
  });
  vm.runInContext(workerSource(version, files), context);

  /** Fires an event and settles what it asked to wait for. */
  async function dispatch(type: string, extra: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    let answer: Promise<Response> | undefined;
    listeners[type]?.({
      ...extra,
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
      respondWith: (p: Promise<Response>) => void (answer = p),
    });
    // What it answers first, and then what it asked to wait for, which it may only ask once it has the answer.
    const response = answer ? await answer : undefined;
    await Promise.all(waits);
    return response;
  }
  const fetchEvent = (
    path: string,
    init: { mode?: string; method?: string; origin?: string } = {},
  ) => {
    const request = new Request(`${init.origin ?? ORIGIN}${path}`, {
      method: init.method ?? 'GET',
    });
    Object.defineProperty(request, 'mode', { value: init.mode ?? 'cors' });
    return dispatch('fetch', { request });
  };
  const kept = () =>
    [...stores.entries()].flatMap(([name, store]) =>
      [...store.keys()].map((url) => `${name} ${new URL(url).pathname}`),
    );
  return { dispatch, fetchEvent, kept, stores, state, requested, listeners };
}

const allowed = (path: string) =>
  path === '/shell' ||
  path.startsWith('/_next/static/') ||
  /^\/(icon\.svg|favicon\.ico|manifest\.webmanifest|icons\/[a-z0-9._-]+)$/.test(path);

describe('the worker’s cache', () => {
  it('holds, once installed, the shell and the build’s files, in a cache named for the version', async () => {
    const w = load('v7');
    await w.dispatch('install');
    expect([...w.stores.keys()]).toEqual([`${CACHE_PREFIX}v7`]);
    expect(
      w
        .kept()
        .map((entry) => entry.split(' ')[1])
        .sort(),
    ).toEqual(['/shell', ...FILES].sort());
  });

  it('keeps nothing of a person after a signed-in tour of the Desk, a board, the Inbox, Settings and the APIs', async () => {
    const w = load();
    await w.dispatch('install');
    const tour: [string, { mode?: string }][] = [
      ['/desk', { mode: 'navigate' }],
      ['/desk/11111111-1111-4111-8111-111111111111?card=x', { mode: 'navigate' }],
      ['/b/22222222-2222-4222-8222-222222222222', { mode: 'navigate' }],
      ['/w/33333333-3333-4333-8333-333333333333', { mode: 'navigate' }],
      ['/boards', { mode: 'navigate' }],
      ['/inbox', { mode: 'navigate' }],
      ['/account', { mode: 'navigate' }],
      ['/sign-in', { mode: 'navigate' }],
      ['/', { mode: 'navigate' }],
      ['/desk?_rsc=abc', {}],
      ['/api/sync', {}],
      ['/api/boards', {}],
      ['/api/auth/get-session', {}],
      ['/api/inbox/unread', {}],
      ['/p/' + 'A'.repeat(43), { mode: 'navigate' }],
      ['/_next/static/chunks/other.js', {}],
      ['/icons/icon-192.png', {}],
      ['/manifest.webmanifest', {}],
    ];
    for (const [path, init] of tour) await w.fetchEvent(path, init);
    const paths = w.kept().map((entry) => entry.split(' ')[1] as string);
    for (const path of paths) expect(allowed(path), `${path} is in the cache`).toBe(true);
    // Nothing of the account got in, by path or by what the network said.
    for (const store of w.stores.values())
      for (const response of store.values())
        expect(await response.clone().text()).not.toMatch(/Ada|ada@example/);
  });

  it('answers a request to the network and stores nothing of it, for everything that is not a file of the build, an icon or the manifest', async () => {
    const w = load();
    await w.dispatch('install');
    const before = w.kept();
    for (const path of [
      '/api/sync',
      '/api/auth/get-session',
      '/desk?_rsc=1',
      '/inbox',
      '/b/x',
      '/anything-else.json',
    ]) {
      const answer = await w.fetchEvent(path, {});
      expect(answer, path).toBeUndefined();
    }
    expect(w.kept()).toEqual(before);
  });

  it('is only for GET requests to its own origin', async () => {
    const w = load();
    await w.dispatch('install');
    const before = w.kept();
    expect(await w.fetchEvent('/_next/static/chunks/new.js', { method: 'POST' })).toBeUndefined();
    expect(
      await w.fetchEvent('/_next/static/chunks/new.js', { origin: 'https://elsewhere.test' }),
    ).toBeUndefined();
    expect(w.kept()).toEqual(before);
  });

  it('keeps a file of the build as it is asked for, and answers it from the cache after', async () => {
    const w = load();
    const first = await w.fetchEvent('/_next/static/chunks/late.js', {});
    expect(first?.status).toBe(200);
    expect(w.kept().map((e) => e.split(' ')[1])).toContain('/_next/static/chunks/late.js');
    w.state.online = false;
    const again = await w.fetchEvent('/_next/static/chunks/late.js', {});
    expect(await again?.text()).toBe('file');
  });
});

describe('with no network', () => {
  it('answers a Desk address with the shell, headers and all, so that the policy and the nonce agree', async () => {
    const w = load();
    await w.dispatch('install');
    w.state.online = false;
    for (const path of [
      '/',
      '/desk',
      '/desk/11111111-1111-4111-8111-111111111111',
      '/desk?q=milk',
      '/desk/11111111-1111-4111-8111-111111111111?card=x',
    ]) {
      const answer = await w.fetchEvent(path, { mode: 'navigate' });
      expect(await answer?.text(), path).toContain('the shell, for everyone');
      expect(answer?.headers.get('content-security-policy'), path).toBe("script-src 'nonce-ABC'");
    }
  });

  it('answers anything else with a page of its own that says it needs a connection, has no script and a policy that forbids one', async () => {
    const w = load();
    await w.dispatch('install');
    w.state.online = false;
    for (const path of [
      '/boards',
      '/inbox',
      '/b/22222222-2222-4222-8222-222222222222',
      '/account',
      '/desk/not-a-list-id',
    ]) {
      const answer = await w.fetchEvent(path, { mode: 'navigate' });
      const body = (await answer?.text()) ?? '';
      expect(body, path).toContain('This needs a connection');
      expect(body, path).not.toMatch(/<script/i);
      expect(answer?.headers.get('content-security-policy'), path).toContain("default-src 'none'");
      expect(body, path).toContain('href="/desk"');
    }
  });

  it('answers with the page that needs a connection when there is no shell yet, and lets an API fail as it would', async () => {
    const w = load();
    w.state.online = false;
    const answer = await w.fetchEvent('/desk', { mode: 'navigate' });
    expect(await answer?.text()).toContain('This needs a connection');
    expect(await w.fetchEvent('/api/sync', {})).toBeUndefined();
  });
});

describe('versions', () => {
  it('removes the caches of other versions when it activates, and no cache that is not its own kind', async () => {
    const w = load('v2');
    w.stores.set(`${CACHE_PREFIX}v1`, new Map());
    w.stores.set(`${CACHE_PREFIX}v2`, new Map());
    w.stores.set('someone-elses-cache', new Map());
    await w.dispatch('activate');
    expect([...w.stores.keys()].sort()).toEqual(['someone-elses-cache', `${CACHE_PREFIX}v2`]);
  });

  it('does not take over the pages that are open: a new version waits for the next load', () => {
    const text = workerSource('v1', FILES);
    expect(text).not.toContain('skipWaiting');
    expect(text).not.toContain('clients.claim');
  });

  it('puts the files of the build in as data and never as code', () => {
    const text = workerSource('v1', ['/_next/static/x";alert(1);//.js']);
    expect(() => new vm.Script(text)).not.toThrow();
    expect(text).not.toContain('"; alert');
  });
});
