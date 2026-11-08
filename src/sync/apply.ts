import { type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, dbRun, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import {
  type Change,
  type FieldValue,
  LIMITS,
  type Mutation,
  type RefusalCode,
  type Scalar,
  type RowFields,
  type StoredFields,
  type SyncTable,
  encodeFields,
} from './format';
import { type Operator, sealDeskField } from '../crypto/operator';
import { openStored } from './operator-fields';
import { tableOf } from './tables';
import { decodeFields, parseStructure } from './validate';

/**
 * Applying a mutation (DESIGN.md §7.1, §8.3, §8.4): **one short transaction** in which the server increments the account's counter, checks and writes
 * each change, and records that the mutation was applied. All of it or none of it: one change that cannot be applied refuses the mutation and writes
 * nothing, because a mutation is what one action changes and half of it would be a state no action made.
 *
 * **The server trusts nothing a device says about ownership.** Who the caller is came from the session (`accountRoute`) and is the only owner
 * there is. A row is found and written with the owner in the statement (`WHERE id = … AND owner_id = …`), never looked up by id and then touched, and
 * anything a change points at (its list, its card, its series) is looked up the same way. The answer is the same whether a row does not exist or is
 * another account's (`unavailable`), so it cannot be used to find out which. A client-made id that another account already uses is refused, not
 * merged.
 *
 * **Order is the account's counter.** The first statement of the transaction increments `account_settings.seq` (creating the row for a new account),
 * which locks the account's row until the transaction ends. Two mutations of one account therefore apply one after the other, on all three
 * databases, with different `seq`s and in the order of those, and a mutation of another account is not held up. Every row and field written is stamped
 * with the `seq`, and a pull is "everything past a `seq`", so an order that is the commit order is what makes a cursor never skip a row (`pull.ts`).
 */
export interface ApplyOptions {
  /** The time, in milliseconds: given and not read, so that a test controls it and a device's clock decides nothing. */
  now: number;
  /** `refuse` for an account with a key of its own, which sends no plain field (DESIGN.md §9.4). */
  plain?: 'check' | 'refuse';
  /** The instance key when `TUSK_DB_ENCRYPTION=on` (§9.5): each field is stored sealed under it, and a ciphertext field of a personal key is refused. */
  operator?: Operator;
  /** Smaller limits for a test; the real ones are in `LIMITS`. */
  limits?: { lists: number; cards: number; checks?: number };
}

export type ApplyResult =
  { status: 'applied'; seq: number; replay: boolean } | { status: 'refused'; code: RefusalCode };

/** A change that cannot be applied. Thrown inside the transaction, so that it rolls everything back. */
class Refused extends Error {
  constructor(readonly code: RefusalCode) {
    super(`refused: ${code}`);
  }
}

/** The mutation was applied by a call that finished first. Thrown inside the transaction, which is then rolled back, and answered from the record. */
class Replayed extends Error {
  constructor(readonly seq: number) {
    super('replayed');
  }
}

const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

/** The structural columns of each table, as the database names them. A closed list of ours: nothing a device sent is ever a column name. */
const STRUCTURE_COLUMNS = {
  desk_list: [['position', 'position']],
  desk_card: [
    ['listId', 'list_id'],
    ['position', 'position'],
  ],
  desk_check: [
    ['cardId', 'card_id'],
    ['position', 'position'],
  ],
  desk_series: [['listId', 'list_id']],
} as const satisfies Record<SyncTable, readonly (readonly [string, string])[]>;

const ident = (name: string): SQL => sql.raw(`"${name}"`);

interface Existing {
  deletedAt: number | null;
  fields: string;
}

interface Touched {
  cards: Set<string>;
  checks: Set<string>;
  series: Set<string>;
  /** Lists this mutation deletes: not restored by a card in them that it also touches. */
  deletedLists: Set<string>;
  /** Cards this mutation deletes: not restored by a checklist item of theirs that it also touches. */
  deletedCards: Set<string>;
  created: Record<SyncTable, number>;
}

export async function applyMutation(
  database: Database,
  accountId: string,
  mutation: Mutation,
  options: ApplyOptions,
): Promise<ApplyResult> {
  // A repeat is the common case of a retry, and needs no lock: it is answered from the record.
  const known = await appliedSeq(database, accountId, mutation.mutationId);
  if (known !== undefined) return { status: 'applied', seq: known, replay: true };

  try {
    return await transaction(database, async (tx) => {
      const seq = await nextSeq(tx, accountId, options.now);
      // Looked at again with the account locked: another call of the same mutation may have applied it since the look above.
      const again = await appliedSeq(tx, accountId, mutation.mutationId);
      if (again !== undefined) throw new Replayed(again);

      const touched: Touched = {
        cards: new Set(),
        checks: new Set(),
        series: new Set(),
        deletedLists: new Set(),
        deletedCards: new Set(),
        created: { desk_list: 0, desk_card: 0, desk_check: 0, desk_series: 0 },
      };
      for (const change of mutation.changes) {
        await applyChange(tx, accountId, change, seq, options, touched);
      }
      await checkStructure(tx, accountId, touched, seq, options.operator);
      await checkLimits(
        tx,
        accountId,
        touched,
        options.limits ?? {
          lists: LIMITS.listsPerAccount,
          cards: LIMITS.cardsPerAccount,
          checks: LIMITS.checksPerAccount,
        },
      );

      const record = schema(tx).appliedMutation;
      await dbRun(
        tx,
        sql`INSERT INTO ${record} (account_id, id, seq, applied_at) VALUES (${accountId}, ${mutation.mutationId}, ${seq}, ${options.now})`,
      );
      return { status: 'applied', seq, replay: false } as const;
    });
  } catch (error) {
    if (error instanceof Refused) return { status: 'refused', code: error.code };
    if (error instanceof Replayed) return { status: 'applied', seq: error.seq, replay: true };
    throw error;
  }
}

async function appliedSeq(
  database: Database,
  accountId: string,
  mutationId: string,
): Promise<number | undefined> {
  const row = await dbGet<{ seq: number | string }>(
    database,
    sql`SELECT seq FROM ${schema(database).appliedMutation} WHERE account_id = ${accountId} AND id = ${mutationId}`,
  );
  return row === undefined ? undefined : Number(row.seq);
}

/**
 * The account's next `seq`, in the one statement that creates the row for an account that has none and increments it for one that has. As the
 * transaction's first statement it is a write, so that SQLite takes its lock now and not on a later upgrade that could fail, and PostgreSQL's row
 * lock holds the account's other writers off until this one ends.
 */
async function nextSeq(tx: Database, accountId: string, now: number): Promise<number> {
  const settings = schema(tx).accountSettings;
  const row = await dbGet<{ seq: number | string }>(
    tx,
    sql`INSERT INTO ${settings} AS s (account_id, seq, created_at) VALUES (${accountId}, 1, ${now})
        ON CONFLICT (account_id) DO UPDATE SET seq = s.seq + 1
        RETURNING seq`,
  );
  if (!row) throw new Error('the account counter could not be incremented');
  return Number(row.seq);
}

async function applyChange(
  tx: Database,
  accountId: string,
  change: Change,
  seq: number,
  options: ApplyOptions,
  touched: Touched,
): Promise<void> {
  const table = change.table;
  const target = tableOf(tx, table);
  const plain = options.plain ?? 'check';
  // Under the operator key the server seals what it can read, so a field a device sealed itself has no place (§9.5).
  if (options.operator && change.fields && Object.values(change.fields).some((f) => 'c' in f))
    throw new Refused('invalid');

  // The row, if this account has it: found with the owner in the statement. A row of another account is, to this account, not there.
  const existing = await dbGet<{ deletedAt: number | string | null; fields: string }>(
    tx,
    sql`SELECT deleted_at AS "deletedAt", fields FROM ${target} WHERE id = ${change.id} AND owner_id = ${accountId}`,
  );

  if (existing === undefined) {
    // It can only be new if it says what a new row needs. If not, it is an edit of a row that is not there for this account, unless what is wrong
    // with it is not what a new row needs but what no change may be (a column its table does not have): that is its shape, and is said so.
    if (!parseStructure(change, { creating: true, plain }).ok) {
      throw new Refused(parseStructure(change, { plain }).ok ? 'unavailable' : 'structure');
    }
    await insertRow(tx, accountId, change, seq, options.now, options.operator);
    touched.created[table] += 1;
  } else {
    // A list's key is set once (DESIGN.md §9.2): everything sealed under it depends on it, so a change that would put another there is refused whole, and
    // two devices that both start to seal a list leave it with the first one's, and the second's work is undone with it.
    if (change.table === 'desk_list' && change.fields && Object.hasOwn(change.fields, 'key')) {
      const have = decodeFields(existing.fields);
      const old = have.ok ? have.value.key : undefined;
      const sent = change.fields.key;
      if (old && 'v' in old && !(sent && 'v' in sent && sent.v === old.v))
        throw new Refused('invalid');
    }
    await updateRow(
      tx,
      accountId,
      change,
      {
        deletedAt: existing.deletedAt === null ? null : Number(existing.deletedAt),
        fields: existing.fields,
      },
      seq,
      options.now,
      options.operator,
    );
  }

  if (change.table === 'desk_card') touched.cards.add(change.id);
  if (change.table === 'desk_check') touched.checks.add(change.id);
  if (change.table === 'desk_series') touched.series.add(change.id);
  if (change.deleted === true) {
    if (change.table === 'desk_list') touched.deletedLists.add(change.id);
    if (change.table === 'desk_card') touched.deletedCards.add(change.id);
  }
}

/** The columns a change sets, as `column = value` pieces: the structure it names, and nothing else. */
function structureSets(change: Change): SQL[] {
  const sets: SQL[] = [];
  const record = change as unknown as Record<string, unknown>;
  for (const [key, column] of STRUCTURE_COLUMNS[change.table]) {
    if (Object.hasOwn(record, key))
      sets.push(sql`${ident(column)} = ${record[key] as string | null}`);
  }
  return sets;
}

/** `{ v }` or `{ c }` of each field sent, stamped with the `seq`, laid over the fields the row already has: a field sent replaces that field only. */
function mergeFields(
  existing: string,
  sent: Readonly<Record<string, FieldValue>>,
  seq: number,
  seal?: (name: string, value: Scalar) => string,
): RowFields {
  const decoded = decodeFields(existing);
  const base = decoded.ok ? decoded.value : {};
  const merged: Record<string, RowFields[string]> = { ...base };
  for (const [name, value] of Object.entries(sent)) {
    merged[name] = seal && 'v' in value ? { o: seal(name, value.v), s: seq } : { ...value, s: seq };
  }
  return merged;
}

/**
 * What the server copies out of the fields for the Planner and reminders of phase 2 (DESIGN.md §23.3): the due date and time and when it was completed, when they are
 * readable. A field that is ciphertext has no mirror, and a field never set has none either.
 */
function mirrors(fields: StoredFields): {
  dueDate: string | null;
  dueTime: string | null;
  completedAt: number | null;
} {
  const plain = (name: string) => {
    const field = fields[name];
    return field !== undefined && 'v' in field ? field.v : null;
  };
  const dueDate = plain('dueDate');
  const dueTime = plain('dueTime');
  const completedAt = plain('completedAt');
  return {
    dueDate: typeof dueDate === 'string' ? dueDate : null,
    dueTime: typeof dueTime === 'string' ? dueTime : null,
    completedAt: typeof completedAt === 'number' ? completedAt : null,
  };
}

/** What seals a field of this row under the operator key, or nothing when the mode is off. */
const sealer = (operator: Operator, change: Change) =>
  operator
    ? (name: string, value: Scalar) => sealDeskField(operator, change.table, change.id, name, value)
    : undefined;

async function insertRow(
  tx: Database,
  accountId: string,
  change: Change,
  seq: number,
  now: number,
  operator: Operator,
): Promise<void> {
  const target = tableOf(tx, change.table);
  const fields = mergeFields('{}', change.fields ?? {}, seq, sealer(operator, change));
  const columns: SQL[] = [
    ident('id'),
    ident('owner_id'),
    ident('deleted_at'),
    ident('seq'),
    ident('created_at'),
    ident('fields'),
  ];
  const values: SQL[] = [
    sql`${change.id}`,
    sql`${accountId}`,
    sql`${change.deleted === true ? now : null}`,
    sql`${seq}`,
    sql`${now}`,
    sql`${encodeFields(fields)}`,
  ];
  const record = change as unknown as Record<string, unknown>;
  for (const [key, column] of STRUCTURE_COLUMNS[change.table]) {
    if (Object.hasOwn(record, key)) {
      columns.push(ident(column));
      values.push(sql`${record[key] as string | null}`);
    }
  }
  if (change.table === 'desk_card') {
    const mirror = mirrors(openStored(operator, change.table, change.id, fields));
    columns.push(ident('due_date'), ident('due_time'), ident('completed_at'));
    values.push(sql`${mirror.dueDate}`, sql`${mirror.dueTime}`, sql`${mirror.completedAt}`);
  }
  // An id that another account uses is a conflict, and a conflict writes nothing: no row comes back, and the change is refused.
  const inserted = await dbAll<{ id: string }>(
    tx,
    sql`INSERT INTO ${target} (${sql.join(columns, sql`, `)}) VALUES (${sql.join(values, sql`, `)})
        ON CONFLICT (id) DO NOTHING RETURNING id`,
  );
  if (inserted.length === 0) throw new Refused('unavailable');
}

async function updateRow(
  tx: Database,
  accountId: string,
  change: Change,
  existing: Existing,
  seq: number,
  now: number,
  operator: Operator,
): Promise<void> {
  const target = tableOf(tx, change.table);
  const fields = mergeFields(existing.fields, change.fields ?? {}, seq, sealer(operator, change));

  // An edit of a deleted row restores it (DESIGN.md §8.4): losing someone's words is worse than a deleted card coming back. A delete of one that is
  // deleted already keeps the time it was first deleted.
  const deletedAt = change.deleted === true ? (existing.deletedAt ?? now) : null;

  const sets: SQL[] = [
    sql`${ident('deleted_at')} = ${deletedAt}`,
    sql`${ident('seq')} = ${seq}`,
    sql`${ident('fields')} = ${encodeFields(fields)}`,
    ...structureSets(change),
  ];
  if (change.table === 'desk_card') {
    const mirror = mirrors(openStored(operator, change.table, change.id, fields));
    sets.push(
      sql`${ident('due_date')} = ${mirror.dueDate}`,
      sql`${ident('due_time')} = ${mirror.dueTime}`,
      sql`${ident('completed_at')} = ${mirror.completedAt}`,
    );
  }
  const updated = await dbAll<{ id: string }>(
    tx,
    sql`UPDATE ${target} SET ${sql.join(sets, sql`, `)} WHERE id = ${change.id} AND owner_id = ${accountId} RETURNING id`,
  );
  if (updated.length === 0) throw new Refused('unavailable');
}

interface CardRow {
  id: string;
  listId: string;
  deletedAt: number | string | null;
  fields: string;
}

/**
 * What must hold after every change of the mutation is written, over the rows it touched, and is checked here and not change by change because a
 * mutation may do things in any order: make a list and put a card in it, move a card and tick its items. Anything that does not hold refuses the
 * mutation, and the transaction rolls back.
 */
async function checkStructure(
  tx: Database,
  accountId: string,
  touched: Touched,
  seq: number,
  operator: Operator,
): Promise<void> {
  const card = tableOf(tx, 'desk_card');
  const check = tableOf(tx, 'desk_check');
  const series = tableOf(tx, 'desk_series');

  for (const id of touched.cards) {
    const row = await dbGet<CardRow>(
      tx,
      sql`SELECT id, list_id AS "listId", deleted_at AS "deletedAt", fields
          FROM ${card} WHERE id = ${id} AND owner_id = ${accountId}`,
    );
    if (!row) throw new Refused('unavailable');
    await requireList(tx, accountId, row.listId, row.deletedAt === null, touched, seq);

    // A series it points at is the account's. It is a field, so only a readable one can be checked; one that is ciphertext is not.
    const decoded = decodeFields(row.fields);
    const readable = decoded.ok ? openStored(operator, 'desk_card', row.id, decoded.value) : {};
    const pointer = readable.seriesId;
    if (pointer && 'v' in pointer && typeof pointer.v === 'string') {
      const found = await dbGet(
        tx,
        sql`SELECT 1 AS one FROM ${series} WHERE id = ${pointer.v} AND owner_id = ${accountId}`,
      );
      if (!found) throw new Refused('unavailable');
    }
  }

  // A checklist item's card is the account's (DESIGN.md §10.3). An item that is edited brings its deleted card back with it, as an edited card brings
  // back its list; an item has no list of its own, so a card moving takes nothing with it.
  for (const id of touched.checks) {
    const row = await dbGet<{ cardId: string; deletedAt: number | string | null }>(
      tx,
      sql`SELECT card_id AS "cardId", deleted_at AS "deletedAt" FROM ${check} WHERE id = ${id} AND owner_id = ${accountId}`,
    );
    if (!row) throw new Refused('unavailable');
    const parent = await dbGet<{ deletedAt: number | string | null }>(
      tx,
      sql`SELECT deleted_at AS "deletedAt" FROM ${card} WHERE id = ${row.cardId} AND owner_id = ${accountId}`,
    );
    if (!parent) throw new Refused('unavailable');
    if (
      row.deletedAt === null &&
      parent.deletedAt !== null &&
      !touched.deletedCards.has(row.cardId)
    ) {
      await dbRun(
        tx,
        sql`UPDATE ${card} SET deleted_at = NULL, seq = ${seq} WHERE id = ${row.cardId} AND owner_id = ${accountId}`,
      );
      // Which may in turn need its list back.
      const restored = await dbGet<{ listId: string }>(
        tx,
        sql`SELECT list_id AS "listId" FROM ${card} WHERE id = ${row.cardId} AND owner_id = ${accountId}`,
      );
      if (restored) await requireList(tx, accountId, restored.listId, true, touched, seq);
    }
  }

  for (const id of touched.series) {
    const row = await dbGet<{ listId: string; deletedAt: number | string | null }>(
      tx,
      sql`SELECT list_id AS "listId", deleted_at AS "deletedAt" FROM ${series} WHERE id = ${id} AND owner_id = ${accountId}`,
    );
    if (!row) throw new Refused('unavailable');
    await requireList(tx, accountId, row.listId, row.deletedAt === null, touched, seq);
  }
}

/**
 * A list a card or series points at is the account's. If the row is live and the list is deleted, the list is restored (DESIGN.md §8.4: a card added
 * to a list another device deleted brings it back), unless this mutation is what deletes the list.
 */
async function requireList(
  tx: Database,
  accountId: string,
  listId: string,
  live: boolean,
  touched: Touched,
  seq: number,
): Promise<void> {
  const list = tableOf(tx, 'desk_list');
  const found = await dbGet<{ deletedAt: number | string | null }>(
    tx,
    sql`SELECT deleted_at AS "deletedAt" FROM ${list} WHERE id = ${listId} AND owner_id = ${accountId}`,
  );
  if (!found) throw new Refused('unavailable');
  if (live && found.deletedAt !== null && !touched.deletedLists.has(listId)) {
    await dbRun(
      tx,
      sql`UPDATE ${list} SET deleted_at = NULL, seq = ${seq} WHERE id = ${listId} AND owner_id = ${accountId}`,
    );
  }
}

/** What an account may have (DESIGN.md §7.4), counted only where the mutation made rows, since that is the only way a count grows. */
async function checkLimits(
  tx: Database,
  accountId: string,
  touched: Touched,
  limits: { lists: number; cards: number; checks?: number },
): Promise<void> {
  const counts: [SyncTable, number][] = [
    ['desk_list', limits.lists],
    ['desk_card', limits.cards],
    ['desk_check', limits.checks ?? LIMITS.checksPerAccount],
    ['desk_series', limits.cards],
  ];
  for (const [name, most] of counts) {
    if (touched.created[name] === 0) continue;
    const row = await dbGet<{ n: number | string }>(
      tx,
      sql`SELECT COUNT(*) AS n FROM ${tableOf(tx, name)} WHERE owner_id = ${accountId}`,
    );
    if (Number(row?.n ?? 0) > most) throw new Refused('limit');
  }
}
