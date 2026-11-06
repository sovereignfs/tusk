import { type Ids, chunkedChanges } from '../actions/import';
import type { LocalRow } from '../local/rows';
import { after, first } from '../position';
import { type Change, LIMITS, type Mutation } from '../sync/format';
import type { DeskPart } from './format';

/**
 * Importing the Desk's part of a file (DESIGN.md §20.2): **it creates, and never replaces or merges.** The lists are added to the Desk after the lists it
 * has, every card and item and series has a new id, and what the file's rows pointed at they point at under its new id. Importing twice makes two copies.
 * The result is mutations, committed through sync like anything else the Desk does, chunked so that **no card is split from its checklist** and a series
 * and its list come before what points at them. Pure: it is given the ids.
 *
 * `existing` is what the account has, counting what was deleted and not yet removed (it counts against the limits): a file that would take the account
 * over one is refused whole, so that it is never half imported.
 */
export interface Existing {
  /** The live lists, in order: the new ones go after the last. */
  readonly lists: readonly LocalRow[];
  readonly listRows: number;
  readonly cardRows: number;
  readonly checkRows: number;
  readonly seriesRows: number;
}

export type ImportedDesk =
  | {
      ok: true;
      mutations: Mutation[];
      counts: { lists: number; cards: number; items: number; series: number };
    }
  | { ok: false; reason: 'lists' | 'cards' | 'items' | 'series' };

export function importDesk(part: DeskPart, existing: Existing, ids: Ids): ImportedDesk {
  const cards = part.lists.reduce((n, list) => n + list.cards.length, 0);
  const items = part.lists.reduce(
    (n, list) => n + list.cards.reduce((m, card) => m + card.checklist.length, 0),
    0,
  );
  if (existing.listRows + part.lists.length > LIMITS.listsPerAccount)
    return { ok: false, reason: 'lists' };
  if (existing.cardRows + cards > LIMITS.cardsPerAccount) return { ok: false, reason: 'cards' };
  if (existing.checkRows + items > LIMITS.checksPerAccount) return { ok: false, reason: 'items' };
  if (existing.seriesRows + part.series.length > LIMITS.cardsPerAccount)
    return { ok: false, reason: 'series' };

  const listIds = new Map<string, string>();
  const seriesIds = new Map<string, string>();
  for (const list of part.lists) listIds.set(list.id, ids.newId());
  for (const series of part.series) seriesIds.set(series.id, ids.newId());

  // After the last list the Desk has, in the order the file has them.
  const last = existing.lists.at(-1);
  let position = last && 'position' in last ? after(last.position) : first();

  const groups: Change[][] = [];
  for (const list of part.lists) {
    const fields: Record<string, { v: string }> = { title: { v: list.title } };
    if (list.color !== null) fields.color = { v: list.color };
    if (list.sort !== null) fields.sort = { v: list.sort };
    groups.push([{ table: 'desk_list', id: listIds.get(list.id) as string, position, fields }]);
    position = after(position);
  }
  for (const series of part.series) {
    groups.push([
      {
        table: 'desk_series',
        id: seriesIds.get(series.id) as string,
        listId: listIds.get(series.listId) as string,
        fields: { rule: { v: series.rule }, anchor: { v: series.anchor } },
      },
    ]);
  }
  for (const list of part.lists) {
    for (const card of list.cards) {
      const cardId = ids.newId();
      const fields: Record<string, { v: string | number | boolean | null }> = {
        title: { v: card.title },
      };
      if (card.description !== '') fields.description = { v: card.description };
      if (card.starred) fields.starred = { v: true };
      // A date and its time are written together, as they are everywhere (src/actions/due.ts).
      if (card.dueDate !== null) {
        fields.dueDate = { v: card.dueDate };
        if (card.dueTime !== null) fields.dueTime = { v: card.dueTime };
      }
      if (card.seriesId !== null) fields.seriesId = { v: seriesIds.get(card.seriesId) ?? null };
      if (card.startedAt !== null) fields.startedAt = { v: card.startedAt };
      if (card.completedAt !== null) fields.completedAt = { v: card.completedAt };
      const group: Change[] = [
        {
          table: 'desk_card',
          id: cardId,
          listId: listIds.get(list.id) as string,
          position: card.position,
          fields,
        },
      ];
      for (const item of card.checklist) {
        group.push({
          table: 'desk_check',
          id: ids.newId(),
          cardId,
          position: item.position,
          fields: {
            title: { v: item.title },
            ...(item.completedAt !== null ? { completedAt: { v: item.completedAt } } : {}),
          },
        });
      }
      groups.push(group);
    }
  }

  const result = chunkedChanges(ids, groups);
  return {
    ok: true,
    mutations: result,
    counts: { lists: part.lists.length, cards, items, series: part.series.length },
  };
}
