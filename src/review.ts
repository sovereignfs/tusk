import { isCompleted } from './actions/cards';
import type { LocalRow } from './local/rows';
import { comparePositions } from './position';

/**
 * **Review** (DESIGN.md §25.3), pure: every open card of the Desk (or of one list), in the order a pass should go in. A card never reviewed comes first, then the
 * least recently reviewed, then by the order they are in: the list's place, when it is given, then the card's position, then its id, so that two devices make the same
 * order. **Stopping and coming back continues with what was not seen**, because any swipe in Review stamps the card (`reviewedAt`), which moves it to the end.
 * It reads no clock.
 */
const reviewedAt = (card: LocalRow): number | undefined => {
  const field = card.fields.reviewedAt;
  return field !== undefined && 'v' in field && typeof field.v === 'number' ? field.v : undefined;
};

export function buildReview(
  cards: readonly LocalRow[],
  options: {
    /** Only this list's cards. */
    listId?: string;
    /** Where each list is, from 0, for the order of cards that tie on when they were reviewed. */
    listRank?: ReadonlyMap<string, number>;
  } = {},
): LocalRow[] {
  const open = cards.filter(
    (card): card is Extract<LocalRow, { table: 'desk_card' }> =>
      card.table === 'desk_card' &&
      card.deletedAt === null &&
      !isCompleted(card) &&
      (options.listId === undefined || card.listId === options.listId),
  );
  return [...open].sort((a, b) => {
    const ra = reviewedAt(a);
    const rb = reviewedAt(b);
    if (ra !== rb) {
      if (ra === undefined) return -1;
      if (rb === undefined) return 1;
      return ra - rb;
    }
    const la = options.listRank?.get(a.listId) ?? 0;
    const lb = options.listRank?.get(b.listId) ?? 0;
    if (la !== lb) return la - lb;
    const byPosition = comparePositions(a.position, b.position);
    if (byPosition !== 0) return byPosition;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
