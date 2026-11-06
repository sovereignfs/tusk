import type { LocalRow } from '../local/rows';
import type { Change } from '../sync/format';
import { TUSK_NAMESPACE, uuid5 } from '../uuid5';
import { isCompleted, moveToList, reopenCard } from './cards';
import { dueOf } from './due';
import type { ActionResult, Ids } from './lists';
import { readSeries, seriesIdOf } from './series';

/**
 * The rest of an occurrence's life (DESIGN.md §12.5): reopening it, and moving it. **Nothing is lost** by either. Deleting needs nothing of its own: a
 * deleted card still names its series, so Undo brings it back repeating, and the purge removes a series that no card names (`src/sync/purge.ts`).
 */

/** An occurrence with the items of its checklist, as the working copy has them: what `occurrencesOf` reads. */
export interface Occurrence {
  readonly card: LocalRow;
  readonly items: readonly LocalRow[];
}

const norm = (row: LocalRow, name: string): string => {
  const field = row.fields[name];
  if (field === undefined) return '';
  if ('c' in field) return `c:${field.c}`;
  const value = field.v;
  return value === null || value === '' || value === false ? '' : `v:${JSON.stringify(value)}`;
};

const live = (rows: readonly LocalRow[]) => rows.filter((row) => row.deletedAt === null);

const completionOf = (row: LocalRow): number | undefined => {
  const field = row.fields.completedAt;
  return field !== undefined && 'v' in field && typeof field.v === 'number' ? field.v : undefined;
};

/**
 * Whether the occurrence made after `done` is as completing `done` made it: **nothing written to it since.** Worked out from what it is, since a
 * device cannot tell its own pending edit from the copy it made (a field's stamp is the server's). It is untouched if it has the id its own date
 * gives it (a date moved is a touch), is not started or done, is in the same list at the same place, carries the same title, description, star and
 * time, and has exactly the items completing made for it, unticked, with their titles and places.
 */
export function isUntouched(done: Occurrence, next: Occurrence, seriesId: string): boolean {
  const date = dueOf(next.card).date;
  if (date === null) return false;
  if (next.card.id !== uuid5(`occurrence:${seriesId}:${date}`, TUSK_NAMESPACE)) return false;
  if (next.card.table !== 'desk_card' || done.card.table !== 'desk_card') return false;
  if (norm(next.card, 'startedAt') !== '' || norm(next.card, 'completedAt') !== '') return false;
  if (next.card.listId !== done.card.listId || next.card.position !== done.card.position)
    return false;
  for (const name of ['title', 'description', 'starred'])
    if (norm(next.card, name) !== norm(done.card, name)) return false;
  if (dueOf(next.card).time !== dueOf(done.card).time) return false;

  const mine = live(done.items);
  const theirs = live(next.items);
  if (mine.length !== theirs.length) return false;
  for (const item of mine) {
    const copy = theirs.find(
      (each) => each.id === uuid5(`item:${next.card.id}:${item.id}`, TUSK_NAMESPACE),
    );
    if (!copy || copy.table !== 'desk_check' || item.table !== 'desk_check') return false;
    if (norm(copy, 'title') !== norm(item, 'title')) return false;
    if (copy.position !== item.position || isCompleted(copy)) return false;
  }
  return true;
}

/**
 * Reopens a completed occurrence in one mutation (§12.5). For a card that does not repeat it is `reopenCard`. For one that does, `others` are the other
 * live occurrences of its series with their items:
 *
 *  - none, or only the next occurrence **untouched** (`isUntouched`): the next is deleted with its items, the card reopened and the items the tick ticked
 *    unticked, so that **Undo after a tick leaves things as they were**;
 *  - otherwise (the next has been changed, or there is more than one): the reopened card **leaves the series** and becomes a one-off, and nothing is lost.
 */
export function reopenOccurrence(
  card: LocalRow | undefined,
  series: LocalRow | undefined,
  items: readonly LocalRow[],
  others: readonly Occurrence[],
  ids: Ids,
): ActionResult {
  const reopened = reopenCard(card, ids);
  if (!reopened.ok || !card) return reopened;
  const read = readSeries(series);
  if (!read || seriesIdOf(card) !== read.id) return reopened;

  const open = others.filter(
    (other) =>
      other.card.id !== card.id &&
      other.card.deletedAt === null &&
      !isCompleted(other.card) &&
      seriesIdOf(other.card) === read.id,
  );
  const changes: Change[] = [...reopened.mutation.changes];
  const next = open[0];
  if (open.length === 0) return reopened;
  if (open.length === 1 && next && isUntouched({ card, items }, next, read.id)) {
    changes.push({ table: 'desk_card', id: next.card.id, deleted: true });
    for (const item of live(next.items))
      changes.push({ table: 'desk_check', id: item.id, deleted: true });
    // This is the undo of a tick, so what the tick ticked is unticked: the items done at the very time the card was, which an item ticked earlier was not.
    const completedAt = completionOf(card);
    for (const item of live(items))
      if (completedAt !== undefined && completionOf(item) === completedAt)
        changes.push({ table: 'desk_check', id: item.id, fields: { completedAt: { v: null } } });
  } else {
    changes.push({ table: 'desk_card', id: card.id, fields: { seriesId: { v: null } } });
  }
  return { ok: true, mutation: { mutationId: reopened.mutation.mutationId, changes } };
}

/**
 * Moves an occurrence to another list, and **the series with it** (§12.5), in one mutation: the next occurrence is made in the series' list, so a series
 * left behind would put it back. A completed occurrence is history and moves alone.
 */
export function moveOccurrence(
  card: LocalRow | undefined,
  series: LocalRow | undefined,
  toListId: string,
  destination: readonly LocalRow[],
  ids: Ids,
): ActionResult {
  const moved = moveToList(card, toListId, destination, ids);
  if (!moved.ok || !card) return moved;
  const read = readSeries(series);
  if (!read || seriesIdOf(card) !== read.id || isCompleted(card)) return moved;
  return {
    ok: true,
    mutation: {
      mutationId: moved.mutation.mutationId,
      changes: [...moved.mutation.changes, { table: 'desk_series', id: read.id, listId: toListId }],
    },
  };
}
