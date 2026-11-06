import type { BoardPerson, CardTile, LabelRow } from '../workspaces/format';

/**
 * Search on a board (DESIGN.md §14.5): the cards a board has loaded, filtered as you type by title, label name and assignee name. Pure, and given what it
 * needs, so that it is tested with no screen. **Letters are compared folded**: case and accents do not decide, so "É" finds "é" and "e", and "straße" finds
 * "STRASSE". Every word typed must be found, in the title or a label or an assignee, in any order; nothing typed shows every card.
 */
/** Letters that do not come apart into a letter and a mark, folded to what a keyboard without them types. */
const SPECIAL: Record<string, string> = {
  ß: 'ss',
  ς: 'σ',
  ı: 'i',
  ſ: 's',
  ø: 'o',
  đ: 'd',
  ł: 'l',
  æ: 'ae',
  œ: 'oe',
};

/** The text with case and accents folded away. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßςıſøđłæœ]/gu, (each) => SPECIAL[each] ?? each);
}

/** The words of a query, folded: what each card must have all of. */
export function terms(query: string): string[] {
  return fold(query)
    .split(/\s+/u)
    .filter((each) => each !== '');
}

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
