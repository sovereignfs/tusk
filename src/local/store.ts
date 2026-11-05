import type { IDBPTransaction, StoreNames } from 'idb';
import type {
  Change,
  Mutation,
  MutationResult,
  Pull,
  RefusalCode,
  SyncTable,
} from '../sync/format';
import type { LocalDatabase, LocalSchema, OutboxEntry } from './db';
import { type LocalRow, applyChange, byPosition, mergePulled } from './rows';

/**
 * Reading and writing the working copy (DESIGN.md §8.1, §8.3). Everything that changes more than one store does it in **one IndexedDB
 * transaction**, so that closing the tab, a crash or a full disk at any moment leaves the rows and the outbox agreeing: a write is in both or in
 * neither. A transaction here holds no `await` of anything but IndexedDB, which is what keeps it open.
 */
type Tx = IDBPTransaction<LocalSchema, StoreNames<LocalSchema>[], 'readwrite'>;
const WRITE_STORES = ['list', 'task', 'series', 'shadow', 'outbox', 'meta'] as const;

const TABLES: readonly SyncTable[] = ['list', 'task', 'series'];
const keyOf = (table: string, id: string) => `${table}\u0000${id}`;

/**
 * Runs `work` in one read-write transaction over every store, and **aborts it if `work` throws**. IndexedDB commits a transaction when it has nothing
 * more to wait for, and an exception in our code does not make it wait or stop: without the abort, whatever `work` had written before it threw would
 * be committed, and a write would be in the rows and not in the outbox, which is exactly what one transaction is for.
 */
async function inTransaction<T>(db: LocalDatabase, work: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = db.transaction([...WRITE_STORES], 'readwrite');
  try {
    const result = await work(tx);
    await tx.done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // Already finished or aborted: nothing is left to undo.
    }
    // The transaction's own completion promise rejects with an AbortError now, and nobody is waiting for it.
    await tx.done.catch(() => undefined);
    throw error;
  }
}

/** A refused mutation, for the person to be told why (the only thing of all this that reaches them, DESIGN.md §8.4). */
export interface Refusal {
  mutationId: string | null;
  code: RefusalCode;
  /** What the mutation changed, so that the screen can say which: the titles of rows it made are not here, only their ids. */
  changes: readonly Change[];
}

/**
 * Applies a mutation to the working copy and queues it, in one transaction. The rows a change touches are remembered as the server last had them
 * (`shadow`) the first time they are touched, so that the change can be taken back or merged under.
 */
export async function commitMutation(
  db: LocalDatabase,
  mutation: Mutation,
  now: number,
): Promise<void> {
  await inTransaction(db, async (tx) => {
    for (const change of mutation.changes) {
      const row = (await tx.objectStore(change.table).get(change.id)) as LocalRow | undefined;
      const shadow = await tx.objectStore('shadow').get([change.table, change.id]);
      if (!shadow) {
        await tx
          .objectStore('shadow')
          .put({ table: change.table, id: change.id, row: row ?? null });
      }
      await tx.objectStore(change.table).put(applyChange(row, change, now));
    }
    await tx.objectStore('outbox').add({ mutation, queuedAt: now });
  });
}

/** The mutations not yet answered, oldest first, at most `limit`. */
export async function readOutbox(
  db: LocalDatabase,
  limit: number,
): Promise<(OutboxEntry & { n: number })[]> {
  const out: (OutboxEntry & { n: number })[] = [];
  let cursor = await db.transaction('outbox').store.openCursor();
  while (cursor && out.length < limit) {
    out.push({ ...cursor.value, n: cursor.key });
    cursor = await cursor.continue();
  }
  return out;
}

export async function outboxSize(db: LocalDatabase): Promise<number> {
  return db.count('outbox');
}

export async function readCursor(db: LocalDatabase): Promise<number> {
  const cursor = await db.get('meta', 'cursor');
  return typeof cursor === 'number' ? cursor : 0;
}

export async function lastSyncedAt(db: LocalDatabase): Promise<number | undefined> {
  const at = await db.get('meta', 'lastSyncedAt');
  return typeof at === 'number' ? at : undefined;
}

export interface Settled {
  refused: Refusal[];
  /** The server has more past the cursor. */
  more: boolean;
  /** How many of the sent mutations were answered either way. */
  answered: number;
}

/**
 * Takes what the server answered: drops the mutations it answered from the outbox, takes back the ones it refused, merges what it sent under the
 * edits still waiting, and moves the cursor. One transaction, so that a device is never left having forgotten a mutation and not yet taken its
 * result, or the other way about.
 *
 * - **A pending edit stays on top of a pull.** A row with edits waiting is the server's row (kept as its shadow) with those edits laid over it again,
 *   so a pull can never overwrite what the person has just done on this device.
 * - **A refused mutation is undone** by taking it out and laying the rest over the shadow again; any later mutation that depended on it is refused
 *   by the server in its turn, and undone the same way.
 * - A row the server answered for keeps what the device shows, and takes the server's per field as it arrives, the higher `seq` winning.
 */
export async function settle(
  db: LocalDatabase,
  sent: readonly (OutboxEntry & { n: number })[],
  results: readonly MutationResult[],
  pull: Pull,
  now: number,
): Promise<Settled> {
  return inTransaction(db, async (tx) => {
    const refused: Refusal[] = [];
    const undo = new Set<string>();
    const touched = new Set<string>();
    const mark = (set: Set<string>, change: Change) => set.add(keyOf(change.table, change.id));
    let answered = 0;

    // 1. The answers, in order: either way the mutation is no longer waiting.
    for (let i = 0; i < sent.length; i++) {
      const entry = sent[i];
      const result = results[i];
      if (!entry || !result) continue;
      answered += 1;
      await tx.objectStore('outbox').delete(entry.n);
      for (const change of entry.mutation.changes) {
        mark(touched, change);
        if (result.status === 'refused') mark(undo, change);
      }
      if (result.status === 'refused') {
        refused.push({
          mutationId: result.mutationId,
          code: result.code,
          changes: entry.mutation.changes,
        });
      }
    }

    // 2. What the server sent. A row with a shadow is merged into the shadow, and shown again with its waiting edits laid over; any other is merged
    //    into what the device shows.
    for (const incoming of pull.rows) {
      const key = keyOf(incoming.table, incoming.id);
      const shadow = await tx.objectStore('shadow').get([incoming.table, incoming.id]);
      if (shadow) {
        await tx
          .objectStore('shadow')
          .put({ ...shadow, row: mergePulled(shadow.row ?? undefined, incoming) });
        touched.add(key);
      } else {
        const have = (await tx.objectStore(incoming.table).get(incoming.id)) as
          LocalRow | undefined;
        await tx.objectStore(incoming.table).put(mergePulled(have, incoming));
      }
    }
    for (const gone of pull.tombstones) {
      await tx.objectStore(gone.table).delete(gone.id);
      await tx.objectStore('shadow').delete([gone.table, gone.id]);
      touched.delete(keyOf(gone.table, gone.id));
    }

    // 3. Every row the answers or the pull touched is shown again: the server's version with whatever is still waiting laid over it.
    await reshow(tx, touched, undo, new Set(pull.rows.map((row) => keyOf(row.table, row.id))), now);

    const had = await tx.objectStore('meta').get('cursor');
    await tx
      .objectStore('meta')
      .put(Math.max(typeof had === 'number' ? had : 0, pull.cursor), 'cursor');
    await tx.objectStore('meta').put(now, 'lastSyncedAt');
    return { refused, more: pull.more, answered };
  });
}

/**
 * Shows each of `keys` again from its shadow and the mutations still waiting. With nothing waiting the shadow goes: a row that was undone goes back
 * to the server's, one that the server answered stays as shown (the server's version is merged in as it arrives, by `mergePulled`), and one that the
 * device made and the server refused is gone.
 */
async function reshow(
  tx: Tx,
  keys: ReadonlySet<string>,
  undone: ReadonlySet<string>,
  pulled: ReadonlySet<string>,
  now: number,
): Promise<void> {
  if (keys.size === 0) return;
  const waiting = new Map<string, Change[]>();
  let cursor = await tx.objectStore('outbox').openCursor();
  while (cursor) {
    for (const change of cursor.value.mutation.changes) {
      const key = keyOf(change.table, change.id);
      if (keys.has(key)) waiting.set(key, [...(waiting.get(key) ?? []), change]);
    }
    cursor = await cursor.continue();
  }

  for (const key of keys) {
    const [table, id] = key.split('\u0000') as [SyncTable, string];
    if (!TABLES.includes(table) || id === undefined) continue;
    const shadow = await tx.objectStore('shadow').get([table, id]);
    const changes = waiting.get(key) ?? [];

    if (changes.length > 0) {
      let row = shadow?.row ?? undefined;
      for (const change of changes) row = applyChange(row, change, now);
      await tx.objectStore(table).put(row as LocalRow);
      continue;
    }
    // Nothing waits any more.
    if (shadow) {
      if (undone.has(key) || pulled.has(key)) {
        if (shadow.row) await tx.objectStore(table).put(shadow.row);
        else await tx.objectStore(table).delete(id);
      }
      await tx.objectStore('shadow').delete([table, id]);
    }
  }
}

/** Whether a row has an edit waiting to be sent. */
export async function isPending(db: LocalDatabase, table: SyncTable, id: string): Promise<boolean> {
  return (await db.get('shadow', [table, id])) !== undefined;
}

/* Queries. They read the working copy and never the network (DESIGN.md §8.1), and never return a deleted row: a deleted row is for Undo and for the
   sync, not for a screen. */

const live = (row: LocalRow): boolean => row.deletedAt === null;

/** The lists, in order. */
export async function listsOf(db: LocalDatabase): Promise<LocalRow[]> {
  const rows = (await db.getAll('list')).filter(live) as (LocalRow & { position: string })[];
  return rows.sort(byPosition);
}

/** A list's top-level tasks, in order. A subtask is `subtasksOf` its parent. */
export async function tasksOf(db: LocalDatabase, listId: string): Promise<LocalRow[]> {
  const range = IDBKeyRange.bound([listId, ''], [listId, '￿']);
  const rows = await db.getAllFromIndex('task', 'byListPosition', range);
  const top = rows.filter(
    (row) => live(row) && row.table === 'task' && row.parentId === null,
  ) as (LocalRow & { table: 'task' })[];
  return top.sort(byPosition);
}

/** A task's subtasks, in order. */
export async function subtasksOf(db: LocalDatabase, parentId: string): Promise<LocalRow[]> {
  const rows = await db.getAllFromIndex('task', 'byParent', parentId);
  return (rows.filter(live) as (LocalRow & { table: 'task' })[]).sort(byPosition);
}

export async function getRow(
  db: LocalDatabase,
  table: SyncTable,
  id: string,
): Promise<LocalRow | undefined> {
  return (await db.get(table, id)) as LocalRow | undefined;
}

/**
 * How many open top-level tasks each list has, for the sidebar's count (DESIGN.md §10). "Open" is a task that is not deleted and has no completion
 * time. A completion time that is ciphertext cannot be read here, so such a task counts as open until the keys are in place (task 14.3).
 */
export async function openCounts(db: LocalDatabase): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let cursor = await db.transaction('task').store.openCursor();
  while (cursor) {
    const row = cursor.value;
    if (row.table === 'task' && row.deletedAt === null && row.parentId === null) {
      const done = row.fields.completedAt;
      const completed = done !== undefined && 'v' in done && done.v !== null;
      if (!completed) counts.set(row.listId, (counts.get(row.listId) ?? 0) + 1);
    }
    cursor = await cursor.continue();
  }
  return counts;
}
