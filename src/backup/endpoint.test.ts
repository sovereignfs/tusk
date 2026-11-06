import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { entryOf, ringOf } from '../crypto/keys';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import { RateLimiter } from '../limits/rate';
import { FakeGitHub } from '../providers/testing/fake-github';
import type { RepositoryRef } from '../providers/types';
import { makeStore } from '../sync/test-support';
import {
  type ConnectionDeps,
  connectionConnect,
  connectionDisconnect,
  connectionStatus,
} from './endpoint';

/**
 * `/api/backup/connection` (DESIGN.md §21.2) as a request reaches it, with two real accounts: who may call it, that an account sees and removes only its own,
 * the answers for each refusal, and that the token is in no response, header or body, whatever happens.
 */
const { leg } = testTarget();
const TOKEN = 'github_pat_PLANTED_0123456789_TOKEN';
const ring = ringOf(entryOf(randomBytes(32)).key);

let t: TwoAccounts;
let fake: FakeGitHub;
let database: Database;
let close: () => Promise<void>;
let counter = 0;
beforeAll(async () => {
  t = await twoAccounts();
  fake = await FakeGitHub.start();
  ({ database, close } = await makeStore());
});
afterAll(async () => {
  await t.close();
  await fake.stop();
  await close();
});
beforeEach(() => {
  fake.reset();
  fake.addToken(TOKEN, { write: true });
});

const deps = (extra: Partial<ConnectionDeps> = {}): ConnectionDeps => ({
  database,
  ring,
  apiUrl: fake.url,
  now: () => 1_800_000_000_000,
  limiter: new RateLimiter(database),
  ...extra,
});
const routes = (extra: Partial<ConnectionDeps> = {}) => ({
  GET: accountRoute(({ accountId }) => connectionStatus(accountId, deps(extra)), t.deps),
  POST: accountRoute(
    ({ request, accountId }) => connectionConnect(request, accountId, deps(extra)),
    t.deps,
  ),
  DELETE: accountRoute(({ accountId }) => connectionDisconnect(accountId, deps(extra)), t.deps),
});
const repo = async (options: Parameters<FakeGitHub['createRepository']>[1] = {}) => {
  const ref: RepositoryRef = { owner: 'ada', name: `notes-${(counter += 1)}` };
  await fake.createRepository(ref, options);
  return ref;
};
const path = '/api/backup/connection';
const text = async (response: Response) => {
  const body = await response.clone().text();
  return body + JSON.stringify([...response.headers.entries()]);
};

describe(`/api/backup/connection (${leg})`, () => {
  it('is for someone signed in, and for a request from the app itself', async () => {
    const r = routes();
    expect((await r.GET(t.request(null, path))).status).toBe(401);
    expect((await r.POST(t.request(null, path, { method: 'POST', body: {} }))).status).toBe(401);
    expect((await r.DELETE(t.request(null, path, { method: 'DELETE' }))).status).toBe(401);
    const other = t.request(t.ada, path, {
      method: 'POST',
      body: { repository: 'ada/x', token: TOKEN },
      headers: { origin: 'https://evil.example' },
    });
    expect((await r.POST(other)).status).toBe(403);
    expect(
      (await r.DELETE(t.request(t.ada, path, { method: 'DELETE', headers: { origin: '' } })))
        .status,
    ).toBe(403);
  });

  it('says whether the server can keep a token, and what is connected', async () => {
    const r = routes();
    const empty = await (await r.GET(t.request(t.ada, path))).json();
    expect(empty).toEqual({ canConnect: true, connection: null });
    const keyless = await (await routes({ ring: undefined }).GET(t.request(t.ada, path))).json();
    expect(keyless).toEqual({ canConnect: false, connection: null });
  });

  it('connects, shows the connection with no secret, and disconnects', async () => {
    const r = routes();
    const ref = await repo({ defaultBranch: 'trunk' });
    const other = await r.POST(
      t.request(t.ada, path, {
        method: 'POST',
        body: { repository: `https://gitlab.com/${ref.owner}/${ref.name}`, token: TOKEN },
      }),
    );
    // Another host is refused, and the token is not sent there or anywhere.
    expect(other.status).toBe(422);
    expect(await other.json()).toMatchObject({ code: 'host' });
    expect(fake.requests).toEqual([]);

    const good = await r.POST(
      t.request(t.ada, path, {
        method: 'POST',
        body: { repository: `${ref.owner}/${ref.name}`, token: TOKEN },
      }),
    );
    expect(good.status).toBe(200);
    const everything = await text(good);
    const body = await good.json();
    expect(body).toMatchObject({
      connection: { repository: `${ref.owner}/${ref.name}`, branch: 'trunk', kind: 'token' },
    });
    expect(Object.keys(body.connection).sort()).toEqual([
      'branch',
      'connectedAt',
      'kind',
      'repository',
      'url',
    ]);
    expect(everything).not.toContain('PLANTED');

    const status = await r.GET(t.request(t.ada, path));
    expect(await text(status)).not.toContain('PLANTED');
    expect((await status.json()).connection).toMatchObject({
      repository: `${ref.owner}/${ref.name}`,
    });

    const gone = await r.DELETE(t.request(t.ada, path, { method: 'DELETE' }));
    expect(gone.status).toBe(204);
    expect((await (await r.GET(t.request(t.ada, path))).json()).connection).toBeNull();
    // The repository was not written to by any of it.
    expect(fake.requests.filter((q) => q.method !== 'GET')).toEqual([]);
  });

  it('answers each refusal with our words and a code, 422, and no token', async () => {
    const r = routes();
    const ref = await repo();
    const open = await repo({ private: false });
    const empty = await repo({ files: null });
    const send = async (repository: string, token: string) => {
      const response = await r.POST(
        t.request(t.grace, path, { method: 'POST', body: { repository, token } }),
      );
      const everything = await text(response);
      expect(everything).not.toContain('PLANTED');
      return { status: response.status, body: await response.json() };
    };
    const name = (ref: RepositoryRef) => `${ref.owner}/${ref.name}`;
    expect(await send(name(open), TOKEN)).toMatchObject({ status: 422, body: { code: 'public' } });
    expect(await send(name(empty), TOKEN)).toMatchObject({ status: 422, body: { code: 'empty' } });
    expect(await send(name(ref), 'github_pat_NOT_A_TOKEN_THE_HOST_KNOWS')).toMatchObject({
      status: 422,
      body: { code: 'token_rejected' },
    });
    const refused = await send(name(open), TOKEN);
    expect(refused.body.message).toMatch(/private/);
    // Nothing was kept for the account by any of them.
    expect((await (await r.GET(t.request(t.grace, path))).json()).connection).toBeNull();
  });

  it('warns, in words, when the token reaches more than the repository', async () => {
    const r = routes();
    const ref = await repo();
    await repo();
    const response = await r.POST(
      t.request(t.ada, path, {
        method: 'POST',
        body: { repository: `${ref.owner}/${ref.name}`, token: TOKEN },
      }),
    );
    const body = await response.json();
    expect(body.warning.alsoReaches).toBeGreaterThanOrEqual(1);
    expect(body.warning.message).toMatch(/can also reach/);
  });

  it('shows an account its own connection and no other’s, and removing one leaves the other', async () => {
    const r = routes();
    const mine = await repo();
    const theirs = await repo();
    const post = (who: typeof t.ada, ref: RepositoryRef) =>
      r.POST(
        t.request(who, path, {
          method: 'POST',
          body: { repository: `${ref.owner}/${ref.name}`, token: TOKEN },
        }),
      );
    await post(t.ada, mine);
    const nothing = await r.GET(t.request(t.grace, path));
    expect((await nothing.json()).connection).toBeNull();
    // Grace has nothing to disconnect, and that is the answer for anything that is not hers: 404, and Ada's is where it was.
    expect((await r.DELETE(t.request(t.grace, path, { method: 'DELETE' }))).status).toBe(404);
    expect((await (await r.GET(t.request(t.ada, path))).json()).connection.repository).toBe(
      `${mine.owner}/${mine.name}`,
    );
    await post(t.grace, theirs);
    expect((await r.DELETE(t.request(t.ada, path, { method: 'DELETE' }))).status).toBe(204);
    expect((await (await r.GET(t.request(t.grace, path))).json()).connection.repository).toBe(
      `${theirs.owner}/${theirs.name}`,
    );
    expect((await r.DELETE(t.request(t.ada, path, { method: 'DELETE' }))).status).toBe(404);
  });

  it('refuses what is not a request: bad JSON, the wrong shape, a body that is too big, and too many tries', async () => {
    const r = routes();
    const post = (body: unknown, raw?: string) =>
      r.POST(
        raw === undefined
          ? t.request(t.ada, path, { method: 'POST', body })
          : new Request(t.request(t.ada, path).url, {
              method: 'POST',
              headers: {
                origin: new URL(t.request(t.ada, path).url).origin,
                cookie: t.ada.client.cookieHeader(),
              },
              body: raw,
            }),
      );
    expect((await post(undefined, '{not json')).status).toBe(400);
    expect((await post({ repository: 5, token: TOKEN })).status).toBe(400);
    expect((await post({ repository: 'ada/x' })).status).toBe(400);
    expect((await post(null, 'null')).status).toBe(400);
    expect((await post({ repository: 'ada/x', token: 'x'.repeat(5000) })).status).toBe(413);

    let last = 0;
    const limited = routes({ limiter: new RateLimiter(database) });
    for (let n = 0; n < 12; n += 1)
      last = (
        await limited.POST(
          t.request(t.grace, path, { method: 'POST', body: { repository: 'nope', token: TOKEN } }),
        )
      ).status;
    expect(last).toBe(429);
  });

  it('does not connect when the server has no key, and says why', async () => {
    const ref = await repo();
    const response = await routes({ ring: undefined }).POST(
      t.request(t.ada, path, {
        method: 'POST',
        body: { repository: `${ref.owner}/${ref.name}`, token: TOKEN },
      }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'no_key' });
  });
});
