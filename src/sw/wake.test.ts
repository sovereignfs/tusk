import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importListKey, sealField } from '../cipher/field';
import { forgetKey } from '../cipher/vault';
import { localName, openLocal } from '../local/db';
import type { LocalRow } from '../local/rows';
import { forgetWake, keepWake, readWake } from '../reminders/wake';
import { workerSource } from './source';

/**
 * A wake (DESIGN.md §25.2, task 14.6): the push that carries no card. This evaluates the very text that is served, with a Desk whose fields are sealed as the browser seals
 * them, the keys the page gave it, and a clock the test controls, and looks at what is shown. **It shows what it can read, and says so when it cannot read:** never "nothing"
 * for what it could not open, and it makes no database that is not there.
 */
const ACCOUNT = 'acc-1';
const NOW = Date.parse('2026-11-08T09:00:00Z');
const rawKey = () => crypto.getRandomValues(new Uint8Array(32));

type Shown = { title: string; options: Record<string, unknown> };

/** The worker, with the browser's storage and crypto, and a clock at `now`. */
function worker(now = NOW) {
  const listeners: Record<string, (event: Record<string, unknown>) => void> = {};
  const shown: Shown[] = [];
  class FakeDate extends Date {
    constructor(value?: number | string | Date) {
      super(value === undefined ? now : value);
    }
    static now() {
      return now;
    }
  }
  const self = {
    location: { origin: 'https://tusk.test' },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) =>
        void shown.push({ title, options }),
    },
    clients: { matchAll: async () => [], openWindow: async () => undefined },
    addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) =>
      void (listeners[type] = fn),
  };
  const context = vm.createContext({
    self,
    indexedDB,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Intl,
    Date: FakeDate,
    Set,
    Array,
    Object,
    String,
    Error,
    Promise,
    JSON,
    Math,
    URL,
    atob,
    caches: {},
    fetch: async () => new Response(''),
    Request,
    Response,
  });
  vm.runInContext(workerSource('v1', []), context);
  async function wake(payload: unknown = { kind: 'wake', title: 'You have cards due', key: 'n1' }) {
    const waits: Promise<unknown>[] = [];
    listeners.push?.({
      data: { json: () => payload },
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
    });
    await Promise.all(waits);
    return shown;
  }
  return { wake, shown };
}

/** Writes the Desk's working copy as the browser does: sealed fields of a card, a live list, a key record for the worker. */
async function desk(
  cards: {
    id: string;
    list?: string;
    fields: Record<string, unknown>;
    deletedAt?: number | null;
  }[],
  options: { keys?: CryptoKey[]; zone?: string; sealWith?: CryptoKey } = {},
) {
  const key = options.sealWith ?? (await importListKey(rawKey()));
  const db = await openLocal(ACCOUNT);
  await db.put('desk_list', {
    table: 'desk_list',
    id: 'l1',
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: {},
  } as unknown as LocalRow);
  await db.put('desk_list', {
    table: 'desk_list',
    id: 'gone',
    deletedAt: 5,
    seq: 1,
    createdAt: 1,
    fields: {},
  } as unknown as LocalRow);
  for (const card of cards) {
    const fields: Record<string, { c: string; s: number }> = {};
    for (const [name, value] of Object.entries(card.fields))
      fields[name] = {
        c: await sealField(key, value as never, { table: 'desk_card', id: card.id, field: name }),
        s: 1,
      };
    await db.put('desk_card', {
      table: 'desk_card',
      id: card.id,
      listId: card.list ?? 'l1',
      position: 'a0',
      deletedAt: card.deletedAt ?? null,
      seq: 1,
      createdAt: 1,
      fields,
    } as unknown as LocalRow);
  }
  db.close();
  await keepWake({
    accountId: ACCOUNT,
    zone: options.zone ?? 'UTC',
    keys: options.keys ?? [key],
  });
  return key;
}

beforeEach(async () => {
  await deleteDB(localName(ACCOUNT));
  await forgetWake();
});
afterEach(async () => {
  await deleteDB(localName(ACCOUNT));
  await forgetWake();
});

describe('a wake', () => {
  it('shows what the server said, and nothing of a card, where the device was given no keys', async () => {
    const w = worker();
    const shown = await w.wake();
    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe('You have cards due');
    expect(shown[0]?.options.body).toBeUndefined();
    expect(shown[0]?.options.tag).toBe('n1');
    expect(shown[0]?.options.data).toEqual({ path: '/desk' });
  });

  it('makes no database for a Desk it has no copy of', async () => {
    await keepWake({ accountId: 'nobody', zone: 'UTC', keys: [await importListKey(rawKey())] });
    const w = worker();
    expect((await w.wake())[0]?.title).toBe('You have cards due');
    const names = (await indexedDB.databases()).map((each) => each.name);
    expect(names).not.toContain('tusk-desk-nobody');
  });

  it('shows the title of the one card that came due, opened with the key it was given', async () => {
    await desk([
      { id: 'c1', fields: { title: 'Pay the rent', dueDate: '2026-11-08', dueTime: '09:00' } },
    ]);
    const shown = await worker().wake();
    expect(shown[0]?.title).toBe('Pay the rent');
    expect(shown[0]?.options.body).toBe('Due now');
  });

  it('says how many and lists them when several came due, in the order they did', async () => {
    await desk([
      { id: 'c1', fields: { title: 'Second', dueDate: '2026-11-08', dueTime: '08:59' } },
      { id: 'c2', fields: { title: 'First', dueDate: '2026-11-08', dueTime: '08:40' } },
    ]);
    const shown = await worker().wake();
    expect(shown[0]?.title).toBe('2 cards due');
    expect(shown[0]?.options.body).toBe('First, Second');
  });

  it('works out “now” in the account’s zone, and leaves out what is done, deleted, in a deleted list, not yet due or long past', async () => {
    await desk(
      [
        // 14:30 in Kolkata is 09:00 here.
        { id: 'c1', fields: { title: 'Here', dueDate: '2026-11-08', dueTime: '14:30' } },
        {
          id: 'c2',
          fields: { title: 'Done', dueDate: '2026-11-08', dueTime: '14:30', completedAt: 5 },
        },
        {
          id: 'c3',
          fields: { title: 'Deleted', dueDate: '2026-11-08', dueTime: '14:30' },
          deletedAt: 7,
        },
        {
          id: 'c4',
          list: 'gone',
          fields: { title: 'Gone list', dueDate: '2026-11-08', dueTime: '14:30' },
        },
        { id: 'c5', fields: { title: 'Later', dueDate: '2026-11-08', dueTime: '14:45' } },
        { id: 'c6', fields: { title: 'Long ago', dueDate: '2026-11-08', dueTime: '12:00' } },
        { id: 'c7', fields: { title: 'No time', dueDate: '2026-11-08', dueTime: null } },
      ],
      { zone: 'Asia/Kolkata' },
    );
    const shown = await worker().wake();
    expect(shown[0]?.title).toBe('Here');
  });

  it('says “Nothing due after all” when it read everything and nothing is due', async () => {
    await desk([
      { id: 'c1', fields: { title: 'Tomorrow', dueDate: '2026-11-09', dueTime: '09:00' } },
    ]);
    expect((await worker().wake())[0]?.title).toBe('Nothing due after all');
  });

  it('does not say nothing for a Desk it could not open: it shows what the server said', async () => {
    const sealed = await importListKey(rawKey());
    // Sealed under a key the worker was not given.
    await desk(
      [{ id: 'c1', fields: { title: 'Secret', dueDate: '2026-11-08', dueTime: '09:00' } }],
      { sealWith: sealed, keys: [await importListKey(rawKey())] },
    );
    const shown = await worker().wake();
    expect(shown[0]?.title).toBe('You have cards due');
  });

  it('shows no card for a card that was moved: any of the keys it was given may open it', async () => {
    const a = await importListKey(rawKey());
    const b = await importListKey(rawKey());
    await desk(
      [{ id: 'c1', fields: { title: 'Moved', dueDate: '2026-11-08', dueTime: '09:00' } }],
      { sealWith: b, keys: [a, b] },
    );
    expect((await worker().wake())[0]?.title).toBe('Moved');
  });

  it('is the only push that reads the Desk: any other is shown as it came', async () => {
    await desk([
      { id: 'c1', fields: { title: 'Pay the rent', dueDate: '2026-11-08', dueTime: '09:00' } },
    ]);
    const shown = await worker().wake({ title: 'Hello', path: '/inbox', key: 'k' });
    expect(shown[0]?.title).toBe('Hello');
    expect(shown[0]?.options.data).toEqual({ path: '/inbox' });
  });
});

describe('what the worker is given', () => {
  it('is deleted when the key is forgotten, and when the person turns it off', async () => {
    await keepWake({ accountId: ACCOUNT, zone: 'UTC', keys: [await importListKey(rawKey())] });
    expect((await readWake())?.accountId).toBe(ACCOUNT);
    await forgetKey(ACCOUNT);
    await forgetWake();
    expect(await readWake()).toBeUndefined();
    await keepWake({ accountId: ACCOUNT, zone: 'UTC', keys: [await importListKey(rawKey())] });
    await forgetWake();
    expect(await readWake()).toBeUndefined();
    // And with none, a wake shows what the server said.
    expect((await worker().wake())[0]?.title).toBe('You have cards due');
  });
});
