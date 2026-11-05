'use client';

import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import { type LocalDatabase, openLocal } from '../local/db';
import { useToast } from '../ui';
import { SyncClient } from './client';
import { browserEnvironment, startSyncLoop } from './loop';
import { refusalMessage } from './messages';
import { fetchTransport } from './transport';

/**
 * Sync for the React tree of a signed-in person (DESIGN.md §8). `SyncProvider` opens the account's working copy, starts the loop, tells the person
 * when the server refuses a change, and offers the client to everything below it. **A screen reads with `useLocal` and writes with
 * `useSync().commit`; neither waits for the network, and nothing here shows a spinner for what is already on the device.**
 */
const Context = createContext<SyncClient | null>(null);

export function useSync(): SyncClient {
  const client = useContext(Context);
  if (!client) throw new Error('useSync is used inside a SyncProvider');
  return client;
}

export function SyncProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  const [client, setClient] = useState<SyncClient | null>(null);
  const toast = useToast();
  // The latest `toast`, without making the effect start again every time the toasts do.
  const show = useRef(toast.show);
  show.current = toast.show;

  useEffect(() => {
    let alive = true;
    let cleanup: () => void = () => undefined;
    void openLocal(accountId).then((db: LocalDatabase) => {
      if (!alive) {
        db.close();
        return;
      }
      const channel = new BroadcastChannel(`tasks-${accountId}`);
      const made = new SyncClient({ db, transport: fetchTransport(), channel });
      const stopRefusals = made.onRefused((refusals) => {
        for (const refusal of refusals) {
          show.current({
            title: refusalMessage(refusal.code),
            category: 'warning',
            duration: 8000,
          });
        }
      });
      const loop = startSyncLoop({
        client: made,
        lockName: `tasks-sync-${accountId}`,
        environment: browserEnvironment(),
      });
      cleanup = () => {
        loop.stop();
        stopRefusals();
        made.close();
        channel.close();
        db.close();
      };
      setClient(made);
    });
    return () => {
      alive = false;
      cleanup();
      setClient(null);
    };
  }, [accountId]);

  return client ? <Context.Provider value={client}>{children}</Context.Provider> : null;
}

/**
 * The result of a query of the working copy, kept up to date as it changes: by this tab, by another, or by a sync. It is `undefined` only until the
 * first read finishes, which is a few milliseconds of IndexedDB and not the network, and **it keeps the last result while it reads the next**, so a
 * screen never goes blank or shows a spinner between two states of data it already has.
 */
export function useLocal<T>(
  query: (db: LocalDatabase) => Promise<T>,
  dependencies: readonly unknown[] = [],
): T | undefined {
  const client = useSync();
  const [value, setValue] = useState<T | undefined>(undefined);
  const latest = useRef(query);
  latest.current = query;

  useEffect(() => {
    let alive = true;
    let reading = 0;
    const read = () => {
      const mine = ++reading;
      void client.read(latest.current).then((result) => {
        // Only the newest read counts, so that a slow earlier one cannot put older data over newer.
        if (alive && mine === reading) setValue(result);
      });
    };
    read();
    const stop = client.subscribe(read);
    return () => {
      alive = false;
      stop();
    };
    // The caller names what the query depends on, which is why these are not the effect's own list.
  }, [client, ...dependencies]);

  return value;
}
