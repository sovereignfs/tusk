import { type DBSchema, type IDBPDatabase, deleteDB, openDB } from 'idb';
import type { Mutation } from '../sync/format';
import type { LocalRow } from './rows';

/**
 * The browser's working copy (DESIGN.md §8.1): IndexedDB through `idb`, **one database per account**, named for it, so that a second account on the
 * same device sees nothing of the first and signing out can delete exactly one. The UI reads and writes only this; the server is something the
 * sync loop talks to (`src/sync`).
 *
 * - `desk_list`, `desk_card`, `desk_check`, `desk_series`
 *                              the rows as the device shows them: the server's, with this device's unanswered edits laid over (`store.ts`).
 * - `shadow`                  for a row that has unanswered edits, the row as the server last had it, so that an edit can be taken back and a
 *                              pull can be merged under the edits. A row with no unanswered edit has none.
 * - `outbox`                  the mutations not yet answered, in the order they were made. They are written in the same transaction as the rows
 *                              they changed, so closing the tab at any moment loses neither.
 * - `meta`                    small facts: the cursor, and when the device last heard from the server.
 */
export interface OutboxEntry {
  /** The order, assigned by the store. */
  n?: number;
  mutation: Mutation;
  queuedAt: number;
}

export interface Shadow {
  table: string;
  id: string;
  /** The row as the server last had it, or null if the device made it and the server has not answered. */
  row: LocalRow | null;
}

export interface LocalSchema extends DBSchema {
  desk_list: { key: string; value: LocalRow; indexes: { byPosition: string } };
  desk_card: { key: string; value: LocalRow; indexes: { byListPosition: [string, string] } };
  desk_check: { key: string; value: LocalRow; indexes: { byCard: string } };
  desk_series: { key: string; value: LocalRow; indexes: { byList: string } };
  shadow: { key: [string, string]; value: Shadow };
  outbox: { key: number; value: OutboxEntry };
  meta: { key: string; value: unknown };
}

export type LocalDatabase = IDBPDatabase<LocalSchema>;

/**
 * The version of the stores below. A change to them adds a step to `upgrade` and raises this; it never edits an earlier step. **Version 2** is the Desk's
 * tables (task 15.2): a database from version 1, which was made under the old names in the few hours that existed, is emptied and made again, since
 * nothing was released and nothing in it was kept.
 */
export const LOCAL_VERSION = 2;

/** The database for an account (DESIGN.md §8.1). */
export const localName = (accountId: string): string => `tusk-desk-${accountId}`;

export async function openLocal(
  accountId: string,
  name = localName(accountId),
): Promise<LocalDatabase> {
  return openDB<LocalSchema>(name, LOCAL_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion === 1) {
        for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
      }
      if (oldVersion < 2) {
        db.createObjectStore('desk_list', { keyPath: 'id' }).createIndex('byPosition', [
          'position',
          'id',
        ]);
        const card = db.createObjectStore('desk_card', { keyPath: 'id' });
        // Queries by list and position (DESIGN.md §8.1): a list's cards in order, and a card's checklist.
        card.createIndex('byListPosition', ['listId', 'position']);
        db.createObjectStore('desk_check', { keyPath: 'id' }).createIndex('byCard', 'cardId');
        db.createObjectStore('desk_series', { keyPath: 'id' }).createIndex('byList', 'listId');
        db.createObjectStore('shadow', { keyPath: ['table', 'id'] });
        db.createObjectStore('outbox', { keyPath: 'n', autoIncrement: true });
        db.createObjectStore('meta');
      }
    },
    // Another tab is deleting this account's database (it signed out, or the account was deleted): this connection is in the way, so it lets go.
    // Without it the deletion waits for every tab to be closed, and a person who signed out would still have their tasks on the device.
    blocking(_currentVersion, _blockedVersion, event) {
      (event.target as IDBDatabase).close();
    },
  });
}

/** Deletes an account's database from this device: what signing out does (task 13.4). Resolves when it is gone; blocked by an open connection until that closes. */
export async function deleteLocal(accountId: string, name = localName(accountId)): Promise<void> {
  await deleteDB(name);
}
