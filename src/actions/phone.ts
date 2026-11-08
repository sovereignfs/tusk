import type { LocalRow } from '../local/rows';
import type { Mutation } from '../sync/format';
import { deleteCard } from './cards';
import { type ActionResult, type Ids } from './lists';
import { nextOccurrenceChanges, seriesIdOf } from './series';

/**
 * What the phone's swipe views do to a card (DESIGN.md §25.3). Each is a mutation of the card and nothing else but what is said: **Dismiss** only sets the day
 * Today leaves it out until (`dismissedOn`), **Review** only sets when it was last gone past (`reviewedAt`), and neither touches its due date, its star or its list.
 */
const mutationOf = (ids: Ids, changes: Mutation['changes']): ActionResult => ({
  ok: true,
  mutation: { mutationId: ids.newId(), changes },
});

const plainOf = (row: LocalRow, name: string) => {
  const field = row.fields[name];
  return field !== undefined && 'v' in field ? field.v : undefined;
};

/** Today leaves the card out for `today`; tomorrow it is back. */
export function dismissCard(card: LocalRow | undefined, today: string, ids: Ids): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  if (plainOf(card, 'dismissedOn') === today) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [
    { table: 'desk_card', id: card.id, fields: { dismissedOn: { v: today } } },
  ]);
}

/** Undo of `dismissCard`: back to what it was, which is the day it had before, or none. */
export function restoreDismissal(
  card: LocalRow | undefined,
  before: string | null,
  ids: Ids,
): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  return mutationOf(ids, [
    { table: 'desk_card', id: card.id, fields: { dismissedOn: { v: before } } },
  ]);
}

/** Review has gone past the card at `now`. */
export function markReviewed(card: LocalRow | undefined, now: number, ids: Ids): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  return mutationOf(ids, [{ table: 'desk_card', id: card.id, fields: { reviewedAt: { v: now } } }]);
}

/** The result of cancelling: the mutation, and the id of the next occurrence it made when the card repeats, which its Undo takes away again. */
export type Cancelled =
  { ok: true; mutation: Mutation; made?: string } | { ok: false; reason: 'missing' | 'nothing' };

/**
 * **Cancel** (Down): deletes the card, in one mutation with its checklist (it can be undone, `restoreCard`). **On a card that repeats it skips this occurrence**:
 * the next one is made in the same mutation, as completing would, and the mutation names it so that Undo can remove it again if nobody has touched it.
 */
export function cancelCard(
  card: LocalRow | undefined,
  items: readonly LocalRow[],
  repeat: { series: LocalRow | undefined; today: string },
  ids: Ids,
): Cancelled {
  const deleted = deleteCard(card, ids, items);
  if (!deleted.ok)
    return { ok: false, reason: deleted.reason === 'nothing' ? 'nothing' : 'missing' };
  if (!card || !seriesIdOf(card)) return { ok: true, mutation: deleted.mutation };
  const next = nextOccurrenceChanges(card, items, repeat.series, repeat.today);
  const made = next.find((change) => change.table === 'desk_card')?.id;
  return {
    ok: true,
    mutation: { ...deleted.mutation, changes: [...deleted.mutation.changes, ...next] },
    ...(made ? { made } : {}),
  };
}
