import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { type Database, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { testTarget } from '../db/test-support';
import { getPlanned } from './endpoint';

/**
 * Who may call `GET /api/planner` (DESIGN.md §25.1, task 19.1), on every form of the database: nobody without a session, and a range that is not two dates in
 * order of at most nine weeks is 400. What a signed-in person is given of the cards is held by `src/workspaces/planned.test.ts`, role by role. The accounts
 * are made first, as the other route tests do, since making them sets the instance's database up.
 */
const { leg } = testTarget();
let t: TwoAccounts;
let database: Database;
beforeAll(async () => {
  t = await twoAccounts();
  database = await openDatabase(testTarget().config, 'app');
  await runMigrations(database);
});
afterAll(async () => {
  await database.close();
  await t.close();
});

describe(`who may call the route (${leg})`, () => {
  const route = () =>
    accountRoute(({ request, accountId }) => getPlanned(request, accountId, database), t.deps);

  it('refuses no session (401) and a range that is not one (400), and answers a signed-in person with their own, which is nothing yet', async () => {
    const get = route();
    const path = '/api/planner?from=2026-11-01&to=2026-11-30';
    expect((await get(t.request(null, path))).status).toBe(401);
    for (const bad of [
      '/api/planner',
      '/api/planner?from=2026-11-01',
      '/api/planner?from=2026-11-30&to=2026-11-01',
      '/api/planner?from=2026-01-01&to=2026-12-31',
      '/api/planner?from=2026-02-30&to=2026-03-02',
    ])
      expect((await get(t.request(t.ada, bad))).status, bad).toBe(400);
    const ok = await get(t.request(t.ada, path));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ cards: [] });
  });
});
