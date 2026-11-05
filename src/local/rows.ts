import type { Change, PulledRow } from '../sync/format';

/**
 * A row as the browser holds it: the same shape the server sends (`PulledRow`), because that is what a pull brings and a query reads. Two pure
 * functions say how it changes, and neither touches IndexedDB, so they are tested with none and could run anywhere.
 *
 * `seq` and each field's `s` are **the server's**: the seq of the last mutation the server applied that wrote the row, or the field. A field a
 * device has written and the server has not yet answered keeps the `s` it had, and is protected by the outbox and not by a number (`store.ts`).
 */
export type LocalRow = PulledRow;

const STRUCTURE_KEYS = ['listId', 'parentId', 'position'] as const;

/**
 * What a change does to a row, as the device shows it before the server has answered: the same rules the server applies (`apply.ts`), so that
 * what a person sees is what they will be sent back. A new row is made if there is none; fields are laid over a field at a time; an edit of a
 * deleted row restores it; deleting one that is deleted keeps the first time. The server's time and order are not known yet: a new row has `seq`
 * zero, and a deletion is stamped with the device's clock until the server's answer replaces it.
 */
export function applyChange(row: LocalRow | undefined, change: Change, now: number): LocalRow {
  const structure: Record<string, unknown> = {};
  for (const key of STRUCTURE_KEYS) {
    if (Object.hasOwn(change, key))
      structure[key] = (change as unknown as Record<string, unknown>)[key];
  }

  const base: LocalRow =
    row ??
    ({
      table: change.table,
      id: change.id,
      deletedAt: null,
      seq: 0,
      createdAt: now,
      fields: {},
      ...(change.table === 'task' ? { parentId: null } : {}),
    } as LocalRow);

  const fields = { ...base.fields };
  for (const [name, value] of Object.entries(change.fields ?? {})) {
    fields[name] = { ...value, s: base.fields[name]?.s ?? 0 };
  }

  return {
    ...base,
    ...structure,
    deletedAt: change.deleted === true ? (base.deletedAt ?? now) : null,
    fields,
  } as LocalRow;
}

/**
 * What a row the server sent does to the row a device has (DESIGN.md §8.4): **per field, the higher `seq` wins**, so that a field the server has
 * newer news of is replaced and one it has not is kept, and the structure, the deletion and the order follow the row that was written last. A
 * row the device does not have is the server's as it is.
 */
export function mergePulled(base: LocalRow | undefined, pulled: PulledRow): LocalRow {
  if (!base) return pulled;
  const newer = pulled.seq >= base.seq;
  const fields = { ...base.fields };
  for (const [name, value] of Object.entries(pulled.fields)) {
    const have = fields[name];
    if (!have || value.s > have.s) fields[name] = value;
  }
  const winner = newer ? pulled : base;
  return { ...winner, fields } as LocalRow;
}

/** Whether one row sorts before another in a list: by position, compared by bytes and never by locale, and equal positions by id (DESIGN.md §11.3). */
export function byPosition(
  a: { position: string; id: string },
  b: { position: string; id: string },
): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
