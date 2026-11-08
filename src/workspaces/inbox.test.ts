import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { saveSettings } from '../settings/account-settings';
import { makeStore } from '../sync/test-support';
import { applyOp } from './apply';
import { type Op, type OpRequest, NOTICE_LIMITS } from './format';
import { assignedOf } from './inbox';
import { dismiss, markRead, noticesOf, trimNotices, unreadCount } from './notifications';
import { tablesOf } from './tables';
import { type Role, type World, seedWorld } from './testing/roles';
import { sealText } from './content';

/**
 * The Inbox (DESIGN.md §16), on whichever database the leg runs on: what is written, who is told, what is shown, and what is read.
 */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

const NOW = 1_800_000_500_000;
const KNOWN = '0b7e1c52-9c1e-4a8e-8d52-5a0c2f4f9a11';
const directory = {
  idOfEmail: async (email: string) => (email === 'known@example.com' ? KNOWN : undefined),
  profiles: async (ids: readonly string[]) =>
    new Map(
      ids.map((each) => [
        each,
        { id: each, name: `Name ${each.slice(0, 4)}`, email: 'x@example.com', image: null },
      ]),
    ),
};
const id = () => crypto.randomUUID();
const apply = (w: World, role: Role, op: Op, now = NOW) =>
  applyOp(database, w.accounts[role], { opId: id(), ...op } as OpRequest, { now, directory });
/** What a person is told and what is assigned to them, as the two screens read them. */
const inboxFor = async (account: string, before?: { createdAt: number; id: string }) => ({
  ...(await noticesOf(database, directory, account, before)),
  assigned: before ? [] : await assignedOf(database, account),
});
const inbox = (w: World, role: Role) => inboxFor(w.accounts[role]);
const t = () => tablesOf(database);

describe(`the Inbox (${leg})`, () => {
  it('shows an assignment to the one assigned and not to the one who made it, with who did what to which card', async () => {
    const w = await seedWorld(database);
    await apply(w, 'boardOwner', {
      op: 'card.assign',
      cardId: w.cards.open,
      accountId: w.accounts.boardMember,
    });
    const theirs = await inbox(w, 'boardMember');
    expect(theirs.notices).toHaveLength(1);
    expect(theirs.notices[0]).toMatchObject({
      kind: 'assigned',
      subject: 'Open one',
      cardId: w.cards.open,
      boardId: w.boards.publicBoard,
      workspaceId: w.workspace,
      actorName: `Name ${w.accounts.boardOwner.slice(0, 4)}`,
    });
    expect((await inbox(w, 'boardOwner')).notices).toEqual([]);
    expect((await inbox(w, 'outsider')).notices).toEqual([]);
  });

  it('tells the assignees and the maker of a comment and not its author, and a person being added where they were added', async () => {
    const w = await seedWorld(database);
    await apply(w, 'boardOwner', {
      op: 'card.assign',
      cardId: w.cards.open,
      accountId: w.accounts.boardMember,
    });
    await apply(w, 'boardMember', {
      op: 'comment.add',
      id: id(),
      cardId: w.cards.open,
      body: 'Hi',
    });
    expect((await inbox(w, 'boardOwner')).notices.map((n) => n.kind)).toEqual(['comment']);
    expect((await inbox(w, 'boardMember')).notices.map((n) => n.kind)).toEqual(['assigned']);
    // Added to a board, and to a workspace (the account that has one is in the fake directory).
    await apply(w, 'owner', {
      op: 'boardMember.add',
      boardId: w.boards.publicBoard,
      accountId: w.accounts.member,
    });
    expect((await inbox(w, 'member')).notices).toMatchObject([
      { kind: 'added_to_board', subject: 'Roadmap', boardId: w.boards.publicBoard },
    ]);
    await apply(w, 'owner', {
      op: 'member.add',
      workspaceId: w.workspace,
      email: 'known@example.com',
    });
    const added = await inboxFor(KNOWN);
    expect(added.notices).toMatchObject([
      { kind: 'added_to_workspace', subject: 'Acme', boardId: null, cardId: null },
    ]);
  });

  it('leaves out a notice about a board the person can no longer see, and brings it back if they can again', async () => {
    const w = await seedWorld(database);
    await apply(w, 'boardOwner', {
      op: 'card.assign',
      cardId: w.cards.open,
      accountId: w.accounts.boardMember,
    });
    await apply(w, 'boardOwner', {
      op: 'card.assign',
      cardId: w.cards.open,
      accountId: w.accounts.boardOwner,
    });
    expect((await inbox(w, 'boardMember')).notices).toHaveLength(1);
    // Made private, and they are on it: still seen. Taken off it as well: gone, and with it the card in Assigned to me.
    await apply(w, 'boardOwner', {
      op: 'board.setVisibility',
      id: w.boards.publicBoard,
      visibility: 'private',
    });
    expect((await inbox(w, 'boardMember')).notices).toHaveLength(1);
    await apply(w, 'boardOwner', {
      op: 'boardMember.remove',
      boardId: w.boards.publicBoard,
      accountId: w.accounts.boardMember,
    });
    const after = await inbox(w, 'boardMember');
    expect(after.notices).toEqual([]);
    expect(after.assigned).toEqual([]);
    expect(await unreadCount(database, w.accounts.boardMember)).toBe(0);
    // Public again, they see the board and so the notice.
    await apply(w, 'boardOwner', {
      op: 'board.setVisibility',
      id: w.boards.publicBoard,
      visibility: 'public',
    });
    expect((await inbox(w, 'boardMember')).notices).toHaveLength(1);
    // A notice about being added to a workspace is not shown once they have left it.
    await apply(w, 'owner', {
      op: 'member.add',
      workspaceId: w.workspace,
      email: 'known@example.com',
    });
    // (The same account is added in the worlds of other tests, so it is this workspace's notices that are looked at.)
    const here = async () =>
      (await inboxFor(KNOWN)).notices.filter((n) => n.workspaceId === w.workspace);
    expect((await here()).map((n) => n.kind)).toEqual(['added_to_workspace']);
    await apply(w, 'owner', { op: 'member.remove', workspaceId: w.workspace, accountId: KNOWN });
    expect(await here()).toEqual([]);
    // A notice about a workspace they have left is not shown either.
    await apply(w, 'owner', {
      op: 'member.remove',
      workspaceId: w.workspace,
      accountId: w.accounts.boardMember,
    });
    expect((await inbox(w, 'boardMember')).notices).toEqual([]);
  });

  it('does not write a kind that was turned off, and still writes the others', async () => {
    const w = await seedWorld(database);
    await saveSettings(database, w.accounts.boardMember, { noticesOff: ['assigned'] }, NOW);
    await apply(w, 'boardOwner', {
      op: 'card.assign',
      cardId: w.cards.open,
      accountId: w.accounts.boardMember,
    });
    expect((await inbox(w, 'boardMember')).notices).toEqual([]);
    await apply(w, 'boardOwner', { op: 'comment.add', id: id(), cardId: w.cards.open, body: 'x' });
    expect((await inbox(w, 'boardMember')).notices.map((n) => n.kind)).toEqual(['comment']);
    // Turned back on, the next is written; the one not written is not made up.
    await saveSettings(database, w.accounts.boardMember, { noticesOff: [] }, NOW);
    await apply(w, 'boardOwner', {
      op: 'card.unassign',
      cardId: w.cards.open,
      accountId: w.accounts.boardMember,
    });
    await apply(w, 'boardOwner', {
      op: 'card.assign',
      cardId: w.cards.open,
      accountId: w.accounts.boardMember,
    });
    expect((await inbox(w, 'boardMember')).notices.map((n) => n.kind).sort()).toEqual([
      'assigned',
      'comment',
    ]);
  });

  it('counts unread from the last time it was opened, to 100, on every device, for one account only', async () => {
    const w = await seedWorld(database);
    const other = id();
    await apply(
      w,
      'boardOwner',
      { op: 'card.assign', cardId: w.cards.open, accountId: w.accounts.boardMember },
      NOW,
    );
    expect(await unreadCount(database, w.accounts.boardMember)).toBe(1);
    // Opening it moves the time on: nothing is unread, for this account and no other.
    await markRead(database, w.accounts.boardMember, { all: true }, NOW + 10);
    expect(await unreadCount(database, w.accounts.boardMember)).toBe(0);
    await markRead(database, other, { all: true }, NOW + 10);
    // And never back.
    await markRead(database, w.accounts.boardMember, { all: true }, NOW);
    expect(await unreadCount(database, w.accounts.boardMember)).toBe(0);
    await apply(
      w,
      'boardOwner',
      { op: 'comment.add', id: id(), cardId: w.cards.open, body: 'x' },
      NOW + 20,
    );
    expect(await unreadCount(database, w.accounts.boardMember)).toBe(1);
    // A hundred and more are counted as a hundred.
    for (let i = 0; i < 120; i++)
      await dbAll(
        database,
        sql`INSERT INTO ${t().notice} (id, account_id, kind, actor_id, workspace_id, board_id, card_id, details, created_at)
            VALUES (${id()}, ${w.accounts.boardMember}, 'comment', ${w.accounts.boardOwner}, ${w.workspace}, ${w.boards.publicBoard}, ${w.cards.open}, '{"title":"x"}', ${NOW + 100 + i}) RETURNING id`,
      );
    expect(await unreadCount(database, w.accounts.boardMember)).toBe(100);
  });

  it('lists the open cards assigned across boards by due date with undated last, and not archived ones', async () => {
    const w = await seedWorld(database);
    const second = id();
    await apply(w, 'boardMember', {
      op: 'card.create',
      id: second,
      listId: w.lists.privateBoard,
      title: 'Private one',
      position: 'a0',
    });
    const third = id();
    await apply(w, 'boardMember', {
      op: 'card.create',
      id: third,
      listId: w.lists.publicBoard,
      title: 'Dated',
      position: 'a9',
    });
    for (const card of [w.cards.open, second, third])
      await apply(w, 'boardMember', {
        op: 'card.assign',
        cardId: card,
        accountId: w.accounts.boardMember,
      });
    await apply(w, 'boardMember', {
      op: 'card.setDue',
      id: third,
      dueDate: '2026-12-01',
      dueTime: '09:00',
    });
    await apply(w, 'boardMember', {
      op: 'card.setDue',
      id: second,
      dueDate: '2026-11-20',
      dueTime: null,
    });
    expect((await inbox(w, 'boardMember')).assigned.map((a) => a.title)).toEqual([
      'Private one',
      'Dated',
      'Open one',
    ]);
    // An archived card is not listed.
    await apply(w, 'boardMember', { op: 'card.archive', id: third });
    expect((await inbox(w, 'boardMember')).assigned.map((a) => a.title)).toEqual([
      'Private one',
      'Open one',
    ]);
    // Nobody else sees them.
    expect((await inbox(w, 'boardOwner')).assigned).toEqual([]);
  });

  it('pages newest first after a cursor without skipping or repeating', async () => {
    const w = await seedWorld(database);
    for (let i = 0; i < 60; i++) {
      const noticeId = id();
      await dbAll(
        database,
        sql`INSERT INTO ${t().notice} (id, account_id, kind, actor_id, workspace_id, board_id, card_id, details, created_at)
            VALUES (${noticeId}, ${w.accounts.member}, 'comment', ${w.accounts.boardOwner}, ${w.workspace}, ${w.boards.publicBoard}, ${w.cards.open}, ${sealText('notice', noticeId, 'details', JSON.stringify({ title: `n${i}` }))}, ${NOW + i}) RETURNING id`,
      );
    }
    const first = await inboxFor(w.accounts.member);
    expect(first.notices).toHaveLength(NOTICE_LIMITS.page);
    expect(first.more).toBe(true);
    expect(first.notices[0]?.subject).toBe('n59');
    const edge = first.notices.at(-1);
    const second = await inboxFor(
      w.accounts.member,
      edge && { createdAt: edge.createdAt, id: edge.id },
    );
    expect(second.notices).toHaveLength(10);
    expect(second.more).toBe(false);
    expect(second.notices[0]?.subject).toBe('n9');
    const all = [...first.notices, ...second.notices].map((n) => n.subject);
    expect(new Set(all).size).toBe(60);
    // Later pages carry no assigned list and no count.
    expect(second.assigned).toEqual([]);
    expect(second.unread).toBe(0);
  });

  it('trims what is older than 90 days and keeps each person’s latest 500', async () => {
    const w = await seedWorld(database);
    const base = NOW + NOTICE_LIMITS.keptMs;
    const mine = w.accounts.member;
    const put = (account: string, at: number) =>
      dbAll(
        database,
        sql`INSERT INTO ${t().notice} (id, account_id, kind, actor_id, workspace_id, details, created_at)
            VALUES (${id()}, ${account}, 'added_to_workspace', ${w.accounts.owner}, ${w.workspace}, '{"title":"Acme"}', ${at}) RETURNING id`,
      );
    await put(mine, NOW - 1); // older than 90 days at `base`
    for (let i = 0; i < 510; i++) await put(mine, base - 1000 + i);
    await put(w.accounts.boardMember, base - 500);
    const removed = await trimNotices(database, base);
    expect(removed).toBeGreaterThanOrEqual(11);
    const count = async (account: string) =>
      Number(
        (
          await dbAll<{ n: number | string }>(
            database,
            sql`SELECT COUNT(*) AS n FROM ${t().notice} WHERE account_id = ${account}`,
          )
        )[0]?.n,
      );
    expect(await count(mine)).toBe(NOTICE_LIMITS.perPerson);
    expect(await count(w.accounts.boardMember)).toBe(1);
    // The newest are the ones kept.
    const newest = await dbAll<{ at: number | string }>(
      database,
      sql`SELECT MAX(created_at) AS at FROM ${t().notice} WHERE account_id = ${mine}`,
    );
    expect(Number(newest[0]?.at)).toBe(base - 1000 + 509);
  });
});

describe(`reading and dismissing one notice at a time (${leg})`, () => {
  const told = async (w: World, role: Role) => {
    const who = w.accounts[role];
    await apply(w, 'boardOwner', { op: 'card.assign', cardId: w.cards.open, accountId: who }, NOW);
    await apply(
      w,
      'boardOwner',
      { op: 'comment.add', id: id(), cardId: w.cards.open, body: 'a' },
      NOW + 1,
    );
    await apply(
      w,
      'boardOwner',
      { op: 'comment.add', id: id(), cardId: w.cards.open, body: 'b' },
      NOW + 2,
    );
    return (await noticesOf(database, directory, who)).notices;
  };

  it('reads the notices named and no others, and one already read keeps the time it was read', async () => {
    const w = await seedWorld(database);
    const notices = await told(w, 'boardMember');
    const [first = ''] = notices.map((n) => n.id);
    expect(notices.map((n) => n.read)).toEqual([false, false, false]);
    const who = w.accounts.boardMember;
    expect(await unreadCount(database, who)).toBe(3);
    await markRead(database, who, { ids: [first] }, NOW + 10);
    const after = await noticesOf(database, directory, who);
    expect(after.notices.map((n) => n.read)).toEqual([true, false, false]);
    expect(after.unread).toBe(2);
    // Twice does nothing more; the first time stands.
    await markRead(database, who, { ids: [first] }, NOW + 99);
    const rows = await dbAll<{ readAt: number | string | null }>(
      database,
      sql`SELECT read_at AS "readAt" FROM ${t().notice} WHERE id = ${first}`,
    );
    expect(Number(rows[0]?.readAt)).toBe(NOW + 10);
    // Nothing named reads nothing.
    await markRead(database, who, { ids: [] }, NOW + 11);
    expect(await unreadCount(database, who)).toBe(2);
  });

  it('reads all with one write that moves a time on, and a notice made after it is unread', async () => {
    const w = await seedWorld(database);
    await told(w, 'boardMember');
    const who = w.accounts.boardMember;
    await markRead(database, who, { all: true }, NOW + 50);
    expect(await unreadCount(database, who)).toBe(0);
    expect((await noticesOf(database, directory, who)).notices.every((n) => n.read)).toBe(true);
    await apply(
      w,
      'boardOwner',
      { op: 'comment.add', id: id(), cardId: w.cards.open, body: 'c' },
      NOW + 60,
    );
    const now = await noticesOf(database, directory, who);
    expect(now.unread).toBe(1);
    expect(now.notices.map((n) => n.read)).toEqual([false, true, true, true]);
  });

  it('dismisses the notices named, and all, which are shown nowhere and counted for nothing', async () => {
    const w = await seedWorld(database);
    const notices = await told(w, 'boardMember');
    const [first = '', second = '', third = ''] = notices.map((n) => n.id);
    const who = w.accounts.boardMember;
    await dismiss(database, who, { ids: [second] }, NOW + 10);
    const after = await noticesOf(database, directory, who);
    expect(after.notices.map((n) => n.id)).toEqual([first, third]);
    expect(after.unread).toBe(2);
    // A new page does not bring it back; reading all does not either.
    await markRead(database, who, { all: true }, NOW + 20);
    expect((await noticesOf(database, directory, who)).notices).toHaveLength(2);
    await dismiss(database, who, { all: true }, NOW + 30);
    expect(await noticesOf(database, directory, who)).toMatchObject({ notices: [], unread: 0 });
    // What is assigned is not a notice and is still there.
    expect((await assignedOf(database, who)).length).toBe(1);
  });

  it('touches only the person’s own notices: another’s ids change nothing, and are answered as ids that are not there', async () => {
    const w = await seedWorld(database);
    const mine = await told(w, 'boardMember');
    // The owner has notices of their own: a comment on the card they are assigned to, by somebody else.
    await apply(
      w,
      'boardOwner',
      { op: 'card.assign', cardId: w.cards.open, accountId: w.accounts.boardOwner },
      NOW,
    );
    await apply(
      w,
      'boardMember',
      { op: 'comment.add', id: id(), cardId: w.cards.open, body: 'z' },
      NOW + 3,
    );
    const theirs = (await noticesOf(database, directory, w.accounts.boardOwner)).notices;
    const [owner, member] = [w.accounts.boardOwner, w.accounts.boardMember];
    expect(theirs.length).toBeGreaterThan(0);
    await markRead(database, owner, { ids: mine.map((n) => n.id) }, NOW + 10);
    await dismiss(database, owner, { ids: mine.map((n) => n.id) }, NOW + 10);
    await markRead(database, owner, { ids: [id(), id()] }, NOW + 10);
    const unchanged = await noticesOf(database, directory, member);
    expect(unchanged.notices.map((n) => n.read)).toEqual([false, false, false]);
    expect(unchanged.notices).toHaveLength(3);
    expect(unchanged.unread).toBe(3);
    // "All" is the asker's all.
    await dismiss(database, owner, { all: true }, NOW + 20);
    expect((await noticesOf(database, directory, member)).notices).toHaveLength(3);
  });

  it('keeps what a person cannot see out of the count however it was read or dismissed', async () => {
    const w = await seedWorld(database);
    const notices = await told(w, 'boardMember');
    const [first = ''] = notices.map((n) => n.id);
    const who = w.accounts.boardMember;
    await apply(
      w,
      'owner',
      { op: 'member.remove', workspaceId: w.workspace, accountId: who },
      NOW + 5,
    );
    expect(await unreadCount(database, who)).toBe(0);
    expect((await noticesOf(database, directory, who)).notices).toEqual([]);
    await markRead(database, who, { ids: [first] }, NOW + 6);
    expect(await unreadCount(database, who)).toBe(0);
  });
});
