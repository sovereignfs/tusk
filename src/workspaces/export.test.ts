import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll, dbRun } from '../db/exec';
import { testTarget } from '../db/test-support';
import { makeStore } from '../sync/test-support';
import { tablesOf } from './tables';
import { type World, seedBoardContents, seedWorld } from './testing/roles';
import { exportBoard, exportOwned, exportWorkspace, withoutIds } from './export';

/**
 * What a board and a workspace export (DESIGN.md §20.1), on whichever database the leg runs, in the world of six roles: who may export what, what is in the
 * file and what never is (a person's id, a publication token), and that two exports of unchanged data are the same text.
 */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
let world: World;
beforeAll(async () => {
  ({ database, close } = await makeStore());
  world = await seedWorld(database);
  await seedBoardContents(database, world);
  const t = tablesOf(database);
  // An activity row that kept an id of a person among the names its sentence needs, and an archived card with a comment by someone whose account is gone.
  await dbRun(
    database,
    sql`INSERT INTO ${t.activity} (id, board_id, card_id, actor_id, kind, details, created_at) VALUES (${crypto.randomUUID()}, ${world.boards.publicBoard}, ${world.cards.open}, ${world.accounts.boardMember}, 'card.assigned', ${JSON.stringify({ person: { id: world.accounts.member, name: 'Pat' }, accountId: world.accounts.owner, title: 'Open one' })}, ${1_800_000_000_500})`,
  );
});
afterAll(async () => close());

const profiles = async (ids: readonly string[]) =>
  new Map(
    ids
      .filter((each) => each !== 'gone')
      .map((each) => [
        each,
        {
          id: each,
          name: `Name of ${each.slice(0, 4)}`,
          email: `${each.slice(0, 4)}@example.com`,
          image: null,
        },
      ]),
  );
const directory = { profiles };
const publicationTokens = async () =>
  (
    await dbAll<{ token: string }>(
      database,
      sql`SELECT token FROM ${tablesOf(database).publication}`,
    )
  ).map((row) => row.token);

describe(`exporting a board (${leg})`, () => {
  it('is for anyone who can see it: a member, a viewer, an owner of the workspace; and an outsider, or a board that is not theirs, is nothing', async () => {
    for (const who of ['boardMember', 'member', 'boardOwner', 'owner', 'coOwner'] as const)
      expect(
        await exportBoard(database, directory, world.accounts[who], world.boards.publicBoard),
        who,
      ).toBeDefined();
    expect(
      await exportBoard(database, directory, world.accounts.outsider, world.boards.publicBoard),
    ).toBeUndefined();
    // The private board: its member and the workspace's owners.
    expect(
      await exportBoard(database, directory, world.accounts.boardMember, world.boards.privateBoard),
    ).toBeDefined();
    expect(
      await exportBoard(database, directory, world.accounts.owner, world.boards.privateBoard),
    ).toBeDefined();
    for (const who of ['member', 'boardOwner', 'outsider'] as const)
      expect(
        await exportBoard(database, directory, world.accounts[who], world.boards.privateBoard),
        who,
      ).toBeUndefined();
    expect(
      await exportBoard(database, directory, world.accounts.owner, crypto.randomUUID()),
    ).toBeUndefined();
  });

  it('holds the board, its lists, cards, labels, checklist, assignees, comments and activity, and archived cards with a mark', async () => {
    const board = await exportBoard(
      database,
      directory,
      world.accounts.member,
      world.boards.publicBoard,
    );
    expect(board).toMatchObject({
      id: world.boards.publicBoard,
      visibility: 'public',
      archived: false,
    });
    const list = board?.lists[0];
    expect(list?.cards.map((card) => card.title).sort()).toContain('First');
    const first = list?.cards.find((card) => card.title === 'First');
    expect(first).toMatchObject({
      archived: false,
      assignees: [{ email: `${world.accounts.boardOwner.slice(0, 4)}@example.com` }],
      checklist: [{ title: 'Step', completedAt: null }],
      comments: [{ body: 'Hello' }],
    });
    expect(first?.labels).toHaveLength(1);
    expect(board?.labels.map((label) => label.name)).toContain('Bug');
    // The archived card of the world is in the file, marked.
    const archived = list?.cards.find((card) => card.id === world.cards.archived);
    expect(archived?.archived).toBe(true);
    expect(board?.activity.length).toBeGreaterThan(1);
    expect(
      (await exportBoard(database, directory, world.accounts.owner, world.boards.archivedBoard))
        ?.archived,
    ).toBe(true);
  });

  it('names people by name and address and never by id, and holds no publication token', async () => {
    const board = await exportBoard(
      database,
      directory,
      world.accounts.member,
      world.boards.publicBoard,
    );
    const text = JSON.stringify(board);
    for (const account of Object.values(world.accounts))
      expect(text, account).not.toContain(account);
    for (const token of await publicationTokens()) expect(text).not.toContain(token);
    expect(text).not.toMatch(/token|password|secret/i);
    // The activity that kept ids has them taken out, and keeps its names.
    const assigned = board?.activity.find((entry) => entry.kind === 'card.assigned');
    expect(assigned?.details).toEqual({ person: { name: 'Pat' }, title: 'Open one' });
    expect(assigned?.actor).toEqual({
      name: `Name of ${world.accounts.boardMember.slice(0, 4)}`,
      email: `${world.accounts.boardMember.slice(0, 4)}@example.com`,
    });
  });

  it('names a person whose account is gone as so, and not by anything of theirs', async () => {
    const gone = await exportBoard(
      database,
      { profiles: async () => new Map() },
      world.accounts.member,
      world.boards.publicBoard,
    );
    const first = gone?.lists[0]?.cards.find((card) => card.title === 'First');
    expect(first?.assignees).toEqual([{ name: 'Deleted account', email: '' }]);
    expect(first?.comments[0]?.author).toEqual({ name: 'Deleted account', email: '' });
  });

  it('is the same text twice, for unchanged data', async () => {
    const [a, b] = [
      await exportBoard(database, directory, world.accounts.owner, world.boards.publicBoard),
      await exportBoard(database, directory, world.accounts.owner, world.boards.publicBoard),
    ];
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe(`exporting a workspace (${leg})`, () => {
  it('is for its owners alone: a member, a board’s owner and an outsider are told nothing', async () => {
    for (const who of ['owner', 'coOwner'] as const)
      expect(
        await exportWorkspace(database, directory, world.accounts[who], world.workspace),
        who,
      ).toBeDefined();
    for (const who of ['member', 'boardOwner', 'boardMember', 'outsider'] as const)
      expect(
        await exportWorkspace(database, directory, world.accounts[who], world.workspace),
        who,
      ).toBeUndefined();
    expect(
      await exportWorkspace(database, directory, world.accounts.owner, crypto.randomUUID()),
    ).toBeUndefined();
  });

  it('holds its people by name, address and role, and every board it has, private and archived ones too', async () => {
    const workspace = await exportWorkspace(
      database,
      directory,
      world.accounts.owner,
      world.workspace,
    );
    expect(workspace?.people.length).toBe(5);
    expect(
      workspace?.people.every(
        (p) => p.email.endsWith('@example.com') && ['owner', 'member'].includes(p.role),
      ),
    ).toBe(true);
    expect(workspace?.people.filter((p) => p.role === 'owner')).toHaveLength(2);
    expect(workspace?.people.slice(0, 2).every((p) => p.role === 'owner')).toBe(true);
    expect((workspace?.boards ?? []).map((board) => board.id).sort()).toEqual(
      Object.values(world.boards).sort(),
    );
    const text = JSON.stringify(workspace);
    for (const account of Object.values(world.accounts))
      expect(text, account).not.toContain(account);
    for (const token of await publicationTokens()) expect(text).not.toContain(token);
  });

  it('is the same text twice, and "owned" is the workspaces the person owns and no other', async () => {
    const [a, b] = [
      await exportWorkspace(database, directory, world.accounts.owner, world.workspace),
      await exportWorkspace(database, directory, world.accounts.owner, world.workspace),
    ];
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect((await exportOwned(database, directory, world.accounts.owner)).map((w) => w.id)).toEqual(
      [world.workspace],
    );
    expect(await exportOwned(database, directory, world.accounts.member)).toEqual([]);
    expect(await exportOwned(database, directory, world.accounts.outsider)).toEqual([]);
  });
});

describe('taking the ids out of what an activity kept', () => {
  it('drops a key that is an id, or ends in Id, at any depth, and keeps the rest in a fixed order', () => {
    expect(
      withoutIds({
        title: 'x',
        actorId: 'a',
        person: { id: 'p', name: 'N', other: { cardId: 'c', list: 'L' } },
        list: [{ accountId: 'z', v: 1 }],
      }),
    ).toEqual({ list: [{ v: 1 }], person: { name: 'N', other: { list: 'L' } }, title: 'x' });
    expect(withoutIds('not an object')).toEqual({});
    expect(withoutIds(null)).toEqual({});
    expect(withoutIds([1, 2])).toEqual({});
  });
});
