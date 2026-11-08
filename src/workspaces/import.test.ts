import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll, dbRun } from '../db/exec';
import { testTarget } from '../db/test-support';
import { type BoardPart, envelope, serialise } from '../portability/format';
import { validateFile } from '../portability/validate';
import { makeStore } from '../sync/test-support';
import { exportBoard } from './export';
import { importBoard, importWorkspaces } from './import';
import { tablesOf } from './tables';
import { type World, countAll, seedBoardContents, seedWorld } from './testing/roles';
import { WORKSPACE_LIMITS } from './format';
import { openText, sealText } from './content';

/**
 * Importing a board and a workspace (DESIGN.md §20.2), on whichever database the leg runs, in the world of six roles: created and never merged, every id
 * new, in one transaction, equal to what was exported but for ids, comments and activity, with people matched by address and the rest dropped and counted.
 */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
let world: World;
const NOW = 1_800_000_900_000;
beforeAll(async () => {
  ({ database, close } = await makeStore());
  world = await seedWorld(database);
  await seedBoardContents(database, world);
  // The outsider is assigned to the open card too, though they are in no workspace: an assignee the destination will not have.
  const t = tablesOf(database);
  await dbRun(
    database,
    sql`INSERT INTO ${t.cardAssignee} (card_id, account_id, board_id, assigned_by, created_at) VALUES (${world.cards.open}, ${world.accounts.outsider}, ${world.boards.publicBoard}, ${world.accounts.boardOwner}, 1)`,
  );
  // The open card is dated and has an end, so that a round trip has one to lose (task 19.5).
  await dbRun(
    database,
    sql`UPDATE ${t.card} SET due_date = '2026-12-01', due_time = '09:00', due_end = '10:30' WHERE id = ${world.cards.open}`,
  );
  const putAway = crypto.randomUUID();
  await dbRun(
    database,
    sql`INSERT INTO ${t.card} (id, board_id, list_id, title, position, archived_at, created_by, created_at, updated_at)
        VALUES (${putAway}, ${world.boards.publicBoard}, ${world.lists.publicBoard}, ${sealText('card', putAway, 'title', 'Put away')}, 'a8', 5, ${world.accounts.boardOwner}, 1, 1)`,
  );
});
afterAll(async () => close());

const emailOf = (account: string) => `${account.slice(0, 4)}@example.com`;
const profiles = async (ids: readonly string[]) =>
  new Map(
    ids.map((each) => [
      each,
      { id: each, name: `Name of ${each.slice(0, 4)}`, email: emailOf(each), image: null },
    ]),
  );
const directory = {
  profiles,
  idOfEmail: async (email: string) =>
    Object.values(world.accounts).find((account) => emailOf(account) === email.toLowerCase()),
};

/** The file a board export makes, read as the server reads a file it is sent. */
async function fileOf(boardId: string, as: keyof World['accounts'] = 'owner'): Promise<BoardPart> {
  const board = await exportBoard(database, directory, world.accounts[as], boardId);
  if (!board) throw new Error('not exportable');
  const text = serialise(envelope('board', { board }, new Date(NOW)));
  const read = validateFile(text);
  if (!read.ok || !read.file.board) throw new Error(`not read: ${!read.ok && read.error}`);
  return read.file.board;
}

/** A board with no ids, and none of what is not imported: what "equal data" means. */
function bare(board: BoardPart) {
  const labelNames = new Map(board.labels.map((l) => [l.id, l.name]));
  return {
    name: board.name,
    color: board.color,
    description: board.description,
    visibility: board.visibility,
    // Rows that tie (the same position, the same moment) come back in the order of their new ids, so ties are ordered by what they say.
    labels: board.labels
      .map((l) => ({ name: l.name, color: l.color }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    lists: board.lists.map((l) => ({
      name: l.name,
      position: l.position,
      cards: [...l.cards]
        .sort((a, b) =>
          a.position < b.position ? -1 : a.position > b.position ? 1 : a.title < b.title ? -1 : 1,
        )
        .map((c) => ({
          title: c.title,
          description: c.description,
          dueDate: c.dueDate,
          dueTime: c.dueTime,
          dueEnd: c.dueEnd,
          position: c.position,
          archived: c.archived,
          labels: c.labels.map((id) => labelNames.get(id)).sort(),
          assignees: c.assignees,
          checklist: c.checklist.map((i) => ({
            title: i.title,
            completedAt: i.completedAt,
            position: i.position,
          })),
        })),
    })),
  };
}

const rowCount = async (table: 'board' | 'comment' | 'activity' | 'card' | 'workspace') =>
  Number(
    (
      await dbAll<{ n: number | string }>(
        database,
        sql`SELECT COUNT(*) AS n FROM ${tablesOf(database)[table]}`,
      )
    )[0]?.n ?? 0,
  );

describe(`importing a board (${leg})`, () => {
  it('into a workspace the person is in gives equal data, ignoring ids, comments and activity, with the assignees who are members and without those who are not', async () => {
    const source = await fileOf(world.boards.publicBoard);
    const made = await importBoard(
      database,
      directory,
      world.accounts.boardMember,
      world.workspace,
      source,
      NOW,
    );
    if (!made.ok) throw new Error(`refused: ${made.reason}`);
    expect(made.imported).toMatchObject({
      workspaces: 0,
      boards: 1,
      peopleDropped: 1,
      assignmentsDropped: 1,
    });
    expect(made.imported.cards).toBe(source.lists.reduce((n, l) => n + l.cards.length, 0));

    const ids = (
      await dbAll<{ id: string; name: string }>(
        database,
        sql`SELECT id, name FROM ${tablesOf(database).board} WHERE id <> ${source.id} ORDER BY created_at DESC, id`,
      )
    )
      .filter((r) => openText('board', r.id, 'name', r.name) === source.name)
      .slice(0, 1)
      .map((r) => r.id);
    const copy = await exportBoard(database, directory, world.accounts.boardMember, ids[0] ?? '');
    if (!copy) throw new Error('the copy is not there');
    const expected = bare(source);
    // The outsider is dropped from the card they were on; everyone else is as they were.
    for (const list of expected.lists)
      for (const card of list.cards)
        card.assignees = card.assignees.filter((p) => p.email !== emailOf(world.accounts.outsider));
    expect(bare(copy)).toEqual(expected);
    // Nothing of the old board's ids, comments or activity is in the copy but a line saying it was imported.
    expect(JSON.stringify(copy)).not.toContain(source.id);
    expect(copy.lists.flatMap((l) => l.cards).every((c) => c.comments.length === 0)).toBe(true);
    expect(copy.activity.map((a) => a.kind)).toEqual(['board.imported']);
    expect(copy.archived).toBe(false);
    // An archived card stays archived.
    expect(copy.lists.flatMap((l) => l.cards).find((c) => c.title === 'Put away')?.archived).toBe(
      true,
    );
  });

  it('is two copies when done twice, and never touches the board it was made from', async () => {
    const source = await fileOf(world.boards.publicBoard);
    const before = await rowCount('board');
    const cardsBefore = await rowCount('card');
    for (let i = 0; i < 2; i++) {
      const made = await importBoard(
        database,
        directory,
        world.accounts.owner,
        world.workspace,
        source,
        NOW + i,
      );
      expect(made.ok).toBe(true);
    }
    expect(await rowCount('board')).toBe(before + 2);
    const perBoard = source.lists.reduce((n, l) => n + l.cards.length, 0);
    expect(await rowCount('card')).toBe(cardsBefore + 2 * perBoard);
    expect(
      await exportBoard(database, directory, world.accounts.owner, world.boards.publicBoard),
    ).toMatchObject({ id: world.boards.publicBoard });
  });

  it('is for someone in the workspace: an outsider is told it is not there, and nothing is written', async () => {
    const source = await fileOf(world.boards.publicBoard);
    const before = await countAll(database);
    expect(
      await importBoard(database, directory, world.accounts.outsider, world.workspace, source, NOW),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await importBoard(
        database,
        directory,
        world.accounts.owner,
        crypto.randomUUID(),
        source,
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await countAll(database)).toEqual(before);
  });

  it('makes the person its owner and its only member, but for the members it assigns, and keeps a private board private', async () => {
    const source = await fileOf(world.boards.privateBoard);
    const made = await importBoard(
      database,
      directory,
      world.accounts.boardMember,
      world.workspace,
      source,
      NOW,
    );
    expect(made.ok).toBe(true);
    const t = tablesOf(database);
    const row = (
      await dbAll<{ id: string; name: string; visibility: string }>(
        database,
        sql`SELECT id, name, visibility FROM ${t.board} WHERE id <> ${source.id} ORDER BY created_at DESC, id`,
      )
    ).find((each) => openText('board', each.id, 'name', each.name) === source.name);
    expect(row?.visibility).toBe('private');
    const members = await dbAll<{ accountId: string; role: string }>(
      database,
      sql`SELECT account_id AS "accountId", role FROM ${t.boardMember} WHERE board_id = ${row?.id ?? ''}`,
    );
    expect(members).toEqual([{ accountId: world.accounts.boardMember, role: 'owner' }]);
  });

  it('is all or nothing: a row that fails, half way, leaves every table as it was', async () => {
    const source = await fileOf(world.boards.publicBoard);
    const broken: BoardPart = {
      ...source,
      lists: source.lists.map((list, i) =>
        i === 0
          ? {
              ...list,
              cards: list.cards.map((card, k) =>
                k === list.cards.length - 1 ? { ...card, position: null as never } : card,
              ),
            }
          : list,
      ),
    };
    const before = await countAll(database);
    await expect(
      importBoard(database, directory, world.accounts.owner, world.workspace, broken, NOW),
    ).rejects.toThrow();
    expect(await countAll(database)).toEqual(before);
  });
});

describe(`importing a workspace (${leg})`, () => {
  it('creates it with the person as owner and no one else, its boards in it, and no one is added whatever the file’s people say', async () => {
    const board = await fileOf(world.boards.publicBoard);
    const workspace = {
      id: crypto.randomUUID(),
      name: 'Imported',
      people: [{ name: 'Ana', email: emailOf(world.accounts.member), role: 'member' as const }],
      boards: [board],
    };
    const made = await importWorkspaces(
      database,
      directory,
      world.accounts.owner,
      [workspace],
      NOW,
    );
    if (!made.ok) throw new Error(`refused: ${made.reason}`);
    expect(made.imported).toMatchObject({ workspaces: 1, boards: 1 });
    const t = tablesOf(database);
    const created = (
      await dbAll<{ id: string; name: string }>(database, sql`SELECT id, name FROM ${t.workspace}`)
    ).find((row) => openText('workspace', row.id, 'name', row.name) === 'Imported');
    const people = await dbAll<{ accountId: string; role: string }>(
      database,
      sql`SELECT account_id AS "accountId", role FROM ${t.workspaceMember} WHERE workspace_id = ${created?.id ?? ''}`,
    );
    expect(people).toEqual([{ accountId: world.accounts.owner, role: 'owner' }]);
    expect(created?.id).not.toBe(workspace.id);
    // Everyone the boards assigned is a stranger to this new workspace, so every assignee but the importer is dropped.
    expect(made.imported.peopleDropped).toBeGreaterThan(0);
  });

  it('is refused whole when it would give the account more workspaces than it may make', async () => {
    const t = tablesOf(database);
    const person = world.accounts.coOwner;
    for (let i = 0; i < WORKSPACE_LIMITS.workspacesPerAccount; i++) {
      const filler = crypto.randomUUID();
      await dbRun(
        database,
        sql`INSERT INTO ${t.workspace} (id, name, created_by, created_at, updated_at) VALUES (${filler}, ${sealText('workspace', filler, 'name', 'filler')}, ${person}, 1, 1)`,
      );
    }
    const before = await countAll(database);
    const one = { id: crypto.randomUUID(), name: 'One too many', people: [], boards: [] };
    expect(await importWorkspaces(database, directory, person, [one], NOW)).toEqual({
      ok: false,
      reason: 'limit',
    });
    expect(await countAll(database)).toEqual(before);
  });
});
