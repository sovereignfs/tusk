import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { type LocalDatabase, deleteLocal, openLocal } from '../local/db';
import { listsOf, outboxSize, readCursor } from '../local/store';
import { InvalidMutation, SyncClient } from './client';
import { LIMITS, PROTOCOL_VERSION, type SyncRequest, type SyncResponse } from './format';
import type { Transport, TransportResult } from './transport';

const ID = () => crypto.randomUUID();
const open: LocalDatabase[] = [];
const names: string[] = [];
afterEach(async () => {
  for (const db of open.splice(0)) db.close();
  for (const name of names.splice(0)) await deleteLocal('', name);
});

async function database(account = ID()): Promise<LocalDatabase> {
  names.push(`tasks-${account}`);
  const db = await openLocal(account);
  open.push(db);
  return db;
}

const list = () => ({
  table: 'list' as const,
  id: ID(),
  position: 'a0',
  fields: { title: { v: 'Home' } },
});
const mutation = (...changes: ReturnType<typeof list>[]) => ({ mutationId: ID(), changes });

/** A transport that records what it was sent and answers as it is told. */
function transport(answer: (request: SyncRequest, call: number) => TransportResult) {
  const calls: SyncRequest[] = [];
  const send: Transport = async (request) => answer(request, calls.push(request));
  return { send, calls };
}

const okFor = (request: SyncRequest, cursor = request.cursor): TransportResult => ({
  kind: 'ok',
  response: {
    protocol: PROTOCOL_VERSION,
    results: (request.mutations as { mutationId: string }[]).map((m, i) => ({
      mutationId: m.mutationId,
      status: 'applied',
      seq: cursor + i + 1,
    })),
    pull: { cursor: cursor + request.mutations.length, more: false, rows: [], tombstones: [] },
  } satisfies SyncResponse,
});

describe('committing', () => {
  it('puts a mutation in the working copy at once and does not touch the network', async () => {
    const t = transport(() => ({ kind: 'offline' }));
    const client = new SyncClient({ db: await database(), transport: t.send });
    const l = list();
    await client.commit(mutation(l));
    expect((await client.read(listsOf)).map((row) => row.id)).toEqual([l.id]);
    expect(await client.pending()).toBe(1);
    expect(t.calls).toEqual([]);
  });

  it('refuses a mutation the server would refuse, before anything is written, and says why without the input', async () => {
    const client = new SyncClient({
      db: await database(),
      transport: transport(() => ({ kind: 'offline' })).send,
    });
    await expect(
      client.commit({
        mutationId: ID(),
        changes: [{ table: 'list', id: 'not-an-id', position: 'a0' }],
      }),
    ).rejects.toBeInstanceOf(InvalidMutation);
    await expect(client.commit({ mutationId: ID(), changes: [] })).rejects.toThrow(InvalidMutation);
    await expect(client.commit('nope')).rejects.toThrow(InvalidMutation);
    expect(await client.pending()).toBe(0);
    expect(await client.read(listsOf)).toEqual([]);
  });

  it('tells the listeners, and stops when one stops listening', async () => {
    const client = new SyncClient({
      db: await database(),
      transport: transport(() => ({ kind: 'offline' })).send,
    });
    let heard = 0;
    const stop = client.subscribe(() => heard++);
    await client.commit(mutation(list()));
    expect(heard).toBe(1);
    stop();
    await client.commit(mutation(list()));
    expect(heard).toBe(1);
  });

  it('tells the sync loop of a write and not of a sync that ended, which would make it sync for ever', async () => {
    const t = transport((request) => okFor(request));
    const client = new SyncClient({ db: await database(), transport: t.send });
    let writes = 0;
    let changes = 0;
    client.onWrite(() => writes++);
    client.subscribe(() => changes++);
    await client.commit(mutation(list()));
    await client.sync();
    expect(writes).toBe(1);
    expect(changes).toBe(2);
  });

  it('tells another tab through the channel, which then reads what the first wrote from the shared database', async () => {
    const account = ID();
    const a = new BroadcastChannel(`test-${account}`);
    const b = new BroadcastChannel(`test-${account}`);
    const dbA = await database(account);
    const dbB = await openLocal(account);
    open.push(dbB);
    const tabA = new SyncClient({
      db: dbA,
      transport: transport(() => ({ kind: 'offline' })).send,
      channel: a,
    });
    const tabB = new SyncClient({
      db: dbB,
      transport: transport(() => ({ kind: 'offline' })).send,
      channel: b,
    });
    const heard = new Promise<void>((resolve) => tabB.subscribe(resolve));
    const l = list();
    await tabA.commit(mutation(l));
    await heard;
    expect((await tabB.read(listsOf)).map((row) => row.id)).toEqual([l.id]);
    tabA.close();
    tabB.close();
    a.close();
    b.close();
  });
});

describe('syncing', () => {
  it('sends the outbox in order with the cursor and the protocol, and clears what was answered', async () => {
    const t = transport((request) => okFor(request));
    const client = new SyncClient({ db: await database(), transport: t.send });
    const [a, b] = [mutation(list()), mutation(list())];
    await client.commit(a);
    await client.commit(b);

    expect(await client.sync()).toEqual({ status: 'synced' });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toMatchObject({ protocol: PROTOCOL_VERSION, cursor: 0 });
    expect((t.calls[0]?.mutations as { mutationId: string }[]).map((m) => m.mutationId)).toEqual([
      a.mutationId,
      b.mutationId,
    ]);
    expect(await client.pending()).toBe(0);
    expect(await readCursor(client.db)).toBe(2);
  });

  it('asks again for what is past the cursor while the server says there is more, and then stops', async () => {
    const t = transport((request, call) => ({
      kind: 'ok',
      response: {
        protocol: PROTOCOL_VERSION,
        results: [],
        pull: { cursor: call * 10, more: call < 3, rows: [], tombstones: [] },
      },
    }));
    const client = new SyncClient({ db: await database(), transport: t.send });
    expect(await client.sync()).toEqual({ status: 'synced' });
    expect(t.calls.map((c) => c.cursor)).toEqual([0, 10, 20]);
  });

  it('sends a long outbox in requests of the most the server takes', async () => {
    const t = transport((request) => okFor(request));
    const client = new SyncClient({ db: await database(), transport: t.send });
    const total = LIMITS.mutationsPerRequest * 2 + 3;
    for (let i = 0; i < total; i++) await client.commit(mutation(list()));
    expect(await client.sync()).toEqual({ status: 'synced' });
    expect(t.calls.map((c) => c.mutations.length)).toEqual([
      LIMITS.mutationsPerRequest,
      LIMITS.mutationsPerRequest,
      3,
    ]);
    expect(await client.pending()).toBe(0);
  });

  it('leaves the outbox as it was when the network is away, and sends the same again', async () => {
    let up = false;
    const t = transport((request) => (up ? okFor(request) : { kind: 'offline' }));
    const client = new SyncClient({ db: await database(), transport: t.send });
    const m = mutation(list());
    await client.commit(m);
    expect(await client.sync()).toEqual({ status: 'offline' });
    expect(await client.pending()).toBe(1);
    up = true;
    expect(await client.sync()).toEqual({ status: 'synced' });
    expect((t.calls[0]?.mutations as { mutationId: string }[])[0]?.mutationId).toBe(m.mutationId);
    expect((t.calls[1]?.mutations as { mutationId: string }[])[0]?.mutationId).toBe(m.mutationId);
  });

  it.each([
    [{ kind: 'signed-out' }, { status: 'signed-out' }],
    [{ kind: 'update-required' }, { status: 'update-required' }],
    [
      { kind: 'rate-limited', retryAfterMs: 7000 },
      { status: 'rate-limited', retryAfterMs: 7000 },
    ],
    [{ kind: 'error', status: 500 }, { status: 'error' }],
  ] as const)('reports %j as %j and keeps the outbox', async (result, outcome) => {
    const client = new SyncClient({
      db: await database(),
      transport: transport(() => result).send,
    });
    await client.commit(mutation(list()));
    expect(await client.sync()).toEqual(outcome);
    expect(await client.pending()).toBe(1);
  });

  it('tells the listeners what was refused, and has undone it', async () => {
    const t = transport((request) => ({
      kind: 'ok',
      response: {
        protocol: PROTOCOL_VERSION,
        results: (request.mutations as { mutationId: string }[]).map((m) => ({
          mutationId: m.mutationId,
          status: 'refused',
          code: 'limit',
        })),
        pull: { cursor: 0, more: false, rows: [], tombstones: [] },
      },
    }));
    const client = new SyncClient({ db: await database(), transport: t.send });
    const refusals: string[] = [];
    client.onRefused((r) => refusals.push(...r.map((x) => x.code)));
    await client.commit(mutation(list()));
    expect((await client.read(listsOf)).length).toBe(1);
    await client.sync();
    expect(refusals).toEqual(['limit']);
    expect(await client.read(listsOf)).toEqual([]);
    expect(await outboxSize(client.db)).toBe(0);
  });
});
