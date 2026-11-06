import { text as textParser } from '../access/parse';
import type { LocalRow } from '../local/rows';
import { before, first } from '../position';
import { LIMITS, type Mutation } from '../sync/format';
import type { ActionResult, Ids } from './lists';
import { neighboursAfterMove, positionBetween } from './order';

/**
 * What a person does to a card (DESIGN.md §10.2), as pure functions in the same way as the lists' (`lists.ts`): given what is on the screen and what was
 * asked, each returns the mutation, or why there is none. `now` is a parameter, so that a completion time is not read from a clock in here. What a person
 * does to a card's checklist is `checks.ts`.
 *
 * `cards` is the list's cards **as they are rendered**: live, in order. A new card goes at the top, before whatever is first on the screen.
 */
const TITLE = textParser(1, LIMITS.titleChars);
const DESCRIPTION = textParser(0, LIMITS.descriptionChars);

const mutationOf = (ids: Ids, changes: Mutation['changes']): ActionResult => ({
  ok: true,
  mutation: { mutationId: ids.newId(), changes },
});

const plainOf = (row: LocalRow, name: string) => {
  const field = row.fields[name];
  return field !== undefined && 'v' in field ? field.v : undefined;
};

/** Whether a card or a checklist item is done: it has a completion time. A completion time that is ciphertext cannot be read, and counts as not done until the keys are in place. */
export function isCompleted(row: LocalRow): boolean {
  const done = plainOf(row, 'completedAt');
  return typeof done === 'number';
}

export type Status = 'open' | 'in_progress' | 'done';

/**
 * A card's status (DESIGN.md §10.2), worked out from two times: **Done** if it has a completion time, whatever else it has; **In progress** if it has
 * only a start time; otherwise **Open**. Two fields and not one, so that two devices that disagree end at the same status, and so that Done is never lost
 * to an "in progress" written later on a device that had not heard (§8.4). A time that is ciphertext cannot be read, and counts as not set until the keys
 * are in place.
 */
export function statusOf(card: LocalRow): Status {
  if (typeof plainOf(card, 'completedAt') === 'number') return 'done';
  if (typeof plainOf(card, 'startedAt') === 'number') return 'in_progress';
  return 'open';
}

/** A new card at the top of its list. `allCount` is every card row of the account, which counts against the limit (a deleted one until it is removed). */
export function createCard(
  listId: string,
  cards: readonly LocalRow[],
  input: { title: string },
  ids: Ids,
  allCount = cards.length,
  /**
   * A position the new card must also sort above: the one the caller made last. A screen shows what the working copy had a moment ago, so a card added
   * in the instant after another is not yet on it, and "before the first on the screen" would put the two at one place. This is that card's position.
   */
  above?: string,
): ActionResult {
  const title = input.title.trim();
  if (!TITLE(title).ok) return { ok: false, reason: 'title' };
  if (allCount >= LIMITS.cardsPerAccount) return { ok: false, reason: 'limit' };
  const shown = cards[0] && 'position' in cards[0] ? cards[0].position : undefined;
  // The topmost of the two, by bytes.
  const top =
    shown !== undefined && above !== undefined ? (shown < above ? shown : above) : (shown ?? above);
  return mutationOf(ids, [
    {
      table: 'desk_card',
      id: ids.newId(),
      listId,
      position: top !== undefined ? before(top) : first(),
      fields: { title: { v: title } },
    },
  ]);
}

/** Changes a card's title and/or description. Only what differs is sent: a field, not a row, which is what lets two devices' edits to different fields both stand. */
export function updateCard(
  card: LocalRow | undefined,
  patch: { title?: string; description?: string },
  ids: Ids,
): ActionResult {
  if (!card) return { ok: false, reason: 'missing' };
  const fields: Record<string, { v: string }> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!TITLE(title).ok) return { ok: false, reason: 'title' };
    if (plainOf(card, 'title') !== title) fields.title = { v: title };
  }
  if (patch.description !== undefined) {
    // A description is plain text, shown as written: a trailing line break is the person's own and is kept.
    if (!DESCRIPTION(patch.description).ok) return { ok: false, reason: 'title' };
    if ((plainOf(card, 'description') ?? '') !== patch.description)
      fields.description = { v: patch.description };
  }
  if (Object.keys(fields).length === 0) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [{ table: 'desk_card', id: card.id, fields }]);
}

/**
 * Ticks a card off at `now`. **Ticking one that is done already does nothing**, so that a double tap does one thing and not two: the second finds the
 * first's completion time and leaves it (DESIGN.md §12.1).
 *
 * Completing a card is **one mutation** that also completes its **open** checklist items (`items` is the card's, as rendered): one that is done
 * already keeps the time it was done at, which the plugin overwrote (§10.3). Ticking an item, the last one included, completes nothing else:
 * finishing the parts is often not finishing the thing.
 */
export function completeCard(
  card: LocalRow | undefined,
  now: number,
  ids: Ids,
  items: readonly LocalRow[] = [],
): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  if (isCompleted(card)) return { ok: false, reason: 'nothing' };
  const changes: Mutation['changes'][number][] = [
    { table: 'desk_card', id: card.id, fields: { completedAt: { v: now } } },
  ];
  for (const item of items) {
    if (!isCompleted(item))
      changes.push({ table: 'desk_check', id: item.id, fields: { completedAt: { v: now } } });
  }
  return mutationOf(ids, changes);
}

/** Un-ticks a card. One that is not done is left alone. **Reopening a card reopens nothing else** (DESIGN.md §10.3). */
export function reopenCard(card: LocalRow | undefined, ids: Ids): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  if (!isCompleted(card)) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [
    {
      table: 'desk_card',
      id: card.id,
      // Reopening clears both times (DESIGN.md §10.2); the start time is only sent when there is one to clear.
      fields: {
        completedAt: { v: null },
        ...(statusOf(card) === 'done' && typeof plainOf(card, 'startedAt') === 'number'
          ? { startedAt: { v: null } }
          : {}),
      },
    },
  ]);
}

/**
 * Marks a card in progress at `now` (DESIGN.md §10.2). **On an open card only the start time is written**, so that a completion that another device made
 * meanwhile still stands (Done wins, §8.4). On a card that is done it is a reopening, and clears the completion time too. One already in progress is left alone.
 */
export function startCard(card: LocalRow | undefined, now: number, ids: Ids): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  const status = statusOf(card);
  if (status === 'in_progress') return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [
    {
      table: 'desk_card',
      id: card.id,
      fields: {
        startedAt: { v: now },
        ...(status === 'done' ? { completedAt: { v: null } } : {}),
      },
    },
  ]);
}

/**
 * Sets a card's status: the choice in its detail. Open reopens (both times cleared), In progress starts it, and Done completes it with its open checklist
 * items (`items`, as `completeCard` takes them). The status it already has is nothing to do.
 */
export function setStatus(
  card: LocalRow | undefined,
  status: Status,
  now: number,
  ids: Ids,
  items: readonly LocalRow[] = [],
): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  if (statusOf(card) === status) return { ok: false, reason: 'nothing' };
  if (status === 'done') return completeCard(card, now, ids, items);
  if (status === 'in_progress') return startCard(card, now, ids);
  // Open: from done it is a reopening; from in progress only the start time goes.
  if (statusOf(card) === 'done') return reopenCard(card, ids);
  return mutationOf(ids, [{ table: 'desk_card', id: card.id, fields: { startedAt: { v: null } } }]);
}

/**
 * Deletes a card, which can be undone with `restoreCard` for as long as the row is kept (DESIGN.md §10.6). **Deleting a card marks its live checklist
 * items in the same mutation**, which is stamped with one time, so that restoring it can bring back exactly those and not an item that was deleted
 * earlier. `items` is the card's, as rendered.
 */
export function deleteCard(
  card: LocalRow | undefined,
  ids: Ids,
  items: readonly LocalRow[] = [],
): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  const changes: Mutation['changes'][number][] = [
    { table: 'desk_card', id: card.id, deleted: true },
  ];
  for (const item of items)
    if (item.deletedAt === null) changes.push({ table: 'desk_check', id: item.id, deleted: true });
  return mutationOf(ids, changes);
}

/**
 * Undo of `deleteCard`. `items` is **every** item the card has, deleted ones too: those that were deleted with it, which carry the time it was
 * deleted at, come back with it, and one that was deleted before stays deleted.
 */
export function restoreCard(
  card: LocalRow | undefined,
  ids: Ids,
  items: readonly LocalRow[] = [],
): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  const changes: Mutation['changes'][number][] = [
    { table: 'desk_card', id: card.id, deleted: false },
  ];
  if (card.deletedAt !== null) {
    for (const item of items) {
      if (item.deletedAt === card.deletedAt)
        changes.push({ table: 'desk_check', id: item.id, deleted: false });
    }
  }
  return mutationOf(ids, changes);
}

/**
 * Moves a card to `toIndex` among `rendered`: the cards of the list as they are on the screen, in the order they are shown, which under a filter is
 * not all of them. **One change to one row**, between the two it ends up between, so the rows that are not shown keep the order they had, and two
 * devices that move different cards never touch the same one (DESIGN.md §10.4).
 */
export function moveCard(
  rendered: readonly LocalRow[],
  id: string,
  toIndex: number,
  ids: Ids,
): ActionResult {
  if (!rendered.some((row) => row.id === id)) return { ok: false, reason: 'missing' };
  const neighbours = neighboursAfterMove(rendered, id, toIndex);
  if (!neighbours) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [{ table: 'desk_card', id, position: positionBetween(neighbours) }]);
}

/** A card and its checklist as they are to be acted on together. */
export interface Group {
  card: LocalRow;
  items: readonly LocalRow[];
}

export type ManyResult = { ok: true; mutations: Mutation[] } | { ok: false; reason: 'nothing' };

/** Most changes in one mutation: well under the server's limit, so that a group, which is never split, has room. */
const CHUNK = 400;

function chunked(
  ids: Ids,
  groups: readonly (readonly Mutation['changes'][number][])[],
): ManyResult {
  const mutations: Mutation[] = [];
  let current: Mutation['changes'][number][] = [];
  for (const group of groups) {
    if (current.length > 0 && current.length + group.length > CHUNK) {
      mutations.push({ mutationId: ids.newId(), changes: current });
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) mutations.push({ mutationId: ids.newId(), changes: current });
  return mutations.length === 0 ? { ok: false, reason: 'nothing' } : { ok: true, mutations };
}

/**
 * Deletes several cards, each with its live checklist items, as `deleteCard` does one: a list's completed cards are one action (DESIGN.md §10.5). A
 * long list's are more changes than one mutation holds, so they are **several mutations, none of which splits a card from its items**, and the undo is
 * the same several.
 */
export function deleteMany(groups: readonly Group[], ids: Ids): ManyResult {
  return chunked(
    ids,
    groups.map(({ card, items }) => {
      const result = deleteCard(card, ids, items);
      return result.ok ? result.mutation.changes : [];
    }),
  );
}

/** The undo of `deleteMany`: `groups` are the rows as they are by then, deleted, which is what says which items went with each. */
export function restoreMany(groups: readonly Group[], ids: Ids): ManyResult {
  return chunked(
    ids,
    groups.map(({ card, items }) => {
      const result = restoreCard(card, ids, items);
      return result.ok ? result.mutation.changes : [];
    }),
  );
}

/**
 * Moves a card to another list (DESIGN.md §10.2) in **one change**: the card goes to the top of the destination. Its checklist is not touched, since an
 * item belongs to its card and has no list of its own (§10.3). `destination` is the destination's cards as rendered, for the position at the top.
 */
export function moveToList(
  card: LocalRow | undefined,
  toListId: string,
  destination: readonly LocalRow[],
  ids: Ids,
): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  if (card.listId === toListId) return { ok: false, reason: 'nothing' };
  const top = destination[0];
  return mutationOf(ids, [
    {
      table: 'desk_card',
      id: card.id,
      listId: toListId,
      position: top && 'position' in top ? before(top.position) : first(),
    },
  ]);
}

/** Stars a card, or takes the star off. */
export function setStarred(card: LocalRow | undefined, starred: boolean, ids: Ids): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  if ((plainOf(card, 'starred') === true) === starred) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [
    { table: 'desk_card', id: card.id, fields: { starred: { v: starred } } },
  ]);
}

/** Whether a card is starred. */
export function isStarred(card: LocalRow): boolean {
  return plainOf(card, 'starred') === true;
}
