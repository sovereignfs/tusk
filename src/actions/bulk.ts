import type { LocalRow } from '../local/rows';
import { before, first } from '../position';
import type { Change } from '../sync/format';
import { completeCard, chunked, isCompleted, type ManyResult } from './cards';
import type { Ids } from './lists';
import { readSeries, seriesIdOf } from './series';

/**
 * Acting on several cards at once (DESIGN.md §10.6): each is **one mutation, in chunks if it is large,** and **no chunk splits a card from what goes with it**
 * (its checklist, the next occurrence it makes, the series it moves). A card that the action does not apply to (one already done, one already in the
 * list) is left out, and nothing at all is `nothing`. Deleting several is `deleteMany` in `cards.ts`, with `restoreMany` as its one Undo. Pure.
 */

/** A card with what completing or moving it needs to know. */
export interface Selected {
  readonly card: LocalRow;
  /** Its live checklist items. */
  readonly items: readonly LocalRow[];
  /** Its series, when it repeats. */
  readonly series: LocalRow | undefined;
}

/**
 * Completes the cards, each as `completeCard` does one: its open items ticked at the same time, and **a card that repeats makes its next occurrence**,
 * in the same mutation as its completion. A card that is done already is left alone, so ticking twice does not make a second next.
 */
export function completeMany(
  selected: readonly Selected[],
  now: number,
  today: string,
  ids: Ids,
): ManyResult {
  const groups: Change[][] = [];
  for (const { card, items, series } of selected) {
    const result = completeCard(card, now, ids, items, { series, today });
    if (result.ok) groups.push([...result.mutation.changes]);
  }
  return chunked(ids, groups);
}

/**
 * Moves the cards to the top of another list, **keeping the order they have** among themselves, a card that repeats taking its series with it
 * (`moveOccurrence` for one). `destination` is the other list's cards as shown; `selected` is in the order they are shown. A card already in the list is
 * left where it is; a done card moves alone.
 */
export function moveMany(
  selected: readonly Selected[],
  toListId: string,
  destination: readonly LocalRow[],
  ids: Ids,
): ManyResult {
  const moving = selected.filter(
    ({ card }) => card.table === 'desk_card' && card.listId !== toListId,
  );
  // The keys run down from the first card shown in the other list, so the first of those moved is the topmost.
  const top = destination[0];
  let key: string | undefined = top && 'position' in top ? top.position : undefined;
  const keys: string[] = [];
  for (let i = moving.length - 1; i >= 0; i--) {
    key = key === undefined ? first() : before(key);
    keys[i] = key;
  }
  const groups: Change[][] = moving.map(({ card, series }, i) => {
    const group: Change[] = [
      { table: 'desk_card', id: card.id, listId: toListId, position: keys[i] ?? first() },
    ];
    const read = readSeries(series);
    if (read && seriesIdOf(card) === read.id && !isCompleted(card))
      group.push({ table: 'desk_series', id: read.id, listId: toListId });
    return group;
  });
  return chunked(ids, groups);
}
