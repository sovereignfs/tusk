import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import { makeStore } from '../sync/test-support';
import { applyOp } from './apply';
import type { Op, OpRequest } from './format';
import { getPlanned } from '../planner/endpoint';
import { plannedBoardCards } from './planned';
import { ROLES, type Role, type World, seedWorld } from './testing/roles';

/**
 * The boards' part of the Planner (DESIGN.md §25.1, task 19.1), on whichever database the leg runs on: only the cards assigned to the person, only open ones in
 * the range, only on boards they can still see, and nobody's but their own.
 */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

const NOW = 1_800_000_500_000;
const directory = {
  idOfEmail: async () => undefined,
  profiles: async () => new Map(),
};
const id = () => crypto.randomUUID();
const apply = (w: World, role: Role, op: Op) =>
  applyOp(database, w.accounts[role], { opId: id(), ...op } as OpRequest, { now: NOW, directory });
const planned = (w: World, role: Role, from = '2026-11-01', to = '2026-11-30') =>
  plannedBoardCards(database, w.accounts[role], from, to);

async function dated(w: World, who: Role, title: string, date: string, time: string | null) {
  const card = id();
  await apply(w, 'boardMember', {
    op: 'card.create',
    id: card,
    listId: w.lists.publicBoard,
    title,
    position: `a${card.slice(0, 6)}`,
  });
  await apply(w, 'boardMember', { op: 'card.setDue', id: card, dueDate: date, dueTime: time });
  await apply(w, 'boardMember', { op: 'card.assign', cardId: card, accountId: w.accounts[who] });
  return card;
}

describe(`the Planner's boards (${leg})`, () => {
  it('returns the cards assigned to the person, dated in the range, in the order of the day, with where each is from', async () => {
    const w = await seedWorld(database);
    await dated(w, 'boardMember', 'Late', '2026-11-12', '15:00');
    await dated(w, 'boardMember', 'Early', '2026-11-12', '09:00');
    await dated(w, 'boardMember', 'No time', '2026-11-12', null);
    await dated(w, 'boardMember', 'Next day', '2026-11-13', null);
    const found = await planned(w, 'boardMember');
    expect(found.map((c) => c.title)).toEqual(['No time', 'Early', 'Late', 'Next day']);
    expect(found[0]).toMatchObject({
      boardId: w.boards.publicBoard,
      boardName: 'Roadmap',
      boardColor: '#2563eb',
      listName: 'Backlog',
      dueDate: '2026-11-12',
      dueTime: null,
    });
  });

  it('leaves out a card outside the range, an undated one, an archived one, and one assigned to somebody else', async () => {
    const w = await seedWorld(database);
    await dated(w, 'boardMember', 'In', '2026-11-30', null);
    await dated(w, 'boardMember', 'Before', '2026-10-31', null);
    await dated(w, 'boardMember', 'After', '2026-12-01', null);
    const gone = await dated(w, 'boardMember', 'Archived', '2026-11-05', null);
    await apply(w, 'boardMember', { op: 'card.archive', id: gone });
    await dated(w, 'boardOwner', 'Theirs', '2026-11-05', null);
    // The seed's open card is assigned and has no date.
    await apply(w, 'boardOwner', {
      op: 'card.assign',
      cardId: w.cards.open,
      accountId: w.accounts.boardMember,
    });
    expect((await planned(w, 'boardMember')).map((c) => c.title)).toEqual(['In']);
    expect((await planned(w, 'boardOwner')).map((c) => c.title)).toEqual(['Theirs']);
    // Nobody else's cards come to a person with none, however the range is chosen.
    expect(await planned(w, 'outsider', '0001-01-01', '9999-12-31')).toEqual([]);
    expect(await planned(w, 'member')).toEqual([]);
  });

  it('is read by the one it is assigned to and by no other role, whatever the role can see of the board', async () => {
    const w = await seedWorld(database);
    await dated(w, 'boardMember', 'Only mine', '2026-11-12', null);
    for (const role of ROLES)
      expect(
        (await planned(w, role)).map((c) => c.title),
        role,
      ).toEqual(role === 'boardMember' ? ['Only mine'] : []);
  });

  it('stops showing a card of a board the person has left, or lost sight of', async () => {
    const w = await seedWorld(database);
    await dated(w, 'boardMember', 'Here', '2026-11-12', null);
    expect(await planned(w, 'boardMember')).toHaveLength(1);
    await apply(w, 'owner', {
      op: 'member.remove',
      workspaceId: w.workspace,
      accountId: w.accounts.boardMember,
    });
    expect(await planned(w, 'boardMember')).toEqual([]);
  });
});

describe(`who may call the route (${leg})`, () => {
  let t: TwoAccounts;
  beforeAll(async () => {
    t = await twoAccounts();
  });
  afterAll(async () => t.close());

  it('refuses no session (401) and a range that is not one (400), and gives the signed-in person their own', async () => {
    // The route's own database is the one the test made, and each account is the one the session names.
    const route = accountRoute(
      ({ request, accountId }) => getPlanned(request, accountId, database),
      t.deps,
    );
    const w = await seedWorld(database);
    await dated(w, 'boardMember', 'Mine', '2026-11-12', null);
    const path = '/api/planner?from=2026-11-01&to=2026-11-30';
    expect((await route(t.request(null, path))).status).toBe(401);
    for (const bad of [
      '/api/planner',
      '/api/planner?from=2026-11-01',
      '/api/planner?from=2026-11-30&to=2026-11-01',
      '/api/planner?from=2026-01-01&to=2026-12-31',
    ])
      expect((await route(t.request(t.ada, bad))).status, bad).toBe(400);
    const ok = await route(t.request(t.ada, path));
    expect(ok.status).toBe(200);
    // Ada is nobody in that world: she is given her own cards, which are none, and not those of the person the card is assigned to.
    expect(await ok.json()).toEqual({ cards: [] });
    expect((await planned(w, 'boardMember')).map((c) => c.title)).toEqual(['Mine']);
  });
});
