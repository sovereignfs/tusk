import { type DBSchema, type IDBPDatabase, deleteDB, openDB } from 'idb';

/**
 * What the service worker is given so that a reminder can say which card (DESIGN.md §25.2, task 14.6), **on a device whose person chose it, and for a Desk sealed with a key of
 * their own.** The server cannot say what is due, so Push only wakes the device, and the worker reads the Desk's working copy (IndexedDB, which it shares with the page) and
 * opens the fields it needs. Opening them takes the Desk's **list keys**, which the page has opened and the worker cannot (the person's own key is in the vault, which the
 * worker is not given); so this is where those list keys are kept: **one record, in a database of its own, as browser keys that script cannot read back, and the account's zone
 * to work out what "now" is.** It is the one place a service worker is given anything of a sealed Desk, and it is kept only while the person has asked for it on this device:
 * turning it off, locking the Desk, forgetting the key and signing out each delete it (`forgetWake`). What a device does not give, the worker does not show: it says that cards are due.
 */
export interface WakeRecord {
  readonly accountId: string;
  /** The account's zone, the one the server's jobs use. */
  readonly zone: string;
  /** The Desk's list keys, as the browser keys that open a field. */
  readonly keys: readonly CryptoKey[];
}

interface WakeSchema extends DBSchema {
  device: { key: string; value: WakeRecord };
}

/** The database's name and version, which the worker's source names too (`src/sw/source.ts`). */
export const WAKE_DB = 'tusk-wake';
export const WAKE_VERSION = 1;
export const WAKE_STORE = 'device';
export const WAKE_KEY = 'current';

const open = (): Promise<IDBPDatabase<WakeSchema>> =>
  openDB<WakeSchema>(WAKE_DB, WAKE_VERSION, {
    upgrade(db) {
      db.createObjectStore(WAKE_STORE);
    },
  });

/** Gives the worker the keys to open this account's Desk with, replacing any record before. */
export async function keepWake(record: WakeRecord): Promise<void> {
  const db = await open();
  try {
    await db.put(WAKE_STORE, record, WAKE_KEY);
  } finally {
    db.close();
  }
}

/** The record, if there is one: for a test, and for a page that wants to know it is there. */
export async function readWake(): Promise<WakeRecord | undefined> {
  const db = await open();
  try {
    return await db.get(WAKE_STORE, WAKE_KEY);
  } finally {
    db.close();
  }
}

/** Takes the keys back from the worker. Safe to call when there is nothing: it is what every way of leaving does. */
export async function forgetWake(): Promise<void> {
  try {
    await deleteDB(WAKE_DB);
  } catch {
    // A device that will not delete it (another tab holds it open) is asked again at the next sign-out; the worker still cannot do more than the record allows.
  }
}

const flagKey = (accountId: string) => `tusk.wake.${accountId}`;

/** Whether this device's person chose to have the card shown in a reminder here: a per-device convenience, kept in the browser and not on the server. */
export function wakeChosen(accountId: string): boolean {
  try {
    return localStorage.getItem(flagKey(accountId)) === '1';
  } catch {
    return false;
  }
}

export function chooseWake(accountId: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(flagKey(accountId), '1');
    else localStorage.removeItem(flagKey(accountId));
  } catch {
    // A browser that keeps nothing keeps no choice: the keys are not given to the worker.
  }
}
