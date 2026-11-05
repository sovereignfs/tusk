import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { type LocalDatabase, deleteLocal, openLocal } from '../local/db';
import { listsOf } from '../local/store';
import { SyncClient } from './client';
import { PROTOCOL_VERSION } from './format';
import { leaveDevice } from './signout';
import type { Transport, TransportResult } from './transport';

const ID = () => crypto.randomUUID();
const open: LocalDatabase[] = [];
const accounts: string[] = [];
afterEach(async () => {
  for (const db of open.splice(0)) db.close();
  for (const account of accounts.splice(0)) await deleteLocal(account);
});

const databases = async () => (await indexedDB.databases()).map((db) => db.name);

async function device(send: Transport) {
  const account = ID();
  accounts.push(account);
  const db = await openLocal(account);
  open.push(db);
  return { account, client: new SyncClient({ db, transport: send }), db };
}

const answers = (): TransportResult => ({
  kind: 'ok',
  response: {
    protocol: PROTOCOL_VERSION,
    results: [],
    pull: { cursor: 0, more: false, rows: [], tombstones: [] },
  },
});
const list = () => ({
  mutationId: ID(),
  changes: [{ table: 'list' as const, id: ID(), position: 'a0', fields: { title: { v: 'x' } } }],
});

/** A transport that takes whatever it is sent and says it applied it. */
const accepting: Transport = async (request) => ({
  kind: 'ok',
  response: {
    protocol: PROTOCOL_VERSION,
    results: (request.mutations as { mutationId: string }[]).map((m, i) => ({
      mutationId: m.mutationId,
      status: 'applied',
      seq: i + 1,
    })),
    pull: { cursor: request.mutations.length, more: false, rows: [], tombstones: [] },
  },
});

describe('leaving a device', () => {
  it('sends what it can, ends the session, and deletes the account’s database, in that order', async () => {
    const { account, client } = await device(accepting);
    await client.commit(list());
    const order: string[] = [];
    const result = await leaveDevice({
      accountId: account,
      client,
      confirmLosing: async () => (order.push('asked'), true),
      endSession: async () => void order.push('session ended'),
      announce: () => order.push('announced'),
    });
    expect(result).toEqual({ status: 'left' });
    // Everything was sent, so nobody had to be asked.
    expect(order).toEqual(['session ended', 'announced']);
    expect(await databases()).not.toContain(`tasks-${account}`);
  });

  it('asks before it throws away changes it could not send, with how many, and stays if the person says so', async () => {
    const { account, client, db } = await device(async () => ({ kind: 'offline' }));
    await client.commit(list());
    await client.commit(list());
    let asked = 0;
    let ended = false;
    const result = await leaveDevice({
      accountId: account,
      client,
      confirmLosing: async (n) => ((asked = n), false),
      endSession: async () => void (ended = true),
    });
    expect(result).toEqual({ status: 'cancelled', unsent: 2 });
    expect(asked).toBe(2);
    expect(ended).toBe(false);
    // Nothing was touched: the copy and its outbox are still there.
    expect(await databases()).toContain(`tasks-${account}`);
    expect(await client.pending()).toBe(2);
    expect((await client.read(listsOf)).length).toBe(2);
    expect(db.objectStoreNames.length).toBeGreaterThan(0);
  });

  it('leaves, losing them, when the person says so', async () => {
    const { account, client } = await device(async () => ({ kind: 'offline' }));
    await client.commit(list());
    const result = await leaveDevice({
      accountId: account,
      client,
      confirmLosing: async () => true,
      endSession: async () => undefined,
    });
    expect(result).toEqual({ status: 'left' });
    expect(await databases()).not.toContain(`tasks-${account}`);
  });

  it('changes nothing if the session cannot be ended, so no one is left signed in with no data or signed out with data', async () => {
    const { account, client } = await device(accepting);
    await client.commit(list());
    const result = await leaveDevice({
      accountId: account,
      client,
      confirmLosing: async () => true,
      endSession: async () => {
        throw new Error('offline');
      },
    });
    expect(result).toEqual({ status: 'offline' });
    expect(await databases()).toContain(`tasks-${account}`);
  });

  it('deletes only this account’s database: another account on the device keeps its own', async () => {
    const [one, two] = [await device(accepting), await device(accepting)];
    await two.client.commit(list());
    await leaveDevice({
      accountId: one.account,
      client: one.client,
      confirmLosing: async () => true,
      endSession: async () => undefined,
    });
    expect(await databases()).toContain(`tasks-${two.account}`);
    expect(await two.client.pending()).toBe(1);
  });

  it('does not wait for another tab that has the database open', async () => {
    const { account, client } = await device(accepting);
    // A second tab: its own connection to the same database, which it has not closed.
    const otherTab = await openLocal(account);
    open.push(otherTab);
    const result = await Promise.race([
      leaveDevice({
        accountId: account,
        client,
        confirmLosing: async () => true,
        endSession: async () => undefined,
      }),
      new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 3000)),
    ]);
    expect(result).toEqual({ status: 'left' });
    expect(await databases()).not.toContain(`tasks-${account}`);
  });

  it('can leave with no copy open: there is nothing to send, and the database goes', async () => {
    const account = ID();
    accounts.push(account);
    open.push(await openLocal(account));
    open[open.length - 1]?.close();
    const result = await leaveDevice({
      accountId: account,
      confirmLosing: async () => false,
      endSession: async () => undefined,
    });
    expect(result).toEqual({ status: 'left' });
    expect(await databases()).not.toContain(`tasks-${account}`);
  });

  it('a second account on the device sees nothing of the first', async () => {
    const first = await device(accepting);
    await first.client.commit(list());
    // The first signs out and a second signs in on the same device: its database is its own, and starts empty.
    await leaveDevice({
      accountId: first.account,
      client: first.client,
      confirmLosing: async () => true,
      endSession: async () => undefined,
    });
    const second = await device(answers as unknown as Transport);
    expect(await second.client.read(listsOf)).toEqual([]);
    expect(await second.client.pending()).toBe(0);
    // And if the first had not signed out, the second would still not see it.
    const third = await device(accepting);
    expect(await third.client.read(listsOf)).toEqual([]);
  });
});
