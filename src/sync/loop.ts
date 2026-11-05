import type { SyncClient, SyncOutcome } from './client';

/**
 * When a device syncs (DESIGN.md §8.3): after a write (debounced), on load, when the tab regains focus, when it comes back online, and every few
 * minutes while it is open. **One tab at a time** does it, by a Web Lock, and the others are told through the channel when the working copy changes
 * so that whichever tab holds the lock sends what any of them wrote. It **backs off silently** on a failure: nothing here is shown to a person, who
 * is not made to wait for the network or told about it (`outbox` and `meta.lastSyncedAt` are all Settings needs to say when it last worked).
 *
 * Everything outside the process is given (timers, the lock manager, the places events come from), so that a test drives a whole day of triggers
 * with none of them real.
 */
export interface LoopEnvironment {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Web Locks. `request` runs `callback` with the lock, or with null at once if it is held and `ifAvailable` is set. */
  locks: {
    request(
      name: string,
      options: { ifAvailable: true },
      callback: (lock: unknown) => Promise<void> | void,
    ): Promise<unknown>;
  };
  /** Where `online`, `focus` and `visibilitychange` come from: the window and the document. Absent in a test that fires none. */
  events?: { listen(type: 'online' | 'focus' | 'visible', listener: () => void): () => void };
  random(): number;
}

export interface LoopOptions {
  client: SyncClient;
  /** The lock's name, which is per account so that two accounts on one device do not wait for each other. */
  lockName: string;
  environment: LoopEnvironment;
  /** After a write, wait this long for more writes before sending. */
  debounceMs?: number;
  /** While the tab is open, sync at least this often. */
  intervalMs?: number;
  /** The longest the silence after failures grows to. */
  maxBackoffMs?: number;
  /** The session ended: stop and show sign-in (task 13.4). */
  onSignedOut?: () => void;
  /** This device is too old to talk to the server: update, keeping the outbox (task 13.4). */
  onUpdateRequired?: () => void;
  /** The account this device holds the tasks of was deleted: the app deletes the working copy (task 13.4). */
  onAccountDeleted?: () => void;
  /** Told of each finished attempt, for Settings' "last synced" and for tests. */
  onOutcome?: (outcome: SyncOutcome) => void;
}

export interface Loop {
  /** Ask for a sync soon. */
  trigger(): void;
  /** Sync now, if this tab is the one that does it; resolves when that attempt ends. */
  syncNow(): Promise<void>;
  stop(): void;
}

export function startSyncLoop(options: LoopOptions): Loop {
  const {
    client,
    lockName,
    environment: env,
    debounceMs = 300,
    intervalMs = 3 * 60_000,
    maxBackoffMs = 60_000,
  } = options;
  let stopped = false;
  let failures = 0;
  let debounce: unknown;
  let retry: unknown;
  let running: Promise<void> | undefined;
  let again = false;

  const attempt = async (): Promise<void> => {
    if (stopped) return;
    const held: { outcome?: SyncOutcome } = {};
    // Only the tab with the lock sends; one that finds it taken has nothing to do, since the tab with it reads the same outbox.
    await env.locks.request(lockName, { ifAvailable: true }, async (lock) => {
      if (lock) held.outcome = await client.sync();
    });
    const outcome = held.outcome;
    if (!outcome) return;
    options.onOutcome?.(outcome);

    if (outcome.status === 'synced') {
      failures = 0;
    } else if (outcome.status === 'signed-out') {
      stopped = true;
      options.onSignedOut?.();
    } else if (outcome.status === 'account-deleted') {
      stopped = true;
      options.onAccountDeleted?.();
    } else if (outcome.status === 'update-required') {
      stopped = true;
      options.onUpdateRequired?.();
    } else {
      // Offline, too often, or an error: say nothing, and try again after a pause that grows to a minute, with some chance in it so that devices
      // that failed together do not come back together. A server that said when to come back is believed.
      failures += 1;
      const grown = Math.min(maxBackoffMs, 1000 * 2 ** Math.min(failures, 10));
      const wait =
        outcome.status === 'rate-limited'
          ? outcome.retryAfterMs
          : grown * (0.75 + env.random() * 0.5);
      env.clearTimeout(retry);
      if (!stopped) retry = env.setTimeout(() => void run(), wait);
    }
  };

  /** One attempt at a time in this tab: a trigger during one is remembered and runs once when it ends, not once for each. */
  const run = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await attempt();
        } while (again && !stopped);
      } finally {
        running = undefined;
      }
    })();
    return running;
  };

  const trigger = () => {
    if (stopped) return;
    env.clearTimeout(debounce);
    debounce = env.setTimeout(() => void run(), debounceMs);
  };

  const timer = (): void => {
    if (stopped) return;
    interval = env.setTimeout(() => {
      void run();
      timer();
    }, intervalMs);
  };
  let interval: unknown;

  const stops = [
    client.onWrite(trigger),
    env.events?.listen('online', () => void run()) ?? (() => undefined),
    env.events?.listen('focus', () => void run()) ?? (() => undefined),
    env.events?.listen('visible', () => void run()) ?? (() => undefined),
  ];
  timer();
  void run(); // on load

  return {
    trigger,
    syncNow: run,
    stop() {
      stopped = true;
      env.clearTimeout(debounce);
      env.clearTimeout(retry);
      env.clearTimeout(interval);
      for (const stop of stops) stop();
    },
  };
}

/** The browser's own: real timers, the page's Web Locks, and the window's and document's events. */
export function browserEnvironment(): LoopEnvironment {
  return {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    locks: navigator.locks as unknown as LoopEnvironment['locks'],
    random: Math.random,
    events: {
      listen(type, listener) {
        if (type === 'visible') {
          const onChange = () => document.visibilityState === 'visible' && listener();
          document.addEventListener('visibilitychange', onChange);
          return () => document.removeEventListener('visibilitychange', onChange);
        }
        window.addEventListener(type, listener);
        return () => window.removeEventListener(type, listener);
      },
    },
  };
}
