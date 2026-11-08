import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll, dbRun } from '../db/exec';
import { testTarget } from '../db/test-support';
import { applyMutation } from '../sync/apply';
import { account, card, list, makeStore, mutation } from '../sync/test-support';
import { pull } from '../sync/pull';
import { configureOperator, operatorRing } from '../workspaces/content';
import { readBoard } from '../workspaces/reads';
import { seedWorld } from '../workspaces/testing/roles';
import { entryOf, ringOf } from './keys';
import {
  assertOperatorState,
  inspectOperatorState,
  moveContent,
  rotateContent,
} from './operator-data';

/**
 * The start-up refusal, the explicit move and the rotation of the operator key (DESIGN.md §9.5, task 14.7), on a database that starts with plain content: the
 * real workspace world and a Desk, written with the mode off.
 */
const { leg } = testTarget();
const A = ringOf(Buffer.alloc(32, 1));
const B = ringOf(Buffer.alloc(32, 2));
if (!A || !B) throw new Error('rings');

let database: Database;
let close: () => Promise<void>;
let saved: ReturnType<typeof operatorRing>;
let owner: string;
let boardId: string;
const MARK = 'zqxplanted';

beforeAll(async () => {
  saved = operatorRing();
  configureOperator(undefined);
  ({ database, close } = await makeStore());
  const world = await seedWorld(database);
  boardId = world.boards.publicBoard;
  owner = account();
  const l = list({ title: `${MARK}-desk-list` });
  const c = card(l.id, { fields: { title: { v: `${MARK}-desk-card` } } });
  await applyMutation(database, owner, mutation(l, c), { now: 1_800_000_000_000 });
  configureOperator(saved);
});
afterAll(async () => {
  configureOperator(saved);
  await close();
});
beforeEach(() => configureOperator(undefined));
afterEach(() => configureOperator(saved));

const dumpOf = async () =>
  JSON.stringify([
    await dbAll(database, sql`SELECT name, description FROM board`),
    await dbAll(database, sql`SELECT title FROM card`),
    await dbAll(database, sql`SELECT fields FROM desk_card`),
    await dbAll(database, sql`SELECT fields FROM desk_list`),
  ]);

describe(`the operator key's start-up check, move and rotation (${leg})`, () => {
  it('refuses to start with the mode on and plain content, and names where and what to run', async () => {
    const state = await inspectOperatorState(database, A);
    expect(state.plain.size).toBeGreaterThan(5);
    await expect(assertOperatorState(database, { operator: true, ring: A })).rejects.toThrow(
      /content is stored in plain in .*card.*desk_card.*encrypt-data/s,
    );
  });

  it('starts with the mode off and plain content, as it always did', async () => {
    await expect(
      assertOperatorState(database, { operator: false, ring: undefined }),
    ).resolves.toBeUndefined();
  });

  it('seals everything on request, leaves a dump with none of it, and is safe to run again', async () => {
    const moved = await moveContent(database, A, 'seal');
    expect(moved.map((m) => m.place)).toEqual(
      expect.arrayContaining(['card.title', 'board.name', 'desk_card', 'desk_list']),
    );
    expect(await dumpOf()).not.toContain(MARK);
    expect(await dumpOf()).not.toContain('Roadmap');
    expect(await moveContent(database, A, 'seal')).toEqual([]);
    await expect(
      assertOperatorState(database, { operator: true, ring: A }),
    ).resolves.toBeUndefined();
  });

  it('reads what it sealed, through the readers, with the mode on', async () => {
    configureOperator(A);
    const read = await readBoard(
      database,
      (
        await dbAll<{ id: string }>(
          database,
          sql`SELECT created_by AS id FROM board WHERE id = ${boardId}`,
        )
      )[0]?.id ?? '',
      boardId,
    );
    expect(read?.board.name).toBe('Roadmap');
    const page = await pull(database, owner, 0, { operator: A });
    expect(JSON.stringify(page)).toContain(`${MARK}-desk-card`);
  });

  it('refuses the mode off with sealed content, and sealed under a key it was not given', async () => {
    await expect(
      assertOperatorState(database, { operator: false, ring: undefined }),
    ).rejects.toThrow(/TUSK_DB_ENCRYPTION is off, and content is sealed/);
    await expect(assertOperatorState(database, { operator: true, ring: B })).rejects.toThrow(
      /sealed under a key this server was not given/,
    );
  });

  it('moves to a new key at start-up, in two processes at once, and the old key can be dropped', async () => {
    const ring = { current: B.current, previous: A.current };
    const runs = await Promise.all([rotateContent(database, ring), rotateContent(database, ring)]);
    expect(runs[0] + runs[1]).toBeGreaterThan(0);
    // Every row was moved once, between the two, and a third run finds nothing.
    expect(await rotateContent(database, ring)).toBe(0);
    await expect(
      assertOperatorState(database, { operator: true, ring: B }),
    ).resolves.toBeUndefined();
    configureOperator(B);
    const page = await pull(database, owner, 0, { operator: B });
    expect(JSON.stringify(page)).toContain(`${MARK}-desk-card`);
    expect(entryOf(Buffer.alloc(32, 2)).fingerprint).toBe(B.current.fingerprint);
  });

  it('opens everything on request, so that the mode can go off again', async () => {
    await moveContent(database, B, 'open');
    expect(await dumpOf()).toContain(`${MARK}-desk-card`);
    await expect(
      assertOperatorState(database, { operator: false, ring: undefined }),
    ).resolves.toBeUndefined();
  });

  it('refuses the mode on with accounts that have a key of their own, and moves nothing for them', async () => {
    await dbRun(
      database,
      sql`INSERT INTO account_settings (account_id, seq, encryption, created_at) VALUES (${account()}, 1, 'personal', 1)`,
    );
    await expect(assertOperatorState(database, { operator: true, ring: B })).rejects.toThrow(
      /have a key of their own/,
    );
    await expect(moveContent(database, B, 'seal')).rejects.toThrow(/key of their own/);
  });
});
