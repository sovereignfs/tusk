import { comparePositions } from '../position';
import type { BoardView, ChecklistItem, Op, Progress } from '../workspaces/format';

/**
 * A card's checklist, held by its dialog (DESIGN.md §15.4), and the same change the server will make to it. Pure. The board holds only the count of a
 * card's items, so the dialog works the count out from the items and tells the board (`withProgress`), and the tile follows at once.
 */
export function sortItems(items: readonly ChecklistItem[]): ChecklistItem[] {
  return [...items].sort(
    (a, b) => comparePositions(a.position, b.position) || (a.id < b.id ? -1 : 1),
  );
}

export function progressOf(items: readonly ChecklistItem[]): Progress {
  return { done: items.filter((each) => each.done).length, total: items.length };
}

export function showingItems(items: readonly ChecklistItem[], op: Op): ChecklistItem[] {
  switch (op.op) {
    case 'item.add':
      return sortItems([
        ...items.filter((each) => each.id !== op.id),
        { id: op.id, cardId: op.cardId, title: op.title, done: false, position: op.position },
      ]);
    case 'item.rename':
      return items.map((each) => (each.id === op.id ? { ...each, title: op.title } : each));
    case 'item.tick':
      return items.map((each) => (each.id === op.id ? { ...each, done: true } : each));
    case 'item.untick':
      return items.map((each) => (each.id === op.id ? { ...each, done: false } : each));
    case 'item.move':
      return sortItems(
        items.map((each) => (each.id === op.id ? { ...each, position: op.position } : each)),
      );
    case 'item.delete':
      return items.filter((each) => each.id !== op.id);
    default:
      return [...items];
  }
}

/** The board with a card's checklist count set: how a change to the checklist shows on the tile before the server has answered. */
export function withProgress(view: BoardView, cardId: string, progress: Progress): BoardView {
  return {
    ...view,
    cards: view.cards.map((each) => (each.id === cardId ? { ...each, checklist: progress } : each)),
  };
}
