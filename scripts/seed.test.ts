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
import { authDirectory } from '../src/auth/directory';
import { assignedOf } from '../src/workspaces/inbox';
import { noticesOf } from '../src/workspaces/notifications';
import { readPublished, publicationsOf } from '../src/workspaces/published';
import { boardsOfWorkspace, readBoard } from '../src/workspaces/reads';
import { countAll } from '../src/workspaces/testing/roles';
import { SEED2_EMAIL, SEED_EMAIL, isLocalDatabase, planSeed, removeSeed, runSeed } from './seed';
import { WORKSPACE_NAME, workspaceIds } from './seed-workspace';

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

describe(`the shared workspace (${leg})`, () => {
  const twoAccounts = async () => {
    const result = await runSeed(stores(), auth.settings, { now: 1_800_000_000_000 });
    return { one: result.accountId, two: result.secondAccountId, result };
  };
  const names = async (account: string) =>
    ((await boardsOfWorkspace(app, account, workspaceIds().workspace)) ?? []).map((b) => b.name);

  it('makes a second account, a member of a workspace the first owns, with a board of every kind', async () => {
    const { one, two, result } = await twoAccounts();
    expect(one).not.toBe(two);
    expect(result.workspace.steps).toBeGreaterThan(50);
    // The owner sees all four: the public, the private, the archived and the published. The member does not see the private one.
    expect(await names(one)).toEqual(['Hiring', 'Last year', 'Marketing site', 'Product roadmap']);
    expect(await names(two)).toEqual(['Last year', 'Marketing site', 'Product roadmap']);
    const { boards } = workspaceIds();
    expect(await readBoard(app, two, boards.hiring)).toBeUndefined();
    expect((await readBoard(app, one, boards.hiring))?.board.visibility).toBe('private');
    expect((await readBoard(app, two, boards.lastYear))?.board.archived).toBe(true);
    // The public board has cards at every state: labelled, assigned, due, with checklists and comments, and one archived.
    const roadmap = await readBoard(app, two, boards.roadmap);
    expect(roadmap?.lists.map((l) => l.name)).toEqual(['Backlog', 'Doing', 'Done']);
    const cards = roadmap?.cards ?? [];
    expect(cards.some((c) => c.labels.length > 1)).toBe(true);
    expect(cards.some((c) => c.assignees.length === 2)).toBe(true);
    expect(cards.some((c) => c.dueDate !== null && c.dueDate < '2026-11-01')).toBe(true);
    expect(cards.some((c) => c.checklist.total > 0 && c.checklist.done === c.checklist.total)).toBe(
      true,
    );
    expect(cards.some((c) => c.checklist.total > 0 && c.checklist.done === 0)).toBe(true);
    expect(cards.some((c) => c.comments >= 2)).toBe(true);
    expect(cards.some((c) => c.title === 'An old idea')).toBe(false);
  });

  it('has a published board that opens signed out, with the work and none of the people', async () => {
    const { one } = await twoAccounts();
    const published = await publicationsOf(app, one);
    expect(published.map((p) => p.boardName)).toEqual(['Marketing site']);
    const board = await readPublished(app, published[0]?.token ?? '');
    expect(board?.lists.flatMap((l) => l.cards).map((c) => c.title)).toEqual([
      'Write the home page',
      'Pricing page',
    ]);
    expect(JSON.stringify(board)).not.toMatch(/seed|example\.test/i);
  });

  it('told the member what the owner did, through the door: they were added, assigned and spoken to', async () => {
    const { two } = await twoAccounts();
    const inbox = {
      ...(await noticesOf(app, authDirectory(auth.database), two)),
      assigned: await assignedOf(app, two),
    };
    const kinds = new Set(inbox.notices.map((n) => n.kind));
    for (const kind of ['added_to_workspace', 'added_to_board', 'assigned', 'comment'])
      expect(kinds, kind).toContain(kind);
    expect(inbox.notices.every((n) => n.actorName === 'Seed')).toBe(true);
    expect(inbox.assigned.length).toBeGreaterThanOrEqual(2);
    // And there is activity, written as the app writes it.
    const rows = await dbAll<{ n: number | string }>(
      app,
      sql`SELECT COUNT(*) AS n FROM ${app.dialect === 'postgres' ? postgresSchema.activity : sqliteSchema.activity}`,
    );
    expect(Number(rows[0]?.n)).toBeGreaterThan(40);
  });

  it('does not double when it is run again: not a row of any table changes', async () => {
    await twoAccounts();
    const before = JSON.stringify(await countAll(app));
    const again = await runSeed(stores(), auth.settings);
    expect(again.workspace.created).toBe(false);
    expect(JSON.stringify(await countAll(app))).toBe(before);
  });

  it('is reset by removing it and making it again, and removing leaves nothing of the workspace or the second account', async () => {
    const { two } = await twoAccounts();
    const before = await countAll(app);
    expect(await removeSeed(stores())).toBe(true);
    const gone = await countAll(app);
    for (const [table, n] of Object.entries(gone)) expect(n, table).toBe(0);
    expect(
      (
        await dbAll(
          auth.database,
          sql`SELECT 1 FROM ${auth.database.dialect === 'postgres' ? postgresSchema.user : sqliteSchema.user} WHERE email = ${SEED2_EMAIL}`,
        )
      ).length,
    ).toBe(0);
    expect((await noticesOf(app, authDirectory(auth.database), two)).notices).toEqual([]);
    const reset = await runSeed(stores(), auth.settings, { now: 1_800_000_000_000 });
    expect(reset.workspace.created).toBe(true);
    const after = await countAll(app);
    // The same rows, bar the address a board is published at, which is new.
    expect(after).toEqual(before);
    expect(WORKSPACE_NAME).toBe('Seed Studio');
  });
});
