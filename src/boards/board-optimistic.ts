import { after, before, between, comparePositions, first } from '../position';
import type { BoardView, CardTile, ListRow, Op, OpRows } from '../workspaces/format';

/**
 * What a board shows of an operation before the server has answered (DESIGN.md §14.7), and what it keeps once it has. Pure, so that it is tested with no
 * browser. The lists are always in the order of their positions, compared as bytes; a tie is broken by id, as the server's `ORDER BY` does.
 */
export function sortLists(lists: readonly ListRow[]): ListRow[] {
  return [...lists].sort(
    (a, b) => comparePositions(a.position, b.position) || (a.id < b.id ? -1 : 1),
  );
}

/** The cards of one list, top to bottom. */
export function cardsIn(cards: readonly CardTile[], listId: string): CardTile[] {
  return cards
    .filter((each) => each.listId === listId)
    .sort((a, b) => comparePositions(a.position, b.position) || (a.id < b.id ? -1 : 1));
}

/** The same change the server will make, to the board the screen holds. Operations that are not about a board's lists change nothing here. */
export function showingBoard(view: BoardView, op: Op): BoardView {
  const change = (lists: readonly ListRow[]): BoardView => ({ ...view, lists: sortLists(lists) });
  switch (op.op) {
    case 'list.create':
      if (op.boardId !== view.board.id) return view;
      return change([
        ...view.lists.filter((each) => each.id !== op.id),
        { id: op.id, boardId: op.boardId, name: op.name, position: op.position, cards: 0 },
      ]);
    case 'list.rename':
      return change(
        view.lists.map((each) => (each.id === op.id ? { ...each, name: op.name } : each)),
      );
    case 'list.move':
      return change(
        view.lists.map((each) => (each.id === op.id ? { ...each, position: op.position } : each)),
      );
    case 'list.delete':
      // The cards that were on it go with it.
      return {
        ...change(view.lists.filter((each) => each.id !== op.id)),
        cards: view.cards.filter((each) => each.listId !== op.id),
      };
    case 'card.create':
      if (!view.lists.some((each) => each.id === op.listId)) return view;
      return {
        ...view,
        cards: [
          ...view.cards.filter((each) => each.id !== op.id),
          {
            id: op.id,
            boardId: view.board.id,
            listId: op.listId,
            title: op.title,
            position: op.position,
            dueDate: null,
            dueTime: null,
            hasDescription: false,
          },
        ],
      };
    case 'card.move':
      if (!view.lists.some((each) => each.id === op.listId)) return view;
      return {
        ...view,
        cards: view.cards.map((each) =>
          each.id === op.id ? { ...each, listId: op.listId, position: op.position } : each,
        ),
      };
    case 'card.archive':
    case 'card.delete':
      return { ...view, cards: view.cards.filter((each) => each.id !== op.id) };
    default:
      return view;
  }
}

/** The board as the server now holds it, once it has said yes: its row of the list replaces the guess, and its version is the board's. */
export function settled(view: BoardView, op: Op, rows: OpRows): BoardView {
  let lists = view.lists;
  let cards = view.cards;
  const card = rows.card;
  // An archived card is not an open one: the board holds the open cards only, and a restored card joins them.
  if (card && card.boardId === view.board.id && op.op !== 'card.archive')
    cards = [...cards.filter((each) => each.id !== card.id), card];
  if (op.op === 'card.archive') cards = cards.filter((each) => each.id !== op.id);
  const goneCard = rows.deletedCard;
  if (goneCard) cards = cards.filter((each) => each.id !== goneCard);
  const row = rows.list;
  if (row && row.boardId === view.board.id)
    lists = [...lists.filter((each) => each.id !== row.id), row];
  const gone = rows.deletedList;
  if (gone) {
    lists = lists.filter((each) => each.id !== gone);
    cards = cards.filter((each) => each.listId !== gone);
  }
  return {
    ...view,
    lists: sortLists(lists),
    cards,
    board: rows.version === undefined ? view.board : { ...view.board, version: rows.version },
  };
}

/** The position for a new list: after the last one, or the first position if there is none. */
export function endPosition(lists: readonly ListRow[]): string {
  const last = sortLists(lists).at(-1);
  return last ? after(last.position) : first();
}

/**
 * The position that puts list `id` at `index` among the others (0 is the first), between the two it will lie between. One row is written, whatever the
 * distance. An index past the end is the end.
 */
export function positionFor(lists: readonly ListRow[], id: string, index: number): string {
  const others = sortLists(lists).filter((each) => each.id !== id);
  const at = Math.max(0, Math.min(index, others.length));
  return between(others[at - 1]?.position ?? null, others[at]?.position ?? null);
}

/**
 * The position that puts card `id` at `index` in list `listId` (0 is the top), between the two cards it will lie between, **among what is shown**: the
 * cards of that list without the one being moved. One row is written, however far it goes.
 */
export function cardPositionFor(
  cards: readonly CardTile[],
  id: string,
  listId: string,
  index: number,
): string {
  const others = cardsIn(cards, listId).filter((each) => each.id !== id);
  const at = Math.max(0, Math.min(index, others.length));
  return between(others[at - 1]?.position ?? null, others[at]?.position ?? null);
}

/** The position for a card added at the top of a list. */
export function topPosition(cards: readonly CardTile[], listId: string): string {
  const top = cardsIn(cards, listId)[0];
  return top ? before(top.position) : first();
}
