import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import { testTarget } from '../db/test-support';
import { parseSettingsChange, saveSettings } from '../settings/account-settings';
import { makeStore } from '../sync/test-support';
import { INDEX_AVATARS } from './format';
import { boardsIndex } from './reads';
import { tablesOf } from './tables';
import { type Role, seedWorld } from './testing/roles';

/** The boards index (DESIGN.md §17.3) and the setting that sorts it, on whichever database the leg runs on. */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

const NOW = 1_800_000_300_000;
const directory = {
  profiles: async (ids: readonly string[]) =>
    new Map(
      ids.map((each) => [
        each,
        { id: each, name: `Person ${each.slice(0, 4)}`, email: 'x@example.com', image: null },
      ]),
    ),
};
const settingsTable = () =>
  database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;

describe(`the boards index (${leg})`, () => {
  it('has, for each workspace, the boards the asker can see, and none of a private board that is not theirs', async () => {
    const w = await seedWorld(database);
    const seen = async (role: Role) => {
      const index = await boardsIndex(database, directory, w.accounts[role]);
      return index.workspaces
        .filter((each) => each.id === w.workspace)
        .flatMap((each) => each.boards.map((board) => board.name));
    };
    expect(await seen('owner')).toEqual(['Hiring', 'Last year', 'Roadmap']);
    expect(await seen('boardMember')).toEqual(['Hiring', 'Last year', 'Roadmap']);
    expect(await seen('member')).toEqual(['Last year', 'Roadmap']);
    expect(await seen('outsider')).toEqual([]);
    const archived = (await boardsIndex(database, directory, w.accounts.member)).workspaces
      .flatMap((each) => each.boards)
      .find((board) => board.name === 'Last year');
    expect(archived?.archived).toBe(true);
  });

  it('has only the workspaces the asker is in, and a workspace with no boards still', async () => {
    const [a, b] = [await seedWorld(database), await seedWorld(database)];
    const outsiderOfBoth = await boardsIndex(database, directory, a.accounts.outsider);
    expect(outsiderOfBoth.workspaces.map((each) => each.id)).not.toContain(a.workspace);
    // A workspace nobody has made a board in is listed, empty.
    const t = tablesOf(database);
    await dbAll(
      database,
      sql`DELETE FROM ${t.board} WHERE workspace_id = ${b.workspace} RETURNING 1 AS one`,
    );
    const own = (await boardsIndex(database, directory, b.accounts.owner)).workspaces.find(
      (each) => each.id === b.workspace,
    );
    expect(own).toMatchObject({ boards: [], peopleCount: 5 });
    expect(
      (await boardsIndex(database, directory, a.accounts.owner)).workspaces.map((each) => each.id),
    ).toContain(a.workspace);
  });

  it('shows a few of the people, owners first, and counts them all', async () => {
    const w = await seedWorld(database);
    const t = tablesOf(database);
    for (let i = 0; i < 3; i++)
      await dbAll(
        database,
        sql`INSERT INTO ${t.workspaceMember} (workspace_id, account_id, role, added_by, created_at) VALUES (${w.workspace}, ${crypto.randomUUID()}, 'member', ${w.accounts.owner}, ${NOW + i}) RETURNING account_id`,
      );
    const entry = (await boardsIndex(database, directory, w.accounts.member)).workspaces.find(
      (each) => each.id === w.workspace,
    );
    expect(entry?.peopleCount).toBe(8);
    expect(entry?.people).toHaveLength(INDEX_AVATARS);
    expect(entry?.people.slice(0, 2).map((each) => each.accountId)).toEqual(
      expect.arrayContaining([w.accounts.owner, w.accounts.coOwner]),
    );
    // Names, and nothing else of a person: no address.
    expect(Object.keys(entry?.people[0] ?? {}).sort()).toEqual(['accountId', 'name']);
  });

  it('is empty for an account that is in nothing', async () => {
    const index = await boardsIndex(database, directory, crypto.randomUUID());
    expect(index).toEqual({ sort: 'name', workspaces: [] });
  });
});

describe(`the sort kept with the account (${leg})`, () => {
  it('is name until it is changed, then what was chosen, on every read, and a second change replaces the first', async () => {
    const account = crypto.randomUUID();
    expect((await boardsIndex(database, directory, account)).sort).toBe('name');
    await saveSettings(database, account, { workspaceSort: 'updated' }, NOW);
    expect((await boardsIndex(database, directory, account)).sort).toBe('updated');
    await saveSettings(database, account, { workspaceSort: 'created' }, NOW + 1);
    expect((await boardsIndex(database, directory, account)).sort).toBe('created');
    const rows = await dbAll(
      database,
      sql`SELECT 1 FROM ${settingsTable()} WHERE account_id = ${account}`,
    );
    expect(rows).toHaveLength(1);
  });

  it('leaves the account’s sync counter as it was, and is one account’s only', async () => {
    const [mine, other] = [crypto.randomUUID(), crypto.randomUUID()];
    await dbAll(
      database,
      sql`INSERT INTO ${settingsTable()} (account_id, seq, created_at) VALUES (${mine}, 42, ${NOW}) RETURNING account_id`,
    );
    await saveSettings(database, mine, { workspaceSort: 'updated' }, NOW + 5);
    const [row] = await dbAll<{ seq: number | string }>(
      database,
      sql`SELECT seq FROM ${settingsTable()} WHERE account_id = ${mine}`,
    );
    expect(Number(row?.seq)).toBe(42);
    expect((await boardsIndex(database, directory, other)).sort).toBe('name');
  });

  it('keeps the zone the browser reported, beside the sort, each without touching the other', async () => {
    const account = crypto.randomUUID();
    const zoneOf = async () =>
      (
        await dbAll<{ zone: string; sort: string }>(
          database,
          sql`SELECT time_zone AS zone, workspace_sort AS sort FROM ${settingsTable()} WHERE account_id = ${account}`,
        )
      )[0];
    await saveSettings(database, account, { timeZone: 'Pacific/Auckland' }, NOW);
    expect(await zoneOf()).toEqual({ zone: 'Pacific/Auckland', sort: 'name' });
    await saveSettings(database, account, { workspaceSort: 'updated' }, NOW + 1);
    expect(await zoneOf()).toEqual({ zone: 'Pacific/Auckland', sort: 'updated' });
    await saveSettings(database, account, { timeZone: 'America/Los_Angeles' }, NOW + 2);
    expect(await zoneOf()).toEqual({ zone: 'America/Los_Angeles', sort: 'updated' });
    expect(parseSettingsChange({ timeZone: 'Europe/Berlin', workspaceSort: 'created' }).ok).toBe(
      true,
    );
  });

  it('takes a sort or a zone and nothing else', () => {
    for (const sort of ['name', 'created', 'updated'])
      expect(parseSettingsChange({ workspaceSort: sort }).ok, sort).toBe(true);
    for (const bad of [
      null,
      [],
      {},
      { workspaceSort: 'size' },
      { timeZone: 'Mars/Olympus' },
      { timeZone: 7 },
      { workspaceSort: 'name', seq: 1 },
      { seq: 1 },
      'name',
    ])
      expect(parseSettingsChange(bad).ok, JSON.stringify(bad)).toBe(false);
  });
});
