import { type Operator, openDeskField, sealDeskField } from '../crypto/operator';
import type { RowField, RowFields, StoredFields, SyncTable } from './format';

/**
 * A Desk row's fields under the operator key (DESIGN.md §9.5, task 14.7). `sealStored` turns each plain `{ v }` into `{ o }`, sealed to the table, the row
 * and the field; `openStored` turns each `{ o }` back into `{ v }`, the form a device, a backup and a file are given. Ciphertext `{ c }` is a personal key's
 * and is left as it is. With no operator ring, `sealStored` returns what it was given, and `openStored` does too **unless a field is sealed, which it will
 * not hand on as if it were readable**: start-up refuses a database with sealed fields and the mode off (task 14.7), so that is a bug, and it stops.
 */
export function sealStored(
  ring: Operator,
  table: SyncTable,
  id: string,
  fields: RowFields,
): RowFields {
  if (!ring) return fields;
  const out: Record<string, RowField> = {};
  for (const [name, field] of Object.entries(fields)) {
    out[name] =
      'v' in field ? { o: sealDeskField(ring, table, id, name, field.v), s: field.s } : field;
  }
  return out;
}

export function openStored(
  ring: Operator,
  table: SyncTable,
  id: string,
  fields: RowFields,
): StoredFields {
  const out: Record<string, StoredFields[string]> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (!('o' in field)) {
      out[name] = field;
    } else if (ring) {
      out[name] = { v: openDeskField(ring, table, id, name, field.o), s: field.s };
    } else {
      throw new Error('a field is sealed under the operator key, and the server has none');
    }
  }
  return out;
}
