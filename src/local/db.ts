import { type DBSchema, type IDBPDatabase, deleteDB, openDB } from 'idb';
import type { Mutation } from '../sync/format';
import type { LocalRow } from './rows';

/**
 * The browser's working copy (DESIGN.md §8.1): IndexedDB through `idb`, **one database per account**, named for it, so that a second account on the
 * same device sees nothing of the first and signing out can delete exactly one. The UI reads and writes only this; the server is something the
 * sync loop talks to (`src/sync`).
 *
 * - `list`, `task`, `series`  the rows as the device shows them: the server's, with this device's unanswered edits laid over (`store.ts`).
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
  list: { key: string; value: LocalRow; indexes: { byPosition: string } };
  task: {
    key: string;
    value: LocalRow;
    indexes: { byListPosition: [string, string]; byParent: string };
  };
  series: { key: string; value: LocalRow; indexes: { byList: string } };
  shadow: { key: [string, string]; value: Shadow };
  outbox: { key: number; value: OutboxEntry };
  meta: { key: string; value: unknown };
}

export type LocalDatabase = IDBPDatabase<LocalSchema>;

/** The version of the stores below. A change to them adds a step to `upgrade` and raises this; it never edits an earlier step. */
export const LOCAL_VERSION = 1;

/** The database for an account (DESIGN.md §8.1). */
export const localName = (accountId: string): string => `tasks-${accountId}`;

export async function openLocal(
  accountId: string,
  name = localName(accountId),
): Promise<LocalDatabase> {
  return openDB<LocalSchema>(name, LOCAL_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('list', { keyPath: 'id' }).createIndex('byPosition', [
          'position',
          'id',
        ]);
        const task = db.createObjectStore('task', { keyPath: 'id' });
        // Queries by list and position (DESIGN.md §8.1): a list's tasks in order, and a task's subtasks.
        task.createIndex('byListPosition', ['listId', 'position']);
        task.createIndex('byParent', 'parentId');
        db.createObjectStore('series', { keyPath: 'id' }).createIndex('byList', 'listId');
        db.createObjectStore('shadow', { keyPath: ['table', 'id'] });
        db.createObjectStore('outbox', { keyPath: 'n', autoIncrement: true });
        db.createObjectStore('meta');
      }
    },
  });
}

/** Deletes an account's database from this device: what signing out does (task 13.4). Resolves when it is gone; blocked by an open connection until that closes. */
export async function deleteLocal(accountId: string, name = localName(accountId)): Promise<void> {
  await deleteDB(name);
}
