/**
 * Folding text to compare it (DESIGN.md §10.7, §14.5): **case and accents do not decide,** so "É" finds "é" and "e", and "straße" finds "STRASSE". Used by
 * the search of the Desk and of a board alike, so that the two agree. Pure.
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
