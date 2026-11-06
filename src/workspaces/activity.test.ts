import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { makeStore } from '../sync/test-support';
import { activityOfBoard, activityOfCard, activityOfPerson } from './activity-reads';
import { applyOp } from './apply';
import { ACTIVITY_PAGE, type Op, type OpRequest } from './format';
import { tablesOf } from './tables';
import { type Role, type World, seedWorld } from './testing/roles';

/** Activity (DESIGN.md §15.6), on whichever database the leg runs on: written with the change, kept as it was, read only by those who can see the board. */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

const KNOWN = '0b7e1c52-9c1e-4a8e-8d52-5a0c2f4f9a11';
const names: Record<string, string> = {};
const directory = {
  idOfEmail: async () => KNOWN,
  profiles: async (ids: readonly string[]) =>
    new Map(
      ids
        .filter((each) => names[each] !== 'GONE')
        .map((each) => [
          each,
          {
            id: each,
            name: names[each] ?? `P-${each.slice(0, 4)}`,
            email: 'x@example.com',
            image: null,
          },
        ]),
    ),
};
const id = () => crypto.randomUUID();
let clock = 1_800_000_600_000;
const apply = (w: World, role: Role, op: Op) =>
  applyOp(database, w.accounts[role], { opId: id(), ...op } as OpRequest, {
    now: (clock += 1000),
    directory,
  });
const board = async (
  w: World,
  role: Role = 'boardMember',
  before?: { createdAt: number; id: string },
) =>
  (await activityOfBoard(database, directory, w.accounts[role], w.boards.publicBoard, before)) ?? {
    activity: [],
    more: false,
  };
const texts = async (w: World) => (await board(w)).activity.map((a) => a.text);
const rowsOf = (w: World) =>
  dbAll<{ kind: string }>(
    database,
    sql`SELECT kind FROM ${tablesOf(database).activity} WHERE board_id = ${w.boards.publicBoard}`,
  );

describe(`activity (${leg})`, () => {
  it('writes a row with each change, by the actor, newest first, as a sentence with names as they were', async () => {
    const w = await seedWorld(database);
    names[w.accounts.boardMember] = 'Ana';
    names[w.accounts.boardOwner] = 'Bo';
    const doing = id();
    const card = id();
    await apply(w, 'boardMember', {
      op: 'list.create',
      id: doing,
      boardId: w.boards.publicBoard,
      name: 'Doing',
      position: 'a1',
    });
    await apply(w, 'boardMember', {
      op: 'card.create',
      id: card,
      listId: w.lists.publicBoard,
      title: 'Fix login',
      position: 'a5',
    });
    await apply(w, 'boardMember', { op: 'card.move', id: card, listId: doing, position: 'a0' });
    await apply(w, 'boardMember', { op: 'card.rename', id: card, title: 'Fix sign-in' });
    await apply(w, 'boardOwner', {
      op: 'card.assign',
      cardId: card,
      accountId: w.accounts.boardMember,
    });
    expect(await texts(w)).toEqual([
      'Bo assigned Ana to Fix sign-in',
      'Ana renamed Fix login to Fix sign-in',
      'Ana moved Fix login from Backlog to Doing',
      'Ana added Fix login to Backlog',
      'Ana added the list Doing',
    ]);
  });

  it('writes nothing for a change that was refused or that changed nothing', async () => {
    const w = await seedWorld(database);
    const before = (await rowsOf(w)).length;
    // Refused: a viewer, an outsider, a card that is not there.
    await apply(w, 'member', { op: 'card.rename', id: w.cards.open, title: 'Hijack' });
    await apply(w, 'outsider', {
      op: 'list.create',
      id: id(),
      boardId: w.boards.publicBoard,
      name: 'X',
      position: 'a9',
    });
    await apply(w, 'boardMember', { op: 'card.rename', id: id(), title: 'Nothing' });
    // Nothing changed: the same title, a move within a list, a repeat of an assignment.
    await apply(w, 'boardMember', { op: 'card.rename', id: w.cards.open, title: 'Open one' });
    await apply(w, 'boardMember', {
      op: 'card.move',
      id: w.cards.open,
      listId: w.lists.publicBoard,
      position: 'a7',
    });
    await apply(w, 'boardMember', {
      op: 'card.assign',
      cardId: w.cards.open,
      accountId: w.accounts.boardMember,
    });
    const rows = await rowsOf(w);
    expect(rows.length - before).toBe(1);
    await apply(w, 'boardMember', {
      op: 'card.assign',
      cardId: w.cards.open,
      accountId: w.accounts.boardMember,
    });
    expect((await rowsOf(w)).length).toBe(rows.length);
  });

  it('keeps reading the same after the card is renamed or deleted, and the card’s own is readable then too', async () => {
    const w = await seedWorld(database);
    const card = id();
    await apply(w, 'boardMember', {
      op: 'card.create',
      id: card,
      listId: w.lists.publicBoard,
      title: 'Short-lived',
      position: 'a5',
    });
    await apply(w, 'boardMember', { op: 'card.rename', id: card, title: 'Renamed' });
    await apply(w, 'boardMember', { op: 'card.archive', id: card });
    await apply(w, 'boardMember', { op: 'card.delete', id: card });
    const own = await activityOfCard(database, directory, w.accounts.member, card);
    expect(own?.activity.map((a) => a.text.replace(/^\S+ /, ''))).toEqual([
      'deleted Renamed',
      'archived Renamed',
      'renamed Short-lived to Renamed',
      'added Short-lived to Backlog',
    ]);
    // Nothing of the card is left but its history, and that history is the board's too.
    expect(
      (await dbAll(database, sql`SELECT 1 FROM ${tablesOf(database).card} WHERE id = ${card}`))
        .length,
    ).toBe(0);
    expect((await board(w)).activity.map((a) => a.text)).toEqual(
      expect.arrayContaining([own?.activity[0]?.text]),
    );
    // Not for an outsider, and not for a card nobody has heard of.
    expect(await activityOfCard(database, directory, w.accounts.outsider, card)).toBeUndefined();
    expect(await activityOfCard(database, directory, w.accounts.member, id())).toBeUndefined();
  });

  it('writes the changes of due dates, labels, checklists, comments, lists and the board', async () => {
    const w = await seedWorld(database);
    await apply(w, 'boardMember', {
      op: 'card.setDue',
      id: w.cards.open,
      dueDate: '2026-12-01',
      dueTime: '09:00',
    });
    await apply(w, 'boardMember', {
      op: 'card.setDue',
      id: w.cards.open,
      dueDate: null,
      dueTime: null,
    });
    await apply(w, 'boardMember', {
      op: 'card.addLabel',
      cardId: w.cards.open,
      labelId: w.labels.publicBoard,
    });
    await apply(w, 'boardMember', {
      op: 'card.removeLabel',
      cardId: w.cards.open,
      labelId: w.labels.publicBoard,
    });
    await apply(w, 'boardMember', {
      op: 'item.add',
      id: id(),
      cardId: w.cards.open,
      title: 'Step',
      position: 'a9',
    });
    await apply(w, 'boardMember', { op: 'item.tick', id: w.items.open });
    await apply(w, 'boardMember', {
      op: 'comment.add',
      id: id(),
      cardId: w.cards.open,
      body: 'Hi',
    });
    await apply(w, 'boardMember', { op: 'list.rename', id: w.lists.publicBoard, name: 'Later' });
    await apply(w, 'boardMember', { op: 'list.move', id: w.lists.publicBoard, position: 'a9' });
    await apply(w, 'boardOwner', {
      op: 'board.update',
      id: w.boards.publicBoard,
      name: 'Plans',
      color: '#2563eb',
      description: '',
    });
    await apply(w, 'boardOwner', {
      op: 'board.setVisibility',
      id: w.boards.publicBoard,
      visibility: 'private',
    });
    await apply(w, 'boardOwner', {
      op: 'board.setVisibility',
      id: w.boards.publicBoard,
      visibility: 'public',
    });
    await apply(w, 'member', { op: 'board.join', id: w.boards.publicBoard });
    await apply(w, 'member', { op: 'board.leave', id: w.boards.publicBoard });
    await apply(w, 'boardOwner', {
      op: 'boardMember.setRole',
      boardId: w.boards.publicBoard,
      accountId: w.accounts.boardMember,
      role: 'owner',
    });
    await apply(w, 'boardOwner', { op: 'board.archive', id: w.boards.publicBoard });
    await apply(w, 'owner', { op: 'board.restore', id: w.boards.publicBoard });
    const kinds = (await rowsOf(w)).map((r) => r.kind);
    for (const kind of [
      'card.due_set',
      'card.due_cleared',
      'card.label_added',
      'card.label_removed',
      'card.item_added',
      'card.item_ticked',
      'card.commented',
      'list.renamed',
      'list.moved',
      'board.renamed',
      'board.visibility',
      'board.joined',
      'board.left',
      'board.member_owner',
      'board.archived',
      'board.restored',
    ])
      expect(kinds, kind).toContain(kind);
    // An untick and a rename of an item are not events of their own.
    expect(kinds.filter((k) => k === 'board.visibility')).toHaveLength(2);
  });

  it('is read only by those who can see the board, a page at a time with each row once', async () => {
    const w = await seedWorld(database);
    expect(
      await activityOfBoard(database, directory, w.accounts.outsider, w.boards.publicBoard),
    ).toBeUndefined();
    // A private board's activity is not there for a member of the workspace who is not on it.
    expect(
      await activityOfBoard(database, directory, w.accounts.member, w.boards.privateBoard),
    ).toBeUndefined();
    for (let i = 0; i < 120; i++)
      await apply(w, 'boardMember', {
        op: 'list.create',
        id: id(),
        boardId: w.boards.publicBoard,
        name: `L${i}`,
        position: `c${String(i).padStart(3, '0')}`,
      }).catch(() => undefined);
    // The board holds only 100 lists, so some of those were refused and wrote nothing.
    const seen: string[] = [];
    let cursor: { createdAt: number; id: string } | undefined;
    for (;;) {
      const page = await board(w, 'member', cursor);
      expect(page.activity.length).toBeLessThanOrEqual(ACTIVITY_PAGE);
      seen.push(...page.activity.map((a) => a.id));
      const last = page.activity.at(-1);
      if (!page.more || !last) break;
      cursor = { createdAt: last.createdAt, id: last.id };
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(ACTIVITY_PAGE);
    expect(seen.length).toBe((await rowsOf(w)).length);
  });

  it('lists a person’s own across the boards they can still see, and says Deleted account for one that is gone', async () => {
    const w = await seedWorld(database);
    await apply(w, 'boardMember', { op: 'card.rename', id: w.cards.open, title: 'Mine' });
    await apply(w, 'boardMember', {
      op: 'card.create',
      id: id(),
      listId: w.lists.privateBoard,
      title: 'On the private board',
      position: 'a0',
    });
    const own = (await activityOfPerson(database, directory, w.accounts.boardMember)).activity;
    expect(own.map((a) => a.boardName).sort()).toEqual(['Hiring', 'Roadmap']);
    // Taken off the private board, those rows are no longer theirs to see.
    await apply(w, 'owner', {
      op: 'boardMember.remove',
      boardId: w.boards.privateBoard,
      accountId: w.accounts.boardMember,
    });
    expect(
      (await activityOfPerson(database, directory, w.accounts.boardMember)).activity.map(
        (a) => a.boardName,
      ),
    ).toEqual(['Roadmap']);
    // Nobody else's are in it.
    expect((await activityOfPerson(database, directory, w.accounts.outsider)).activity).toEqual([]);
    names[w.accounts.boardMember] = 'GONE';
    expect((await board(w, 'member')).activity.some((a) => a.actorName === 'Deleted account')).toBe(
      true,
    );
  });
});
