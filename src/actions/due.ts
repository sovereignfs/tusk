import type { LocalRow } from '../local/rows';
import type { ActionResult, Ids } from './lists';
import { createCard } from './cards';

/**
 * A card's due date and time (DESIGN.md §11), on the Desk. **This is the one action that writes them, and it always writes both**: `dueDate` and
 * `dueTime` in one change, so that the pair is stamped with one order and two devices cannot end with one device's date and the other's time. Clearing
 * the date clears the time, and there is no time without a date; the server's validator refuses a change that says otherwise (`src/sync/validate.ts`).
 * A test holds that no other action names these fields.
 */
export interface Due {
  /** `YYYY-MM-DD`, or null for none. */
  readonly date: string | null;
  /** `HH:MM`, or null; only with a date. */
  readonly time: string | null;
}

const plainOf = (row: LocalRow, name: string) => {
  const field = row.fields[name];
  return field !== undefined && 'v' in field ? field.v : undefined;
};

/** What a card is due, as the working copy has it. A date that is ciphertext cannot be read, and counts as none until the keys are in place. */
export function dueOf(card: LocalRow): Due {
  const date = plainOf(card, 'dueDate');
  const time = plainOf(card, 'dueTime');
  return {
    date: typeof date === 'string' ? date : null,
    time: typeof date === 'string' && typeof time === 'string' ? time : null,
  };
}

/** The fields that set a due date and time, the pair together: what a change that gives a card a date, or makes one that has it, carries. */
export function dueFields(due: Due): Record<'dueDate' | 'dueTime', { v: string | null }> {
  const date = due.date;
  return { dueDate: { v: date }, dueTime: { v: date === null ? null : due.time } };
}

export function setDue(card: LocalRow | undefined, due: Due, ids: Ids): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  // No time without a date.
  const next: Due = due.date === null ? { date: null, time: null } : due;
  const now = dueOf(card);
  if (now.date === next.date && now.time === next.time) return { ok: false, reason: 'nothing' };
  return {
    ok: true,
    mutation: {
      mutationId: ids.newId(),
      changes: [
        {
          table: 'desk_card',
          id: card.id,
          fields: dueFields(next),
        },
      ],
    },
  };
}

/**
 * A new card that is due from the first moment (the Planner, DESIGN.md §25.1): `createCard`, with the date and time carried in the same change as the title, so that
 * there is never a card with no date in between and a device that has seen the card has seen when it is due. The pair is written by `dueFields` and nowhere else.
 * A time with no date is no time.
 */
export function createDueCard(
  listId: string,
  cards: readonly LocalRow[],
  input: { title: string; due: Due },
  ids: Ids,
  allCount = cards.length,
  above?: string,
): ActionResult {
  const made = createCard(listId, cards, { title: input.title }, ids, allCount, above);
  if (!made.ok) return made;
  const [change] = made.mutation.changes;
  if (!change || change.table !== 'desk_card' || !('fields' in change) || !change.fields)
    return { ok: false, reason: 'rule' };
  const due = input.due.date === null ? { date: null, time: null } : input.due;
  return {
    ok: true,
    mutation: {
      ...made.mutation,
      changes: [{ ...change, fields: { ...change.fields, ...dueFields(due) } }],
    },
  };
}
