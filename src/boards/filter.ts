import { fold, terms } from '../fold';
import type { BoardPerson, CardTile, LabelRow } from '../workspaces/format';

/**
 * Search on a board (DESIGN.md §14.5): the cards a board has loaded, filtered as you type by title, label name and assignee name. Pure, and given what it
 * needs, so that it is tested with no screen. **Letters are compared folded**: case and accents do not decide, so "É" finds "é" and "e", and "straße" finds
 * "STRASSE". Every word typed must be found, in the title or a label or an assignee, in any order; nothing typed shows every card.
 */

export { fold, terms };

export interface Filtered {
  readonly shown: readonly CardTile[];
  /** How many open cards the query hides. */
  readonly hidden: number;
}

export function filterCards(
  cards: readonly CardTile[],
  query: string,
  labels: readonly LabelRow[],
  people: readonly Pick<BoardPerson, 'accountId' | 'name'>[],
): Filtered {
  const wanted = terms(query);
  if (wanted.length === 0) return { shown: cards, hidden: 0 };
  const shown = cards.filter((card) => {
    const text = fold(
      [
        card.title,
        ...card.labels.map((id) => labels.find((each) => each.id === id)?.name ?? ''),
        ...card.assignees.map((id) => people.find((each) => each.accountId === id)?.name ?? ''),
      ].join('\n'),
    );
    return wanted.every((word) => text.includes(word));
  });
  return { shown, hidden: cards.length - shown.length };
}
