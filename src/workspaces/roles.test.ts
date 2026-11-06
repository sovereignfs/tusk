import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { makeStore } from '../sync/test-support';
import { applyOp } from './apply';
import { boardsAdministeredBy, boardsEditableBy, boardsVisibleTo } from './can';
import {
  type Op,
  OPS,
  type OpReason,
  type OpRefusal,
  type OpRequest,
  WORKSPACE_LIMITS,
} from './format';
import {
  archivedCards,
  boardPeople,
  boardsIndex,
  cardDetail,
  boardVersion,
  boardsOfWorkspace,
  listWorkspaces,
  peopleOf,
  readBoard,
  workspaceOf,
} from './reads';
import { tablesOf } from './tables';
import {
  type Role,
  ROLES,
  type World,
  countAll,
  reachable,
  seedBoardContents,
  seedWorld,
} from './testing/roles';

/**
 * The matrix of roles (DESIGN.md §7.2, §24 Testing): six people in six roles, every operation and every permission, and what each of them gets, **written
 * once in a table** and run against all of them, on whichever database the leg runs on. A new operation without a row in `OPERATIONS` fails the last test,
 * so that nothing can be added to the door without saying who may use it.
 */
const { leg } = testTarget();

let database: Database;
let close: () => Promise<void>;
/** The world the permissions are read in, which nothing changes. Every operation below gets a world of its own, since one that is allowed changes it. */
let world: World;
beforeAll(async () => {
  ({ database, close } = await makeStore());
  world = await seedWorld(database);
});
afterAll(async () => close());

const NOW = 1_800_000_100_000;
/** The accounts, as a fake: one address belongs to an account, and no other does. The real directory over the auth store is tested with it (`directory.test.ts`). */
const KNOWN_EMAIL = 'known@example.com';
const KNOWN = '0b7e1c52-9c1e-4a8e-8d52-5a0c2f4f9a11';
const directory = {
  idOfEmail: async (email: string) => (email === KNOWN_EMAIL ? KNOWN : undefined),
  profiles: async (ids: readonly string[]) =>
    new Map(
      ids.map((each) => [
        each,
        {
          id: each,
          name: `Name of ${each.slice(0, 4)}`,
          email: `${each.slice(0, 4)}@example.com`,
          image: null,
        },
      ]),
    ),
};
const OPTIONS = { now: NOW, directory };
const id = () => crypto.randomUUID();

/** What each operation is for, and who may do it. `build` makes the request against the world; `may` are the roles that get `applied`, all others `not_found`. */
interface Row {
  op: (typeof OPS)[number];
  build(w: World): Op;
  may: readonly Role[];
  /** What anyone else is told. */
  otherwise: OpRefusal;
  /** What a role is told when it is not `otherwise`: the one who is refused because they are already what the operation would make them. */
  refusals?: Partial<Record<Role, { code: OpRefusal; reason: OpReason }>>;
}
const OPERATIONS: Row[] = [
  {
    op: 'workspace.rename',
    build: (w) => ({ op: 'workspace.rename', id: w.workspace, name: 'Renamed' }),
    may: ['owner', 'coOwner'],
    otherwise: 'not_found',
  },
  {
    // Only an owner, and only by typing its name: a shared space is not deleted by accident.
    op: 'workspace.delete',
    build: (w) => ({ op: 'workspace.delete', id: w.workspace, name: 'Acme' }),
    may: ['owner', 'coOwner'],
    otherwise: 'not_found',
  },
  {
    // Anyone may make a workspace of their own, and a new id is nothing of anyone else's.
    op: 'workspace.create',
    build: () => ({ op: 'workspace.create', id: id(), name: 'Mine' }),
    may: ROLES,
    otherwise: 'not_found',
  },
  {
    // Only an owner adds a person, and an outsider is told what they are told for anything else, whatever the address.
    op: 'member.add',
    build: (w) => ({ op: 'member.add', workspaceId: w.workspace, email: KNOWN_EMAIL }),
    may: ['owner', 'coOwner'],
    otherwise: 'not_found',
  },
  {
    op: 'member.setRole',
    build: (w) => ({
      op: 'member.setRole',
      workspaceId: w.workspace,
      accountId: w.accounts.member,
      role: 'owner',
    }),
    may: ['owner', 'coOwner'],
    otherwise: 'not_found',
  },
  {
    op: 'member.remove',
    build: (w) => ({ op: 'member.remove', workspaceId: w.workspace, accountId: w.accounts.member }),
    may: ['owner', 'coOwner'],
    otherwise: 'not_found',
  },
  {
    // Anyone in the workspace may make a board of their own; an outsider has no workspace to make it in.
    op: 'board.create',
    build: (w) => ({
      op: 'board.create',
      id: id(),
      workspaceId: w.workspace,
      name: 'New board',
      color: '#2563eb',
    }),
    may: ['owner', 'coOwner', 'boardOwner', 'boardMember', 'member'],
    otherwise: 'not_found',
  },
  // Only a member of a board changes its lists (§7.2): its owners and members, and not a workspace owner who is not on it, nor a viewer.
  {
    op: 'list.create',
    build: (w) => ({
      op: 'list.create',
      id: id(),
      boardId: w.boards.publicBoard,
      name: 'Doing',
      position: 'a1',
    }),
    may: ['boardOwner', 'boardMember'],
    otherwise: 'not_found',
  },
  {
    op: 'list.rename',
    build: (w) => ({ op: 'list.rename', id: w.lists.publicBoard, name: 'Later' }),
    may: ['boardOwner', 'boardMember'],
    otherwise: 'not_found',
  },
  {
    op: 'list.move',
    build: (w) => ({ op: 'list.move', id: w.lists.publicBoard, position: 'a1' }),
    may: ['boardOwner', 'boardMember'],
    otherwise: 'not_found',
  },
  {
    op: 'list.delete',
    build: (w) => ({ op: 'list.delete', id: w.lists.publicBoard }),
    may: ['boardOwner', 'boardMember'],
    otherwise: 'not_found',
  },
  {
    op: 'card.create',
    build: (w) => ({
      op: 'card.create',
      id: id(),
      listId: w.lists.publicBoard,
      title: 'New card',
      position: 'Zz',
    }),
    may: ['boardOwner', 'boardMember'],
    otherwise: 'not_found',
  },
  {
    op: 'card.move',
    build: (w) => ({
      op: 'card.move',
      id: w.cards.open,
      listId: w.lists.publicBoard,
      position: 'a5',
    }),
    may: ['boardOwner', 'boardMember'],
    otherwise: 'not_found',
  },
  {
    op: 'card.archive',
    build: (w) => ({ op: 'card.archive', id: w.cards.open }),
    may: ['boardOwner', 'boardMember'],
    otherwise: 'not_found',
  },
  {
    op: 'card.restore',
    build: (w) => ({ op: 'card.restore', id: w.cards.archived }),
    may: ['boardOwner', 'boardMember'],
    otherwise: 'not_found',
  },
  {
    op: 'card.delete',
    build: (w) => ({ op: 'card.delete', id: w.cards.archived }),
    may: ['boardOwner', 'boardMember'],
    otherwise: 'not_found',
  },
  {
    op: 'card.rename',
    build: (w) => ({ op: 'card.rename', id: w.cards.open, title: 'Renamed' }),
    may: ['boardOwner', 'boardMember'],
    otherwise: 'not_found',
  },
  {
    op: 'card.describe',
    build: (w) => ({ op: 'card.describe', id: w.cards.open, description: 'Words' }),
    may: ['boardOwner', 'boardMember'],
    otherwise: 'not_found',
  },
  // Administering a board is its owner's, and a workspace owner's, who need not be on it (§7.2).
  {
    op: 'board.update',
    build: (w) => ({
      op: 'board.update',
      id: w.boards.publicBoard,
      name: 'Renamed',
      color: '#dc2626',
      description: 'About it',
    }),
    may: ['owner', 'coOwner', 'boardOwner'],
    otherwise: 'not_found',
  },
  {
    op: 'board.archive',
    build: (w) => ({ op: 'board.archive', id: w.boards.publicBoard }),
    may: ['owner', 'coOwner', 'boardOwner'],
    otherwise: 'not_found',
  },
  {
    op: 'board.restore',
    build: (w) => ({ op: 'board.restore', id: w.boards.archivedBoard }),
    may: ['owner', 'coOwner', 'boardOwner'],
    otherwise: 'not_found',
  },
  {
    op: 'board.delete',
    build: (w) => ({ op: 'board.delete', id: w.boards.publicBoard, name: 'Roadmap' }),
    may: ['owner', 'coOwner', 'boardOwner'],
    otherwise: 'not_found',
  },
  {
    op: 'board.setVisibility',
    build: (w) => ({ op: 'board.setVisibility', id: w.boards.publicBoard, visibility: 'private' }),
    may: ['owner', 'coOwner', 'boardOwner'],
    otherwise: 'not_found',
  },
  {
    op: 'boardMember.add',
    build: (w) => ({
      op: 'boardMember.add',
      boardId: w.boards.publicBoard,
      accountId: w.accounts.member,
    }),
    may: ['owner', 'coOwner', 'boardOwner'],
    otherwise: 'not_found',
  },
  {
    op: 'boardMember.setRole',
    build: (w) => ({
      op: 'boardMember.setRole',
      boardId: w.boards.publicBoard,
      accountId: w.accounts.boardMember,
      role: 'owner',
    }),
    may: ['owner', 'coOwner', 'boardOwner'],
    otherwise: 'not_found',
  },
  {
    op: 'boardMember.remove',
    build: (w) => ({
      op: 'boardMember.remove',
      boardId: w.boards.publicBoard,
      accountId: w.accounts.boardMember,
    }),
    may: ['owner', 'coOwner', 'boardOwner'],
    otherwise: 'not_found',
  },
  {
    // Anyone in the workspace joins a public board, and the workspace's owners add themselves. Those already on it are told so; an outsider is not told.
    op: 'board.join',
    build: (w) => ({ op: 'board.join', id: w.boards.publicBoard }),
    may: ['owner', 'coOwner', 'member'],
    otherwise: 'not_found',
    refusals: {
      boardOwner: { code: 'invalid', reason: 'already_in' },
      boardMember: { code: 'invalid', reason: 'already_in' },
    },
  },
  {
    op: 'board.leave',
    build: (w) => ({ op: 'board.leave', id: w.boards.publicBoard }),
    may: ['boardOwner', 'boardMember'],
    otherwise: 'not_found',
  },
  {
    // Anyone in it may leave (there is another owner in this world); an outsider has nothing to leave.
    op: 'member.leave',
    build: (w) => ({ op: 'member.leave', workspaceId: w.workspace }),
    may: ['owner', 'coOwner', 'boardOwner', 'boardMember', 'member'],
    otherwise: 'not_found',
  },
];

const row = (table: unknown) =>
  dbAll<Record<string, unknown>>(database, sql`SELECT * FROM ${table as never} ORDER BY 1`);

describe(`the roles (${leg})`, () => {
  describe.each(OPERATIONS)('$op', ({ build, may, otherwise, refusals }) => {
    for (const role of ROLES) {
      const allowed = may.includes(role);
      it(`${allowed ? 'lets' : 'refuses'} ${role}${allowed ? '' : `, as ${otherwise}, changing nothing`}`, async () => {
        const mine = await seedWorld(database);
        const request = { opId: id(), ...build(mine) } as OpRequest;
        const before = JSON.stringify(await countAll(database));
        const beforeRows = JSON.stringify([
          await row(tablesOf(database).workspace),
          await row(tablesOf(database).workspaceMember),
        ]);
        const result = await applyOp(database, mine.accounts[role], request, OPTIONS);
        if (allowed) {
          expect(result.status).toBe('applied');
        } else {
          expect(result).toEqual({
            status: 'refused',
            ...(refusals?.[role] ?? { code: otherwise }),
          });
          expect(JSON.stringify(await countAll(database))).toBe(before);
          expect(
            JSON.stringify([
              await row(tablesOf(database).workspace),
              await row(tablesOf(database).workspaceMember),
            ]),
          ).toBe(beforeRows);
          // And nothing was recorded as done: the same `opId` can be tried again by someone who may.
          const retry = await applyOp(database, mine.accounts[may[0] ?? 'owner'], request, OPTIONS);
          if (request.op !== 'workspace.create') expect(retry.status).toBe('applied');
        }
      });
    }
  });

  it('is the same answer for a workspace that is not there as for one that is not theirs', async () => {
    const theirs = await applyOp(
      database,
      world.accounts.outsider,
      { opId: id(), op: 'workspace.rename', id: world.workspace, name: 'Mine now' },
      OPTIONS,
    );
    const nothing = await applyOp(
      database,
      world.accounts.outsider,
      { opId: id(), op: 'workspace.rename', id: id(), name: 'Mine now' },
      OPTIONS,
    );
    expect(theirs).toEqual(nothing);
  });

  describe('which boards each role reaches', () => {
    const sorted = (...ids: string[]) => ids.sort();
    const table = (): Record<
      Role,
      { visible: string[]; editable: string[]; administered: string[] }
    > => {
      const { publicBoard, privateBoard, archivedBoard } = world.boards;
      return {
        // Owners see every board of the workspace and administer them, and edit none of them: only a member edits.
        owner: {
          visible: sorted(publicBoard, privateBoard, archivedBoard),
          editable: [],
          administered: sorted(publicBoard, privateBoard, archivedBoard),
        },
        coOwner: {
          visible: sorted(publicBoard, privateBoard, archivedBoard),
          editable: [],
          administered: sorted(publicBoard, privateBoard, archivedBoard),
        },
        // The owner of a board administers it (and an archived one, to restore it) and edits the one that is not archived.
        boardOwner: {
          visible: sorted(publicBoard, archivedBoard),
          editable: sorted(publicBoard),
          administered: sorted(publicBoard, archivedBoard),
        },
        boardMember: {
          visible: sorted(publicBoard, privateBoard, archivedBoard),
          editable: sorted(publicBoard, privateBoard),
          administered: [],
        },
        // A viewer: sees the public boards, and changes nothing.
        member: { visible: sorted(publicBoard, archivedBoard), editable: [], administered: [] },
        outsider: { visible: [], editable: [], administered: [] },
      };
    };

    for (const role of ROLES) {
      it(`${role}`, async () => {
        const expected = table()[role];
        const account = world.accounts[role];
        expect(await reachable(database, boardsVisibleTo, account), 'visible').toEqual(
          expected.visible,
        );
        expect(await reachable(database, boardsEditableBy, account), 'editable').toEqual(
          expected.editable,
        );
        expect(await reachable(database, boardsAdministeredBy, account), 'administered').toEqual(
          expected.administered,
        );
      });
    }
  });

  describe('deleting a workspace', () => {
    it('leaves nothing of it in any table, and nothing of another workspace touched', async () => {
      const [doomed, kept] = [await seedWorld(database), await seedWorld(database)];
      await seedBoardContents(database, doomed);
      await seedBoardContents(database, kept);
      const before = await countAll(database);
      const result = await applyOp(
        database,
        doomed.accounts.owner,
        { opId: id(), op: 'workspace.delete', id: doomed.workspace, name: 'Acme' },
        OPTIONS,
      );
      expect(result).toMatchObject({ status: 'applied', rows: { deleted: doomed.workspace } });
      const after = await countAll(database);
      // One workspace's worth of every table is gone: the world has 1 workspace, 5 members, 3 boards, 4 board members, and one row of each below a board.
      const gone = (name: string) => (before[name] ?? 0) - (after[name] ?? 0);
      expect(gone('workspace')).toBe(1);
      expect(gone('workspace_member')).toBe(5);
      expect(gone('board')).toBe(3);
      expect(gone('board_member')).toBe(4);
      // One list of each of the three boards.
      expect(gone('board_list')).toBe(3);
      // The world's two cards and the one the contents add.
      expect(gone('card')).toBe(3);
      for (const name of [
        'label',
        'card_label',
        'card_assignee',
        'checklist_item',
        'comment',
        'activity',
        'publication',
        'notice',
      ])
        expect(gone(name), name).toBe(1);
      // The other one is whole.
      const t = tablesOf(database);
      const remaining = await dbAll<{ n: number | string }>(
        database,
        sql`SELECT COUNT(*) AS n FROM ${t.board} WHERE workspace_id = ${kept.workspace}`,
      );
      expect(Number(remaining[0]?.n)).toBe(3);
    });

    it('needs the name as it is, typed: another name deletes nothing and says it is invalid', async () => {
      const mine = await seedWorld(database);
      const before = await countAll(database);
      for (const name of ['acme', 'Acme ', 'Other']) {
        expect(
          await applyOp(
            database,
            mine.accounts.owner,
            { opId: id(), op: 'workspace.delete', id: mine.workspace, name },
            OPTIONS,
          ),
          name,
        ).toEqual({ status: 'refused', code: 'invalid' });
      }
      expect(await countAll(database)).toEqual(before);
    });

    it('is safe to send again: a repeat is answered as applied and the workspace is still gone', async () => {
      const mine = await seedWorld(database);
      const request: OpRequest = {
        opId: id(),
        op: 'workspace.delete',
        id: mine.workspace,
        name: 'Acme',
      };
      expect((await applyOp(database, mine.accounts.owner, request, OPTIONS)).status).toBe(
        'applied',
      );
      expect(await applyOp(database, mine.accounts.owner, request, OPTIONS)).toMatchObject({
        status: 'applied',
        replay: true,
      });
    });
  });

  describe('reading', () => {
    it('lists a person’s workspaces by name with their own role, and none for an outsider', async () => {
      const mine = await seedWorld(database);
      expect(await listWorkspaces(database, mine.accounts.owner)).toMatchObject([
        { id: mine.workspace, role: 'owner', name: 'Acme' },
      ]);
      expect(await listWorkspaces(database, mine.accounts.member)).toMatchObject([
        { id: mine.workspace, role: 'member' },
      ]);
      expect(await listWorkspaces(database, mine.accounts.outsider)).toEqual([]);
      expect(await workspaceOf(database, mine.accounts.outsider, mine.workspace)).toBeUndefined();
      expect(await workspaceOf(database, mine.accounts.member, mine.workspace)).toMatchObject({
        role: 'member',
      });
    });
  });

  describe('a workspace’s people', () => {
    const apply = (w: World, role: Role, op: Op) =>
      applyOp(database, w.accounts[role], { opId: id(), ...op } as OpRequest, OPTIONS);
    const roleOf = async (w: World, account: string) => {
      const rows = await dbAll<{ role: string }>(
        database,
        sql`SELECT role FROM ${tablesOf(database).workspaceMember} WHERE workspace_id = ${w.workspace} AND account_id = ${account}`,
      );
      return rows[0]?.role;
    };
    const countMembers = async (w: World) =>
      (
        await dbAll(
          database,
          sql`SELECT 1 FROM ${tablesOf(database).workspaceMember} WHERE workspace_id = ${w.workspace}`,
        )
      ).length;

    it('adds an account by its address as a member, and moves the workspace on', async () => {
      const w = await seedWorld(database);
      const result = await apply(w, 'owner', {
        op: 'member.add',
        workspaceId: w.workspace,
        email: KNOWN_EMAIL,
      });
      expect(result).toMatchObject({
        status: 'applied',
        rows: { member: { accountId: KNOWN, role: 'member' } },
      });
      expect(await roleOf(w, KNOWN)).toBe('member');
      // The one added sees the workspace on their next read.
      // (The same account is added in the worlds of other tests, so it is this workspace that is looked for.)
      expect(
        (await listWorkspaces(database, KNOWN)).filter((each) => each.id === w.workspace),
      ).toMatchObject([{ role: 'member' }]);
      const [row] = await dbAll<{ at: number | string }>(
        database,
        sql`SELECT updated_at AS at FROM ${tablesOf(database).workspace} WHERE id = ${w.workspace}`,
      );
      expect(Number(row?.at)).toBe(NOW);
    });

    it('says an address has no account to an owner, and adds nothing; an outsider is not told that', async () => {
      const w = await seedWorld(database);
      const before = await countMembers(w);
      const unknown: Op = {
        op: 'member.add',
        workspaceId: w.workspace,
        email: 'nobody@example.com',
      };
      expect(await apply(w, 'owner', unknown)).toEqual({
        status: 'refused',
        code: 'invalid',
        reason: 'no_account',
      });
      expect(await countMembers(w)).toBe(before);
      // To someone who may not ask, an address that has an account and one that has not are the same answer.
      const known: Op = { op: 'member.add', workspaceId: w.workspace, email: KNOWN_EMAIL };
      expect(await apply(w, 'member', unknown)).toEqual({ status: 'refused', code: 'not_found' });
      expect(await apply(w, 'outsider', unknown)).toEqual(await apply(w, 'outsider', known));
    });

    it('does not add someone twice, and holds a hundred people', async () => {
      const w = await seedWorld(database);
      const add: Op = { op: 'member.add', workspaceId: w.workspace, email: KNOWN_EMAIL };
      expect((await apply(w, 'owner', add)).status).toBe('applied');
      expect(await apply(w, 'owner', add)).toEqual({
        status: 'refused',
        code: 'invalid',
        reason: 'already_in',
      });
      const t = tablesOf(database);
      for (let i = await countMembers(w); i < WORKSPACE_LIMITS.membersPerWorkspace; i++)
        await dbAll(
          database,
          sql`INSERT INTO ${t.workspaceMember} (workspace_id, account_id, role, added_by, created_at) VALUES (${w.workspace}, ${id()}, 'member', ${w.accounts.owner}, ${NOW}) RETURNING account_id`,
        );
      const other = { ...add, email: KNOWN_EMAIL };
      const full = await applyOp(
        database,
        w.accounts.owner,
        { opId: id(), ...other } as OpRequest,
        { now: NOW, directory: { idOfEmail: async () => id() } },
      );
      expect(full).toEqual({ status: 'refused', code: 'limit' });
      expect(await countMembers(w)).toBe(WORKSPACE_LIMITS.membersPerWorkspace);
    });

    it('changes a role, and answers stale for someone who is not in it', async () => {
      const w = await seedWorld(database);
      const set = (account: string, role: 'owner' | 'member'): Op => ({
        op: 'member.setRole',
        workspaceId: w.workspace,
        accountId: account,
        role,
      });
      expect((await apply(w, 'owner', set(w.accounts.member, 'owner'))).status).toBe('applied');
      expect(await roleOf(w, w.accounts.member)).toBe('owner');
      expect((await apply(w, 'owner', set(w.accounts.coOwner, 'member'))).status).toBe('applied');
      expect(await roleOf(w, w.accounts.coOwner)).toBe('member');
      expect(await apply(w, 'owner', set(w.accounts.outsider, 'owner'))).toEqual({
        status: 'refused',
        code: 'stale',
      });
    });

    it('keeps one owner: the last cannot step down, leave or be removed', async () => {
      const w = await seedWorld(database);
      const base = { workspaceId: w.workspace };
      // The other owner steps down, and the one left is the last.
      expect(
        (
          await apply(w, 'coOwner', {
            op: 'member.setRole',
            ...base,
            accountId: w.accounts.coOwner,
            role: 'member',
          })
        ).status,
      ).toBe('applied');
      const before = JSON.stringify(await countAll(database));
      const refused = { status: 'refused', code: 'invalid', reason: 'last_owner' };
      expect(
        await apply(w, 'owner', {
          op: 'member.setRole',
          ...base,
          accountId: w.accounts.owner,
          role: 'member',
        }),
      ).toEqual(refused);
      expect(await apply(w, 'owner', { op: 'member.leave', ...base })).toEqual(refused);
      expect(
        await apply(w, 'owner', { op: 'member.remove', ...base, accountId: w.accounts.owner }),
      ).toEqual(refused);
      expect(JSON.stringify(await countAll(database))).toBe(before);
      expect(await roleOf(w, w.accounts.owner)).toBe('owner');
      // Someone else made owner first, and they may go.
      await apply(w, 'owner', {
        op: 'member.setRole',
        ...base,
        accountId: w.accounts.member,
        role: 'owner',
      });
      expect((await apply(w, 'owner', { op: 'member.leave', ...base })).status).toBe('applied');
    });

    it('lets only one of two owners who step down at once do it', async () => {
      const w = await seedWorld(database);
      const down = (role: 'owner' | 'coOwner'): Promise<unknown> =>
        apply(w, role, {
          op: 'member.setRole',
          workspaceId: w.workspace,
          accountId: w.accounts[role],
          role: 'member',
        });
      const results = (await Promise.all([down('owner'), down('coOwner')])) as { status: string }[];
      expect(results.map((each) => each.status).sort()).toEqual(['applied', 'refused']);
      const owners = (
        await dbAll(
          database,
          sql`SELECT 1 FROM ${tablesOf(database).workspaceMember} WHERE workspace_id = ${w.workspace} AND role = 'owner'`,
        )
      ).length;
      expect(owners).toBe(1);
    });

    it('takes a removed or leaving person off every board and unassigns them, and leaves their comments', async () => {
      for (const how of ['remove', 'leave'] as const) {
        const w = await seedWorld(database);
        await seedBoardContents(database, w);
        const t = tablesOf(database);
        const mine = (table: unknown, column = 'account_id') =>
          dbAll(
            database,
            sql`SELECT 1 FROM ${table as never} WHERE ${sql.raw(column)} = ${w.accounts.boardOwner}`,
          );
        expect((await mine(t.boardMember)).length).toBe(2);
        expect((await mine(t.cardAssignee)).length).toBe(1);
        const result =
          how === 'remove'
            ? await apply(w, 'owner', {
                op: 'member.remove',
                workspaceId: w.workspace,
                accountId: w.accounts.boardOwner,
              })
            : await apply(w, 'boardOwner', { op: 'member.leave', workspaceId: w.workspace });
        expect(result).toMatchObject({
          status: 'applied',
          rows: { removed: { accountId: w.accounts.boardOwner } },
        });
        expect(await roleOf(w, w.accounts.boardOwner)).toBeUndefined();
        expect((await mine(t.boardMember)).length, how).toBe(0);
        expect((await mine(t.cardAssignee)).length, how).toBe(0);
        // What they wrote stays, and the board is still the workspace's owners' to administer.
        expect((await mine(t.comment, 'author_id')).length, how).toBe(1);
        expect(await listWorkspaces(database, w.accounts.boardOwner)).toEqual([]);
        expect(await reachable(database, boardsAdministeredBy, w.accounts.owner)).toHaveLength(3);
        // Others' places are untouched.
        expect((await mine(t.boardMember)).length).toBe(0);
        expect(await roleOf(w, w.accounts.boardMember)).toBe('member');
      }
    });

    it('lists the people owners first, with addresses for an owner only, and none for an outsider', async () => {
      const w = await seedWorld(database);
      const asOwner = await peopleOf(database, directory, w.accounts.owner, w.workspace);
      expect(asOwner).toHaveLength(5);
      expect(asOwner?.slice(0, 2).map((each) => each.role)).toEqual(['owner', 'owner']);
      expect(asOwner?.every((each) => each.email !== undefined)).toBe(true);
      expect(asOwner?.filter((each) => each.you).map((each) => each.accountId)).toEqual([
        w.accounts.owner,
      ]);
      const asMember = await peopleOf(database, directory, w.accounts.member, w.workspace);
      expect(asMember).toHaveLength(5);
      expect(asMember?.some((each) => each.email !== undefined)).toBe(false);
      expect(await peopleOf(database, directory, w.accounts.outsider, w.workspace)).toBeUndefined();
      expect(await peopleOf(database, directory, w.accounts.owner, id())).toBeUndefined();
    });
  });

  describe('a board and its lists', () => {
    const apply = (w: World, role: Role, op: Op) =>
      applyOp(database, w.accounts[role], { opId: id(), ...op } as OpRequest, OPTIONS);
    const t = () => tablesOf(database);
    const listsOf = (boardId: string) =>
      dbAll<{ id: string; name: string; position: string }>(
        database,
        sql`SELECT id, name, position FROM ${t().boardList} WHERE board_id = ${boardId} ORDER BY position, id`,
      );
    const versionOf = async (boardId: string) =>
      Number(
        (
          await dbAll<{ v: number | string }>(
            database,
            sql`SELECT version AS v FROM ${t().board} WHERE id = ${boardId}`,
          )
        )[0]?.v,
      );

    it('makes a board with Backlog, its maker the owner and only member, public, and moves the workspace on', async () => {
      const w = await seedWorld(database);
      const board = id();
      const result = await apply(w, 'member', {
        op: 'board.create',
        id: board,
        workspaceId: w.workspace,
        name: 'Roadmap',
        color: '#7c3aed',
      });
      expect(result).toMatchObject({
        status: 'applied',
        rows: {
          board: { id: board, name: 'Roadmap', color: '#7c3aed', visibility: 'public', version: 1 },
        },
      });
      expect((await listsOf(board)).map((each) => each.name)).toEqual(['Backlog']);
      // The maker owns it and is on it, so they edit it and administer it, and everyone in the workspace sees it.
      expect(await reachable(database, boardsEditableBy, w.accounts.member)).toContain(board);
      expect(await reachable(database, boardsAdministeredBy, w.accounts.member)).toContain(board);
      expect(await reachable(database, boardsVisibleTo, w.accounts.boardMember)).toContain(board);
      expect(await reachable(database, boardsEditableBy, w.accounts.boardMember)).not.toContain(
        board,
      );
      expect(await reachable(database, boardsVisibleTo, w.accounts.outsider)).not.toContain(board);
      const [row] = await dbAll<{ at: number | string }>(
        database,
        sql`SELECT updated_at AS at FROM ${t().workspace} WHERE id = ${w.workspace}`,
      );
      expect(Number(row?.at)).toBe(NOW);
    });

    it('takes no id another board already has, and holds 500 boards in a workspace', async () => {
      const w = await seedWorld(database);
      const before = JSON.stringify(await countAll(database));
      expect(
        await apply(w, 'owner', {
          op: 'board.create',
          id: w.boards.privateBoard,
          workspaceId: w.workspace,
          name: 'Mine now',
          color: '#2563eb',
        }),
      ).toEqual({ status: 'refused', code: 'not_found' });
      expect(JSON.stringify(await countAll(database))).toBe(before);
      const existing = Number(
        (
          await dbAll<{ n: number | string }>(
            database,
            sql`SELECT COUNT(*) AS n FROM ${t().board} WHERE workspace_id = ${w.workspace}`,
          )
        )[0]?.n,
      );
      for (let i = existing; i < WORKSPACE_LIMITS.boardsPerWorkspace; i++)
        await dbAll(
          database,
          sql`INSERT INTO ${t().board} (id, workspace_id, name, color, visibility, version, created_by, created_at, updated_at) VALUES (${id()}, ${w.workspace}, 'b', '#2563eb', 'public', 1, ${w.accounts.owner}, ${NOW}, ${NOW}) RETURNING id`,
        );
      expect(
        await apply(w, 'owner', {
          op: 'board.create',
          id: id(),
          workspaceId: w.workspace,
          name: 'One more',
          color: '#2563eb',
        }),
      ).toEqual({ status: 'refused', code: 'limit' });
    });

    it('adds, renames and moves a list, moves the version on each time, and writes one row for a move', async () => {
      const w = await seedWorld(database);
      const board = w.boards.publicBoard;
      const start = await versionOf(board);
      const doing = id();
      expect(
        await apply(w, 'boardMember', {
          op: 'list.create',
          id: doing,
          boardId: board,
          name: 'Doing',
          position: 'a1',
        }),
      ).toMatchObject({
        status: 'applied',
        rows: { list: { id: doing, name: 'Doing', cards: 0 }, version: start + 1 },
      });
      expect(
        await apply(w, 'boardOwner', { op: 'list.rename', id: doing, name: 'In flight' }),
      ).toMatchObject({
        rows: { list: { name: 'In flight' }, version: start + 2 },
      });
      const before = await listsOf(board);
      expect(
        await apply(w, 'boardOwner', { op: 'list.move', id: doing, position: 'Zz' }),
      ).toMatchObject({ status: 'applied' });
      const after = await listsOf(board);
      expect(after.map((each) => each.id)).toEqual([doing, w.lists.publicBoard]);
      // Everything but the one list is as it was.
      expect(after.find((each) => each.id === w.lists.publicBoard)).toEqual(
        before.find((each) => each.id === w.lists.publicBoard),
      );
      expect(await versionOf(board)).toBe(start + 3);
    });

    it('holds 100 lists, and takes no id that is already a list', async () => {
      const w = await seedWorld(database);
      const board = w.boards.publicBoard;
      expect(
        await apply(w, 'boardMember', {
          op: 'list.create',
          id: w.lists.privateBoard,
          boardId: board,
          name: 'Clash',
          position: 'a1',
        }),
      ).toEqual({ status: 'refused', code: 'not_found' });
      for (let i = (await listsOf(board)).length; i < WORKSPACE_LIMITS.listsPerBoard; i++)
        await dbAll(
          database,
          sql`INSERT INTO ${t().boardList} (id, board_id, name, position, created_at, updated_at) VALUES (${id()}, ${board}, 'l', ${`b${String(i).padStart(3, '0')}`}, ${NOW}, ${NOW}) RETURNING id`,
        );
      expect(
        await apply(w, 'boardMember', {
          op: 'list.create',
          id: id(),
          boardId: board,
          name: 'Too many',
          position: 'zz',
        }),
      ).toEqual({ status: 'refused', code: 'limit' });
      expect(await listsOf(board)).toHaveLength(WORKSPACE_LIMITS.listsPerBoard);
    });

    it('lets a private board’s member change it and nobody else, and no one change an archived board', async () => {
      const w = await seedWorld(database);
      const into = (boardId: string): Op => ({
        op: 'list.create',
        id: id(),
        boardId,
        name: 'X',
        position: 'a5',
      });
      expect((await apply(w, 'boardMember', into(w.boards.privateBoard))).status).toBe('applied');
      for (const role of ['owner', 'coOwner', 'boardOwner', 'member', 'outsider'] as const)
        expect(await apply(w, role, into(w.boards.privateBoard)), role).toEqual({
          status: 'refused',
          code: 'not_found',
        });
      // Archived: read-only for everyone, its owner included.
      for (const role of ROLES)
        expect(await apply(w, role, into(w.boards.archivedBoard)), role).toEqual({
          status: 'refused',
          code: 'not_found',
        });
      expect(
        await apply(w, 'boardOwner', { op: 'list.delete', id: w.lists.archivedBoard }),
      ).toEqual({ status: 'refused', code: 'not_found' });
    });

    it('deletes a list with its cards and everything on them, and nothing of another list or board', async () => {
      const w = await seedWorld(database);
      await seedBoardContents(database, w);
      const other = id();
      await apply(w, 'boardOwner', {
        op: 'list.create',
        id: other,
        boardId: w.boards.publicBoard,
        name: 'Keep',
        position: 'a1',
      });
      const card = id();
      await dbAll(
        database,
        sql`INSERT INTO ${t().card} (id, board_id, list_id, title, position, created_by, created_at, updated_at) VALUES (${card}, ${w.boards.publicBoard}, ${other}, 'Stay', 'a0', ${w.accounts.boardOwner}, ${NOW}, ${NOW}) RETURNING id`,
      );
      const before = await countAll(database);
      const result = await apply(w, 'boardMember', { op: 'list.delete', id: w.lists.publicBoard });
      expect(result).toMatchObject({
        status: 'applied',
        rows: { deletedList: w.lists.publicBoard },
      });
      const after = await countAll(database);
      const gone = (name: string) => (before[name] ?? 0) - (after[name] ?? 0);
      for (const name of [
        'board_list',
        'card_label',
        'card_assignee',
        'checklist_item',
        'comment',
        'activity',
      ])
        expect(gone(name), name).toBe(1);
      // The world's two cards and the one with contents were on it.
      expect(gone('card')).toBe(3);
      // The board's own labels stay, and so does the other list with its card.
      expect(gone('label')).toBe(0);
      expect(gone('board')).toBe(0);
      expect((await listsOf(w.boards.publicBoard)).map((each) => each.id)).toEqual([other]);
      expect(await dbAll(database, sql`SELECT 1 FROM ${t().card} WHERE id = ${card}`)).toHaveLength(
        1,
      );
    });

    it('is read whole for whoever can see it, with what they may do, and not at all for anyone else', async () => {
      const w = await seedWorld(database);
      await seedBoardContents(database, w);
      const seen = async (role: Role, boardId: string) =>
        readBoard(database, w.accounts[role], boardId);
      const owner = await seen('owner', w.boards.privateBoard);
      expect(owner).toMatchObject({
        workspace: { name: 'Acme' },
        can: { edit: false, admin: true },
        board: { visibility: 'private' },
      });
      expect(await seen('boardMember', w.boards.privateBoard)).toMatchObject({
        can: { edit: true, admin: false },
      });
      expect(await seen('boardOwner', w.boards.publicBoard)).toMatchObject({
        can: { edit: true, admin: true },
        lists: [{ id: w.lists.publicBoard, name: 'Backlog', cards: 2 }],
      });
      expect(await seen('member', w.boards.publicBoard)).toMatchObject({
        can: { edit: false, admin: false },
      });
      // Archived: seen, and read-only even for its owner.
      expect(await seen('boardOwner', w.boards.archivedBoard)).toMatchObject({
        board: { archived: true },
        can: { edit: false, admin: true },
      });
      // A private board is not there for a member who is not on it; nor is anything for an outsider or an id that is nothing.
      expect(await seen('member', w.boards.privateBoard)).toBeUndefined();
      expect(await seen('outsider', w.boards.publicBoard)).toBeUndefined();
      expect(await readBoard(database, w.accounts.owner, id())).toBeUndefined();
      expect(
        await boardVersion(database, w.accounts.member, w.boards.privateBoard),
      ).toBeUndefined();
      expect(await boardVersion(database, w.accounts.member, w.boards.publicBoard)).toBe(1);
    });

    it('lists a workspace’s boards by name for those who can see them, and none for an outsider', async () => {
      const w = await seedWorld(database);
      const names = async (role: Role) =>
        (await boardsOfWorkspace(database, w.accounts[role], w.workspace))?.map(
          (each) => each.name,
        );
      expect(await names('owner')).toEqual(['Hiring', 'Last year', 'Roadmap']);
      expect(await names('member')).toEqual(['Last year', 'Roadmap']);
      expect(await names('boardMember')).toEqual(['Hiring', 'Last year', 'Roadmap']);
      expect(await names('outsider')).toBeUndefined();
    });
  });

  describe('cards in lists', () => {
    const apply = (w: World, role: Role, op: Op) =>
      applyOp(database, w.accounts[role], { opId: id(), ...op } as OpRequest, OPTIONS);
    const t = () => tablesOf(database);
    const cardRow = async (cardId: string) =>
      (
        await dbAll<{
          listId: string;
          position: string;
          archivedAt: number | string | null;
          updatedAt: number | string;
        }>(
          database,
          sql`SELECT list_id AS "listId", position, archived_at AS "archivedAt", updated_at AS "updatedAt" FROM ${t().card} WHERE id = ${cardId}`,
        )
      )[0];
    const versionOf = async (boardId: string) =>
      Number(
        (
          await dbAll<{ v: number | string }>(
            database,
            sql`SELECT version AS v FROM ${t().board} WHERE id = ${boardId}`,
          )
        )[0]?.v,
      );

    it('adds a card to a list with the title it was given, and moves the board on', async () => {
      const w = await seedWorld(database);
      const start = await versionOf(w.boards.publicBoard);
      const made = id();
      expect(
        await apply(w, 'boardMember', {
          op: 'card.create',
          id: made,
          listId: w.lists.publicBoard,
          title: 'Write it',
          position: 'Zy',
        }),
      ).toMatchObject({
        status: 'applied',
        rows: {
          card: {
            id: made,
            title: 'Write it',
            listId: w.lists.publicBoard,
            position: 'Zy',
            hasDescription: false,
          },
          version: start + 1,
        },
      });
      expect(
        (await readBoard(database, w.accounts.boardMember, w.boards.publicBoard))?.cards.map(
          (c) => c.id,
        ),
      ).toContain(made);
    });

    it('takes no id another card has, no list of a board one cannot change, and holds 5,000 cards', async () => {
      const w = await seedWorld(database);
      const create = (listId: string, cardId = id()): Op => ({
        op: 'card.create',
        id: cardId,
        listId,
        title: 'x',
        position: 'a9',
      });
      expect(await apply(w, 'boardMember', create(w.lists.publicBoard, w.cards.open))).toEqual({
        status: 'refused',
        code: 'not_found',
      });
      // The private board's list is its member's; the archived board's is nobody's.
      expect((await apply(w, 'boardMember', create(w.lists.privateBoard))).status).toBe('applied');
      expect(await apply(w, 'boardOwner', create(w.lists.privateBoard))).toEqual({
        status: 'refused',
        code: 'not_found',
      });
      expect(await apply(w, 'boardOwner', create(w.lists.archivedBoard))).toEqual({
        status: 'refused',
        code: 'not_found',
      });
      const count = async () =>
        Number(
          (
            await dbAll<{ n: number | string }>(
              database,
              sql`SELECT COUNT(*) AS n FROM ${t().card} WHERE board_id = ${w.boards.publicBoard}`,
            )
          )[0]?.n,
        );
      for (let i = await count(); i < WORKSPACE_LIMITS.cardsPerBoard; i++)
        await dbAll(
          database,
          sql`INSERT INTO ${t().card} (id, board_id, list_id, title, position, created_by, created_at, updated_at) VALUES (${id()}, ${w.boards.publicBoard}, ${w.lists.publicBoard}, 'c', ${`b${i}`}, ${w.accounts.boardOwner}, ${NOW}, ${NOW}) RETURNING id`,
        );
      expect(await apply(w, 'boardMember', create(w.lists.publicBoard))).toEqual({
        status: 'refused',
        code: 'limit',
      });
    });

    it('moves a card to a list of its own board by writing its one row, and to no other board’s list', async () => {
      const w = await seedWorld(database);
      const other = id();
      await apply(w, 'boardOwner', {
        op: 'list.create',
        id: other,
        boardId: w.boards.publicBoard,
        name: 'Doing',
        position: 'a1',
      });
      const neighbour = await cardRow(w.cards.archived);
      const moved = await apply(w, 'boardMember', {
        op: 'card.move',
        id: w.cards.open,
        listId: other,
        position: 'a3',
      });
      expect(moved).toMatchObject({
        status: 'applied',
        rows: { card: { listId: other, position: 'a3' } },
      });
      expect(await cardRow(w.cards.open)).toMatchObject({ listId: other, position: 'a3' });
      // No other card was written.
      expect(await cardRow(w.cards.archived)).toEqual(neighbour);
      // Not to a list of another board, not by someone who may change the target's board but not the card's own, and not an archived card.
      const before = await cardRow(w.cards.open);
      expect(
        await apply(w, 'boardMember', {
          op: 'card.move',
          id: w.cards.open,
          listId: w.lists.privateBoard,
          position: 'a1',
        }),
      ).toEqual({ status: 'refused', code: 'not_found' });
      expect(
        await apply(w, 'boardMember', {
          op: 'card.move',
          id: w.cards.archived,
          listId: other,
          position: 'a1',
        }),
      ).toEqual({ status: 'refused', code: 'not_found' });
      expect(
        await apply(w, 'boardMember', {
          op: 'card.move',
          id: w.cards.open,
          listId: id(),
          position: 'a1',
        }),
      ).toEqual({ status: 'refused', code: 'not_found' });
      expect(await cardRow(w.cards.open)).toEqual(before);
    });

    it('archives a card out of the board and restores it to the list and position it had', async () => {
      const w = await seedWorld(database);
      const open = async () =>
        (await readBoard(database, w.accounts.boardMember, w.boards.publicBoard))?.cards.map(
          (c) => c.id,
        ) ?? [];
      expect(await open()).toEqual([w.cards.open]);
      expect((await apply(w, 'boardMember', { op: 'card.archive', id: w.cards.open })).status).toBe(
        'applied',
      );
      expect(await open()).toEqual([]);
      expect(
        (await archivedCards(database, w.accounts.member, w.boards.publicBoard))
          ?.map((c) => c.id)
          .sort(),
      ).toEqual([w.cards.archived, w.cards.open].sort());
      // Twice is not a card that can be archived.
      expect(await apply(w, 'boardMember', { op: 'card.archive', id: w.cards.open })).toEqual({
        status: 'refused',
        code: 'not_found',
      });
      expect(await apply(w, 'boardMember', { op: 'card.restore', id: w.cards.open })).toMatchObject(
        {
          status: 'applied',
          rows: { card: { id: w.cards.open, listId: w.lists.publicBoard, position: 'a0' } },
        },
      );
      expect(await open()).toEqual([w.cards.open]);
      // An open card cannot be restored.
      expect(await apply(w, 'boardMember', { op: 'card.restore', id: w.cards.open })).toEqual({
        status: 'refused',
        code: 'not_found',
      });
    });

    it('deletes only an archived card, with what is on it, and leaves its activity', async () => {
      const w = await seedWorld(database);
      await seedBoardContents(database, w);
      const contentsCard =
        (
          await dbAll<{ id: string }>(
            database,
            sql`SELECT id FROM ${t().card} WHERE board_id = ${w.boards.publicBoard} AND title = 'First'`,
          )
        )[0]?.id ?? '';
      // An open card is not deleted.
      expect(await apply(w, 'boardMember', { op: 'card.delete', id: contentsCard })).toEqual({
        status: 'refused',
        code: 'not_found',
      });
      await apply(w, 'boardMember', { op: 'card.archive', id: contentsCard });
      const before = await countAll(database);
      expect(await apply(w, 'boardMember', { op: 'card.delete', id: contentsCard })).toMatchObject({
        status: 'applied',
        rows: { deletedCard: contentsCard },
      });
      const after = await countAll(database);
      const gone = (name: string) => (before[name] ?? 0) - (after[name] ?? 0);
      for (const name of ['card', 'card_label', 'card_assignee', 'checklist_item', 'comment'])
        expect(gone(name), name).toBe(1);
      // The history of the work stays, and so do the board's labels and the other cards.
      expect(gone('activity')).toBe(0);
      expect(gone('label')).toBe(0);
      expect(await cardRow(w.cards.open)).toBeDefined();
    });

    it('renames a card and describes it, keeps the description as written, and takes a blank one for none', async () => {
      const w = await seedWorld(database);
      const start = await versionOf(w.boards.publicBoard);
      expect(
        await apply(w, 'boardMember', { op: 'card.rename', id: w.cards.open, title: 'Better' }),
      ).toMatchObject({
        status: 'applied',
        rows: { card: { id: w.cards.open, title: 'Better' }, version: start + 1 },
      });
      const text = 'First line\n\n  indented <b>not html</b>\nlast';
      expect(
        await apply(w, 'boardMember', { op: 'card.describe', id: w.cards.open, description: text }),
      ).toMatchObject({
        rows: { card: { hasDescription: true } },
      });
      const read = await cardDetail(database, w.accounts.member, w.cards.open);
      expect(read).toMatchObject({
        title: 'Better',
        description: text,
        listName: 'Backlog',
        archived: false,
      });
      expect(
        await apply(w, 'boardMember', {
          op: 'card.describe',
          id: w.cards.open,
          description: '  \n ',
        }),
      ).toMatchObject({
        rows: { card: { hasDescription: false } },
      });
      expect((await cardDetail(database, w.accounts.member, w.cards.open))?.description).toBeNull();
    });

    it('reads a card for whoever can see its board, an archived one too, and for nobody else', async () => {
      const w = await seedWorld(database);
      expect((await cardDetail(database, w.accounts.member, w.cards.open))?.title).toBe('Open one');
      expect(await cardDetail(database, w.accounts.member, w.cards.archived)).toMatchObject({
        archived: true,
      });
      expect(await cardDetail(database, w.accounts.outsider, w.cards.open)).toBeUndefined();
      expect(await cardDetail(database, w.accounts.member, id())).toBeUndefined();
      // A card on a private board is not there for a member who is not on it.
      const secret = id();
      await apply(w, 'boardMember', {
        op: 'card.create',
        id: secret,
        listId: w.lists.privateBoard,
        title: 'Secret',
        position: 'a0',
      });
      expect(await cardDetail(database, w.accounts.boardMember, secret)).toMatchObject({
        title: 'Secret',
      });
      expect(await cardDetail(database, w.accounts.owner, secret)).toMatchObject({
        title: 'Secret',
      });
      expect(await cardDetail(database, w.accounts.member, secret)).toBeUndefined();
    });

    it('reads archived cards for whoever can see the board, and for nobody else', async () => {
      const w = await seedWorld(database);
      expect(
        (await archivedCards(database, w.accounts.member, w.boards.publicBoard))?.map(
          (c) => c.title,
        ),
      ).toEqual(['Old one']);
      expect(
        await archivedCards(database, w.accounts.outsider, w.boards.publicBoard),
      ).toBeUndefined();
      expect(
        await archivedCards(database, w.accounts.member, w.boards.privateBoard),
      ).toBeUndefined();
      expect(await archivedCards(database, w.accounts.member, id())).toBeUndefined();
    });
  });

  describe('a board’s settings, archive and delete', () => {
    const apply = (w: World, role: Role, op: Op) =>
      applyOp(database, w.accounts[role], { opId: id(), ...op } as OpRequest, OPTIONS);
    const t = () => tablesOf(database);
    const boardRow = async (boardId: string) =>
      (
        await dbAll<{
          name: string;
          color: string;
          description: string | null;
          archivedAt: number | string | null;
          version: number | string;
        }>(
          database,
          sql`SELECT name, color, description, archived_at AS "archivedAt", version FROM ${t().board} WHERE id = ${boardId}`,
        )
      )[0];

    it('changes the name, colour and description together, and a blank description is none', async () => {
      const w = await seedWorld(database);
      const start = Number((await boardRow(w.boards.publicBoard))?.version);
      expect(
        await apply(w, 'boardOwner', {
          op: 'board.update',
          id: w.boards.publicBoard,
          name: 'Plans',
          color: '#7c3aed',
          description: 'What we do next',
        }),
      ).toMatchObject({
        status: 'applied',
        rows: {
          board: {
            name: 'Plans',
            color: '#7c3aed',
            description: 'What we do next',
            archived: false,
          },
          version: start + 1,
        },
      });
      expect(await boardRow(w.boards.publicBoard)).toMatchObject({
        name: 'Plans',
        color: '#7c3aed',
        description: 'What we do next',
      });
      await apply(w, 'owner', {
        op: 'board.update',
        id: w.boards.publicBoard,
        name: 'Plans',
        color: '#7c3aed',
        description: ' \n ',
      });
      expect((await boardRow(w.boards.publicBoard))?.description).toBeNull();
    });

    it('lets a workspace owner who is not on a board archive it, and not add a card to it', async () => {
      const w = await seedWorld(database);
      expect(
        (await apply(w, 'owner', { op: 'board.archive', id: w.boards.publicBoard })).status,
      ).toBe('applied');
      expect(await readBoard(database, w.accounts.owner, w.boards.publicBoard)).toMatchObject({
        board: { archived: true },
        can: { edit: false, admin: true },
      });
      // Not a member, so not an editor, archived or not.
      expect(
        await apply(w, 'owner', {
          op: 'card.create',
          id: id(),
          listId: w.lists.privateBoard,
          title: 'x',
          position: 'a0',
        }),
      ).toEqual({ status: 'refused', code: 'not_found' });
    });

    it('makes an archived board refuse every content operation from everyone, its owners included, until it is restored', async () => {
      const w = await seedWorld(database);
      await apply(w, 'boardOwner', { op: 'board.archive', id: w.boards.publicBoard });
      const content: Op[] = [
        { op: 'list.create', id: id(), boardId: w.boards.publicBoard, name: 'x', position: 'a5' },
        { op: 'list.rename', id: w.lists.publicBoard, name: 'x' },
        { op: 'list.move', id: w.lists.publicBoard, position: 'a9' },
        { op: 'list.delete', id: w.lists.publicBoard },
        { op: 'card.create', id: id(), listId: w.lists.publicBoard, title: 'x', position: 'a5' },
        { op: 'card.move', id: w.cards.open, listId: w.lists.publicBoard, position: 'a9' },
        { op: 'card.archive', id: w.cards.open },
        { op: 'card.rename', id: w.cards.open, title: 'x' },
        { op: 'card.describe', id: w.cards.open, description: 'x' },
      ];
      for (const role of ROLES)
        for (const op of content)
          expect(await apply(w, role, op), `${role} ${op.op}`).toEqual({
            status: 'refused',
            code: 'not_found',
          });
      // Its settings are read-only too, and archiving twice is not a thing.
      expect(
        await apply(w, 'boardOwner', {
          op: 'board.update',
          id: w.boards.publicBoard,
          name: 'x',
          color: '#2563eb',
          description: '',
        }),
      ).toEqual({ status: 'refused', code: 'not_found' });
      expect(
        await apply(w, 'boardOwner', { op: 'board.archive', id: w.boards.publicBoard }),
      ).toEqual({ status: 'refused', code: 'not_found' });
      // Restored, the work is allowed again.
      expect(
        (await apply(w, 'owner', { op: 'board.restore', id: w.boards.publicBoard })).status,
      ).toBe('applied');
      expect((await apply(w, 'boardMember', content[0] as Op)).status).toBe('applied');
      expect(await apply(w, 'owner', { op: 'board.restore', id: w.boards.publicBoard })).toEqual({
        status: 'refused',
        code: 'not_found',
      });
    });

    it('deletes a board with a row of every table below it, and nothing of another board or of the workspace', async () => {
      const w = await seedWorld(database);
      await seedBoardContents(database, w);
      const before = await countAll(database);
      expect(
        await apply(w, 'boardOwner', {
          op: 'board.delete',
          id: w.boards.publicBoard,
          name: 'Roadmap',
        }),
      ).toMatchObject({
        status: 'applied',
        rows: { deletedBoard: w.boards.publicBoard },
      });
      const after = await countAll(database);
      const gone = (name: string) => (before[name] ?? 0) - (after[name] ?? 0);
      expect(gone('board')).toBe(1);
      expect(gone('board_member')).toBe(2);
      expect(gone('board_list')).toBe(1);
      // The world's two cards and the one with contents.
      expect(gone('card')).toBe(3);
      for (const name of [
        'label',
        'card_label',
        'card_assignee',
        'checklist_item',
        'comment',
        'activity',
        'publication',
        'notice',
      ])
        expect(gone(name), name).toBe(1);
      // The workspace, its people and its other boards are whole.
      expect(gone('workspace')).toBe(0);
      expect(gone('workspace_member')).toBe(0);
      expect(after.board).toBe((before.board ?? 0) - 1);
      expect(await readBoard(database, w.accounts.owner, w.boards.privateBoard)).toBeDefined();
    });

    it('needs the name as it is, typed: another name deletes nothing and says it is invalid', async () => {
      const w = await seedWorld(database);
      const before = JSON.stringify(await countAll(database));
      for (const name of ['roadmap', 'Roadmap ', 'Other'])
        expect(
          await apply(w, 'boardOwner', { op: 'board.delete', id: w.boards.publicBoard, name }),
          name,
        ).toEqual({ status: 'refused', code: 'invalid' });
      expect(JSON.stringify(await countAll(database))).toBe(before);
    });
  });

  describe('who is on a board', () => {
    const apply = (w: World, role: Role, op: Op) =>
      applyOp(database, w.accounts[role], { opId: id(), ...op } as OpRequest, OPTIONS);
    const t = () => tablesOf(database);
    const onBoard = async (boardId: string, account: string) =>
      (
        await dbAll(
          database,
          sql`SELECT 1 FROM ${t().boardMember} WHERE board_id = ${boardId} AND account_id = ${account}`,
        )
      ).length === 1;

    it('hides a board made private from a member of the workspace at once, and not from its members or the workspace’s owners', async () => {
      const w = await seedWorld(database);
      expect(
        (
          await apply(w, 'boardOwner', {
            op: 'board.setVisibility',
            id: w.boards.publicBoard,
            visibility: 'private',
          })
        ).status,
      ).toBe('applied');
      for (const role of ['owner', 'coOwner', 'boardOwner', 'boardMember'] as const)
        expect(
          await readBoard(database, w.accounts[role], w.boards.publicBoard),
          role,
        ).toBeDefined();
      expect(await readBoard(database, w.accounts.member, w.boards.publicBoard)).toBeUndefined();
      expect(await boardVersion(database, w.accounts.member, w.boards.publicBoard)).toBeUndefined();
      expect(
        (await boardsOfWorkspace(database, w.accounts.member, w.workspace))?.map((b) => b.name),
      ).toEqual(['Last year']);
      const index = await boardsIndex(database, directory, w.accounts.member);
      expect(index.workspaces.flatMap((each) => each.boards).map((b) => b.name)).toEqual([
        'Last year',
      ]);
      expect(
        await boardPeople(database, directory, w.accounts.member, w.boards.publicBoard),
      ).toBeUndefined();
      expect(await cardDetail(database, w.accounts.member, w.cards.open)).toBeUndefined();
      // And public again, it is back.
      await apply(w, 'owner', {
        op: 'board.setVisibility',
        id: w.boards.publicBoard,
        visibility: 'public',
      });
      expect(await readBoard(database, w.accounts.member, w.boards.publicBoard)).toBeDefined();
    });

    it('adds only someone who is in the workspace, as a member who then edits, and not twice', async () => {
      const w = await seedWorld(database);
      const add = (account: string): Op => ({
        op: 'boardMember.add',
        boardId: w.boards.publicBoard,
        accountId: account,
      });
      expect(await apply(w, 'owner', add(w.accounts.outsider))).toEqual({
        status: 'refused',
        code: 'invalid',
        reason: 'not_in_workspace',
      });
      expect(await apply(w, 'owner', add(id()))).toEqual({
        status: 'refused',
        code: 'invalid',
        reason: 'not_in_workspace',
      });
      expect(await onBoard(w.boards.publicBoard, w.accounts.outsider)).toBe(false);
      expect(await apply(w, 'owner', add(w.accounts.member))).toMatchObject({
        status: 'applied',
        rows: { boardMember: { accountId: w.accounts.member, role: 'member' } },
      });
      expect(
        (await readBoard(database, w.accounts.member, w.boards.publicBoard))?.can,
      ).toMatchObject({ edit: true, admin: false });
      expect(await apply(w, 'owner', add(w.accounts.member))).toEqual({
        status: 'refused',
        code: 'invalid',
        reason: 'already_in',
      });
      // An archived board's people are read-only too.
      await apply(w, 'owner', { op: 'board.archive', id: w.boards.publicBoard });
      expect(await apply(w, 'owner', add(w.accounts.coOwner))).toEqual({
        status: 'refused',
        code: 'not_found',
      });
    });

    it('makes a member an owner, who then administers the board, and says stale for someone who is not on it', async () => {
      const w = await seedWorld(database);
      const set = (account: string): Op => ({
        op: 'boardMember.setRole',
        boardId: w.boards.publicBoard,
        accountId: account,
        role: 'owner',
      });
      expect((await apply(w, 'boardOwner', set(w.accounts.boardMember))).status).toBe('applied');
      expect(
        (await readBoard(database, w.accounts.boardMember, w.boards.publicBoard))?.can.admin,
      ).toBe(true);
      expect(await apply(w, 'boardOwner', set(w.accounts.member))).toEqual({
        status: 'refused',
        code: 'stale',
      });
    });

    it('takes a removed or leaving person off the board and out of its assignments, and leaves their comments', async () => {
      for (const how of ['remove', 'leave'] as const) {
        const w = await seedWorld(database);
        await seedBoardContents(database, w);
        const mine = (table: unknown, column = 'account_id') =>
          dbAll(
            database,
            sql`SELECT 1 FROM ${table as never} WHERE ${sql.raw(column)} = ${w.accounts.boardOwner} AND board_id = ${w.boards.publicBoard}`,
          );
        expect((await mine(t().cardAssignee)).length).toBe(1);
        const result =
          how === 'remove'
            ? await apply(w, 'owner', {
                op: 'boardMember.remove',
                boardId: w.boards.publicBoard,
                accountId: w.accounts.boardOwner,
              })
            : await apply(w, 'boardOwner', { op: 'board.leave', id: w.boards.publicBoard });
        expect(result).toMatchObject({
          status: 'applied',
          rows: { removedBoardMember: { accountId: w.accounts.boardOwner } },
        });
        expect(await onBoard(w.boards.publicBoard, w.accounts.boardOwner), how).toBe(false);
        expect((await mine(t().cardAssignee)).length, how).toBe(0);
        expect((await mine(t().comment, 'author_id')).length, how).toBe(1);
        // They are still in the workspace and see the public board, as a viewer; the others on it are untouched.
        expect(
          (await readBoard(database, w.accounts.boardOwner, w.boards.publicBoard))?.can,
        ).toMatchObject({ edit: false, admin: false, join: true });
        expect(await onBoard(w.boards.publicBoard, w.accounts.boardMember)).toBe(true);
        // And the one who is not on it cannot be removed or left.
        expect(
          await apply(w, 'owner', {
            op: 'boardMember.remove',
            boardId: w.boards.publicBoard,
            accountId: w.accounts.boardOwner,
          }),
        ).toEqual({ status: 'refused', code: 'stale' });
      }
    });

    it('lets a viewer join a public board with one click and edit it, and no one join what they may not see or what is archived', async () => {
      const w = await seedWorld(database);
      expect(
        (await readBoard(database, w.accounts.member, w.boards.publicBoard))?.can,
      ).toMatchObject({ edit: false, join: true });
      expect(
        (await apply(w, 'member', { op: 'board.join', id: w.boards.publicBoard })).status,
      ).toBe('applied');
      expect(
        (await readBoard(database, w.accounts.member, w.boards.publicBoard))?.can,
      ).toMatchObject({ edit: true, join: false });
      // A private board is not there for a member who is not on it; a workspace owner can add themselves to it; an archived board cannot be joined.
      expect(await apply(w, 'member', { op: 'board.join', id: w.boards.privateBoard })).toEqual({
        status: 'refused',
        code: 'not_found',
      });
      expect((await readBoard(database, w.accounts.owner, w.boards.privateBoard))?.can.join).toBe(
        true,
      );
      expect(
        (await apply(w, 'owner', { op: 'board.join', id: w.boards.privateBoard })).status,
      ).toBe('applied');
      expect(await apply(w, 'member', { op: 'board.join', id: w.boards.archivedBoard })).toEqual({
        status: 'refused',
        code: 'not_found',
      });
      expect(await apply(w, 'outsider', { op: 'board.join', id: w.boards.publicBoard })).toEqual({
        status: 'refused',
        code: 'not_found',
      });
    });

    it('lists a board’s people owners first, with addresses and a picker for an administrator only', async () => {
      const w = await seedWorld(database);
      const asAdmin = await boardPeople(
        database,
        directory,
        w.accounts.boardOwner,
        w.boards.publicBoard,
      );
      expect(asAdmin?.members.map((m) => [m.accountId, m.role])).toEqual([
        [w.accounts.boardOwner, 'owner'],
        [w.accounts.boardMember, 'member'],
      ]);
      expect(asAdmin?.members.every((m) => m.email !== undefined)).toBe(true);
      // The picker is the workspace's people who are not on the board: never anyone else.
      expect(asAdmin?.candidates.map((c) => c.accountId).sort()).toEqual(
        [w.accounts.owner, w.accounts.coOwner, w.accounts.member].sort(),
      );
      const asMember = await boardPeople(
        database,
        directory,
        w.accounts.boardMember,
        w.boards.publicBoard,
      );
      expect(asMember?.members.some((m) => m.email !== undefined)).toBe(false);
      expect(asMember?.candidates).toEqual([]);
      expect(
        await boardPeople(database, directory, w.accounts.outsider, w.boards.publicBoard),
      ).toBeUndefined();
    });
  });

  it('has a row for every operation the door takes', () => {
    expect(OPERATIONS.map((each) => each.op).sort()).toEqual([...OPS].sort());
  });
});
