import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  completeCard,
  createCard,
  deleteCard,
  moveCard,
  moveToList,
  reopenCard,
  restoreCard,
  setStarred,
  setStatus,
  startCard,
  updateCard,
} from '../actions/cards';
import {
  addItem,
  deleteItem,
  moveItem,
  renameItem,
  restoreItem,
  tickItem,
  untickItem,
} from '../actions/checks';
import { setDue } from '../actions/due';
import { createList, deleteList, moveList, renameList, restoreList } from '../actions/lists';
import { seriesIdOf, setRepeat } from '../actions/series';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import type { LocalRow } from '../local/rows';
import { byPosition } from '../local/rows';
import { getRow, outboxSize } from '../local/store';
import { addDays } from '../time';
import { type Device, type Harness, everything, harness, settleAll } from './sim-support';
import { account, makeStore } from './test-support';

/**
 * The convergence suite (DESIGN.md §8.4, §24 Testing): several devices of one account against one real server, each making random offline actions from
 * `src/actions/`, syncing in random orders, with answers lost and requests sent twice. **After everyone has synced, every device has the same rows, and
 * they are the server's.** A run is its seed: a failure names it, and a seed that ever failed is pinned below, so that it is run for ever after.
 *
 * `TUSK_SIM_SEEDS` is how many random runs (30 by default, so that `pnpm test` stays quick; `pnpm test:converge` runs thousands, and is what a nightly
 * job runs). `TUSK_SIM_FIRST` is the seed to start from.
 */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
let devices: Harness;
beforeAll(async () => {
  ({ database, close } = await makeStore());
  devices = harness(database);
});
afterAll(async () => close());
afterEach(async () => devices.dispose());

/** Seeds that once failed, each with what was wrong. They are run before the random ones. */
const PINNED: readonly { seed: number; why: string }[] = [];

class Random {
  private state: number;
  constructor(seed: number) {
    this.state = (seed ^ 0x9e3779b9) >>> 0 || 1;
  }
  /** An integer in [0, below). */
  next(below: number): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x % below;
  }
  pick<T>(items: readonly T[]): T | undefined {
    return items.length === 0 ? undefined : items[this.next(items.length)];
  }
  chance(percent: number): boolean {
    return this.next(100) < percent;
  }
}

const ids = { newId: () => crypto.randomUUID() };
const DAY = (n: number) => addDays('2026-11-01', n);
const RULES = [
  'FREQ=DAILY',
  'FREQ=DAILY;COUNT=3',
  'FREQ=WEEKLY;BYDAY=MO,WE',
  'FREQ=WEEKLY;INTERVAL=2',
  'FREQ=MONTHLY',
];
const WORDS = ['water', 'call', 'email', 'plan', 'fix', 'buy', 'read', 'tidy'];

type Card = Extract<LocalRow, { table: 'desk_card' }>;
type Check = Extract<LocalRow, { table: 'desk_check' }>;
const live = <T extends LocalRow>(rows: readonly T[]) =>
  rows.filter((row) => row.deletedAt === null);
const read = async (d: Device) => {
  const db = d.client.db;
  return {
    lists: (await db.getAll('desk_list')) as LocalRow[],
    cards: (await db.getAll('desk_card')) as Card[],
    checks: (await db.getAll('desk_check')) as Check[],
  };
};
const ordered = <T extends LocalRow>(rows: readonly T[]) =>
  [...rows].sort((a, b) =>
    'position' in a && 'position' in b ? byPosition(a, b) : a.id < b.id ? -1 : 1,
  );

/** One random thing a person does on one device, from its own working copy. Whatever it makes is committed. */
async function act(d: Device, r: Random): Promise<string> {
  const { lists, cards, checks } = await read(d);
  const liveLists = ordered(live(lists));
  const liveCards = live(cards).filter((c) => liveLists.some((l) => l.id === c.listId));
  const list = r.pick(liveLists);
  const card = r.pick(liveCards);
  const itemsOf = (c: LocalRow | undefined) =>
    c ? ordered(checks.filter((i) => i.cardId === c.id && i.deletedAt === null)) : [];
  const allItemsOf = (c: LocalRow | undefined) =>
    c ? checks.filter((i) => i.cardId === c.id) : [];
  const title = `${r.pick(WORDS)} ${r.next(20)}`;
  const today = DAY(r.next(14));
  const db = d.client.db;

  let result;
  let name: string;
  const roll = r.next(100);
  if (roll < 12) {
    name = 'createCard';
    result = list
      ? createCard(
          list.id,
          ordered(live(cards).filter((c) => c.listId === list.id)),
          { title },
          ids,
        )
      : undefined;
  } else if (roll < 17) {
    name = 'updateCard';
    result = updateCard(card, r.chance(50) ? { title } : { description: title }, ids);
  } else if (roll < 21) {
    name = 'setStarred';
    result = setStarred(card, r.chance(50), ids);
  } else if (roll < 27) {
    name = 'setDue';
    result = setDue(
      card,
      r.chance(25)
        ? { date: null, time: null }
        : { date: DAY(r.next(14)), time: r.chance(30) ? '09:00' : null },
      ids,
    );
  } else if (roll < 40) {
    name = 'complete';
    if (card) {
      const sid = seriesIdOf(card);
      const series = sid ? await getRow(db, 'desk_series', sid) : undefined;
      result = completeCard(card, Date.now(), ids, itemsOf(card), { series, today });
    }
  } else if (roll < 45) {
    name = 'reopen';
    result = reopenCard(card, ids);
  } else if (roll < 49) {
    name = 'start';
    result = startCard(card, Date.now(), ids);
  } else if (roll < 52) {
    name = 'setStatus';
    result = setStatus(
      card,
      r.pick(['open', 'in_progress', 'done'] as const) ?? 'open',
      Date.now(),
      ids,
      itemsOf(card),
    );
  } else if (roll < 58) {
    name = 'deleteCard';
    result = deleteCard(card, ids, itemsOf(card));
  } else if (roll < 62) {
    name = 'restoreCard';
    const gone = r.pick(cards.filter((c) => c.deletedAt !== null));
    result = restoreCard(gone, ids, allItemsOf(gone));
  } else if (roll < 68) {
    name = 'moveCard';
    if (card) {
      const rendered = ordered(live(cards).filter((c) => c.listId === card.listId));
      result = moveCard(rendered, card.id, r.next(rendered.length), ids);
    }
  } else if (roll < 71) {
    name = 'moveToList';
    const to = r.pick(liveLists);
    result =
      card && to
        ? moveToList(card, to.id, ordered(live(cards).filter((c) => c.listId === to.id)), ids)
        : undefined;
  } else if (roll < 77) {
    name = 'addItem';
    result = addItem(card, itemsOf(card), { title }, ids);
  } else if (roll < 81) {
    name = 'tickItem';
    result = tickItem(r.pick(itemsOf(card)), Date.now(), ids);
  } else if (roll < 84) {
    name = 'untickItem';
    result = untickItem(r.pick(itemsOf(card)), ids);
  } else if (roll < 86) {
    name = 'renameItem';
    result = renameItem(r.pick(itemsOf(card)), title, ids);
  } else if (roll < 88) {
    name = 'moveItem';
    const items = itemsOf(card);
    const item = r.pick(items);
    result = item ? moveItem(items, item.id, r.next(items.length), ids) : undefined;
  } else if (roll < 90) {
    name = 'deleteItem';
    result = deleteItem(r.pick(itemsOf(card)), ids);
  } else if (roll < 91) {
    name = 'restoreItem';
    result = restoreItem(r.pick(checks.filter((i) => i.deletedAt !== null)), ids);
  } else if (roll < 96) {
    name = 'setRepeat';
    if (card) {
      const sid = seriesIdOf(card);
      const series = sid ? await getRow(db, 'desk_series', sid) : undefined;
      result = setRepeat(card, series, r.pick(RULES) ?? 'FREQ=DAILY', today, ids);
    }
  } else if (roll < 97) {
    name = 'createList';
    result = createList(liveLists, { title }, ids, lists);
  } else if (roll < 98) {
    name = 'renameList';
    result = renameList(list, title, ids);
  } else if (roll < 99) {
    name = r.chance(50) ? 'deleteList' : 'restoreList';
    result =
      name === 'deleteList'
        ? deleteList(list, ids)
        : restoreList(r.pick(lists.filter((l) => l.deletedAt !== null)), ids);
  } else {
    name = 'moveList';
    result = list ? moveList(liveLists, list.id, r.next(liveLists.length), ids) : undefined;
  }
  if (result?.ok) await d.client.commit(result.mutation);
  return result?.ok ? name : '';
}

/** What the network does to a device, at random. */
async function network(d: Device, r: Random): Promise<void> {
  const roll = r.next(100);
  if (roll < 40) await d.client.sync();
  else if (roll < 55) {
    // The server applies it and the answer is lost: the device will send the same again.
    d.loseNextAnswer = true;
    await d.client.sync();
  } else if (roll < 70) {
    // Sent twice in a row.
    await d.client.sync();
    await d.client.sync();
  } else if (roll < 85) d.online = false;
  else d.online = true;
}

/** A field that is null and a field that is not there are the same thing: the server keeps no column for a null, a device may hold the null. */
const plainFields = (entries: [string, unknown][]) =>
  Object.fromEntries(entries.filter(([, value]) => value !== null && value !== undefined));

/** The rows of the server, as a device would hold them: what a device that agrees with it must have. */
async function serverView(owner: string) {
  const { snapshot } = await import('./test-support');
  const rows = await snapshot(database, owner);
  const out: Record<string, unknown> = {};
  for (const [table, list] of Object.entries(rows)) {
    for (const row of list as Record<string, unknown>[]) {
      const fields = JSON.parse(String(row.fields)) as Record<string, { v?: unknown; c?: string }>;
      out[`${table}:${String(row.id)}`] = {
        deleted: row.deleted_at !== null && row.deleted_at !== undefined,
        position: row.position ?? null,
        parent: row.list_id ?? row.card_id ?? null,
        fields: plainFields(Object.entries(fields).map(([k, f]) => [k, f.v ?? f.c])),
      };
    }
  }
  return out;
}

function deviceView(rows: readonly LocalRow[]) {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    out[`${row.table}:${row.id}`] = {
      deleted: row.deletedAt !== null,
      position: 'position' in row ? row.position : null,
      parent: 'listId' in row ? row.listId : 'cardId' in row ? row.cardId : null,
      fields: plainFields(Object.entries(row.fields).map(([k, f]) => [k, 'v' in f ? f.v : f.c])),
    };
  }
  return out;
}

export async function simulate(seed: number): Promise<void> {
  const r = new Random(seed);
  const owner = account();
  const count = 2 + r.next(3);
  const all: Device[] = [];
  for (let i = 0; i < count; i++) all.push(await devices.device(owner));
  const refusals: string[] = [];
  for (const d of all) d.client.onRefused((x) => refusals.push(...x.map((y) => y.code)));

  // They begin having heard of two lists, as a person's devices have.
  const first = all[0];
  if (!first) return;
  for (const title of ['One', 'Two']) {
    const made = createList(ordered(live((await read(first)).lists)), { title }, ids);
    if (made.ok) await first.client.commit(made.mutation);
  }
  await settleAll(all);

  const trace: string[] = [];
  const steps = 25 + r.next(40);
  for (let i = 0; i < steps; i++) {
    const d = r.pick(all);
    if (!d) continue;
    if (r.chance(65)) {
      const did = await act(d, r);
      if (did) trace.push(`${all.indexOf(d)}:${did}`);
    } else {
      await network(d, r);
      trace.push(`${all.indexOf(d)}:net`);
    }
  }

  // The network comes back, and everyone talks until it is quiet.
  for (const d of all) {
    d.online = true;
    d.loseNextAnswer = false;
  }
  await settleAll(all, 14);

  const fail = (what: string) => `seed ${seed} (${leg}): ${what}\n  ${trace.join(' ')}`;
  const views = await Promise.all(all.map(everything));
  const reference = deviceView(views[0] ?? []);
  for (let i = 1; i < views.length; i++)
    expect(deviceView(views[i] ?? []), fail(`device ${i} is not device 0`)).toEqual(reference);
  expect(reference, fail('devices are not the server')).toEqual(await serverView(owner));
  for (const [i, d] of all.entries())
    expect(await outboxSize(d.client.db), fail(`device ${i} still has something to send`)).toBe(0);
  expect(refusals, fail('the server refused something a device made')).toEqual([]);

  // One occurrence of a series is open at a time (§12.1).
  const open = new Map<string, number>();
  for (const row of live(views[0] ?? []))
    if (row.table === 'desk_card') {
      const sid = seriesIdOf(row);
      const done = row.fields.completedAt;
      if (sid && !(done && 'v' in done && typeof done.v === 'number'))
        open.set(sid, (open.get(sid) ?? 0) + 1);
    }
  for (const [sid, n] of open) expect(n, fail(`series ${sid} has ${n} open occurrences`)).toBe(1);
}

describe(`devices converge (${leg})`, () => {
  for (const { seed, why } of PINNED)
    it(`pinned seed ${seed}: ${why}`, async () => simulate(seed), 60_000);

  const runs = Number(process.env.TUSK_SIM_SEEDS ?? 30);
  const from = Number(process.env.TUSK_SIM_FIRST ?? 1);
  it(`${runs} random runs, from seed ${from}, end with every device holding the server's rows`, async () => {
    for (let seed = from; seed < from + runs; seed++) {
      await simulate(seed);
      await devices.dispose();
    }
  }, 3_600_000);
});
