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

/** Label ids in the order the board's labels were made, which is how a tile lists them. */
function orderedLabels(view: BoardView, ids: readonly string[]): string[] {
  const order = new Map(view.labels.map((label, index) => [label.id, index]));
  return [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
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
            dueEnd: null,
            hasDescription: false,
            labels: [],
            assignees: [],
            checklist: { done: 0, total: 0 },
            comments: 0,
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
    case 'board.update':
      if (op.id !== view.board.id) return view;
      return {
        ...view,
        board: {
          ...view.board,
          name: op.name,
          color: op.color,
          description: op.description.trim() === '' ? null : op.description,
        },
      };
    case 'board.archive':
      if (op.id !== view.board.id) return view;
      return {
        ...view,
        board: { ...view.board, archived: true },
        can: { ...view.can, edit: false },
      };
    case 'card.rename':
      return {
        ...view,
        cards: view.cards.map((each) => (each.id === op.id ? { ...each, title: op.title } : each)),
      };
    case 'label.create':
      if (op.boardId !== view.board.id) return view;
      return {
        ...view,
        labels: [
          ...view.labels.filter((each) => each.id !== op.id),
          { id: op.id, boardId: op.boardId, name: op.name, color: op.color },
        ],
      };
    case 'label.update':
      return {
        ...view,
        labels: view.labels.map((each) =>
          each.id === op.id ? { ...each, name: op.name, color: op.color } : each,
        ),
      };
    case 'label.delete':
      // Off every card with it.
      return {
        ...view,
        labels: view.labels.filter((each) => each.id !== op.id),
        cards: view.cards.map((each) =>
          each.labels.includes(op.id)
            ? { ...each, labels: each.labels.filter((id) => id !== op.id) }
            : each,
        ),
      };
    case 'card.addLabel':
      if (!view.labels.some((each) => each.id === op.labelId)) return view;
      return {
        ...view,
        cards: view.cards.map((each) =>
          each.id === op.cardId && !each.labels.includes(op.labelId)
            ? { ...each, labels: orderedLabels(view, [...each.labels, op.labelId]) }
            : each,
        ),
      };
    case 'comment.add':
      return {
        ...view,
        cards: view.cards.map((each) =>
          each.id === op.cardId ? { ...each, comments: each.comments + 1 } : each,
        ),
      };
    case 'card.assign':
      return {
        ...view,
        cards: view.cards.map((each) =>
          each.id === op.cardId && !each.assignees.includes(op.accountId)
            ? { ...each, assignees: [...each.assignees, op.accountId] }
            : each,
        ),
      };
    case 'card.unassign':
      return {
        ...view,
        cards: view.cards.map((each) =>
          each.id === op.cardId
            ? { ...each, assignees: each.assignees.filter((id) => id !== op.accountId) }
            : each,
        ),
      };
    case 'card.removeLabel':
      return {
        ...view,
        cards: view.cards.map((each) =>
          each.id === op.cardId
            ? { ...each, labels: each.labels.filter((id) => id !== op.labelId) }
            : each,
        ),
      };
    case 'card.setDue':
      return {
        ...view,
        cards: view.cards.map((each) =>
          each.id === op.id
            ? {
                ...each,
                dueDate: op.dueDate,
                dueTime: op.dueDate === null ? null : op.dueTime,
                dueEnd: op.dueDate === null || op.dueTime === null ? null : (op.dueEnd ?? null),
              }
            : each,
        ),
      };
    case 'card.describe':
      return {
        ...view,
        cards: view.cards.map((each) =>
          each.id === op.id ? { ...each, hasDescription: op.description.trim() !== '' } : each,
        ),
      };
    case 'card.moveToBoard':
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
  // A card that is now on another board is not on this one.
  if (card && card.boardId !== view.board.id) cards = cards.filter((each) => each.id !== card.id);
  if (op.op === 'card.archive') cards = cards.filter((each) => each.id !== op.id);
  // The board's own row, once the server has said so: an archived board is read-only for everyone, so it can no longer be edited.
  const board = rows.board && rows.board.id === view.board.id ? rows.board : null;
  let labels = view.labels;
  const label = rows.label;
  if (label && label.boardId === view.board.id)
    // In place if the board has it, and at the end if not: labels are in the order they were made.
    labels = labels.some((each) => each.id === label.id)
      ? labels.map((each) => (each.id === label.id ? label : each))
      : [...labels, label];
  const goneLabel = rows.deletedLabel;
  if (goneLabel) {
    labels = labels.filter((each) => each.id !== goneLabel);
    cards = cards.map((each) =>
      each.labels.includes(goneLabel)
        ? { ...each, labels: each.labels.filter((id) => id !== goneLabel) }
        : each,
    );
  }
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
    labels,
    cards,
    board: {
      ...(board ?? view.board),
      version: rows.version === undefined ? (board ?? view.board).version : rows.version,
    },
    can: board && board.archived ? { ...view.can, edit: false } : view.can,
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
