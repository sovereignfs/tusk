import type { IDBPTransaction, StoreNames } from 'idb';
import {
  type Change,
  type Mutation,
  type MutationResult,
  type Pull,
  type RefusalCode,
  type SyncTable,
  TABLES,
} from '../sync/format';
import type { LocalDatabase, LocalSchema, OutboxEntry } from './db';
import { type LocalRow, applyChange, byPosition, mergePulled } from './rows';
import { openAll } from './seal';

/**
 * Reading and writing the working copy (DESIGN.md §8.1, §8.3). Everything that changes more than one store does it in **one IndexedDB
 * transaction**, so that closing the tab, a crash or a full disk at any moment leaves the rows and the outbox agreeing: a write is in both or in
 * neither. A transaction here holds no `await` of anything but IndexedDB, which is what keeps it open.
 */
type Tx = IDBPTransaction<LocalSchema, StoreNames<LocalSchema>[], 'readwrite'>;
const WRITE_STORES = [...TABLES, 'shadow', 'outbox', 'meta'] as const;
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

/**
 * Starts again from nothing, as a device that has been away too long must (DESIGN.md §8.7): the cursor goes to zero and a token is remembered, and
 * every row the server then sends is tagged with it. **Nothing is removed yet**, so the screen keeps showing what it had while the snapshot arrives; when
 * the last page is in, whatever was not tagged was purged while the device was away, and goes (`settle`). The outbox is untouched and is sent with the
 * first request of the snapshot.
 */
export async function startSnapshot(db: LocalDatabase, token: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    await tx.objectStore('meta').put(0, 'cursor');
    await tx.objectStore('meta').put(token, 'snapshot');
  });
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

    // A snapshot is under way if the device was told to start again: what the server sends is tagged, and what is not tagged by the end is gone.
    const snapshotMeta = await tx.objectStore('meta').get('snapshot');
    const snapshot = typeof snapshotMeta === 'string' ? snapshotMeta : undefined;
    const tag = (row: LocalRow): LocalRow =>
      snapshot ? ({ ...row, snap: snapshot } as unknown as LocalRow) : row;

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
        await tx.objectStore(incoming.table).put(tag(mergePulled(have, incoming)));
      }
    }
    for (const gone of pull.tombstones) {
      await tx.objectStore(gone.table).delete(gone.id);
      await tx.objectStore('shadow').delete([gone.table, gone.id]);
      touched.delete(keyOf(gone.table, gone.id));
    }

    // 3. Every row the answers or the pull touched is shown again: the server's version with whatever is still waiting laid over it.
    await reshow(tx, touched, undo, new Set(pull.rows.map((row) => keyOf(row.table, row.id))), now);

    // A row the server sent in a snapshot is tagged whichever way it was shown: one with an edit waiting went through its shadow, and `reshow` wrote it.
    if (snapshot) {
      for (const incoming of pull.rows) {
        const shown = (await tx.objectStore(incoming.table).get(incoming.id)) as
          LocalRow | undefined;
        if (shown) await tx.objectStore(incoming.table).put(tag(shown));
      }
    }

    // The last page of a snapshot: a row that was not sent was purged while the device was away, unless it has an edit waiting, which is kept (the server
    // will refuse it if the row is truly gone, and it is undone then).
    if (snapshot && !pull.more) {
      for (const name of TABLES) {
        let cursor = await tx.objectStore(name).openCursor();
        while (cursor) {
          const row = cursor.value as LocalRow & { snap?: string };
          if (
            row.snap !== snapshot &&
            (await tx.objectStore('shadow').get([name, row.id])) === undefined
          ) {
            await cursor.delete();
          } else if (row.snap !== undefined) {
            // The tag was for this, and is no part of a row: the rows are as the server's are again.
            const { snap: _snap, ...plain } = row;
            await cursor.update(plain as LocalRow);
          }
          cursor = await cursor.continue();
        }
      }
      await tx.objectStore('meta').delete('snapshot');
    }

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
  const rows = (await openAll(db, (await db.getAll('desk_list')).filter(live))) as (LocalRow & {
    position: string;
  })[];
  return rows.sort(byPosition);
}

/** The Desk's repeating series, opened: a rule and an anchor each, which the Planner works the occurrences ahead from (DESIGN.md §25.1). Deleted ones are for `readSeries` to refuse. */
export async function seriesOf(db: LocalDatabase): Promise<LocalRow[]> {
  return openAll(db, (await db.getAll('desk_series')) as LocalRow[]);
}

/** A list's cards, in order. A card's checklist is `checksOf` it. */
export async function cardsOf(db: LocalDatabase, listId: string): Promise<LocalRow[]> {
  const range = IDBKeyRange.bound([listId, ''], [listId, '￿']);
  const rows = await db.getAllFromIndex('desk_card', 'byListPosition', range);
  const opened = (await openAll(db, rows.filter(live))) as (LocalRow & { position: string })[];
  return opened.sort(byPosition);
}

/** A card's checklist, in order. */
export async function checksOf(db: LocalDatabase, cardId: string): Promise<LocalRow[]> {
  const rows = await db.getAllFromIndex('desk_check', 'byCard', cardId);
  const opened = (await openAll(db, rows.filter(live))) as (LocalRow & { position: string })[];
  return opened.sort(byPosition);
}

export async function getRow(
  db: LocalDatabase,
  table: SyncTable,
  id: string,
): Promise<LocalRow | undefined> {
  const row = (await db.get(table, id)) as LocalRow | undefined;
  return row ? (await openAll(db, [row]))[0] : undefined;
}

/**
 * How many open cards each list has, for the sidebar's count (DESIGN.md §10.1). "Open" is a card that is not deleted and has no completion time (so
 * one that is in progress is open). A completion time that is ciphertext cannot be read here, so such a card counts as open until the keys are in
 * place (task 14.3).
 */
export async function openCounts(db: LocalDatabase): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const cards = (await db.getAll('desk_card')).filter(live);
  for (const row of await openAll(db, cards)) {
    if (row.table !== 'desk_card') continue;
    const done = row.fields.completedAt;
    const completed = done !== undefined && 'v' in done && done.v !== null;
    if (!completed) counts.set(row.listId, (counts.get(row.listId) ?? 0) + 1);
  }
  return counts;
}

/** Every list row the device has, deleted ones too, for deciding whether an account has ever had a list. */
export async function allLists(db: LocalDatabase): Promise<LocalRow[]> {
  return openAll(db, await db.getAll('desk_list'));
}

/** How many card rows the device has, deleted ones too, which count against the account's limit until they are removed for good. */
export async function cardCount(db: LocalDatabase): Promise<number> {
  return db.count('desk_card');
}

/** How many checklist item rows the device has, deleted ones too, which count against the account's limit until they are removed for good. */
export async function checkCount(db: LocalDatabase): Promise<number> {
  return db.count('desk_check');
}

/**
 * For each card with a checklist, how many items it has and how many are done, for the ring on its row (DESIGN.md §10.3). Deleted items are not
 * counted. A completion time that is ciphertext cannot be read here, and counts as not done until the keys are in place (task 14.3).
 */
export async function checkCounts(
  db: LocalDatabase,
): Promise<Map<string, { done: number; total: number }>> {
  const counts = new Map<string, { done: number; total: number }>();
  const items = (await db.getAll('desk_check')).filter(live);
  for (const row of await openAll(db, items)) {
    if (row.table !== 'desk_check') continue;
    const have = counts.get(row.cardId) ?? { done: 0, total: 0 };
    const completed = row.fields.completedAt;
    counts.set(row.cardId, {
      total: have.total + 1,
      done:
        have.done +
        (completed !== undefined && 'v' in completed && typeof completed.v === 'number' ? 1 : 0),
    });
  }
  return counts;
}

/** Every item a card has, **deleted ones too**: what restoring a card needs, to find those that were deleted with it. */
export async function allChecksOf(db: LocalDatabase, cardId: string): Promise<LocalRow[]> {
  return openAll(db, (await db.getAllFromIndex('desk_check', 'byCard', cardId)) as LocalRow[]);
}

/**
 * The live occurrences of a series with their live checklist items (DESIGN.md §12.5): what reopening one needs to know whether the next is untouched.
 * A card names its series in a field, which has no index, so this reads the cards once; a Desk is a few thousand at most.
 */
export async function occurrencesOf(
  db: LocalDatabase,
  seriesId: string,
): Promise<{ card: LocalRow; items: LocalRow[] }[]> {
  const cards = (await openAll(db, (await db.getAll('desk_card')) as LocalRow[])).filter((card) => {
    const field = card.fields.seriesId;
    return card.deletedAt === null && field !== undefined && 'v' in field && field.v === seriesId;
  });
  return Promise.all(cards.map(async (card) => ({ card, items: await checksOf(db, card.id) })));
}

/**
 * Every card a screen that looks across lists may show (search, export, the Planner of phase 2): **not deleted, and not of a deleted list**
 * (DESIGN.md §10.6). Deleting a list marks only the list, so its cards are still live rows; this is where they stop being shown. A query across lists
 * goes through here and never through the store directly.
 */
export async function visibleCards(db: LocalDatabase): Promise<LocalRow[]> {
  const lists = new Set(
    (await db.getAll('desk_list')).filter((list) => list.deletedAt === null).map((list) => list.id),
  );
  const cards = ((await db.getAll('desk_card')) as LocalRow[]).filter(
    (card) => card.table === 'desk_card' && card.deletedAt === null && lists.has(card.listId),
  );
  return openAll(db, cards);
}

/**
 * What a search of the Desk looks through (DESIGN.md §10.7): the cards a screen may show (`visibleCards`), and the live checklist items of those cards.
 * Read from the working copy, so a search works offline.
 */
export async function searchable(
  db: LocalDatabase,
): Promise<{ cards: LocalRow[]; checks: LocalRow[] }> {
  const cards = await visibleCards(db);
  const shown = new Set(cards.map((card) => card.id));
  const checks = ((await db.getAll('desk_check')) as LocalRow[]).filter(
    (item) => item.table === 'desk_check' && item.deletedAt === null && shown.has(item.cardId),
  );
  return { cards, checks: await openAll(db, checks) };
}

/**
 * What the boards index shows of the Desk (DESIGN.md §17.3): how many cards are open, and how many of those are due today. "Open" is the sidebar's: not
 * deleted and not completed. A due date that is ciphertext cannot be read here, so such a card counts as open and not as due (task 14.3). Read from the
 * working copy, so it is there offline. `today` is the person's own date as `YYYY-MM-DD`, given and not read, so that a test controls it.
 */
export async function deskSummary(
  db: LocalDatabase,
  today: string,
): Promise<{ open: number; dueToday: number }> {
  let open = 0;
  let dueToday = 0;
  for (const card of await visibleCards(db)) {
    if (card.table !== 'desk_card') continue;
    const done = card.fields.completedAt;
    if (done !== undefined && 'v' in done && done.v !== null) continue;
    open += 1;
    const due = card.fields.dueDate;
    if (due !== undefined && 'v' in due && due.v === today) dueToday += 1;
  }
  return { open, dueToday };
}

/** Every row of the Desk's four tables, deleted ones too, opened: what an export is made from, and what a screen that needs the whole Desk reads. */
export async function allDeskRows(db: LocalDatabase): Promise<{
  lists: LocalRow[];
  cards: LocalRow[];
  checks: LocalRow[];
  series: LocalRow[];
}> {
  return {
    lists: await openAll(db, (await db.getAll('desk_list')) as LocalRow[]),
    cards: await openAll(db, (await db.getAll('desk_card')) as LocalRow[]),
    checks: await openAll(db, (await db.getAll('desk_check')) as LocalRow[]),
    series: await openAll(db, (await db.getAll('desk_series')) as LocalRow[]),
  };
}
