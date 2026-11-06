import { CipherError } from '../cipher/errors';
import { importListKey, openField, sealField } from '../cipher/field';
import { newListKey, unwrapListKey, wrapListKey } from '../cipher/list-key';
import {
  FIELD_NAMES,
  LIMITS,
  type Change,
  type FieldValue,
  type Mutation,
  type Scalar,
  type SyncTable,
} from '../sync/format';
import { STRUCTURAL_FIELDS } from '../sync/validate';
import type { LocalDatabase } from './db';
import type { LocalRow } from './rows';

/**
 * A Desk sealed to a key of the person's own, as the working copy sees it (DESIGN.md §9.2, §9.4). **The working copy holds what the server holds:** a
 * field of such an account is `{ c }` there and in the outbox, so a pull, a shadow and a change waiting all lay over one another as they always did, and
 * the merge rules never learn the difference. What changes is at the two edges: **a change is sealed on its way in** (`seal`), and **a row is opened on
 * its way out** (`openRows`), by the queries of `store.ts`. A screen and an action see plain fields and never ciphertext.
 *
 * A field is sealed under the key of the list it is in, and the row id, table and field are bound to it (`src/cipher/field.ts`). A list's key is made
 * when the list is, wrapped to the person's recipient, and kept in the list's own row as the field `key`, which is how it syncs, is purged and comes back
 * with the list, with nothing of its own to go wrong. **Moving a card re-seals it, its checklist and its series under the new list's key, in the same
 * mutation.** A list with no key on an account that has a key is a fault, and **a change to it is refused here rather than sent in the clear.**
 */
export class NoListKey extends Error {
  constructor() {
    super('a list of this Desk has no key');
    this.name = 'NoListKey';
  }
}

const ciphers = new WeakMap<LocalDatabase, DeskCipher>();

/** Gives a working copy the key to seal and open with, or takes it away (the key was forgotten, or the person left). */
export function attachCipher(db: LocalDatabase, cipher: DeskCipher | undefined): void {
  if (cipher) ciphers.set(db, cipher);
  else ciphers.delete(db);
}

export const cipherOf = (db: LocalDatabase): DeskCipher | undefined => ciphers.get(db);

/** Opens rows with the working copy's key, if it has one. Rows that need none come back as they are. */
export async function openAll(db: LocalDatabase, rows: LocalRow[]): Promise<LocalRow[]> {
  const cipher = ciphers.get(db);
  return cipher ? cipher.openRows(db, rows) : rows;
}

const hasCiphertext = (row: LocalRow): boolean =>
  Object.values(row.fields).some((field) => 'c' in field);

const isStructural = (table: SyncTable, name: string): boolean =>
  STRUCTURAL_FIELDS[table]?.includes(name) === true;

const keyOfRow = (row: LocalRow | undefined): string | undefined => {
  const field = row?.fields.key;
  return field && 'v' in field && typeof field.v === 'string' ? field.v : undefined;
};

/** The names of a row's fields that are content in the clear: what a Desk with a key of its own must not have. */
export const plainContentOf = (row: LocalRow): string[] =>
  Object.entries(row.fields)
    .filter(([name, field]) => 'v' in field && !isStructural(row.table, name))
    .map(([name]) => name);

/** Whether a mutation carries content in the clear. */
export const hasPlainContent = (mutation: Mutation): boolean =>
  mutation.changes.some((change) =>
    Object.entries(change.fields ?? {}).some(
      ([name, field]) => 'v' in field && !isStructural(change.table, name),
    ),
  );

export class DeskCipher {
  /** Rows with a field that could not be opened, as `table\0id`: for a person to be told of, never for what they say. */
  readonly unreadable = new Set<string>();
  /**
   * Rows with a field that opened only under the key of a list the row is not in. Two devices can do this to a row at once: one moves a card to another list
   * and seals it again under that list's key, the other edits a field of it under the key it had, and the fields of a row are merged one by one. Such a row
   * reads, and is sealed again whole by `heal` (`SyncClient`), so that it does not stay under a key that goes when its list is purged.
   */
  readonly stale = new Set<string>();
  private readonly keys = new Map<string, Promise<CryptoKey | undefined>>();
  private readonly opened = new Map<string, Scalar>();

  constructor(
    private readonly identity: string | CryptoKey,
    readonly recipient: string,
  ) {}

  /** The browser key for a wrapped list key, found once. `undefined` if it is not one this identity opens. */
  private keyOf(wrapped: string): Promise<CryptoKey | undefined> {
    let found = this.keys.get(wrapped);
    if (!found) {
      found = unwrapListKey(wrapped, this.identity).then(importListKey, () => undefined);
      this.keys.set(wrapped, found);
    }
    return found;
  }

  /** The list a row is in: a list is its own, a checklist item's is its card's. */
  private async listOf(db: LocalDatabase, row: LocalRow): Promise<string | undefined> {
    if (row.table === 'desk_list') return row.id;
    if (row.table === 'desk_check')
      return ((await db.get('desk_card', row.cardId)) as { listId?: string } | undefined)?.listId;
    return row.listId;
  }

  /**
   * The rows with their ciphertext fields opened into plain ones, in the same order. A field that does not open (changed, moved, or its list's key is
   * gone or is not this person's) is left out and the row is noted in `unreadable`, so a bad row is a bad row and the rest are read.
   */
  async openRows(db: LocalDatabase, rows: LocalRow[]): Promise<LocalRow[]> {
    const lists = new Map<string, Promise<CryptoKey | undefined>>();
    const listKey = (listId: string | undefined): Promise<CryptoKey | undefined> => {
      if (listId === undefined) return Promise.resolve(undefined);
      let found = lists.get(listId);
      if (!found) {
        found = (async () => {
          const wrapped = keyOfRow((await db.get('desk_list', listId)) as LocalRow | undefined);
          return wrapped === undefined ? undefined : this.keyOf(wrapped);
        })();
        lists.set(listId, found);
      }
      return found;
    };

    // The keys of the other lists, found only if a field does not open under its own list's: the cost is in the rare row, and a key that opened is remembered.
    let others: Promise<CryptoKey[]> | undefined;
    const otherKeys = (except: CryptoKey | undefined): Promise<CryptoKey[]> => {
      others ??= (async () => {
        const found: CryptoKey[] = [];
        for (const list of (await db.getAll('desk_list')) as LocalRow[]) {
          const wrapped = keyOfRow(list);
          const key = wrapped === undefined ? undefined : await this.keyOf(wrapped);
          if (key) found.push(key);
        }
        return found;
      })();
      return others.then((all) => all.filter((each) => each !== except));
    };

    const out: LocalRow[] = [];
    for (const row of rows) {
      if (!hasCiphertext(row)) {
        out.push(row);
        continue;
      }
      const key = await listKey(await this.listOf(db, row));
      const fields: Record<string, FieldValue & { s: number }> = {};
      let readable = true;
      for (const [name, field] of Object.entries(row.fields)) {
        if (!('c' in field)) {
          fields[name] = field;
          continue;
        }
        const memo = `${row.table}\u0000${row.id}\u0000${name}\u0000${field.c}`;
        let value = this.opened.get(memo);
        const binding = { table: row.table, id: row.id, field: name };
        if (value === undefined && key) {
          try {
            value = await openField(key, field.c, binding);
            this.opened.set(memo, value);
          } catch (error) {
            if (!(error instanceof CipherError)) throw error;
          }
        }
        if (value === undefined) {
          // Not under its list's key: under one of the person's others, if it was sealed before a move that another device's edit crossed.
          for (const other of await otherKeys(key)) {
            try {
              value = await openField(other, field.c, binding);
              this.opened.set(memo, value);
              this.stale.add(`${row.table}\u0000${row.id}`);
              break;
            } catch (error) {
              if (!(error instanceof CipherError)) throw error;
            }
          }
        }
        if (value === undefined) readable = false;
        else fields[name] = { v: value, s: field.s };
      }
      if (!readable) this.unreadable.add(`${row.table}\u0000${row.id}`);
      else this.unreadable.delete(`${row.table}\u0000${row.id}`);
      out.push({ ...row, fields } as LocalRow);
    }
    return out;
  }

  /** The change that seals a stale row again under its list's key, whole; `undefined` if it is gone or cannot be read in full. */
  async heal(db: LocalDatabase, key: string): Promise<Change | undefined> {
    this.stale.delete(key);
    const [table, id] = key.split('\u0000') as [SyncTable, string];
    const row = (await db.get(table, id)) as LocalRow | undefined;
    if (!row || this.unreadable.has(key)) return undefined;
    const opened = (await this.openRows(db, [row]))[0];
    if (!opened || this.unreadable.has(key)) return undefined;
    const fields: Record<string, FieldValue> = {};
    for (const [name, field] of Object.entries(opened.fields))
      if (!isStructural(table, name) && 'v' in field) fields[name] = { v: field.v };
    // Re-sealing a field nobody changed would move every device's copy for nothing, so it is the change a person could have made and nothing more.
    return Object.keys(fields).length > 0 ? ({ table, id, fields } as Change) : undefined;
  }

  /**
   * The mutation as it is to be written and sent: every content field sealed, a new list given its key, and a card (or series) that moves to another
   * list with all its fields, and its checklist, sealed again under that list's key. **A mutation that cannot be sealed throws, and nothing is written.**
   * Over the limit of changes in a mutation, it comes back as several, in order.
   */
  async seal(
    db: LocalDatabase,
    mutation: Mutation,
    options: { adopt?: boolean } = {},
  ): Promise<Mutation[]> {
    // A list made by this mutation gets its key now, so that the cards put in it by the same mutation can be sealed. With `adopt`, so does a list that exists
    // and has none because it was made before there was a key (moving a Desk to one, §9.3); the server keeps the first key a list is given and refuses
    // another, so two devices that both do this leave one key and the other's work is undone whole.
    const made = new Map<string, { wrapped: string; key: CryptoKey }>();
    for (const change of mutation.changes) {
      if (change.table !== 'desk_list' || made.has(change.id)) continue;
      const have = (await db.get('desk_list', change.id)) as LocalRow | undefined;
      if (have && !(options.adopt && keyOfRow(have) === undefined)) continue;
      const raw = newListKey();
      const wrapped = await wrapListKey(raw, this.recipient);
      made.set(change.id, { wrapped, key: await importListKey(raw) });
      raw.fill(0);
    }
    const cardLists = new Map<string, string>();
    for (const change of mutation.changes)
      if (change.table === 'desk_card' && change.listId !== undefined)
        cardLists.set(change.id, change.listId);

    const keyOfList = async (listId: string | undefined): Promise<CryptoKey> => {
      if (listId === undefined) throw new NoListKey();
      const fresh = made.get(listId);
      if (fresh) return fresh.key;
      const wrapped = keyOfRow((await db.get('desk_list', listId)) as LocalRow | undefined);
      const key = wrapped === undefined ? undefined : await this.keyOf(wrapped);
      if (!key) throw new NoListKey();
      return key;
    };
    const listOfChange = async (change: Change): Promise<string | undefined> => {
      if (change.table === 'desk_list') return change.id;
      if (change.table === 'desk_check') {
        const cardId =
          change.cardId ??
          ((await db.get('desk_check', change.id)) as { cardId?: string } | undefined)?.cardId;
        if (cardId === undefined) return undefined;
        return (
          cardLists.get(cardId) ??
          ((await db.get('desk_card', cardId)) as { listId?: string } | undefined)?.listId
        );
      }
      return (
        change.listId ??
        ((await db.get(change.table, change.id)) as { listId?: string } | undefined)?.listId
      );
    };

    /** Every content field of a row, as the row has it now with the change laid over it: what sealing again under another key needs. */
    const whole = async (
      table: SyncTable,
      id: string,
      patch: Record<string, FieldValue> | undefined,
    ): Promise<Record<string, FieldValue>> => {
      const row = (await db.get(table, id)) as LocalRow | undefined;
      const opened = row ? (await this.openRows(db, [row]))[0] : undefined;
      const fields: Record<string, FieldValue> = {};
      for (const name of FIELD_NAMES[table]) {
        if (isStructural(table, name)) continue;
        const given = patch?.[name];
        const have = opened?.fields[name];
        if (given) fields[name] = given;
        else if (have && 'v' in have) fields[name] = { v: have.v };
      }
      return fields;
    };

    const sealFields = async (
      change: { table: SyncTable; id: string },
      fields: Record<string, FieldValue>,
      key: CryptoKey,
    ): Promise<Record<string, FieldValue>> => {
      const out: Record<string, FieldValue> = {};
      for (const [name, value] of Object.entries(fields)) {
        out[name] =
          'v' in value && !isStructural(change.table, name)
            ? {
                c: await sealField(key, value.v, {
                  table: change.table,
                  id: change.id,
                  field: name,
                }),
              }
            : value;
      }
      return out;
    };

    // Rows that must be sealed again because their card moves, with the key they go under.
    const resealed = new Map<string, string>();
    const moving: Change[] = [];
    for (const change of mutation.changes) {
      if (change.table !== 'desk_card' && change.table !== 'desk_series') continue;
      if (change.listId === undefined) continue;
      const row = (await db.get(change.table, change.id)) as { listId?: string } | undefined;
      if (!row || row.listId === change.listId) continue;
      moving.push(change);
      if (change.table === 'desk_card')
        for (const item of await db.getAllFromIndex('desk_check', 'byCard', change.id))
          resealed.set(item.id, change.listId);
    }

    const changes: Change[] = [];
    const done = new Set<string>();
    for (const change of mutation.changes) {
      const key = await keyOfList(await listOfChange(change));
      let fields = change.fields as Record<string, FieldValue> | undefined;
      // A row that moves, or an item of a card that moves, is sealed whole: nothing of it may stay under the key it is leaving.
      if (moving.includes(change) || resealed.has(change.id)) {
        fields = await whole(change.table, change.id, fields);
        done.add(change.id);
      }
      const sealed = fields ? await sealFields(change, fields, key) : undefined;
      const fresh = change.table === 'desk_list' ? made.get(change.id) : undefined;
      const next = {
        ...change,
        ...(sealed || fresh
          ? { fields: { ...(sealed ?? {}), ...(fresh ? { key: { v: fresh.wrapped } } : {}) } }
          : {}),
      } as Change;
      changes.push(next);
    }
    // Items of a moving card that the mutation did not mention.
    for (const [itemId, listId] of resealed) {
      if (done.has(itemId)) continue;
      const key = await keyOfList(listId);
      const fields = await sealFields(
        { table: 'desk_check', id: itemId },
        await whole('desk_check', itemId, undefined),
        key,
      );
      if (Object.keys(fields).length > 0) changes.push({ table: 'desk_check', id: itemId, fields });
    }

    const parts: Mutation[] = [];
    for (let i = 0; i < changes.length; i += LIMITS.changes)
      parts.push({
        mutationId: i === 0 ? mutation.mutationId : crypto.randomUUID(),
        changes: changes.slice(i, i + LIMITS.changes),
      });
    return parts;
  }
}
