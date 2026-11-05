import { text as textParser } from '../access/parse';
import { DEFAULT_COLOR, type ListColor, isListColor } from '../lists/colors';
import type { LocalRow } from '../local/rows';
import { after, between, first } from '../position';
import { LIMITS, type Mutation } from '../sync/format';
import { TASKS_NAMESPACE, uuid5 } from '../uuid5';

/**
 * What a person does to their lists (DESIGN.md §10), as **pure functions**: given what is on the screen and what the person asked, each says which
 * mutation that is, and nothing else. They read no database and no clock and make no id of their own (the caller gives `newId`), so they are tested
 * without any of them and run the same in the browser as anywhere. `commit` (`src/sync/client.ts`) is what writes the result.
 *
 * `lists` is always **the lists as they are rendered**: live, in order. A drag is worked out against what is on the screen and not against every row
 * there is, since a deleted list is not on the screen (DESIGN.md §15.8).
 */
export interface Ids {
  /** A new id for a row or a mutation: `crypto.randomUUID()` in a browser. */
  newId(): string;
}

export type ActionResult =
  | { ok: true; mutation: Mutation }
  /** Nothing to do: the list is where it was already, or is not there. */
  | { ok: false; reason: 'nothing' | 'missing' }
  /** What the person gave is not allowed, or the account is as full as it can be. */
  | { ok: false; reason: 'title' | 'limit' };

const TITLE = textParser(1, LIMITS.titleChars);

const mutationOf = (ids: Ids, changes: Mutation['changes']): ActionResult => ({
  ok: true,
  mutation: { mutationId: ids.newId(), changes },
});

/** A new list at the bottom of the sidebar. `lists` includes those that are deleted and not yet removed, which count against the limit. */
export function createList(
  lists: readonly LocalRow[],
  input: { title: string; color?: ListColor },
  ids: Ids,
  all: readonly LocalRow[] = lists,
): ActionResult {
  const title = input.title.trim();
  if (!TITLE(title).ok) return { ok: false, reason: 'title' };
  if (all.length >= LIMITS.listsPerAccount) return { ok: false, reason: 'limit' };
  const last = lists.at(-1);
  return mutationOf(ids, [
    {
      table: 'list',
      id: ids.newId(),
      position: last && 'position' in last ? after(last.position) : first(),
      fields: {
        title: { v: title },
        color: { v: input.color ?? DEFAULT_COLOR },
        sort: { v: 'custom' },
      },
    },
  ]);
}

export function renameList(list: LocalRow | undefined, title: string, ids: Ids): ActionResult {
  if (!list) return { ok: false, reason: 'missing' };
  const trimmed = title.trim();
  if (!TITLE(trimmed).ok) return { ok: false, reason: 'title' };
  const current = list.fields.title;
  if (current && 'v' in current && current.v === trimmed) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [{ table: 'list', id: list.id, fields: { title: { v: trimmed } } }]);
}

export function setColor(list: LocalRow | undefined, color: string, ids: Ids): ActionResult {
  if (!list) return { ok: false, reason: 'missing' };
  if (!isListColor(color)) return { ok: false, reason: 'nothing' };
  const current = list.fields.color;
  if (current && 'v' in current && current.v === color) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [{ table: 'list', id: list.id, fields: { color: { v: color } } }]);
}

/**
 * Moves a list to `toIndex` among the lists as rendered (as after the move: index 0 is the top). **One change to one row**, between the two
 * neighbours it ends up between, which is what makes order survive two offline devices (DESIGN.md §11.3).
 */
export function moveList(
  lists: readonly LocalRow[],
  id: string,
  toIndex: number,
  ids: Ids,
): ActionResult {
  const from = lists.findIndex((list) => list.id === id);
  if (from === -1) return { ok: false, reason: 'missing' };
  const index = Math.max(0, Math.min(toIndex, lists.length - 1));
  if (index === from) return { ok: false, reason: 'nothing' };

  const others = lists.filter((list) => list.id !== id);
  const above = others[index - 1];
  const below = others[index];
  const key = (row: LocalRow | undefined) => (row && 'position' in row ? row.position : null);
  return mutationOf(ids, [{ table: 'list', id, position: between(key(above), key(below)) }]);
}

/**
 * Deletes a list, which takes its tasks out of every screen with it and can be undone with `restoreList` (DESIGN.md §11.5). **Only the list is
 * marked**: a task of a deleted list is not shown anywhere, and bringing the list back brings them back, without a change for each of however many
 * tasks there were, which a mutation of at most 500 changes could not hold and which would make Undo a thousand writes.
 */
export function deleteList(list: LocalRow | undefined, ids: Ids): ActionResult {
  if (!list) return { ok: false, reason: 'missing' };
  return mutationOf(ids, [{ table: 'list', id: list.id, deleted: true }]);
}

/** Undo of `deleteList`. */
export function restoreList(list: LocalRow | undefined, ids: Ids): ActionResult {
  if (!list) return { ok: false, reason: 'missing' };
  return mutationOf(ids, [{ table: 'list', id: list.id, deleted: false }]);
}

/** The first list's name (DESIGN.md §10): there is always somewhere to type. */
export const FIRST_LIST_TITLE = 'My tasks';

/** The id of an account's first list: derived from the account, so that two devices that each make it make one row, which arrives once. */
export function firstListId(accountId: string): string {
  return uuid5(`first-list:${accountId}`, TASKS_NAMESPACE);
}

/**
 * *My tasks*, for an account that has never had a list: `all` is every list row the device has, deleted or not, and the device has synced at least
 * once, so that a new device does not make one for an account that has lists it has not yet heard of. Anything else is nothing to do. A person who
 * deletes every list does not have it made again at once, since the deleted rows are still there to be found.
 */
export function ensureFirstList(
  accountId: string,
  all: readonly LocalRow[],
  hasSynced: boolean,
  ids: Ids,
): ActionResult {
  if (!hasSynced || all.length > 0) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [
    {
      table: 'list',
      id: firstListId(accountId),
      position: first(),
      fields: {
        title: { v: FIRST_LIST_TITLE },
        color: { v: DEFAULT_COLOR },
        sort: { v: 'custom' },
      },
    },
  ]);
}
