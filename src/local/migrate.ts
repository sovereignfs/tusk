import { LIMITS, type Change, type FieldValue, type SyncTable } from '../sync/format';
import type { SyncClient } from '../sync/client';
import type { LocalDatabase } from './db';
import type { LocalRow } from './rows';
import { plainContentOf } from './seal';

/**
 * Moving a Desk that has things in it to a key of its own (DESIGN.md §9.3), in the browser, through the ordinary sync path. **Nothing is guessed about what is
 * left to do: it is read from the working copy each time,** every row with a field in the clear, so it can be stopped at any point (a closed tab, a lost
 * network, a restart) and picks up where it was, and a row that arrives in the clear meanwhile, from a device that had not heard, is found and sealed in its turn.
 *
 * It goes a list at a time. A list's first mutation carries the list, which is given its key there, with the cards and so on that fit; the rest of the list
 * follow, each also naming the key, which the server keeps from the first writer and refuses to see changed, so that if two devices both move the Desk the
 * second's work is undone whole and not left sealed under a key nobody has. When nothing in the clear is left it asks the server to finish the move, which
 * the server does only if it finds nothing in the clear either.
 */
export interface Progress {
  readonly done: number;
  readonly total: number;
}

const CHANGES_PER_MUTATION = 400;
/** Well under `LIMITS.mutationChars`, whatever the fields say. */
const CHARS_PER_MUTATION = Math.floor(LIMITS.mutationChars * 0.6);

type Plain = { row: LocalRow; fields: Record<string, FieldValue> };

const plainFields = (row: LocalRow): Record<string, FieldValue> => {
  const out: Record<string, FieldValue> = {};
  for (const name of plainContentOf(row)) {
    const field = row.fields[name];
    if (field && 'v' in field) out[name] = { v: field.v };
  }
  return out;
};

/** Every row of the Desk that has content in the clear, with just those fields, grouped by the list it is in. Rows whose list or card is not there are left alone. */
export async function plainByList(db: LocalDatabase): Promise<Map<string, Plain[]>> {
  const lists = (await db.getAll('desk_list')) as LocalRow[];
  const cards = (await db.getAll('desk_card')) as LocalRow[];
  const listOfCard = new Map(cards.map((card) => [card.id, 'listId' in card ? card.listId : '']));
  const known = new Set(lists.map((list) => list.id));
  const out = new Map<string, Plain[]>();
  const add = (listId: string | undefined, row: LocalRow) => {
    if (listId === undefined || !known.has(listId)) return;
    const fields = plainFields(row);
    if (Object.keys(fields).length === 0) return;
    out.set(listId, [...(out.get(listId) ?? []), { row, fields }]);
  };
  for (const list of lists) add(list.id, list);
  for (const card of cards) add('listId' in card ? card.listId : undefined, card);
  for (const item of (await db.getAll('desk_check')) as LocalRow[])
    add('cardId' in item ? listOfCard.get(item.cardId) : undefined, item);
  for (const each of (await db.getAll('desk_series')) as LocalRow[])
    add('listId' in each ? each.listId : undefined, each);
  return out;
}

export const countPlain = async (db: LocalDatabase): Promise<number> =>
  [...(await plainByList(db)).values()].reduce((sum, rows) => sum + rows.length, 0);

const size = (fields: Record<string, FieldValue>): number =>
  Object.values(fields).reduce(
    (sum, field) => sum + ('v' in field ? String(field.v).length + 16 : 0),
    0,
  );

export type Moved = 'done' | 'stopped';

export interface MoveOptions {
  onProgress?: (progress: Progress) => void;
  /** Asked between mutations: true stops it, to be picked up again. */
  stopped?: () => boolean;
  /** Asks the server to finish: `done`, or how many it still finds in the clear. */
  finish(): Promise<'done' | { plainRemains: number } | 'not_moving'>;
  /** How many rounds of "seal, send, ask" before it gives up and says so. */
  rounds?: number;
}

export async function moveToKey(client: SyncClient, options: MoveOptions): Promise<Moved> {
  const db = client.db;
  const total = await countPlain(db);
  let done = 0;
  options.onProgress?.({ done, total });
  for (let round = 0; round < (options.rounds ?? 20); round++) {
    // What other devices have written comes first: a row is sealed from what this device holds, so it must hold the latest, or the edit of a device that was
    // heard from a moment ago would be written over with the value before it.
    await client.sync();
    const groups = await plainByList(db);
    for (const [listId, rows] of groups) {
      await client.sync();
      // The list itself first, then the rest of it: the list's key has to be in the working copy before anything is sealed under it.
      const ordered = [...rows].sort(
        (a, b) => Number(b.row.table === 'desk_list') - Number(a.row.table === 'desk_list'),
      );
      let wrapped: string | undefined;
      let batch: Change[] = [];
      let chars = 0;
      const flush = async () => {
        if (batch.length === 0) return;
        const changes = [...batch];
        // The key is named in every mutation after the first: the server refuses one that names another.
        if (wrapped !== undefined && !changes.some((c) => c.table === 'desk_list'))
          changes.push({ table: 'desk_list', id: listId, fields: { key: { v: wrapped } } });
        await client.commitMigration({ mutationId: crypto.randomUUID(), changes });
        if (wrapped === undefined) {
          const listRow = (await db.get('desk_list', listId)) as LocalRow | undefined;
          const key = listRow?.fields.key;
          wrapped = key && 'v' in key && typeof key.v === 'string' ? key.v : undefined;
        }
        done += batch.length;
        batch = [];
        chars = 0;
        options.onProgress?.({ done, total: Math.max(total, done) });
      };
      for (const { row, fields } of ordered) {
        if (options.stopped?.()) return 'stopped';
        const cost = size(fields);
        if (
          batch.length >= CHANGES_PER_MUTATION ||
          (chars + cost > CHARS_PER_MUTATION && batch.length > 0)
        )
          await flush();
        batch.push({ table: row.table as SyncTable, id: row.id, fields } as Change);
        chars += cost;
        // The first mutation of a list is only the list, so that the key is there before the rest is sealed under it.
        if (row.table === 'desk_list') await flush();
      }
      await flush();
    }
    // What was sealed is sent, and what other devices sent is taken: a row that came in the clear is found next round.
    await client.sync();
    if ((await countPlain(db)) > 0 && !options.stopped?.()) continue;
    if (options.stopped?.()) return 'stopped';
    const finished = await options.finish();
    if (finished === 'done' || finished === 'not_moving') return 'done';
    await client.sync();
  }
  return 'stopped';
}
