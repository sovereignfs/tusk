import type { LocalRow } from '../local/rows';
import { type Change, type FieldValue, type Mutation } from '../sync/format';
import { TUSK_NAMESPACE, uuid5 } from '../uuid5';
import { firstOnOrAfter, formatRule, nextOccurrence, parseRule, reanchor } from '../recurrence';
import { type Due, dueFields, dueOf, setDue } from './due';
import type { ActionResult, Ids } from './lists';

/**
 * A repeating card (DESIGN.md §12): a series is a rule and an anchor date, and its occurrences are ordinary cards that point at it with `seriesId`.
 * **One occurrence is open at a time;** completing it makes the next (`completeCard`, which calls `nextOccurrenceChanges`). Pure: today is given.
 */

const plainOf = (row: LocalRow, name: string): unknown => {
  const field = row.fields[name];
  return field !== undefined && 'v' in field ? field.v : undefined;
};

/** The series a card points at, from its field; none for a card that does not repeat or whose pointer is ciphertext. */
export function seriesIdOf(card: LocalRow): string | undefined {
  const id = plainOf(card, 'seriesId');
  return typeof id === 'string' ? id : undefined;
}

/** A series' rule and its anchor, as `recurrence.ts` reads them; none for a series that is deleted, unreadable or not a rule this version knows. */
export function readSeries(series: LocalRow | undefined) {
  if (!series || series.table !== 'desk_series' || series.deletedAt !== null) return undefined;
  const text = plainOf(series, 'rule');
  const anchor = plainOf(series, 'anchor');
  if (typeof text !== 'string' || typeof anchor !== 'string') return undefined;
  const parsed = parseRule(text);
  return parsed.ok ? { id: series.id, rule: parsed.rule, anchor } : undefined;
}

/** A field to carry onto the next occurrence: what the person set, and nothing that is only the default. */
function carried(row: LocalRow, name: string): FieldValue | undefined {
  const field = row.fields[name];
  if (field === undefined) return undefined;
  // Only the value: the working copy's field also has its own stamp, which is nobody else's to be sent.
  if ('c' in field) return { c: field.c };
  return field.v === null || field.v === '' || field.v === false ? undefined : { v: field.v };
}

/**
 * The next occurrence of the card's series, as the changes that make it (§12.1), or none when the series has ended, is gone, or cannot be read. It
 * **copies the title, description, star, due time and list, takes the same position, and has its checklist copied, unticked;** it has no start time and no
 * completion. Its due date is the rule's next date after the later of this one's and today (§12.3).
 *
 * **Its id is a UUIDv5 of the series and the date,** and each of its items' of that and the original's, so that two devices that complete the same
 * occurrence make the same rows, which then arrive once (§8.4). `items` are the card's checklist as rendered.
 */
export function nextOccurrenceChanges(
  card: LocalRow,
  items: readonly LocalRow[],
  series: LocalRow | undefined,
  today: string,
): Change[] {
  if (card.table !== 'desk_card') return [];
  const read = readSeries(series);
  if (!read || seriesIdOf(card) !== read.id) return [];
  const due = dueOf(card);
  const date = nextOccurrence({
    rule: read.rule,
    anchor: read.anchor,
    due: due.date,
    today,
  });
  if (date === null) return [];

  const id = uuid5(`occurrence:${read.id}:${date}`, TUSK_NAMESPACE);
  // The due time is carried with the new date, as a pair.
  const fields: Record<string, FieldValue> = {
    ...dueFields({ date, time: due.time }),
    seriesId: { v: read.id },
  };
  for (const name of ['title', 'description', 'starred']) {
    const value = carried(card, name);
    if (value) fields[name] = value;
  }
  const changes: Change[] = [
    { table: 'desk_card', id, listId: card.listId, position: card.position, fields },
  ];
  for (const item of items) {
    if (item.table !== 'desk_check' || item.deletedAt !== null) continue;
    const title = carried(item, 'title');
    changes.push({
      table: 'desk_check',
      id: uuid5(`item:${id}:${item.id}`, TUSK_NAMESPACE),
      cardId: id,
      position: item.position,
      fields: title ? { title } : {},
    });
  }
  return changes;
}

/**
 * Sets a card to repeat, or replaces the rule of the series it is in (§12.4). A card with no due date is given one: **the first date the rule matches,
 * from today.** The anchor of a new or replaced rule is this occurrence's date. The rule is stored in its one canonical text. A card that is done
 * does not start a repeat, and a rule that never matches from today (an `UNTIL` in the past) is refused.
 */
export function setRepeat(
  card: LocalRow | undefined,
  series: LocalRow | undefined,
  ruleText: string,
  today: string,
  ids: Ids,
): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  if (typeof plainOf(card, 'completedAt') === 'number') return { ok: false, reason: 'nothing' };
  const parsed = parseRule(ruleText);
  if (!parsed.ok) return { ok: false, reason: 'rule' };
  const rule = formatRule(parsed.rule);

  const current = dueOf(card).date;
  const date = current ?? firstOnOrAfter(parsed.rule, today);
  if (date === null) return { ok: false, reason: 'rule' };

  const cardFields: Record<string, FieldValue> = {};
  if (current === null) Object.assign(cardFields, dueFields({ date, time: null }));

  const changes: Change[] = [];
  const existing = series && series.deletedAt === null ? series : undefined;
  if (existing && seriesIdOf(card) === existing.id) {
    const fields: Record<string, FieldValue> = {};
    if (plainOf(existing, 'rule') !== rule) fields.rule = { v: rule };
    if (plainOf(existing, 'anchor') !== date) fields.anchor = { v: date };
    if (Object.keys(fields).length > 0)
      changes.push({ table: 'desk_series', id: existing.id, fields });
  } else {
    const id = ids.newId();
    // The series first: the card points at it, and the server looks for it when it reads the card.
    changes.push({
      table: 'desk_series',
      id,
      listId: card.listId,
      fields: { rule: { v: rule }, anchor: { v: date } },
    });
    cardFields.seriesId = { v: id };
  }
  if (Object.keys(cardFields).length > 0)
    changes.push({ table: 'desk_card', id: card.id, fields: cardFields });
  if (changes.length === 0) return { ok: false, reason: 'nothing' };
  return { ok: true, mutation: { mutationId: ids.newId(), changes } satisfies Mutation };
}

/**
 * **Two open occurrences of one series** can arrive: two devices completed the same one on different days, so each made a next with a different date
 * (§8.4). This says which to delete: of the open occurrences of a series (live, not done), **all but the earliest by due date, ties by id,** a rule every
 * device applies alike, so that whichever sees both deletes the same one. A card with no date counts as later than any that has one.
 */
export function duplicateOccurrences(cards: readonly LocalRow[]): string[] {
  const bySeries = new Map<string, LocalRow[]>();
  for (const card of cards) {
    if (card.table !== 'desk_card' || card.deletedAt !== null) continue;
    if (typeof plainOf(card, 'completedAt') === 'number') continue;
    const series = seriesIdOf(card);
    if (series === undefined) continue;
    bySeries.set(series, [...(bySeries.get(series) ?? []), card]);
  }
  const later: string[] = [];
  for (const open of bySeries.values()) {
    if (open.length < 2) continue;
    const dateOf = (card: LocalRow) => dueOf(card).date ?? '9999-12-31';
    open.sort((a, b) =>
      dateOf(a) < dateOf(b) ? -1 : dateOf(a) > dateOf(b) ? 1 : a.id < b.id ? -1 : 1,
    );
    for (const card of open.slice(1)) later.push(card.id);
  }
  return later.sort();
}

/**
 * "Does not repeat" (§12.4): this card **leaves its series and stays as a one-off**, and the series ends, since it has no open occurrence. The series
 * row is left for the job that removes one with nothing pointing at it (task 5.5). Completed occurrences are never written: this is one change to
 * this card alone.
 */
export function stopRepeat(card: LocalRow | undefined, ids: Ids): ActionResult {
  if (!card || card.table !== 'desk_card') return { ok: false, reason: 'missing' };
  if (seriesIdOf(card) === undefined) return { ok: false, reason: 'nothing' };
  // A completed occurrence is history, and is never written by an edit of the series.
  if (typeof plainOf(card, 'completedAt') === 'number') return { ok: false, reason: 'nothing' };
  return {
    ok: true,
    mutation: {
      mutationId: ids.newId(),
      changes: [{ table: 'desk_card', id: card.id, fields: { seriesId: { v: null } } }],
    },
  };
}

/**
 * Changes the due date of a card that may repeat (DESIGN.md §12.4): **this occurrence moves, and the series moves with it.** The anchor becomes the new
 * date, and a weekly rule on one weekday goes to the new date's weekday (`reanchor`), so that "every Monday", moved to a Tuesday, is every Tuesday
 * from then on. Clearing the date **detaches** the card: it stays as a one-off and the series ends. A change of the time alone moves nothing in the
 * series. One mutation. **A completed occurrence is only itself:** its own date is changed as any card's is, and the series is not written, since the
 * open occurrence is the series' to keep.
 */
export function setDueInSeries(
  card: LocalRow | undefined,
  series: LocalRow | undefined,
  due: Due,
  ids: Ids,
): ActionResult {
  const moved = setDue(card, due, ids);
  if (!moved.ok || !card) return moved;
  const read = readSeries(series);
  if (!read || seriesIdOf(card) !== read.id) return moved;
  if (typeof plainOf(card, 'completedAt') === 'number') return moved;

  const changes: Change[] = [...moved.mutation.changes];
  if (due.date === null) {
    changes.push({ table: 'desk_card', id: card.id, fields: { seriesId: { v: null } } });
  } else if (due.date !== read.anchor) {
    const rule = formatRule(reanchor(read.rule, due.date));
    const fields: Record<string, FieldValue> = { anchor: { v: due.date } };
    if (plainOf(series as LocalRow, 'rule') !== rule) fields.rule = { v: rule };
    changes.push({ table: 'desk_series', id: read.id, fields });
  }
  return { ok: true, mutation: { mutationId: moved.mutation.mutationId, changes } };
}
