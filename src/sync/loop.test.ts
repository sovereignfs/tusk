import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { type LocalDatabase, deleteLocal, openLocal } from '../local/db';
import { SyncClient, type SyncOutcome } from './client';
import { PROTOCOL_VERSION } from './format';
import { type LoopEnvironment, startSyncLoop } from './loop';
import type { Transport, TransportResult } from './transport';

/** Time and the browser’s events, by hand: a test moves the clock, fires `online` and takes locks, and nothing waits for anything real. */
class FakeEnvironment implements LoopEnvironment {
  now = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private next = 1;
  private listeners: Record<string, (() => void)[]> = {};
  held = new Set<string>();
  randomValue = 0.5;

  setTimeout = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.timers.push({ at: this.now + ms, fn, id });
    return id;
  };
  clearTimeout = (handle: unknown) => {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  };
  random = () => this.randomValue;
  locks = {
    request: async (
      name: string,
      _options: { ifAvailable: true },
      callback: (lock: unknown) => Promise<void> | void,
    ) => {
      if (this.held.has(name)) return callback(null);
      this.held.add(name);
      try {
        return await callback({ name });
      } finally {
        this.held.delete(name);
      }
    },
  };
  events = {
    listen: (type: 'online' | 'focus' | 'visible', listener: () => void) => {
      (this.listeners[type] ??= []).push(listener);
      return () => {
        this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener);
      };
    },
  };
  fire(type: string) {
    for (const listener of this.listeners[type] ?? []) listener();
  }
  pendingTimers = () => this.timers.length;
  async advance(ms: number) {
    const until = this.now + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer.id !== due.id);
      this.now = due.at;
      due.fn();
      await settleMicrotasks();
    }
    this.now = until;
  }
}

/** Lets promises that are already on their way finish, including the IndexedDB requests between them. */
const settleMicrotasks = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

const ID = () => crypto.randomUUID();
const open: LocalDatabase[] = [];
const names: string[] = [];
afterEach(async () => {
  for (const db of open.splice(0)) db.close();
  for (const name of names.splice(0)) await deleteLocal('', name);
});

async function client(send: Transport) {
  const account = ID();
  names.push(`tasks-${account}`);
  const db = await openLocal(account);
  open.push(db);
  return new SyncClient({ db, transport: send });
}

const ok = (): TransportResult => ({
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

describe('the sync loop', () => {
  it('syncs once on load, then waits for a reason', async () => {
    const env = new FakeEnvironment();
    let calls = 0;
    const c = await client(async () => (calls++, ok()));
    const loop = startSyncLoop({ client: c, lockName: 'l', environment: env });
    await settleMicrotasks();
    expect(calls).toBe(1);
    await env.advance(60_000);
    expect(calls).toBe(1);
    loop.stop();
  });

  it('syncs after a write, once for a burst of them (debounced)', async () => {
    const env = new FakeEnvironment();
    let calls = 0;
    const c = await client(async () => (calls++, ok()));
    const loop = startSyncLoop({ client: c, lockName: 'l', environment: env, debounceMs: 300 });
    await settleMicrotasks();
    calls = 0;
    for (let i = 0; i < 5; i++) {
      await c.commit(list());
      await env.advance(100);
    }
    expect(calls).toBe(0);
    await env.advance(300);
    expect(calls).toBe(1);
    loop.stop();
  });

  it('syncs when the device comes online, the tab regains focus or becomes visible, and on a timer while open', async () => {
    const env = new FakeEnvironment();
    let calls = 0;
    const c = await client(async () => (calls++, ok()));
    const loop = startSyncLoop({ client: c, lockName: 'l', environment: env, intervalMs: 180_000 });
    await settleMicrotasks();
    for (const event of ['online', 'focus', 'visible']) {
      const before = calls;
      env.fire(event);
      await settleMicrotasks();
      expect(calls, event).toBe(before + 1);
    }
    const before = calls;
    await env.advance(180_000);
    expect(calls).toBeGreaterThan(before);
    loop.stop();
  });

  it('does one thing at a time: a trigger during a sync runs once more when it ends, not once for each', async () => {
    const env = new FakeEnvironment();
    let release: () => void = () => undefined;
    let calls = 0;
    const c = await client(async () => {
      calls++;
      await new Promise<void>((resolve) => (release = resolve));
      return ok();
    });
    const loop = startSyncLoop({ client: c, lockName: 'l', environment: env });
    await settleMicrotasks();
    expect(calls).toBe(1);
    for (let i = 0; i < 6; i++) env.fire('focus');
    await settleMicrotasks();
    expect(calls).toBe(1);
    release();
    await settleMicrotasks();
    expect(calls).toBe(2);
    release();
    await settleMicrotasks();
    expect(calls).toBe(2);
    loop.stop();
  });

  it('is one loop for ten tabs: only the tab with the lock sends, and the others send nothing', async () => {
    const env = new FakeEnvironment();
    let inFlight = 0;
    let most = 0;
    let calls = 0;
    const slow: Transport = async () => {
      calls++;
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return ok();
    };
    const tabs = await Promise.all(Array.from({ length: 10 }, () => client(slow)));
    const loops = tabs.map((tab) =>
      startSyncLoop({ client: tab, lockName: 'one-account', environment: env }),
    );
    await settleMicrotasks();
    expect(most).toBe(1);
    expect(calls).toBe(1);
    for (const loop of loops) loop.stop();
  });

  it('says nothing when it fails and tries again after a pause that grows, and goes back to normal when it works', async () => {
    const env = new FakeEnvironment();
    let up = false;
    const calls: number[] = [];
    const c = await client(async () => {
      calls.push(env.now);
      return up ? ok() : { kind: 'offline' };
    });
    const outcomes: SyncOutcome[] = [];
    const loop = startSyncLoop({
      client: c,
      lockName: 'l',
      environment: env,
      maxBackoffMs: 8000,
      onOutcome: (o) => outcomes.push(o),
    });
    await settleMicrotasks();
    await env.advance(60_000);
    // Offline each time: 2s, then 4s, then 8s, and 8s at most after that (the jitter is the middle of its range here).
    const gaps = calls.slice(1, 6).map((at, i) => at - (calls[i] ?? 0));
    expect(gaps).toEqual([2000, 4000, 8000, 8000, 8000]);
    expect(outcomes.every((o) => o.status === 'offline')).toBe(true);

    up = true;
    await env.advance(8000);
    expect(outcomes.at(-1)).toEqual({ status: 'synced' });
    const settledCalls = calls.length;
    await env.advance(60_000);
    expect(calls.length).toBe(settledCalls); // nothing more is pending
    loop.stop();
  });

  it('puts jitter in the pause so that devices that failed together do not come back together', async () => {
    const wait = async (random: number) => {
      const env = new FakeEnvironment();
      env.randomValue = random;
      const calls: number[] = [];
      const c = await client(async () => (calls.push(env.now), { kind: 'offline' }));
      const loop = startSyncLoop({ client: c, lockName: 'l', environment: env });
      await settleMicrotasks();
      await env.advance(10_000);
      loop.stop();
      return (calls[1] ?? 0) - (calls[0] ?? 0);
    };
    expect(await wait(0)).toBe(1500);
    expect(await wait(1)).toBe(2500);
  });

  it('believes a server that says when to come back', async () => {
    const env = new FakeEnvironment();
    const calls: number[] = [];
    const c = await client(
      async () => (calls.push(env.now), { kind: 'rate-limited', retryAfterMs: 30_000 }),
    );
    const loop = startSyncLoop({ client: c, lockName: 'l', environment: env });
    await settleMicrotasks();
    await env.advance(29_000);
    expect(calls).toHaveLength(1);
    await env.advance(1_500);
    expect(calls).toHaveLength(2);
    loop.stop();
  });

  it('stops for good when the session ended, telling the app once, and keeps the outbox', async () => {
    const env = new FakeEnvironment();
    let calls = 0;
    let told = 0;
    const c = await client(async () => (calls++, { kind: 'signed-out' }));
    await c.commit(list());
    const loop = startSyncLoop({
      client: c,
      lockName: 'l',
      environment: env,
      onSignedOut: () => told++,
    });
    await settleMicrotasks();
    await env.advance(600_000);
    env.fire('online');
    await settleMicrotasks();
    expect(calls).toBe(1);
    expect(told).toBe(1);
    expect(await c.pending()).toBe(1);
    loop.stop();
  });

  it('stops for good when the device is too old, telling the app once, and keeps the outbox', async () => {
    const env = new FakeEnvironment();
    let told = 0;
    const c = await client(async () => ({ kind: 'update-required' }));
    await c.commit(list());
    const loop = startSyncLoop({
      client: c,
      lockName: 'l',
      environment: env,
      onUpdateRequired: () => told++,
    });
    await settleMicrotasks();
    await env.advance(600_000);
    expect(told).toBe(1);
    expect(await c.pending()).toBe(1);
    loop.stop();
  });

  it('stops for good when the account was deleted, telling the app once', async () => {
    const env = new FakeEnvironment();
    let told = 0;
    let calls = 0;
    const c = await client(async () => (calls++, { kind: 'account-deleted' }));
    const loop = startSyncLoop({
      client: c,
      lockName: 'l',
      environment: env,
      onAccountDeleted: () => told++,
    });
    await settleMicrotasks();
    await env.advance(600_000);
    env.fire('online');
    await settleMicrotasks();
    expect(told).toBe(1);
    expect(calls).toBe(1);
    loop.stop();
  });

  it('leaves nothing running when it is stopped', async () => {
    const env = new FakeEnvironment();
    const c = await client(async () => ok());
    const loop = startSyncLoop({ client: c, lockName: 'l', environment: env });
    await settleMicrotasks();
    loop.stop();
    expect(env.pendingTimers()).toBe(0);
    await c.commit(list());
    env.fire('online');
    await env.advance(600_000);
    expect(env.pendingTimers()).toBe(0);
  });
});
