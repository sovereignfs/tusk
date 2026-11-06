import type { Database } from '../db/client';
import { type LocalDatabase, deleteLocal, openLocal } from '../local/db';
import type { LocalRow } from '../local/rows';
import { SyncClient } from './client';
import { type SyncDeps, handleSync } from './endpoint';
import { type Transport, fetchTransport } from './transport';
import { id } from './test-support';

/**
 * Devices for the tests that put several of them against one real server (DESIGN.md §8.4, §24 Testing): each is a working copy in its own (fake)
 * IndexedDB and a `SyncClient`, and the server is the real handler on whichever database the leg runs. **The network is the test's:** a device can be
 * off it, and the server can apply a request and the answer be lost on the way back, which is how a device comes to send the same thing twice.
 */
export interface Device {
  readonly client: SyncClient;
  /** Off the network: every request fails before it reaches the server. */
  online: boolean;
  /** The server applies the next request and the answer is lost on the way back. */
  loseNextAnswer: boolean;
}

export interface Harness {
  /** A new device of the account, with a working copy of its own. */
  device(owner: string, overrides?: Partial<SyncDeps>): Promise<Device>;
  /** Closes every device and deletes its working copy: call after each test. */
  dispose(): Promise<void>;
}

export function harness(database: Database): Harness {
  const open: LocalDatabase[] = [];
  const names: string[] = [];
  return {
    async device(owner, overrides = {}) {
      const name = `tusk-desk-${owner}-${id()}`;
      names.push(name);
      const db = await openLocal(owner, name);
      open.push(db);
      const deps: SyncDeps = {
        database,
        limiter: { take: async () => ({ ok: true }) },
        now: Date.now,
        ...overrides,
      };
      const self = {
        online: true,
        loseNextAnswer: false,
        client: undefined as unknown as SyncClient,
      };
      // The browser's own transport, over a `fetch` that goes straight to the server's handler, so that every status the server gives is read as a
      // device reads it.
      const transport: Transport = fetchTransport('/api/sync', async (_url, init) => {
        if (!self.online) throw new TypeError('no network');
        const response = await handleSync(String(init?.body), owner, deps);
        if (self.loseNextAnswer) {
          self.loseNextAnswer = false;
          throw new TypeError('the answer was lost');
        }
        return response;
      });
      self.client = new SyncClient({ db, transport });
      return self;
    },
    async dispose() {
      for (const db of open.splice(0)) db.close();
      for (const name of names.splice(0)) await deleteLocal('', name);
    },
  };
}

/** Syncs every device, over and over, until none has anything to send or take: a quiet network, after which they must all agree. */
export async function settleAll(devices: readonly Device[], rounds = 8): Promise<void> {
  for (let round = 0; round < rounds; round++) for (const d of devices) await d.client.sync();
}

export const TABLES = ['desk_list', 'desk_card', 'desk_check', 'desk_series'] as const;

/** Every row a device has on the four tables, in a fixed order: what two devices that agree have the same of. */
export async function everything(d: Device): Promise<LocalRow[]> {
  const rows: LocalRow[] = [];
  for (const table of TABLES) rows.push(...((await d.client.db.getAll(table)) as LocalRow[]));
  return rows.sort((a, b) => (a.id < b.id ? -1 : 1));
}
