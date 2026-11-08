import { fingerprintOfSealed, open, rewrap, seal } from './envelope';
import type { RowField, RowFields } from '../sync/format';
import type { KeyRing } from './keys';

/**
 * The operator key's sealing of content (DESIGN.md §9.5, task 14.7). With `TUSK_DB_ENCRYPTION=on` the server seals each content value with the instance key
 * before it is stored and opens it on the way out, so that a dump of the database holds none of it. **It is the same envelope as a credential's**
 * (`envelope.ts`), bound to the row and the field, so that a sealed value moved to another row or field does not open.
 *
 * On the Desk a stored field is `{ o, s }`: `o` the sealed value (JSON of the scalar) and `s` the `seq` that wrote it, as `{ v, s }` and `{ c, s }` are. A device
 * is never sent `o`: pull opens it, so a client, a backup and a file see what they do on an instance without the operator key.
 *
 * A function here that is given no ring does nothing, so that every caller is the same code with the mode on or off.
 */
export type Operator = KeyRing | undefined;

/** The ring the server seals content with: the instance key, when `TUSK_DB_ENCRYPTION=on`, and nothing otherwise. */
export const operatorOf = (config: {
  readonly operatorEncryption: boolean;
  readonly encryption: KeyRing | undefined;
}): Operator => (config.operatorEncryption ? config.encryption : undefined);

/** What a Desk field is sealed to: its table and row, and its name. */
const deskBinding = (table: string, rowId: string, field: string) => ({
  id: `${table}:${rowId}`,
  purpose: `desk:${field}`,
});

/** What a workspace content column is sealed to: its table and row, and its column. */
const columnBinding = (table: string, rowId: string, column: string) => ({
  id: `${table}:${rowId}`,
  purpose: `col:${column}`,
});

/** A plain scalar of the Desk, sealed to its field. */
export function sealDeskField(
  ring: KeyRing,
  table: string,
  rowId: string,
  field: string,
  value: string | number | boolean | null,
): string {
  return seal(JSON.stringify(value), deskBinding(table, rowId, field), ring.current);
}

/** A Desk field opened. Throws a `CryptoError` for one that is not this field's or whose key this server does not have: never a wrong value. */
export function openDeskField(
  ring: KeyRing,
  table: string,
  rowId: string,
  field: string,
  sealed: string,
): string | number | boolean | null {
  return JSON.parse(open(sealed, deskBinding(table, rowId, field), ring)) as
    string | number | boolean | null;
}

/** A workspace content column's text, sealed to its row and column. `null` and the empty text are kept readable by the caller: they hold nothing. */
export function sealColumn(
  ring: KeyRing,
  table: string,
  rowId: string,
  column: string,
  text: string,
) {
  return seal(text, columnBinding(table, rowId, column), ring.current);
}

export function openColumn(
  ring: KeyRing,
  table: string,
  rowId: string,
  column: string,
  sealed: string,
): string {
  return open(sealed, columnBinding(table, rowId, column), ring);
}

/** A sealed workspace column moved from the previous key to the current one, the payload untouched. */
export function rewrapColumn(
  ring: KeyRing,
  table: string,
  rowId: string,
  column: string,
  sealed: string,
): string {
  if (!ring.previous) return sealed;
  return rewrap(sealed, columnBinding(table, rowId, column), ring.previous, ring.current);
}

/** The sealed fields of a Desk row moved from the previous key to the current one; a field sealed under another key, or not sealed, is left as it is. */
export function rewrapDeskFields(
  ring: KeyRing,
  table: string,
  rowId: string,
  fields: RowFields,
): RowFields {
  const out: Record<string, RowField> = {};
  for (const [name, field] of Object.entries(fields)) {
    out[name] =
      'o' in field && ring.previous && fingerprintOfSealed(field.o) === ring.previous.fingerprint
        ? {
            o: rewrap(field.o, deskBinding(table, rowId, name), ring.previous, ring.current),
            s: field.s,
          }
        : field;
  }
  return out;
}
