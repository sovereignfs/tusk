'use client';

import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import { AuthShell } from '../auth/screens/AuthShell';
import { type LocalDatabase, deleteLocal, openLocal } from '../local/db';
import { requestPersistence } from '../local/persist';
import { AuthLink, Button, useToast } from '../ui';
import { SyncClient } from './client';
import { browserEnvironment, startSyncLoop } from './loop';
import { refusalMessage } from './messages';
import { fetchTransport } from './transport';

/**
 * Sync for the React tree of a signed-in person (DESIGN.md §8). `SyncProvider` opens the account's working copy, asks the browser to keep it, starts
 * the loop, tells the person when the server refuses a change, and offers the client to everything below it. **A screen reads with `useLocal` and
 * writes with `useSync().commit`; neither waits for the network, and nothing here shows a spinner for what is already on the device.**
 *
 * Three things the server can say end the ordinary state, and each is shown as what it is (§8.5):
 *
 *  - **The session ended** (a password reset, core's logout, another device): the app shows sign-in and **no data**, and the changes waiting stay
 *    in the working copy for this same account to send when it signs back in. A different account that signs in has a database of its own.
 *  - **The device is too old**: a bar says to reload, and the changes waiting are kept.
 *  - **The account was deleted**: the working copy is deleted, and the person goes to the front page.
 */
export type SyncStatus = 'running' | 'session-ended' | 'update-required';

const Context = createContext<{ client: SyncClient; status: SyncStatus; accountId: string } | null>(
  null,
);

function useContextValue() {
  const value = useContext(Context);
  if (!value) throw new Error('this is used inside a SyncProvider');
  return value;
}

export function useSync(): SyncClient {
  return useContextValue().client;
}

/** The account this working copy is of: better-auth's user id, which every row's owner is. */
export function useAccountId(): string {
  return useContextValue().accountId;
}

export function useSyncStatus(): SyncStatus {
  return useContextValue().status;
}

/** The working copy, if there is a provider; null when there is none (the front page is shown to people who are not signed in). */
export function useOptionalSync(): SyncClient | null {
  return useContext(Context)?.client ?? null;
}

export function SyncProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  const [state, setState] = useState<{ client: SyncClient; status: SyncStatus } | null>(null);
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
      void requestPersistence();
      const channel = new BroadcastChannel(`tasks-${accountId}`);
      const made = new SyncClient({ db, transport: fetchTransport(), channel });
      const set = (status: SyncStatus) => alive && setState({ client: made, status });
      const stopRefusals = made.onRefused((refusals) => {
        for (const refusal of refusals) {
          show.current({
            title: refusalMessage(refusal.code),
            category: 'warning',
            duration: 8000,
          });
        }
      });
      // Another tab of this person left this device: this one has nothing left to show either.
      const onChannel = (event: MessageEvent) => {
        if (event.data?.type === 'left') window.location.assign('/');
      };
      channel.addEventListener('message', onChannel);
      const loop = startSyncLoop({
        client: made,
        lockName: `tasks-sync-${accountId}`,
        environment: browserEnvironment(),
        onSignedOut: () => set('session-ended'),
        onUpdateRequired: () => set('update-required'),
        onAccountDeleted: () => {
          made.close();
          db.close();
          void deleteLocal(accountId).finally(() => window.location.assign('/'));
        },
      });
      cleanup = () => {
        loop.stop();
        stopRefusals();
        channel.removeEventListener('message', onChannel);
        made.close();
        channel.close();
        db.close();
      };
      setState({ client: made, status: 'running' });
    });
    return () => {
      alive = false;
      cleanup();
      setState(null);
    };
  }, [accountId]);

  if (!state) return null;
  // The session ended: no data is shown, because there is no one it could be shown to. The copy is still there for this account to come back to.
  if (state.status === 'session-ended') return <SessionEnded />;
  return (
    <Context.Provider value={{ client: state.client, status: state.status, accountId }}>
      {state.status === 'update-required' ? <UpdateRequired /> : null}
      {children}
    </Context.Provider>
  );
}

/** What replaces the app when the session has ended. It says what will happen to what was changed here, which is nothing bad. */
function SessionEnded() {
  return (
    <AuthShell
      title="Your session ended"
      lead="Sign in again to carry on. Anything you changed on this device is kept, and is sent when you do."
      footer={<AuthLink href="/sign-in">Sign in</AuthLink>}
      footerAlign="start"
    />
  );
}

/** A bar over the app when this version is older than the server speaks to. Reloading fetches the new one; the changes waiting are kept. */
function UpdateRequired() {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: 'var(--sv-space-3)',
        alignItems: 'center',
        padding: 'var(--sv-space-3) var(--sv-space-4)',
      }}
    >
      <span>Tasks has been updated. Reload to carry on; your changes are kept.</span>
      <Button variant="secondary" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
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

/**
 * Whether this device has heard from the server yet. `false` for a new device until its first answer, when there is nothing to show and the app can
 * say it is loading; `true` ever after, and so never for a device that has synced once. `undefined` for the moment it takes to look.
 */
export function useHasSynced(): boolean | undefined {
  const client = useSync();
  const [synced, setSynced] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const read = () => void client.hasSynced().then((value) => alive && setSynced(value));
    read();
    const stop = client.subscribe(read);
    return () => {
      alive = false;
      stop();
    };
  }, [client]);
  return synced;
}
