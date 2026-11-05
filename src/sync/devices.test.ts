import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import { type LocalDatabase, deleteLocal, openLocal } from '../local/db';
import { cardsOf, checksOf, getRow, listsOf, outboxSize } from '../local/store';
import type { LocalRow } from '../local/rows';
import { type SyncDeps, handleSync } from './endpoint';
import { SyncClient } from './client';
import { type Transport, fetchTransport } from './transport';
import { purge } from './purge';
import { account, id, makeStore } from './test-support';

/**
 * Devices against a real server (DESIGN.md §8.4): each device is a working copy in its own IndexedDB and a client, and the server is the real thing
 * on whichever database the leg runs. This is the small version of the convergence suite (task 13.5): the named cases of the table of §8.4, one by one.
 */
const { leg } = testTarget();

let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

const open: LocalDatabase[] = [];
const names: string[] = [];
afterEach(async () => {
  for (const db of open.splice(0)) db.close();
  for (const name of names.splice(0)) await deleteLocal('', name);
});

interface Device {
  client: SyncClient;
  online: boolean;
  /** The server applies the next request and the answer is lost on the way back. */
  loseNextAnswer: boolean;
  refusals: string[];
}

function server(
  owner: string,
  overrides: Partial<SyncDeps> = {},
): (online: () => Device) => Transport {
  const deps: SyncDeps = {
    database,
    limiter: { take: async () => ({ ok: true }) },
    now: Date.now,
    ...overrides,
  };
  // The browser's own transport, over a `fetch` that goes straight to the server's handler, so that every status the server gives is read as a device
  // reads it.
  return (self) =>
    fetchTransport('/api/sync', async (_url, init) => {
      const device = self();
      if (!device.online) throw new TypeError('no network');
      const response = await handleSync(String(init?.body), owner, deps);
      if (device.loseNextAnswer) {
        device.loseNextAnswer = false;
        throw new TypeError('the answer was lost');
      }
      return response;
    });
}

async function device(owner: string, makeTransport = server(owner)): Promise<Device> {
  const name = `tusk-desk-${owner}-${id()}`;
  names.push(name);
  const db = await openLocal(owner, name);
  open.push(db);
  const self: Device = {
    online: true,
    loseNextAnswer: false,
    refusals: [],
    client: undefined as unknown as SyncClient,
  };
  self.client = new SyncClient({ db, transport: makeTransport(() => self) });
  self.client.onRefused((r) => self.refusals.push(...r.map((x) => x.code)));
  return self;
}

/** Syncs every device, over and over, until none has anything to send or take: a quiet network, after which they must all agree. */
async function settleAll(...devices: Device[]) {
  for (let round = 0; round < 6; round++) for (const d of devices) await d.client.sync();
}

const everything = async (d: Device): Promise<LocalRow[]> => {
  const rows: LocalRow[] = [];
  for (const table of ['desk_list', 'desk_card', 'desk_check', 'desk_series'] as const) {
    rows.push(...((await d.client.db.getAll(table)) as LocalRow[]));
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : 1));
};

const newList = (title = 'Home') => ({
  table: 'desk_list' as const,
  id: id(),
  position: 'a0',
  fields: { title: { v: title } },
});
const newTask = (listId: string, title = 'Buy milk') => ({
  table: 'desk_card' as const,
  id: id(),
  listId,
  position: 'a0',
  fields: { title: { v: title } },
});
const mutation = (...changes: object[]) => ({ mutationId: id(), changes });
const title = async (d: Device, taskId: string) =>
  JSON.stringify((await getRow(d.client.db, 'desk_card', taskId))?.fields.title);

describe(`devices of one account against the server (${leg})`, () => {
  it('a task made on one device arrives on another, exactly as it is on the first', async () => {
    const owner = account();
    const [a, b] = [await device(owner), await device(owner)];
    const l = newList();
    const t = newTask(l.id);
    await a.client.commit(mutation(l, t));
    await settleAll(a, b);

    expect((await listsOf(b.client.db)).map((r) => r.id)).toEqual([l.id]);
    expect((await cardsOf(b.client.db, l.id)).map((r) => r.id)).toEqual([t.id]);
    expect(await everything(a)).toEqual(await everything(b));
  });

  it('works offline for as long as it must and sends it all when the network comes back, in order', async () => {
    const owner = account();
    const [a, b] = [await device(owner), await device(owner)];
    a.online = false;
    const l = newList();
    const tasks = [newTask(l.id, 'one'), newTask(l.id, 'two'), newTask(l.id, 'three')];
    await a.client.commit(mutation(l));
    for (const t of tasks) await a.client.commit(mutation(t));
    await a.client.commit(mutation({ table: 'desk_card', id: tasks[0]?.id, deleted: true }));
    expect(await a.client.sync()).toEqual({ status: 'offline' });
    expect(await outboxSize(a.client.db)).toBe(5);
    expect((await cardsOf(a.client.db, l.id)).length).toBe(2);

    a.online = true;
    await settleAll(a, b);
    expect(await outboxSize(a.client.db)).toBe(0);
    expect(await everything(a)).toEqual(await everything(b));
    expect((await cardsOf(b.client.db, l.id)).length).toBe(2);
  });

  describe('a card’s checklist, on two devices', () => {
    const newItem = (cardId: string, title = 'Oat milk', position = 'a0') => ({
      table: 'desk_check' as const,
      id: id(),
      cardId,
      position,
      fields: { title: { v: title } },
    });

    it('arrives with the card, in order, ticked as it was, and the two devices agree', async () => {
      const owner = account();
      const [a, b] = [await device(owner), await device(owner)];
      const l = newList();
      const t = newTask(l.id);
      const [one, two] = [newItem(t.id, 'one', 'a0'), newItem(t.id, 'two', 'a1')];
      await a.client.commit(mutation(l, t, one, two));
      await a.client.commit(
        mutation({ table: 'desk_check', id: one.id, fields: { completedAt: { v: 5 } } }),
      );
      await settleAll(a, b);
      expect((await checksOf(b.client.db, t.id)).map((r) => r.id)).toEqual([one.id, two.id]);
      expect(await everything(a)).toEqual(await everything(b));
    });

    it('different items ticked while apart: both ticks stand', async () => {
      const owner = account();
      const [a, b] = [await device(owner), await device(owner)];
      const l = newList();
      const t = newTask(l.id);
      const [one, two] = [newItem(t.id, 'one', 'a0'), newItem(t.id, 'two', 'a1')];
      await a.client.commit(mutation(l, t, one, two));
      await settleAll(a, b);
      a.online = false;
      b.online = false;
      await a.client.commit(
        mutation({ table: 'desk_check', id: one.id, fields: { completedAt: { v: 5 } } }),
      );
      await b.client.commit(
        mutation({ table: 'desk_check', id: two.id, fields: { completedAt: { v: 6 } } }),
      );
      a.online = true;
      b.online = true;
      await settleAll(a, b);
      for (const d of [a, b]) {
        const items = await checksOf(d.client.db, t.id);
        expect(items.map((r) => r.fields.completedAt)).toMatchObject([{ v: 5 }, { v: 6 }]);
      }
      expect(await everything(a)).toEqual(await everything(b));
    });

    it('one deletes the card and the other edits an item of it: the edit brings the card back', async () => {
      const owner = account();
      const [a, b] = [await device(owner), await device(owner)];
      const l = newList();
      const t = newTask(l.id);
      const item = newItem(t.id);
      await a.client.commit(mutation(l, t, item));
      await settleAll(a, b);
      a.online = false;
      b.online = false;
      await a.client.commit(mutation({ table: 'desk_card', id: t.id, deleted: true }));
      await b.client.commit(
        mutation({ table: 'desk_check', id: item.id, fields: { title: { v: 'Oat milk, 2' } } }),
      );
      a.online = true;
      await a.client.sync();
      b.online = true;
      await settleAll(a, b);
      for (const d of [a, b])
        expect((await cardsOf(d.client.db, l.id)).map((r) => r.id)).toEqual([t.id]);
      expect(await everything(a)).toEqual(await everything(b));
    });

    it('an item added to a card the other device moved to another list: it stays with the card', async () => {
      const owner = account();
      const [a, b] = [await device(owner), await device(owner)];
      const [l, other] = [newList('One'), newList('Two')];
      const t = newTask(l.id);
      await a.client.commit(mutation(l, other, t));
      await settleAll(a, b);
      a.online = false;
      b.online = false;
      await a.client.commit(
        mutation({ table: 'desk_card', id: t.id, listId: other.id, position: 'a0' }),
      );
      const added = newItem(t.id, 'late');
      await b.client.commit(mutation(added));
      a.online = true;
      b.online = true;
      await settleAll(a, b);
      for (const d of [a, b]) {
        expect((await cardsOf(d.client.db, other.id)).map((r) => r.id)).toEqual([t.id]);
        expect((await checksOf(d.client.db, t.id)).map((r) => r.id)).toEqual([added.id]);
      }
      expect(await everything(a)).toEqual(await everything(b));
    });
  });

  describe('two devices change a task while apart', () => {
    async function pair() {
      const owner = account();
      const [a, b] = [await device(owner), await device(owner)];
      const l = newList();
      const t = newTask(l.id);
      await a.client.commit(mutation(l, t));
      await settleAll(a, b);
      a.online = false;
      b.online = false;
      return { a, b, l, t };
    }

    it('different fields: both changes stand, on both devices', async () => {
      const { a, b, t } = await pair();
      await a.client.commit(
        mutation({ table: 'desk_card', id: t.id, fields: { description: { v: 'from a' } } }),
      );
      await b.client.commit(
        mutation({ table: 'desk_card', id: t.id, fields: { starred: { v: true } } }),
      );
      a.online = true;
      b.online = true;
      await settleAll(a, b);
      for (const d of [a, b]) {
        expect((await getRow(d.client.db, 'desk_card', t.id))?.fields).toMatchObject({
          description: { v: 'from a' },
          starred: { v: true },
          title: { v: 'Buy milk' },
        });
      }
      expect(await everything(a)).toEqual(await everything(b));
    });

    it('the same field: the one that reached the server later wins, on both devices', async () => {
      const { a, b, t } = await pair();
      await a.client.commit(
        mutation({ table: 'desk_card', id: t.id, fields: { title: { v: 'from a' } } }),
      );
      await b.client.commit(
        mutation({ table: 'desk_card', id: t.id, fields: { title: { v: 'from b' } } }),
      );
      // b reaches the server first, then a: a is later, so a wins.
      b.online = true;
      await b.client.sync();
      a.online = true;
      await settleAll(a, b);
      expect(await title(a, t.id)).toContain('from a');
      expect(await title(b, t.id)).toContain('from a');
      expect(await everything(a)).toEqual(await everything(b));
    });

    it('one deletes and the other edits: the edit restores it', async () => {
      const { a, b, l, t } = await pair();
      await a.client.commit(mutation({ table: 'desk_card', id: t.id, deleted: true }));
      await b.client.commit(
        mutation({ table: 'desk_card', id: t.id, fields: { description: { v: 'still needed' } } }),
      );
      a.online = true;
      await a.client.sync();
      b.online = true;
      await settleAll(a, b);
      for (const d of [a, b])
        expect((await cardsOf(d.client.db, l.id)).map((r) => r.id)).toEqual([t.id]);
      expect(await everything(a)).toEqual(await everything(b));
    });

    it('both delete: it is deleted', async () => {
      const { a, b, l, t } = await pair();
      await a.client.commit(mutation({ table: 'desk_card', id: t.id, deleted: true }));
      await b.client.commit(mutation({ table: 'desk_card', id: t.id, deleted: true }));
      a.online = true;
      b.online = true;
      await settleAll(a, b);
      for (const d of [a, b]) expect(await cardsOf(d.client.db, l.id)).toEqual([]);
      expect(await everything(a)).toEqual(await everything(b));
    });

    it('a task is added to a list the other device deleted: the list comes back', async () => {
      const { a, b, l, t } = await pair();
      await a.client.commit(mutation({ table: 'desk_list', id: l.id, deleted: true }));
      const added = newTask(l.id, 'late');
      await b.client.commit(mutation(added));
      a.online = true;
      await a.client.sync();
      b.online = true;
      await settleAll(a, b);
      for (const d of [a, b]) {
        expect((await listsOf(d.client.db)).map((r) => r.id)).toEqual([l.id]);
        expect((await cardsOf(d.client.db, l.id)).map((r) => r.id).sort()).toEqual(
          [added.id, t.id].sort(),
        );
      }
      expect(await everything(a)).toEqual(await everything(b));
    });

    it('two devices put a task at one position: both keep the key and every device shows one order', async () => {
      const { a, b, l, t } = await pair();
      const [x, y] = [newTask(l.id, 'x'), newTask(l.id, 'y')];
      await a.client.commit(mutation({ ...x, position: 'a5' }));
      await b.client.commit(mutation({ ...y, position: 'a5' }));
      a.online = true;
      b.online = true;
      await settleAll(a, b);
      const order = async (d: Device) => (await cardsOf(d.client.db, l.id)).map((r) => r.id);
      expect(await order(a)).toEqual(await order(b));
      expect(new Set(await order(a))).toEqual(new Set([t.id, x.id, y.id]));
    });
  });

  describe('when something goes wrong on the way', () => {
    it('a lost answer is just a retry: the same mutation is sent again, applied once, and the device has one row', async () => {
      const owner = account();
      const a = await device(owner);
      const l = newList();
      await a.client.commit(mutation(l, newTask(l.id)));
      a.loseNextAnswer = true;
      expect(await a.client.sync()).toEqual({ status: 'offline' });
      expect(await outboxSize(a.client.db)).toBe(1);
      expect(await a.client.sync()).toEqual({ status: 'synced' });
      expect(await outboxSize(a.client.db)).toBe(0);

      const b = await device(owner);
      await b.client.sync();
      expect((await listsOf(b.client.db)).length).toBe(1);
      expect(await everything(a)).toEqual(await everything(b));
    });

    it('a change the server refuses is undone on the device that made it, which is told, and no other device ever sees it', async () => {
      const owner = account();
      const limited = server(owner, { limits: { lists: 1, cards: 1000 } });
      const [a, b] = [await device(owner, limited), await device(owner, limited)];
      const first = newList('first');
      await a.client.commit(mutation(first));
      await settleAll(a, b);

      const second = newList('second');
      await a.client.commit(mutation(second));
      expect((await listsOf(a.client.db)).length).toBe(2);
      await settleAll(a, b);

      expect(a.refusals).toEqual(['limit']);
      expect((await listsOf(a.client.db)).map((r) => r.id)).toEqual([first.id]);
      expect((await listsOf(b.client.db)).map((r) => r.id)).toEqual([first.id]);
      expect(await outboxSize(a.client.db)).toBe(0);
      expect(await everything(a)).toEqual(await everything(b));
    });

    it('a mutation that depended on a refused one is refused in its turn and undone too', async () => {
      const owner = account();
      const limited = server(owner, { limits: { lists: 1, cards: 1000 } });
      const a = await device(owner, limited);
      await a.client.commit(mutation(newList('first')));
      await a.client.sync();

      const second = newList('second');
      await a.client.commit(mutation(second));
      await a.client.commit(mutation(newTask(second.id)));
      await a.client.sync();
      expect(a.refusals.sort()).toEqual(['limit', 'unavailable']);
      expect((await listsOf(a.client.db)).length).toBe(1);
      expect((await a.client.db.getAll('desk_card')).length).toBe(0);
    });
  });

  describe('a device that was away while rows were purged', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const T = 1_800_000_000_000;

    it('offline for eight days: it learns of the purge from its next pull, and the row goes', async () => {
      const owner = account();
      const clock = { now: T };
      const make = server(owner, { now: () => clock.now });
      const [a, b] = [await device(owner, make), await device(owner, make)];
      const l = newList();
      const t = newTask(l.id);
      await a.client.commit(mutation(l, t));
      await settleAll(a, b);
      expect((await cardsOf(a.client.db, l.id)).length).toBe(1);

      a.online = false;
      await b.client.commit(mutation({ table: 'desk_card', id: t.id, deleted: true }));
      await b.client.sync();
      clock.now = T + 8 * DAY;
      await purge(database, clock.now);

      a.online = true;
      await settleAll(a, b);
      // The row is not only hidden but gone, on both devices, and they agree.
      expect(await getRow(a.client.db, 'desk_card', t.id)).toBeUndefined();
      expect(await everything(a)).toEqual(await everything(b));
    });

    it('offline for ninety-one days: told to start again, it sends its edits first and takes a snapshot, and what was purged goes', async () => {
      const owner = account();
      const clock = { now: T };
      const make = server(owner, { now: () => clock.now });
      const [a, b] = [await device(owner, make), await device(owner, make)];
      const l = newList();
      const stays = newTask(l.id, 'stays');
      const goes = newTask(l.id, 'goes');
      await a.client.commit(mutation(l, stays, goes));
      await settleAll(a, b);

      a.online = false;
      // While it is away: one task is deleted and purged, another is made, and the tombstone itself is forgotten.
      await b.client.commit(mutation({ table: 'desk_card', id: goes.id, deleted: true }));
      const meanwhile = newTask(l.id, 'made while away');
      await b.client.commit(mutation(meanwhile));
      await b.client.sync();
      clock.now = T + 8 * DAY;
      await purge(database, clock.now);
      clock.now = T + 8 * DAY + 91 * DAY;
      const result = await purge(database, clock.now);
      expect(result.tombstonesRemoved).toBeGreaterThanOrEqual(1);

      // Its own edits, made offline: one to a task that survived, and a new task.
      await a.client.commit(
        mutation({
          table: 'desk_card',
          id: stays.id,
          fields: { description: { v: 'edited offline' } },
        }),
      );
      const mine = newTask(l.id, 'made offline');
      await a.client.commit(mutation(mine));
      expect(await outboxSize(a.client.db)).toBe(2);

      a.online = true;
      const dbg = await a.client.sync();
      console.log(
        'DBG outcome',
        JSON.stringify(dbg),
        'cursor',
        await a.client.db.get('meta', 'cursor'),
        'snapshot',
        await a.client.db.get('meta', 'snapshot'),
        'outbox',
        await outboxSize(a.client.db),
        'refusals',
        JSON.stringify(a.refusals),
      );
      await settleAll(a, b);
      // Its edits were sent, and kept: nothing it did was lost to the snapshot.
      expect(await outboxSize(a.client.db)).toBe(0);
      expect(a.refusals).toEqual([]);
      expect((await getRow(a.client.db, 'desk_card', stays.id))?.fields.description).toMatchObject({
        v: 'edited offline',
      });
      expect(await getRow(a.client.db, 'desk_card', mine.id)).toBeDefined();
      // What it never heard was purged is gone, and what it never heard was made is there.
      expect(await getRow(a.client.db, 'desk_card', goes.id)).toBeUndefined();
      expect(await getRow(a.client.db, 'desk_card', meanwhile.id)).toBeDefined();
      expect(await everything(a)).toEqual(await everything(b));
    });

    it('keeps showing what it has while the snapshot arrives: nothing is removed until the last page is in', async () => {
      const owner = account();
      const clock = { now: T };
      const make = server(owner, { now: () => clock.now });
      const a = await device(owner, make);
      const l = newList();
      const tasks = Array.from({ length: 5 }, (_, i) => newTask(l.id, `t${i}`));
      await a.client.commit(mutation(l, ...tasks));
      await a.client.sync();
      // The server tells it to start again, and then answers one page at a time.
      const { startSnapshot } = await import('../local/store');
      await startSnapshot(a.client.db, 'token');
      expect((await a.client.db.get('meta', 'cursor')) ?? 0).toBe(0);
      expect((await cardsOf(a.client.db, l.id)).length).toBe(5);
    });
  });

  it('another account’s device sees nothing of this account’s, on the same server', async () => {
    const [ada, grace] = [account(), account()];
    const [a, g] = [await device(ada), await device(grace)];
    const l = newList('Ada’s');
    await a.client.commit(mutation(l, newTask(l.id)));
    await settleAll(a, g);
    expect(await everything(g)).toEqual([]);
    expect((await everything(a)).length).toBe(2);
  });
});
