import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { type Database, openDatabase } from '../db/client';
import { dbAll } from '../db/exec';
import { runMigrations } from '../db/migrate';
import { testTarget } from '../db/test-support';
import {
  type NotificationsDeps,
  getNotifications,
  getUnread,
  parseWhich,
  postDismiss,
  postRead,
} from './notifications-endpoint';
import { sealText } from './content';
import { tablesOf } from './tables';

/**
 * Who may call what a person is told (DESIGN.md §16, task 8.7), on every form of the database: nobody without a session, nobody from another site on a write, a body that
 * is closed, and **the notices of one person never touched by another's ids**. The accounts are made first, as the other route tests do.
 */
const { leg } = testTarget();
const NOW = 1_800_000_000_000;
let t: TwoAccounts;
let database: Database;
let deps: NotificationsDeps;
beforeAll(async () => {
  t = await twoAccounts();
  database = await openDatabase(testTarget().config, 'app');
  await runMigrations(database);
  deps = {
    database,
    directory: { profiles: async () => new Map() },
    now: () => NOW,
  };
});
afterAll(async () => {
  await database.close();
  await t.close();
});

const id = () => crypto.randomUUID();
const note = async (account: string, at: number) => {
  const made = id();
  await dbAll(
    database,
    sql`INSERT INTO ${tablesOf(database).notice} (id, account_id, kind, details, created_at)
        VALUES (${made}, ${account}, 'brief', ${sealText('notice', made, 'details', '{"title":"2 due today"}')}, ${at}) RETURNING id`,
  );
  return made;
};
const states = async (account: string) =>
  dbAll<{ id: string; readAt: number | string | null; dismissedAt: number | string | null }>(
    database,
    sql`SELECT id, read_at AS "readAt", dismissed_at AS "dismissedAt" FROM ${tablesOf(database).notice}
        WHERE account_id = ${account} ORDER BY created_at, id`,
  );

describe('the parts of a body', () => {
  it('are ids of at most two hundred, or all, and nothing else', () => {
    expect(parseWhich({ ids: [id(), id()] }).ok).toBe(true);
    expect(parseWhich({ ids: [] }).ok).toBe(true);
    expect(parseWhich({ all: true }).ok).toBe(true);
    const same = id();
    const deduped = parseWhich({ ids: [same, same] });
    expect(deduped.ok && 'ids' in deduped.which && deduped.which.ids).toEqual([same]);
    for (const bad of [
      null,
      [],
      'all',
      {},
      { all: false },
      { all: 'yes' },
      { all: true, ids: [] },
      { ids: 'x' },
      { ids: ['not-an-id'] },
      { ids: [1] },
      { ids: Array.from({ length: 201 }, id) },
      { ids: [], extra: 1 },
    ])
      expect(parseWhich(bad).ok, JSON.stringify(bad)).toBe(false);
  });
});

describe(`who may call (${leg})`, () => {
  const read = () =>
    accountRoute(({ request, accountId }) => postRead(request, accountId, deps), t.deps);
  const dismissRoute = () =>
    accountRoute(({ request, accountId }) => postDismiss(request, accountId, deps), t.deps);
  const list = () =>
    accountRoute(({ request, accountId }) => getNotifications(request, accountId, deps), t.deps);
  const unread = () => accountRoute(({ accountId }) => getUnread(accountId, deps), t.deps);

  it('refuses no session (401) on every route, and another site (403) on each write, and writes nothing', async () => {
    const mine = await note(t.ada.id, NOW - 10);
    for (const [route, path, method, body] of [
      [list(), '/api/notifications', 'GET', undefined],
      [unread(), '/api/notifications/unread', 'GET', undefined],
      [read(), '/api/notifications/read', 'POST', { all: true }],
      [dismissRoute(), '/api/notifications/dismiss', 'POST', { ids: [mine] }],
    ] as const)
      expect((await route(t.request(null, path, { method, body }))).status, path).toBe(401);
    for (const [route, path] of [
      [read(), '/api/notifications/read'],
      [dismissRoute(), '/api/notifications/dismiss'],
    ] as const)
      expect(
        (
          await route(
            t.request(t.ada, path, {
              method: 'POST',
              body: { ids: [mine] },
              headers: { origin: 'https://evil.example' },
            }),
          )
        ).status,
        path,
      ).toBe(403);
    expect((await states(t.ada.id)).find((row) => row.id === mine)).toMatchObject({
      readAt: null,
      dismissedAt: null,
    });
  });

  it('is 400 for a body that is not one and for a cursor that is not one', async () => {
    for (const body of [{}, { all: false }, { ids: ['x'] }, { ids: [], more: 1 }])
      for (const route of [read(), dismissRoute()])
        expect(
          (await route(t.request(t.ada, '/api/notifications/read', { method: 'POST', body })))
            .status,
          JSON.stringify(body),
        ).toBe(400);
    expect((await list()(t.request(t.ada, '/api/notifications?beforeAt=soon'))).status).toBe(400);
  });

  it('gives a person their own notices and their own count, and reading and dismissing change only theirs', async () => {
    const [a1, a2] = [await note(t.ada.id, NOW - 30), await note(t.ada.id, NOW - 20)];
    const g1 = await note(t.grace.id, NOW - 25);
    const page = await list()(t.request(t.ada, '/api/notifications'));
    expect(page.status).toBe(200);
    const body = (await page.json()) as { notices: { id: string }[]; unread: number };
    expect(body.notices.map((n) => n.id)).toEqual(expect.arrayContaining([a1, a2]));
    expect(body.notices.map((n) => n.id)).not.toContain(g1);
    const before = (
      (await (await unread()(t.request(t.ada, '/api/notifications/unread'))).json()) as {
        unread: number;
      }
    ).unread;

    // Ada names Grace's notice with her own: nothing of Grace's changes, and the answer is the one for ids that are there.
    const read204 = await read()(
      t.request(t.ada, '/api/notifications/read', { method: 'POST', body: { ids: [a1, g1] } }),
    );
    expect(read204.status).toBe(204);
    const dismissed = await dismissRoute()(
      t.request(t.ada, '/api/notifications/dismiss', {
        method: 'POST',
        body: { ids: [a2, g1, id()] },
      }),
    );
    expect(dismissed.status).toBe(204);
    expect(await states(t.grace.id)).toEqual([{ id: g1, readAt: null, dismissedAt: null }]);
    const ada = await states(t.ada.id);
    expect(ada.find((row) => row.id === a1)?.readAt).toBe(NOW);
    expect(ada.find((row) => row.id === a2)?.dismissedAt).toBe(NOW);
    const after = (
      (await (await unread()(t.request(t.ada, '/api/notifications/unread'))).json()) as {
        unread: number;
      }
    ).unread;
    expect(after).toBe(before - 2);
    // Grace's own are still hers to read, and "all" is only hers.
    await dismissRoute()(
      t.request(t.grace, '/api/notifications/dismiss', { method: 'POST', body: { all: true } }),
    );
    expect((await states(t.grace.id))[0]?.dismissedAt).toBe(NOW);
    expect(
      (await states(t.ada.id)).filter((row) => row.dismissedAt === null).length,
    ).toBeGreaterThan(0);
  });
});
