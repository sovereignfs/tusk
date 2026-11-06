import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { makeStore } from '../sync/test-support';
import { applyOp } from './apply';
import { boardsAdministeredBy, boardsEditableBy, boardsVisibleTo } from './can';
import { OPS, type OpRefusal, type OpRequest } from './format';
import { tablesOf } from './tables';
import { type Role, ROLES, type World, reachable, seedWorld } from './testing/roles';

/**
 * The matrix of roles (DESIGN.md §7.2, §24 Testing): six people in six roles, every operation and every permission, and what each of them gets, **written
 * once in a table** and run against all of them, on whichever database the leg runs on. A new operation without a row in `OPERATIONS` fails the last test,
 * so that nothing can be added to the door without saying who may use it.
 */
const { leg } = testTarget();

let database: Database;
let close: () => Promise<void>;
let world: World;
beforeAll(async () => {
  ({ database, close } = await makeStore());
  world = await seedWorld(database);
});
afterAll(async () => close());

const NOW = 1_800_000_100_000;
const id = () => crypto.randomUUID();

/** What each operation is for, and who may do it. `build` makes the request against the world; `may` are the roles that get `applied`, all others `not_found`. */
interface Row {
  op: (typeof OPS)[number];
  build(w: World): Omit<OpRequest, 'opId'>;
  may: readonly Role[];
  /** What anyone else is told. */
  otherwise: OpRefusal;
}
const OPERATIONS: Row[] = [
  {
    op: 'workspace.rename',
    build: (w) => ({ op: 'workspace.rename', id: w.workspace, name: 'Renamed' }),
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
];

const row = (table: unknown) =>
  dbAll<Record<string, unknown>>(database, sql`SELECT * FROM ${table as never} ORDER BY 1`);

describe(`the roles (${leg})`, () => {
  describe.each(OPERATIONS)('$op', ({ build, may, otherwise }) => {
    for (const role of ROLES) {
      const allowed = may.includes(role);
      it(`${allowed ? 'lets' : 'refuses'} ${role}${allowed ? '' : `, as ${otherwise}, changing nothing`}`, async () => {
        const request = { opId: id(), ...build(world) } as OpRequest;
        const before = JSON.stringify([
          await row(tablesOf(database).workspace),
          await row(tablesOf(database).workspaceMember),
        ]);
        const result = await applyOp(database, world.accounts[role], request, { now: NOW });
        if (allowed) {
          expect(result.status).toBe('applied');
        } else {
          expect(result).toEqual({ status: 'refused', code: otherwise });
          const after = JSON.stringify([
            await row(tablesOf(database).workspace),
            await row(tablesOf(database).workspaceMember),
          ]);
          expect(after).toBe(before);
          // And nothing was recorded as done: the same `opId` can be tried again by someone who may.
          const retry = await applyOp(database, world.accounts.owner, request, { now: NOW });
          if (request.op === 'workspace.rename') expect(retry.status).toBe('applied');
        }
      });
    }
  });

  it('is the same answer for a workspace that is not there as for one that is not theirs', async () => {
    const theirs = await applyOp(
      database,
      world.accounts.outsider,
      { opId: id(), op: 'workspace.rename', id: world.workspace, name: 'Mine now' },
      { now: NOW },
    );
    const nothing = await applyOp(
      database,
      world.accounts.outsider,
      { opId: id(), op: 'workspace.rename', id: id(), name: 'Mine now' },
      { now: NOW },
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

  it('has a row for every operation the door takes', () => {
    expect(OPERATIONS.map((each) => each.op).sort()).toEqual([...OPS].sort());
  });
});
