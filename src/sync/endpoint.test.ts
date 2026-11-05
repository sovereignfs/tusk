import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { type Database, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { testTarget } from '../db/test-support';
import { type Limiter, RateLimiter } from '../limits/rate';
import { LIMITS, PROTOCOL_VERSION, type SyncResponse } from './format';
import { type SyncDeps, handleSync, readCapped, syncResponse } from './endpoint';
import { accountSeq, id, list, mutation, snapshot, task } from './test-support';

/**
 * `POST /api/sync` (DESIGN.md §8.3), with two real accounts and real sessions: what the route answers to a request, and to each mutation in it.
 */
const { leg } = testTarget();

let t: TwoAccounts;
let database: Database;
let deps: SyncDeps;
beforeAll(async () => {
  // The sessions first, which start the stores from empty; then the app's store beside them.
  t = await twoAccounts();
  database = await openDatabase(testTarget().config, 'app');
  await runMigrations(database);
  deps = { database, limiter: new RateLimiter(database), now: Date.now };
});
afterAll(async () => {
  await database.close();
  await t.close();
});

const route = (overrides: Partial<SyncDeps> = {}) =>
  accountRoute(
    ({ request, accountId }) => syncResponse(request, accountId, { ...deps, ...overrides }),
    t.deps,
  );

const body = (extra: Record<string, unknown> = {}) => ({
  protocol: PROTOCOL_VERSION,
  cursor: 0,
  mutations: [],
  ...extra,
});
const post = (who: typeof t.ada | null, sent: unknown, headers: Record<string, string> = {}) =>
  route()(t.request(who, '/api/sync', { method: 'POST', body: sent, headers }));
const answer = async (response: Response) => (await response.json()) as SyncResponse;

describe(`POST /api/sync (${leg})`, () => {
  it('applies what a device sends, answers each mutation, and sends back what changed', async () => {
    const l = list();
    const m = mutation(l, task(l.id));
    const response = await post(t.ada, body({ mutations: [m] }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const sync = await answer(response);
    expect(sync.protocol).toBe(PROTOCOL_VERSION);
    expect(sync.results).toEqual([{ mutationId: m.mutationId, status: 'applied', seq: 1 }]);
    expect(sync.pull.cursor).toBe(1);
    expect(sync.pull.rows.map((row) => row.table).sort()).toEqual(['list', 'task']);
  });

  it('answers a repeat as it answered the first time, and writes nothing', async () => {
    const l = list();
    const m = mutation(l);
    const first = await answer(await post(t.grace, body({ mutations: [m] })));
    const before = await snapshot(database, t.grace.id);
    const again = await answer(await post(t.grace, body({ mutations: [m] })));
    expect(again.results).toEqual(first.results);
    expect(await snapshot(database, t.grace.id)).toEqual(before);
  });

  it('pulls from the cursor it is given, with the mutations it brought applied first', async () => {
    const l = list();
    const first = await answer(await post(t.ada, body({ mutations: [mutation(l)], cursor: 0 })));
    const cursor = first.pull.cursor;
    const added = task(l.id);
    const next = await answer(await post(t.ada, body({ mutations: [mutation(added)], cursor })));
    expect(next.pull.rows.map((row) => row.id)).toEqual([added.id]);
    expect(next.pull.cursor).toBe(cursor + 1);
  });

  it('refuses a mutation that is not one and applies the rest, telling the device which and why', async () => {
    const good = mutation(list());
    const sync = await answer(
      await post(
        t.ada,
        body({
          mutations: [
            {
              mutationId: id(),
              changes: [
                {
                  table: 'task',
                  id: id(),
                  ownerId: t.grace.id,
                  listId: id(),
                  position: 'a0',
                  fields: { title: { v: 'x' } },
                },
              ],
            },
            'not a mutation',
            good,
          ],
        }),
      ),
    );
    expect(sync.results.map((r) => r.status)).toEqual(['refused', 'refused', 'applied']);
    expect(sync.results[0]).toMatchObject({ code: 'invalid' });
    expect(typeof (sync.results[0] as { mutationId: unknown }).mutationId).toBe('string');
    expect(sync.results[1]).toEqual({ mutationId: null, status: 'refused', code: 'invalid' });
    expect(sync.results[2]).toMatchObject({ mutationId: good.mutationId });
  });

  describe('as the wrong account', () => {
    it('cannot change what is another’s, and learns nothing of whether it exists', async () => {
      const l = list();
      const secret = task(l.id);
      await post(t.ada, body({ mutations: [mutation(l, secret)] }));
      const adaBefore = await snapshot(database, t.ada.id);

      const edit = mutation({ table: 'task', id: secret.id, fields: { title: { v: 'taken' } } });
      const nobody = mutation({ table: 'task', id: id(), fields: { title: { v: 'taken' } } });
      const stolen = await answer(await post(t.grace, body({ mutations: [edit, nobody] })));
      expect(stolen.results.map((r) => (r.status === 'refused' ? r.code : r.status))).toEqual([
        'unavailable',
        'unavailable',
      ]);
      expect(await snapshot(database, t.ada.id)).toEqual(adaBefore);
      // And what Grace is told of changes is hers alone.
      expect(JSON.stringify(stolen.pull)).not.toContain(secret.id);
      expect(JSON.stringify(stolen.pull)).not.toContain(t.ada.id);
    });

    it('cannot make a row in another’s list or with another’s id', async () => {
      const l = list();
      await post(t.ada, body({ mutations: [mutation(l)] }));
      const graceSeq = await accountSeq(database, t.grace.id);
      const sync = await answer(
        await post(
          t.grace,
          body({ mutations: [mutation(task(l.id)), mutation({ ...list(), id: l.id })] }),
        ),
      );
      expect(sync.results.map((r) => r.status)).toEqual(['refused', 'refused']);
      expect(await accountSeq(database, t.grace.id)).toBe(graceSeq);
    });
  });

  describe('who may ask', () => {
    it('is not for a visitor with no session, and nothing is read or written for one', async () => {
      const before = await accountSeq(database, t.ada.id);
      const response = await post(null, body({ mutations: [mutation(list())] }));
      expect(response.status).toBe(401);
      expect(await accountSeq(database, t.ada.id)).toBe(before);
    });

    it('is not for a request from another site, with the session left alone', async () => {
      const before = await accountSeq(database, t.ada.id);
      for (const origin of ['https://evil.example.com', '']) {
        const response = await post(t.ada, body({ mutations: [mutation(list())] }), { origin });
        expect(response.status, origin).toBe(403);
      }
      expect(await accountSeq(database, t.ada.id)).toBe(before);
    });
  });

  describe('a request that is not one', () => {
    const ask = (sent: unknown) => post(t.ada, sent);

    it('is 400 for what is not JSON, not an object, or has something it should not', async () => {
      const notJson = t.request(t.ada, '/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
      });
      expect((await route()(notJson)).status).toBe(400);
      for (const sent of [
        [],
        'x',
        5,
        null,
        { ...body(), ownerId: t.ada.id },
        { ...body(), extra: true },
      ]) {
        expect((await ask(sent)).status, JSON.stringify(sent)).toBe(400);
      }
    });

    it('is 400 for a cursor, a list of mutations or a limit that is not right', async () => {
      for (const sent of [
        body({ cursor: -1 }),
        body({ cursor: 1.5 }),
        body({ cursor: '0' }),
        body({ mutations: 'none' }),
        body({
          mutations: Array.from({ length: LIMITS.mutationsPerRequest + 1 }, () => mutation(list())),
        }),
        body({ limit: 0 }),
        body({ limit: 'many' }),
      ]) {
        expect((await ask(sent)).status, JSON.stringify(sent).slice(0, 60)).toBe(400);
      }
    });

    it('is 426 for another protocol, saying which this one speaks, and nothing is applied', async () => {
      const before = await accountSeq(database, t.ada.id);
      for (const protocol of [0, PROTOCOL_VERSION + 1, '1', undefined]) {
        const response = await ask({ ...body({ mutations: [mutation(list())] }), protocol });
        expect(response.status, String(protocol)).toBe(426);
        expect(await response.json()).toEqual({
          code: 'UPDATE_REQUIRED',
          protocol: PROTOCOL_VERSION,
        });
      }
      expect(await accountSeq(database, t.ada.id)).toBe(before);
    });

    it('is 413 when it is too big, by what it says and by what it sends', async () => {
      const big = 'x'.repeat(LIMITS.bodyBytes + 1);
      const said = await route()(
        t.request(t.ada, '/api/sync', {
          method: 'POST',
          body: big,
          headers: { 'content-length': String(big.length + 2) },
        }),
      );
      expect(said.status).toBe(413);
      expect(
        await readCapped(new Request('http://x/', { method: 'POST', body: big }), LIMITS.bodyBytes),
      ).toBeNull();
      expect(
        await readCapped(new Request('http://x/', { method: 'POST', body: 'small' }), 10),
      ).toBe('small');
      expect(
        await readCapped(new Request('http://x/', { method: 'POST', body: 'x'.repeat(11) }), 10),
      ).toBeNull();
      expect(await readCapped(new Request('http://x/'), 10)).toBe('');
    });
  });

  describe('too often', () => {
    it('is 429 with when to come back, and nothing is applied or pulled', async () => {
      const refusing: Limiter = { take: async () => ({ ok: false, retryAfterMs: 2500 }) };
      const before = await accountSeq(database, t.ada.id);
      const response = await route({ limiter: refusing })(
        t.request(t.ada, '/api/sync', {
          method: 'POST',
          body: body({ mutations: [mutation(list())] }),
        }),
      );
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('3');
      expect(await response.json()).toEqual({ code: 'RATE_LIMITED' });
      expect(await accountSeq(database, t.ada.id)).toBe(before);
    });

    it('counts each account apart', async () => {
      const keys: string[] = [];
      const counting: Limiter = { take: async (key) => (keys.push(key), { ok: true }) };
      for (const who of [t.ada, t.grace]) {
        await route({ limiter: counting })(
          t.request(who, '/api/sync', { method: 'POST', body: body() }),
        );
      }
      expect(keys).toEqual([`sync:${t.ada.id}`, `sync:${t.grace.id}`]);
    });
  });

  it('can be driven without a route: handleSync takes the account and the body', async () => {
    const response = await handleSync(JSON.stringify(body()), t.ada.id, deps);
    expect(response.status).toBe(200);
  });
});
