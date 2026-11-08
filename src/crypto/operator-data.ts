import { type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { CONTENT_COLUMNS, type ContentTable, contentTableOf } from '../workspaces/content';
import { type RowFields, TABLES, type SyncTable } from '../sync/format';
import { tableOf } from '../sync/tables';
import { decodeFields } from '../sync/validate';
import { encodeFields } from '../sync/format';
import { openStored, sealStored } from '../sync/operator-fields';
import type { KeyRing } from './keys';
import { openColumn, rewrapColumn, rewrapDeskFields, sealColumn } from './operator';

/**
 * What is stored under the operator key, looked at and moved (DESIGN.md §9.5, task 14.7). Three jobs, all over the same list of places:
 *
 * - `assertOperatorState` is the **start-up refusal**: the mode on with content that is plain, or off with content that is sealed, or sealed under a key the
 *   server does not have, or with accounts that have a key of their own, stops the server and says which. **It never converts silently.**
 * - `moveContent` is **the explicit move** (`scripts/encrypt-data.ts`): seals what is plain, or opens what is sealed, in short batches, each row by a
 *   conditional update that holds only while the row is as it was read, so that it can be stopped and run again, and run beside a server.
 * - `rotateContent` re-wraps what is sealed under the previous key under the current one at start-up, as credentials are (`store.ts`), the payload untouched.
 *
 * A sealed value is `t1.<16 hex of the key>.<wrapped>.<payload>`; "sealed" here is the form of the first two parts, which a plain value of a person's cannot
 * be taken for in practice. The empty text and `NULL` are not sealed (`content.ts`).
 */
const SEALED = 't1.________________.%';
const BATCH = 200;

const column = (name: string): SQL => sql.raw(`"${name}"`);

/** Every place content is kept: a workspace column, or a Desk table's `fields`. */
type Place =
  { kind: 'column'; table: ContentTable; column: string } | { kind: 'desk'; table: SyncTable };

const places = (): Place[] => [
  ...(Object.entries(CONTENT_COLUMNS) as [ContentTable, readonly string[]][]).flatMap(
    ([table, columns]) => columns.map((each): Place => ({ kind: 'column', table, column: each })),
  ),
  ...TABLES.map((table): Place => ({ kind: 'desk', table })),
];

const label = (place: Place) =>
  place.kind === 'column' ? `${place.table}.${place.column}` : place.table;

const targetOf = (database: Database, place: Place) =>
  place.kind === 'column'
    ? (contentTableOf(database, place.table) as never)
    : tableOf(database, place.table);

/** The statement's conditions for a row that holds content in the form asked for. */
function condition(
  place: Place,
  form: 'plain' | 'sealed' | 'sealed-by',
  fingerprint?: string,
): SQL {
  if (place.kind === 'column') {
    const col = column(place.column);
    const present = sql`${col} IS NOT NULL AND ${col} <> ''`;
    if (form === 'sealed') return sql`${col} LIKE ${SEALED}`;
    if (form === 'sealed-by') return sql`${col} LIKE ${`t1.${fingerprint}.%`}`;
    return sql`(${present}) AND ${col} NOT LIKE ${SEALED}`;
  }
  // A Desk row's fields are JSON: a sealed field is `"o":"t1.…`, a plain one `"v":` (a plain value's own quotes are escaped in the JSON, so it cannot match).
  if (form === 'sealed') return sql`fields LIKE ${'%"o":"t1.________________.%'}`;
  if (form === 'sealed-by') return sql`fields LIKE ${`%"o":"t1.${fingerprint}.%`}`;
  return sql`fields LIKE ${'%"v":%'}`;
}

async function count(database: Database, place: Place, where: SQL): Promise<number> {
  const row = await dbGet<{ n: number | string }>(
    database,
    sql`SELECT COUNT(*) AS n FROM ${targetOf(database, place)} WHERE ${where}`,
  );
  return Number(row?.n ?? 0);
}

export interface OperatorState {
  /** Places with content that is not sealed, with how many rows: what the mode on cannot start with. */
  readonly plain: Map<string, number>;
  /** Places with content that is sealed. */
  readonly sealed: Map<string, number>;
  /** Places with content sealed under a key that is not in the ring, and the fingerprints. */
  readonly unknownKey: Map<string, number>;
  /** Accounts whose Desk has a key of their own, or is moving to one. */
  readonly personalAccounts: number;
}

/** Looks at everything, and changes nothing. */
export async function inspectOperatorState(
  database: Database,
  ring: KeyRing | undefined,
): Promise<OperatorState> {
  const plain = new Map<string, number>();
  const sealed = new Map<string, number>();
  const unknownKey = new Map<string, number>();
  for (const place of places()) {
    const p = await count(database, place, condition(place, 'plain'));
    if (p > 0) plain.set(label(place), p);
    const s = await count(database, place, condition(place, 'sealed'));
    if (s > 0) {
      sealed.set(label(place), s);
      let known = 0;
      for (const entry of [ring?.current, ring?.previous])
        if (entry)
          known += await count(database, place, condition(place, 'sealed-by', entry.fingerprint));
      // A row may hold values under both keys; a row counted twice only makes `known` larger, so a shortfall is a row under neither.
      if (known < s) unknownKey.set(label(place), s - known);
    }
  }
  const settings =
    database.dialect === 'postgres' ? postgresSchema.accountSettings : sqliteSchema.accountSettings;
  const personal = await dbGet<{ n: number | string }>(
    database,
    sql`SELECT COUNT(*) AS n FROM ${settings} WHERE encryption <> 'none'`,
  );
  return { plain, sealed, unknownKey, personalAccounts: Number(personal?.n ?? 0) };
}

const list = (map: Map<string, number>) =>
  [...map].map(([place, n]) => `${place} (${n})`).join(', ');

/** The start-up refusal. Resolves when what is stored agrees with the mode and the keys; otherwise says what is wrong, naming where. */
export async function assertOperatorState(
  database: Database,
  mode: { operator: boolean; ring: KeyRing | undefined },
): Promise<void> {
  const state = await inspectOperatorState(database, mode.ring);
  const problems: string[] = [];
  if (mode.operator) {
    if (state.personalAccounts > 0)
      problems.push(
        `${state.personalAccounts} account(s) have a key of their own, and the operator key and personal keys are not used together (DESIGN.md §9.5): turn TUSK_DB_ENCRYPTION off, or have those accounts leave the instance`,
      );
    if (state.plain.size > 0)
      problems.push(
        `TUSK_DB_ENCRYPTION=on, and content is stored in plain in ${list(state.plain)}. Nothing is converted silently: stop the server and run "node tools/encrypt-data.mjs seal" (or "pnpm encrypt-data seal"), which moves it, then start it again`,
      );
  } else if (state.sealed.size > 0) {
    problems.push(
      `TUSK_DB_ENCRYPTION is off, and content is sealed in ${list(state.sealed)}. Turn it on with the key that sealed it, or stop the server and run "node tools/encrypt-data.mjs open" with the mode on to move it back, then start it with the mode off`,
    );
  }
  if (state.unknownKey.size > 0)
    problems.push(
      `content is sealed under a key this server was not given, in ${list(state.unknownKey)}. Give TUSK_ENCRYPTION_KEY (and TUSK_ENCRYPTION_KEY_PREVIOUS while moving to a new one) the key that sealed it`,
    );
  if (problems.length > 0) throw new Error(problems.join('. Also: '));
}

export interface Moved {
  readonly place: string;
  readonly rows: number;
}

/**
 * Seals what is plain (`seal`), or opens what is sealed (`open`), everywhere, and returns how many rows each place had moved. A row is moved by an update that
 * holds only while it is still as it was read, so a run that is stopped leaves nothing half-moved and the next one finishes, and a value changed by a person in
 * the meantime is simply read again on the next batch.
 */
export async function moveContent(
  database: Database,
  ring: KeyRing,
  direction: 'seal' | 'open',
  log: (line: string) => void = () => undefined,
): Promise<Moved[]> {
  const settings = await inspectOperatorState(database, ring);
  if (direction === 'seal' && settings.personalAccounts > 0)
    throw new Error(
      'accounts with a key of their own are on this instance, and the operator key does not cover them: nothing was moved',
    );
  const moved: Moved[] = [];
  for (const place of places()) {
    let rows = 0;
    for (;;) {
      const done =
        place.kind === 'column'
          ? await moveColumnBatch(database, ring, place, direction)
          : await moveDeskBatch(database, ring, place, direction);
      rows += done;
      if (done === 0) break;
    }
    if (rows > 0) {
      log(`${direction === 'seal' ? 'sealed' : 'opened'} ${rows} row(s) of ${label(place)}`);
      moved.push({ place: label(place), rows });
    }
  }
  return moved;
}

async function moveColumnBatch(
  database: Database,
  ring: KeyRing,
  place: Extract<Place, { kind: 'column' }>,
  direction: 'seal' | 'open',
): Promise<number> {
  const target = targetOf(database, place);
  const col = column(place.column);
  const rows = await dbAll<{ id: string; value: string }>(
    database,
    sql`SELECT id, ${col} AS value FROM ${target}
        WHERE ${condition(place, direction === 'seal' ? 'plain' : 'sealed')} ORDER BY id LIMIT ${BATCH}`,
  );
  let done = 0;
  await transaction(database, async (tx) => {
    for (const row of rows) {
      const next =
        direction === 'seal'
          ? sealColumn(ring, place.table, row.id, place.column, row.value)
          : openColumn(ring, place.table, row.id, place.column, row.value);
      const changed = await dbAll<{ id: string }>(
        tx,
        sql`UPDATE ${target} SET ${col} = ${next} WHERE id = ${row.id} AND ${col} = ${row.value} RETURNING id`,
      );
      done += changed.length;
    }
  });
  // A batch whose rows were all changed under it moved nothing, which is not the end: only an empty read is.
  return rows.length === 0 ? 0 : Math.max(done, 1);
}

async function moveDeskBatch(
  database: Database,
  ring: KeyRing,
  place: Extract<Place, { kind: 'desk' }>,
  direction: 'seal' | 'open',
): Promise<number> {
  const target = targetOf(database, place);
  const rows = await dbAll<{ id: string; fields: string }>(
    database,
    sql`SELECT id, fields FROM ${target} WHERE ${condition(place, direction === 'seal' ? 'plain' : 'sealed')} ORDER BY id LIMIT ${BATCH}`,
  );
  let done = 0;
  await transaction(database, async (tx) => {
    for (const row of rows) {
      const decoded = decodeFields(row.fields);
      if (!decoded.ok) throw new Error(`a row of ${place.table} has fields that cannot be read`);
      const next: RowFields =
        direction === 'seal'
          ? sealStored(ring, place.table, row.id, decoded.value)
          : openStored(ring, place.table, row.id, decoded.value);
      const changed = await dbAll<{ id: string }>(
        tx,
        sql`UPDATE ${target} SET fields = ${encodeFields(next)} WHERE id = ${row.id} AND fields = ${row.fields} RETURNING id`,
      );
      done += changed.length;
    }
  });
  return rows.length === 0 ? 0 : Math.max(done, 1);
}

/**
 * Rotation at start-up: every value sealed under the previous key is wrapped again under the current one, the payload untouched. It may run from every replica
 * at once, and twice over, as credentials' does: a row is moved by a conditional update that holds only while it is as it was read.
 */
export async function rotateContent(
  database: Database,
  ring: KeyRing,
  log: (line: string) => void = () => undefined,
): Promise<number> {
  const previous = ring.previous;
  if (!previous) return 0;
  let total = 0;
  for (const place of places()) {
    const target = targetOf(database, place);
    for (;;) {
      let moved = 0;
      if (place.kind === 'column') {
        const col = column(place.column);
        const rows = await dbAll<{ id: string; value: string }>(
          database,
          sql`SELECT id, ${col} AS value FROM ${target} WHERE ${condition(place, 'sealed-by', previous.fingerprint)} ORDER BY id LIMIT ${BATCH}`,
        );
        if (rows.length === 0) break;
        await transaction(database, async (tx) => {
          for (const row of rows) {
            const next = rewrapColumn(ring, place.table, row.id, place.column, row.value);
            const changed = await dbAll<{ id: string }>(
              tx,
              sql`UPDATE ${target} SET ${col} = ${next} WHERE id = ${row.id} AND ${col} = ${row.value} RETURNING id`,
            );
            moved += changed.length;
          }
        });
      } else {
        const rows = await dbAll<{ id: string; fields: string }>(
          database,
          sql`SELECT id, fields FROM ${target} WHERE ${condition(place, 'sealed-by', previous.fingerprint)} ORDER BY id LIMIT ${BATCH}`,
        );
        if (rows.length === 0) break;
        await transaction(database, async (tx) => {
          for (const row of rows) {
            const decoded = decodeFields(row.fields);
            if (!decoded.ok) continue;
            const next = rewrapDeskFields(ring, place.table, row.id, decoded.value);
            const changed = await dbAll<{ id: string }>(
              tx,
              sql`UPDATE ${target} SET fields = ${encodeFields(next)} WHERE id = ${row.id} AND fields = ${row.fields} RETURNING id`,
            );
            moved += changed.length;
          }
        });
      }
      total += moved;
      // Rows another replica moved first are no longer found by the next read; if nothing here moved, nothing is left to find.
      if (moved === 0) break;
    }
  }
  if (total > 0)
    log(
      `moved ${total} row(s) of content from key ${previous.fingerprint} to ${ring.current.fingerprint}`,
    );
  return total;
}
