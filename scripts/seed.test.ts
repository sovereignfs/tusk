import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestAuth, makeAuth } from '../src/auth/test-support';
import { type Database, openDatabase } from '../src/db/client';
import { resolveDatabaseConfig } from '../src/db/config';
import { dbAll } from '../src/db/exec';
import { runMigrations } from '../src/db/migrate';
import * as postgresSchema from '../src/db/schema/postgres';
import * as sqliteSchema from '../src/db/schema/sqlite';
import { testTarget } from '../src/db/test-support';
import { applyMutation } from '../src/sync/apply';
import { LIMITS } from '../src/sync/format';
import { account, card, id, list, mutation, snapshot } from '../src/sync/test-support';
import { parseMutation } from '../src/sync/validate';
import { SEED_EMAIL, isLocalDatabase, planSeed, removeSeed, runSeed } from './seed';

const { leg, config } = testTarget();

let auth: TestAuth;
let app: Database;
beforeAll(async () => {
  // The sessions' store first, which starts the stores from empty; then the app's beside it.
  auth = await makeAuth();
  app = await openDatabase(config, 'app');
  await runMigrations(app);
});
afterAll(async () => {
  await app.close();
  await auth.close();
});

const stores = () => ({ app, auth: auth.database });
const userRows = async () =>
  dbAll<{ id: string }>(
    auth.database,
    sql`SELECT id FROM ${auth.database.dialect === 'postgres' ? postgresSchema.user : sqliteSchema.user} WHERE email = ${SEED_EMAIL}`,
  );

describe('which databases the seed will touch', () => {
  it('only those on this machine: a file always, a service when its host is', () => {
    const env = (vars: Record<string, string>) => resolveDatabaseConfig(vars);
    expect(
      isLocalDatabase(env({ TUSK_DB_DIALECT: 'sqlite', TUSK_SQLITE_URL: 'file:/data/tusk.db' })),
    ).toBe(true);
    expect(
      isLocalDatabase(
        env({
          TUSK_SQLD_URL: 'http://localhost:28080',
          TUSK_SQLD_ADMIN_URL: 'http://127.0.0.1:28081',
        }),
      ),
    ).toBe(true);
    expect(
      isLocalDatabase(
        env({
          TUSK_DB_DIALECT: 'postgres',
          TUSK_POSTGRES_URL: 'postgres://u:p@localhost:5432/tusk',
        }),
      ),
    ).toBe(true);
    expect(
      isLocalDatabase(
        env({
          TUSK_DB_DIALECT: 'postgres',
          TUSK_POSTGRES_URL: 'postgres://u:p@[::1]:5432/tusk',
        }),
      ),
    ).toBe(true);
    expect(
      isLocalDatabase(
        env({
          TUSK_DB_DIALECT: 'postgres',
          TUSK_POSTGRES_URL: 'postgres://u:p@db.example.com:5432/tusk',
        }),
      ),
    ).toBe(false);
    expect(
      isLocalDatabase(
        env({ TUSK_SQLD_URL: 'http://sqld:8080', TUSK_SQLD_ADMIN_URL: 'http://sqld:8081' }),
      ),
    ).toBe(false);
    // Both addresses of a service must be here: one that is local and one that is not is not local.
    expect(
      isLocalDatabase(
        env({
          TUSK_SQLD_URL: 'http://localhost:8080',
          TUSK_SQLD_ADMIN_URL: 'http://sqld.example.com:8081',
        }),
      ),
    ).toBe(false);
    expect(
      isLocalDatabase(
        env({
          TUSK_DB_DIALECT: 'postgres',
          TUSK_POSTGRES_URL: 'postgres://u:p@localhost.evil.example.com:5432/tusk',
        }),
      ),
    ).toBe(false);
  });
});

describe('what the seed makes', () => {
  it('is mutations the server takes, with an id for every row, ids the same every time, and no two of them alike', () => {
    const plan = planSeed('account-1');
    for (const m of plan.mutations)
      expect(parseMutation(m).ok, JSON.stringify(m).slice(0, 80)).toBe(true);
    expect(JSON.stringify(planSeed('account-1'))).toBe(JSON.stringify(plan));
    expect(JSON.stringify(planSeed('account-2'))).not.toBe(JSON.stringify(plan));
    const all = [...plan.ids.desk_list, ...plan.ids.desk_card, ...plan.ids.desk_check];
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(plan.mutations.map((m) => m.mutationId)).size).toBe(plan.mutations.length);
  });

  it('covers the shapes worth looking at: an empty list, long titles and descriptions, done and open cards, a list long enough to scroll', () => {
    const plan = planSeed('account-1');
    const changes = plan.mutations.flatMap((m) => m.changes);
    const titles = changes
      .map((c) => c.fields?.title)
      .filter((t): t is { v: string } => t !== undefined && 'v' in t);
    expect(titles.some((t) => t.v.length === LIMITS.titleChars)).toBe(true);
    expect(
      changes.some(
        (c) =>
          typeof (c.fields?.description as { v?: string } | undefined)?.v === 'string' &&
          (c.fields?.description as { v: string }).v.length > 1000,
      ),
    ).toBe(true);
    expect(changes.some((c) => c.fields?.completedAt !== undefined)).toBe(true);
    const lists = changes.filter((c) => c.table === 'desk_list');
    const cards = changes.filter((c) => c.table === 'desk_card');
    const emptyLists = lists.filter((l) => !cards.some((t) => 'listId' in t && t.listId === l.id));
    expect(emptyLists.length).toBeGreaterThanOrEqual(1);
    // Checklists at nothing done, part of them, and all of them, each under a card that is open.
    const items = changes.filter((c) => c.table === 'desk_check');
    const byCard = new Map<string, boolean[]>();
    for (const item of items) {
      if (!('cardId' in item) || typeof item.cardId !== 'string') continue;
      byCard.set(item.cardId, [
        ...(byCard.get(item.cardId) ?? []),
        item.fields?.completedAt !== undefined,
      ]);
    }
    const shares = [...byCard.values()].map((done) => done.filter(Boolean).length / done.length);
    expect(shares).toContain(0);
    expect(shares).toContain(1);
    expect(shares.some((share) => share > 0 && share < 1)).toBe(true);
    for (const cardId of byCard.keys()) {
      expect(cards.find((t) => t.id === cardId)?.fields?.completedAt).toBeUndefined();
    }
    const biggest = Math.max(
      ...lists.map((l) => cards.filter((t) => 'listId' in t && t.listId === l.id).length),
    );
    expect(biggest).toBeGreaterThanOrEqual(30);
  });
});

describe(`running it (${leg})`, () => {
  it('makes an account, its lists, cards and checklists, through the store', async () => {
    const result = await runSeed(stores(), auth.settings, { now: 1_800_000_000_000 });
    expect(result.created).toBe(true);
    expect(result.lists).toBe(6);
    expect(result.cards).toBe(planSeed(result.accountId).ids.desk_card.length);
    expect(result.checks).toBe(planSeed(result.accountId).ids.desk_check.length);
    expect(result.cards).toBe(50);
    expect(result.checks).toBe(8);
    expect((await userRows()).length).toBe(1);
  });

  it('does not double when it is run again: nothing is added, and nothing is written', async () => {
    const first = await runSeed(stores(), auth.settings);
    const before = await snapshot(app, first.accountId);
    const seqOf = async () =>
      Number(
        (
          await dbAll<{ seq: number | string }>(
            app,
            sql`SELECT seq FROM ${app.dialect === 'postgres' ? postgresSchema.accountSettings : sqliteSchema.accountSettings} WHERE account_id = ${first.accountId}`,
          )
        )[0]?.seq,
      );
    const seq = await seqOf();

    const second = await runSeed(stores(), auth.settings);
    expect(second).toEqual({ ...first, created: false });
    expect(await snapshot(app, first.accountId)).toEqual(before);
    expect(await seqOf()).toBe(seq);
    expect((await userRows()).length).toBe(1);
  });

  it('removes only its own: another account’s rows, and rows the person made in the seed account, stay', async () => {
    const seeded = await runSeed(stores(), auth.settings);
    const other = account();
    const l = list({ title: 'Someone else’s' });
    await applyMutation(app, other, mutation(l, card(l.id)), { now: 1_800_000_100_000 });
    const mine = list({ title: 'Made by hand in the seed account' });
    await applyMutation(app, seeded.accountId, mutation(mine, card(mine.id)), {
      now: 1_800_000_100_000,
    });
    const theirs = await snapshot(app, other);

    expect(await removeSeed(stores())).toBe(true);

    expect(await userRows()).toEqual([]);
    expect(await snapshot(app, other)).toEqual(theirs);
    const rows = await snapshot(app, seeded.accountId);
    expect(rows.desk_list).toHaveLength(1);
    expect(rows.desk_list[0]).toMatchObject({ id: mine.id });
    expect(rows.desk_card).toHaveLength(1);
    expect(await removeSeed(stores())).toBe(false);
  });

  it('can be made again after it was removed, as new', async () => {
    const result = await runSeed(stores(), auth.settings);
    expect(result.created).toBe(true);
    expect(result.lists).toBeGreaterThanOrEqual(6);
    expect(id()).toBeTruthy();
  });
});
