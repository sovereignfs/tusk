import { randomBytes } from 'node:crypto';
import { is, sql } from 'drizzle-orm';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { authDirectory } from '../auth/directory';
import { entryOf, ringOf } from '../crypto/keys';
import { putCredential } from '../crypto/store';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as sqliteSchema from '../db/schema/sqlite';
import { testTarget } from '../db/test-support';
import { RateLimiter } from '../limits/rate';
import { purge } from '../sync/purge';
import { applyMutation } from '../sync/apply';
import { card, check, list, makeStore, mutation, series } from '../sync/test-support';
import type { Op } from '../workspaces/format';
import { applyOp } from '../workspaces/apply';
import { deletePerson } from './people';
import { leaveAllWorkspaces, previewLeaving } from '../workspaces/person';
import { tablesOf } from '../workspaces/tables';

/**
 * Deleting an account (DESIGN.md §22), on two real accounts and every table. **The test that keeps the routine whole:** it asks the schema for its tables, and a
 * table that is in none of the three lists below fails it, so a new table that holds something of a person cannot be added without deciding what becomes of
 * it. Then it seeds a row of each table for the person and for a second person who shares a workspace and a board with them, runs the routine (twice), and finds
 * nothing of the first where it is deleted, what is shared handed on or kept, and everything of the second intact.
 */
const { leg } = testTarget();

/** Tables whose rows are the person's, and go with them. */
const GOES = [
  'account_settings',
  'desk_list',
  'desk_card',
  'desk_check',
  'desk_series',
  'applied_mutation',
  'tombstone',
  'rate_bucket',
  'credential',
  'backup_connection',
  'workspace_member',
  'board_member',
  'card_assignee',
  'notice',
  'user',
  'session',
  'account',
  'verification',
];
/** Tables of shared work: their rows stay when the person goes (they name who made them by an id that no longer answers to a name), unless the whole workspace goes. */
const STAYS = [
  'workspace',
  'board',
  'board_list',
  'card',
  'label',
  'card_label',
  'checklist_item',
  'comment',
  'activity',
  'publication',
];
/** Tables that are about something else than a person. */
const NOT_A_PERSON = ['rate_limit'];

let t: TwoAccounts;
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  t = await twoAccounts();
  ({ database, close } = await makeStore());
});
afterAll(async () => {
  await t.close();
  await close();
});

const NOW = 1_800_000_000_000;
const id = () => crypto.randomUUID();
const directory = () => authDirectory(t.auth.database);

async function run(accountId: string, op: Op) {
  const result = await applyOp(database, accountId, { opId: id(), ...op } as never, {
    now: NOW,
    directory: directory(),
  });
  if (result.status !== 'applied') throw new Error(`${op.op} was refused: ${result.code}`);
}
const count = async (table: string, where: string): Promise<number> =>
  Number(
    (
      await dbAll<{ n: number | string }>(
        database,
        sql.raw(
          `SELECT COUNT(*) AS n FROM ${database.dialect === 'postgres' ? `tusk.${table}` : table} WHERE ${where}`,
        ),
      )
    )[0]?.n ?? 0,
  );
const authCount = async (table: string, where: string): Promise<number> =>
  Number(
    (
      await dbAll<{ n: number | string }>(
        t.auth.database,
        sql.raw(`SELECT COUNT(*) AS n FROM "${table}" WHERE ${where}`),
      )
    )[0]?.n ?? 0,
  );

describe(`the tables (${leg})`, () => {
  it('are each decided: they go with the person, they stay as shared work, or they are not about a person', () => {
    const names = Object.values(sqliteSchema)
      .filter((each) => is(each, SQLiteTable))
      .map((each) => getTableConfig(each as SQLiteTable).name);
    expect(names.length).toBeGreaterThan(20);
    const decided = new Set([...GOES, ...STAYS, ...NOT_A_PERSON]);
    expect(
      names.filter((name) => !decided.has(name)),
      'a table nobody decided about',
    ).toEqual([]);
    expect(
      [...decided].filter((name) => !names.includes(name)),
      'a table that is not there',
    ).toEqual([]);
  });
});

describe(`deleting a person (${leg})`, () => {
  it('leaves nothing of them where it goes, hands on what they alone owned, deletes what has nobody else, keeps what is shared, and leaves the other person whole', async () => {
    const [ada, grace] = [t.ada.id, t.grace.id];
    // Ada's Desk, with a list that was deleted and purged (a tombstone).
    const gone = list({ title: 'Gone' });
    const home = list({ title: 'Home' });
    const c = card(home.id);
    await applyMutation(database, ada, mutation(gone, home, c, check(c.id), series(home.id)), {
      now: NOW,
    });
    await applyMutation(
      database,
      ada,
      mutation({ table: 'desk_list', id: gone.id, deleted: true }),
      { now: NOW + 1 },
    );
    await purge(database, NOW + 30 * 86_400_000);
    // Grace's Desk, to be left whole.
    const mine = list({ title: 'Grace home' });
    await applyMutation(database, grace, mutation(mine, card(mine.id)), { now: NOW });
    // A token for a backup, a connection, and counters.
    const ring = ringOf(entryOf(randomBytes(32)).key);
    if (!ring) throw new Error('no ring');
    for (const who of [ada, grace]) {
      await putCredential(
        database,
        ring,
        { id: `backup:${who}`, accountId: who, purpose: 'github-token' },
        'github_pat_PLANTED_TOKEN',
        NOW,
      );
      await dbAll(
        database,
        sql`INSERT INTO ${sqliteSchema.backupConnection} (account_id, kind, repository, branch, credential_id, created_at) VALUES (${who}, 'token', 'o/r', 'main', ${`backup:${who}`}, ${NOW}) RETURNING account_id`,
      );
      await new RateLimiter(database).take(`ops:${who}`, { limit: 10, windowMs: 60_000 });
    }
    await dbAll(
      t.auth.database,
      sql`INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at) VALUES (${id()}, ${t.ada.email}, 'x', ${NOW}, ${NOW}, ${NOW}) RETURNING id`,
    );

    // Shared work. W1: Ada alone owns it, Grace is in it. W2: Ada alone is in it. W3: Grace's, with Ada a member.
    const [w1, w2, w3] = [id(), id(), id()];
    const [b1, b2, b3] = [id(), id(), id()];
    await run(ada, { op: 'workspace.create', id: w1, name: 'Ada and Grace' });
    await run(ada, { op: 'member.add', workspaceId: w1, email: t.grace.email });
    await run(ada, {
      op: 'board.create',
      id: b1,
      workspaceId: w1,
      name: 'Shared board',
      color: '#2563eb',
    });
    await run(ada, { op: 'workspace.create', id: w2, name: 'Only Ada' });
    await run(ada, {
      op: 'board.create',
      id: b2,
      workspaceId: w2,
      name: 'Private board',
      color: '#16a34a',
    });
    await run(grace, { op: 'workspace.create', id: w3, name: 'Grace owns' });
    await run(grace, { op: 'member.add', workspaceId: w3, email: t.ada.email });
    await run(grace, {
      op: 'board.create',
      id: b3,
      workspaceId: w3,
      name: 'Grace board',
      color: '#dc2626',
    });
    await run(ada, { op: 'board.join', id: b3 });
    const lists = async (board: string) =>
      dbAll<{ id: string }>(
        database,
        sql`SELECT id FROM ${tablesOf(database).boardList} WHERE board_id = ${board}`,
      );
    const [l1, l2, l3] = [(await lists(b1))[0], (await lists(b2))[0], (await lists(b3))[0]];
    const [k1, k2, k3] = [id(), id(), id()];
    await run(ada, {
      op: 'card.create',
      id: k1,
      listId: l1?.id ?? '',
      title: 'Ada’s card',
      position: 'a0',
    });
    await run(ada, {
      op: 'card.create',
      id: k2,
      listId: l2?.id ?? '',
      title: 'Ada’s lonely card',
      position: 'a0',
    });
    await run(ada, {
      op: 'card.create',
      id: k3,
      listId: l3?.id ?? '',
      title: 'Ada’s card on Grace’s board',
      position: 'a0',
    });
    await run(ada, { op: 'boardMember.add', boardId: b1, accountId: grace });
    await run(ada, { op: 'card.assign', cardId: k1, accountId: grace });
    await run(grace, { op: 'card.assign', cardId: k1, accountId: ada });
    await run(grace, { op: 'card.assign', cardId: k3, accountId: ada });
    await run(ada, {
      op: 'comment.add',
      id: id(),
      cardId: k3,
      body: 'Ada commented here',
    } as never);
    await run(ada, { op: 'item.add', id: id(), cardId: k1, title: 'An item', position: 'a0' });
    await run(ada, { op: 'board.publish', id: b1 });

    const before = {
      graceDesk: await count('desk_list', `owner_id = '${grace}'`),
      graceCredential: await count('credential', `account_id = '${grace}'`),
      graceBuckets: await count('rate_bucket', `"key" = 'ops:${grace}'`),
    };
    expect(await count('notice', `account_id = '${ada}' OR actor_id = '${ada}'`)).toBeGreaterThan(
      0,
    );
    expect(
      (await previewLeaving(database, directory(), ada)).map((each) => [each.name, each.to]),
    ).toEqual([
      ['Ada and Grace', t.grace.id === grace ? 'Grace' : 'Grace'],
      ['Only Ada', null],
    ]);

    const deps = { database, authDatabase: t.auth.database, now: () => NOW + 31 * 86_400_000 };
    const done = await deletePerson(deps, ada);
    expect(done).toMatchObject({ workspacesPassed: 1, workspacesDeleted: 1 });
    // Run again: nothing is left to do, and nothing goes wrong.
    expect(await deletePerson(deps, ada)).toMatchObject({
      workspacesPassed: 0,
      workspacesDeleted: 0,
      workspacesLeft: 0,
    });

    // Nothing of Ada's where it goes.
    for (const [table, where] of [
      ['account_settings', `account_id = '${ada}'`],
      ['desk_list', `owner_id = '${ada}'`],
      ['desk_card', `owner_id = '${ada}'`],
      ['desk_check', `owner_id = '${ada}'`],
      ['desk_series', `owner_id = '${ada}'`],
      ['applied_mutation', `account_id = '${ada}'`],
      ['tombstone', `account_id = '${ada}'`],
      ['rate_bucket', `"key" LIKE '%:${ada}'`],
      ['credential', `account_id = '${ada}'`],
      ['backup_connection', `account_id = '${ada}'`],
      ['workspace_member', `account_id = '${ada}'`],
      ['board_member', `account_id = '${ada}'`],
      ['card_assignee', `account_id = '${ada}'`],
      ['notice', `account_id = '${ada}' OR actor_id = '${ada}'`],
    ] as const)
      expect(await count(table, where), table).toBe(0);
    for (const [table, where] of [
      ['user', `id = '${ada}'`],
      ['session', `user_id = '${ada}'`],
      ['account', `user_id = '${ada}'`],
      ['verification', `identifier = '${t.ada.email}'`],
    ] as const)
      expect(await authCount(table, where), table).toBe(0);

    // The workspace she alone had with nobody else is gone with its boards and everything on them; the one she shared passed to Grace, who was told.
    expect(await count('workspace', `id = '${w2}'`)).toBe(0);
    expect(await count('board', `id = '${b2}'`)).toBe(0);
    expect(await count('card', `id = '${k2}'`)).toBe(0);
    expect(
      await count(
        'workspace_member',
        `workspace_id = '${w1}' AND account_id = '${grace}' AND role = 'owner'`,
      ),
    ).toBe(1);
    const told = await dbAll<{ kind: string; workspace: string | null; actor: string | null }>(
      database,
      sql`SELECT kind, workspace_id AS workspace, actor_id AS actor FROM ${tablesOf(database).notice} WHERE account_id = ${grace} AND kind = 'workspace_passed'`,
    );
    expect(told).toEqual([{ kind: 'workspace_passed', workspace: w1, actor: null }]);

    // What is shared stays: Ada's cards, comment and the board's publication and activity, now of no one who has a name. Grace's workspace is whole.
    expect(await count('card', `id IN ('${k1}', '${k3}')`)).toBe(2);
    expect(await count('comment', `card_id = '${k3}' AND author_id = '${ada}'`)).toBe(1);
    expect(await count('checklist_item', `card_id = '${k1}'`)).toBe(1);
    expect(await count('publication', `board_id = '${b1}'`)).toBe(1);
    expect(await count('activity', `actor_id = '${ada}'`)).toBeGreaterThan(0);
    expect(
      await count(
        'workspace_member',
        `workspace_id = '${w3}' AND account_id = '${grace}' AND role = 'owner'`,
      ),
    ).toBe(1);
    expect((await authDirectory(t.auth.database).profiles([ada])).size).toBe(0);

    // Grace is whole.
    expect(await count('desk_list', `owner_id = '${grace}'`)).toBe(before.graceDesk);
    expect(await count('credential', `account_id = '${grace}'`)).toBe(before.graceCredential);
    expect(await count('rate_bucket', `"key" = 'ops:${grace}'`)).toBe(before.graceBuckets);
    expect(await count('backup_connection', `account_id = '${grace}'`)).toBe(1);
    expect(await authCount('user', `id = '${grace}'`)).toBe(1);
    expect(await authCount('session', `user_id = '${grace}'`)).toBeGreaterThan(0);
  });

  it('hands a workspace to the member who has been in it longest, and tells only them', async () => {
    const [owner, early, late, middle] = [id(), id(), id(), id()];
    const w = id();
    const m = tablesOf(database);
    await dbAll(
      database,
      sql`INSERT INTO ${m.workspace} (id, name, created_by, created_at, updated_at) VALUES (${w}, 'Handed on', ${owner}, 1, 1) RETURNING id`,
    );
    for (const [who, role, at] of [
      [owner, 'owner', 1],
      [late, 'member', 300],
      [early, 'member', 50],
      [middle, 'member', 100],
    ] as const)
      await dbAll(
        database,
        sql`INSERT INTO ${m.workspaceMember} (workspace_id, account_id, role, added_by, created_at) VALUES (${w}, ${who}, ${role}, ${owner}, ${at}) RETURNING account_id`,
      );
    expect(await previewLeaving(database, { profiles: async () => new Map() }, owner)).toEqual([
      { workspaceId: w, name: 'Handed on', to: 'Someone' },
    ]);
    await leaveAllWorkspaces(database, owner, NOW);
    const owners = await dbAll<{ account: string }>(
      database,
      sql`SELECT account_id AS account FROM ${m.workspaceMember} WHERE workspace_id = ${w} AND role = 'owner'`,
    );
    expect(owners).toEqual([{ account: early }]);
    const told = await dbAll<{ account: string }>(
      database,
      sql`SELECT account_id AS account FROM ${m.notice} WHERE workspace_id = ${w}`,
    );
    expect(told).toEqual([{ account: early }]);
  });
});
