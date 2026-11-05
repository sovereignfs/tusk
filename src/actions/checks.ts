import { text as textParser } from '../access/parse';
import type { LocalRow } from '../local/rows';
import { after, first } from '../position';
import { LIMITS, type Mutation } from '../sync/format';
import { isCompleted } from './cards';
import type { ActionResult, Ids } from './lists';
import { neighboursAfterMove, positionBetween } from './order';

/**
 * What a person does to a card's checklist (DESIGN.md §10.3), as pure functions like the cards' (`cards.ts`). An item is a title and a tick, in an
 * order of its own: it has no date, star or repeat, and no list, since it is where its card is. Ticking one, the last one included, completes nothing
 * else: finishing the parts is often not finishing the thing. Completing and deleting a card take its items with them, and that is `cards.ts`'s.
 *
 * `items` is the card's checklist **as it is rendered**: live, in order.
 */
const TITLE = textParser(1, LIMITS.titleChars);

const mutationOf = (ids: Ids, changes: Mutation['changes']): ActionResult => ({
  ok: true,
  mutation: { mutationId: ids.newId(), changes },
});

/**
 * An item of `card`, at the bottom of its checklist (a checklist grows downward; it is a new *card* that goes to the top). Refused unless the card is
 * still there. `allCount` is every item row of the account, which counts against the limit.
 */
export function addItem(
  card: LocalRow | undefined,
  items: readonly LocalRow[],
  input: { title: string },
  ids: Ids,
  allCount = 0,
  /** The position of the item made last, for the next to go below while the screen is still catching up with it. */
  below?: string,
): ActionResult {
  if (!card || card.table !== 'desk_card' || card.deletedAt !== null)
    return { ok: false, reason: 'missing' };
  const title = input.title.trim();
  if (!TITLE(title).ok) return { ok: false, reason: 'title' };
  if (allCount >= LIMITS.checksPerAccount) return { ok: false, reason: 'limit' };
  const last = items.at(-1);
  const shown = last && 'position' in last ? last.position : undefined;
  const bottom =
    shown !== undefined && below !== undefined ? (shown > below ? shown : below) : (shown ?? below);
  return mutationOf(ids, [
    {
      table: 'desk_check',
      id: ids.newId(),
      cardId: card.id,
      position: bottom !== undefined ? after(bottom) : first(),
      fields: { title: { v: title } },
    },
  ]);
}

/** Renames an item. Only a title that differs is sent. */
export function renameItem(item: LocalRow | undefined, title: string, ids: Ids): ActionResult {
  if (!item || item.table !== 'desk_check') return { ok: false, reason: 'missing' };
  const trimmed = title.trim();
  if (!TITLE(trimmed).ok) return { ok: false, reason: 'title' };
  const current = item.fields.title;
  if (current && 'v' in current && current.v === trimmed) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [{ table: 'desk_check', id: item.id, fields: { title: { v: trimmed } } }]);
}

/** Ticks an item at `now`. One that is done already is left alone, with the time it was done at. */
export function tickItem(item: LocalRow | undefined, now: number, ids: Ids): ActionResult {
  if (!item || item.table !== 'desk_check') return { ok: false, reason: 'missing' };
  if (isCompleted(item)) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [
    { table: 'desk_check', id: item.id, fields: { completedAt: { v: now } } },
  ]);
}

/** Un-ticks an item. One that is not done is left alone. */
export function untickItem(item: LocalRow | undefined, ids: Ids): ActionResult {
  if (!item || item.table !== 'desk_check') return { ok: false, reason: 'missing' };
  if (!isCompleted(item)) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [
    { table: 'desk_check', id: item.id, fields: { completedAt: { v: null } } },
  ]);
}

/** Moves an item to `toIndex` among `rendered`, as `moveCard` does a card: one change to one row (DESIGN.md §10.4). */
export function moveItem(
  rendered: readonly LocalRow[],
  id: string,
  toIndex: number,
  ids: Ids,
): ActionResult {
  if (!rendered.some((row) => row.id === id)) return { ok: false, reason: 'missing' };
  const neighbours = neighboursAfterMove(rendered, id, toIndex);
  if (!neighbours) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [{ table: 'desk_check', id, position: positionBetween(neighbours) }]);
}

/** Deletes an item, which can be undone with `restoreItem` (DESIGN.md §10.6). */
export function deleteItem(item: LocalRow | undefined, ids: Ids): ActionResult {
  if (!item || item.table !== 'desk_check') return { ok: false, reason: 'missing' };
  return mutationOf(ids, [{ table: 'desk_check', id: item.id, deleted: true }]);
}

/** Undo of `deleteItem`. */
export function restoreItem(item: LocalRow | undefined, ids: Ids): ActionResult {
  if (!item || item.table !== 'desk_check') return { ok: false, reason: 'missing' };
  return mutationOf(ids, [{ table: 'desk_check', id: item.id, deleted: false }]);
}
