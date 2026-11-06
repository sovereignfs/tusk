import { after, between, comparePositions, first } from '../position';
import type { BoardView, ListRow, Op, OpRows } from '../workspaces/format';

/**
 * What a board shows of an operation before the server has answered (DESIGN.md §14.7), and what it keeps once it has. Pure, so that it is tested with no
 * browser. The lists are always in the order of their positions, compared as bytes; a tie is broken by id, as the server's `ORDER BY` does.
 */
export function sortLists(lists: readonly ListRow[]): ListRow[] {
  return [...lists].sort(
    (a, b) => comparePositions(a.position, b.position) || (a.id < b.id ? -1 : 1),
  );
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
      return change(view.lists.filter((each) => each.id !== op.id));
    default:
      return view;
  }
}

/** The board as the server now holds it, once it has said yes: its row of the list replaces the guess, and its version is the board's. */
export function settled(view: BoardView, rows: OpRows): BoardView {
  let lists = view.lists;
  const row = rows.list;
  if (row && row.boardId === view.board.id)
    lists = [...lists.filter((each) => each.id !== row.id), row];
  const gone = rows.deletedList;
  if (gone) lists = lists.filter((each) => each.id !== gone);
  return {
    ...view,
    lists: sortLists(lists),
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
