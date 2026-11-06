import { describe, expect, it } from 'vitest';
import { comparePositions } from '../position';
import type { BoardView, CardTile, ListRow } from '../workspaces/format';
import {
  cardPositionFor,
  cardsIn,
  endPosition,
  positionFor,
  settled,
  showingBoard,
  sortLists,
  topPosition,
} from './board-optimistic';

const list = (id: string, position: string, name = id): ListRow => ({
  id,
  boardId: 'b',
  name,
  position,
  cards: 0,
});
const view = (lists: ListRow[]): BoardView => ({
  board: {
    id: 'b',
    workspaceId: 'w',
    name: 'Roadmap',
    color: '#2563eb',
    description: null,
    visibility: 'public',
    archived: false,
    version: 4,
    createdAt: 1,
    updatedAt: 1,
  },
  workspace: { id: 'w', name: 'Acme' },
  lists,
  labels: [],
  cards: [],
  can: { edit: true, admin: true, join: false },
});
const names = (v: BoardView) => v.lists.map((each) => each.id);

describe('what a board shows of a list operation', () => {
  const base = view([list('a', 'a0'), list('b', 'a1'), list('c', 'a2')]);

  it('puts a new list where its position says, and renames, moves and deletes', () => {
    expect(
      names(
        showingBoard(base, { op: 'list.create', id: 'd', boardId: 'b', name: 'D', position: 'a3' }),
      ),
    ).toEqual(['a', 'b', 'c', 'd']);
    expect(showingBoard(base, { op: 'list.rename', id: 'b', name: 'Doing' }).lists[1]?.name).toBe(
      'Doing',
    );
    expect(names(showingBoard(base, { op: 'list.move', id: 'a', position: 'a1V' }))).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(names(showingBoard(base, { op: 'list.delete', id: 'b' }))).toEqual(['a', 'c']);
  });

  it('leaves alone what is not about its lists, and a list made for another board', () => {
    expect(showingBoard(base, { op: 'workspace.rename', id: 'w', name: 'x' })).toBe(base);
    expect(
      showingBoard(base, {
        op: 'list.create',
        id: 'd',
        boardId: 'other',
        name: 'D',
        position: 'a3',
      }),
    ).toBe(base);
  });

  it('does not change the board it was given', () => {
    const copy = JSON.stringify(base);
    showingBoard(base, { op: 'list.delete', id: 'a' });
    showingBoard(base, { op: 'list.move', id: 'a', position: 'a9' });
    expect(JSON.stringify(base)).toBe(copy);
  });

  it('keeps the server’s row and version once it has answered', () => {
    const guess = showingBoard(base, { op: 'list.rename', id: 'b', name: 'Doing' });
    const kept = settled(
      guess,
      { op: 'list.rename', id: 'b', name: 'Doing!' },
      { list: list('b', 'a1', 'Doing!'), version: 9 },
    );
    expect(kept.lists[1]?.name).toBe('Doing!');
    expect(kept.board.version).toBe(9);
    expect(
      names(settled(kept, { op: 'list.delete', id: 'a' }, { deletedList: 'a', version: 10 })),
    ).toEqual(['b', 'c']);
  });
});

describe('where a list goes', () => {
  const lists = [list('a', 'a0'), list('b', 'a1'), list('c', 'a2')];

  it('is after the last for a new one, and first on an empty board', () => {
    expect(comparePositions(endPosition(lists), 'a2')).toBe(1);
    expect(endPosition([])).toBeTruthy();
  });

  it('is between the two it will lie between, and one row is enough however far it goes', () => {
    const toFront = positionFor(lists, 'c', 0);
    expect(comparePositions(toFront, 'a0')).toBe(-1);
    const toMiddle = positionFor(lists, 'c', 1);
    expect(comparePositions(toMiddle, 'a0')).toBe(1);
    expect(comparePositions(toMiddle, 'a1')).toBe(-1);
    expect(comparePositions(positionFor(lists, 'a', 99), 'a2')).toBe(1);
    const moved = sortLists(
      lists.map((each) => (each.id === 'c' ? { ...each, position: toMiddle } : each)),
    );
    expect(moved.map((each) => each.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('cards on a board', () => {
  const card = (id: string, listId: string, position: string): CardTile => ({
    id,
    boardId: 'b',
    listId,
    title: id,
    position,
    dueDate: null,
    dueTime: null,
    hasDescription: false,
    labels: [],
  });
  const base = (): BoardView => ({
    ...view([list('a', 'a0'), list('b', 'a1')]),
    cards: [card('x', 'a', 'a0'), card('y', 'a', 'a1'), card('z', 'b', 'a0')],
  });
  const ids = (v: BoardView, listId: string) => cardsIn(v.cards, listId).map((each) => each.id);

  it('shows a new card at the top, a move to another list, an archive and a list’s deletion', () => {
    const v = base();
    const added = showingBoard(v, {
      op: 'card.create',
      id: 'n',
      listId: 'a',
      title: 'New',
      position: topPosition(v.cards, 'a'),
    });
    expect(ids(added, 'a')).toEqual(['n', 'x', 'y']);
    const moved = showingBoard(v, {
      op: 'card.move',
      id: 'x',
      listId: 'b',
      position: cardPositionFor(v.cards, 'x', 'b', 1),
    });
    expect(ids(moved, 'a')).toEqual(['y']);
    expect(ids(moved, 'b')).toEqual(['z', 'x']);
    expect(showingBoard(v, { op: 'card.archive', id: 'y' }).cards.map((each) => each.id)).toEqual([
      'x',
      'z',
    ]);
    const without = showingBoard(v, { op: 'list.delete', id: 'a' });
    expect(without.cards.map((each) => each.id)).toEqual(['z']);
    // A card made for a list the board does not have is not shown.
    expect(
      showingBoard(v, { op: 'card.create', id: 'n', listId: 'nope', title: 'x', position: 'a5' }),
    ).toBe(v);
  });

  it('shows a rename and whether a description is there', () => {
    const v = base();
    expect(
      showingBoard(v, { op: 'card.rename', id: 'x', title: 'Renamed' }).cards.find(
        (c) => c.id === 'x',
      )?.title,
    ).toBe('Renamed');
    const described = showingBoard(v, { op: 'card.describe', id: 'x', description: 'Words' });
    expect(described.cards.find((c) => c.id === 'x')?.hasDescription).toBe(true);
    expect(
      showingBoard(described, { op: 'card.describe', id: 'x', description: '  ' }).cards.find(
        (c) => c.id === 'x',
      )?.hasDescription,
    ).toBe(false);
  });

  it('shows a due date and time on the tile, and no time without a date', () => {
    const v = base();
    const due = showingBoard(v, {
      op: 'card.setDue',
      id: 'x',
      dueDate: '2026-11-07',
      dueTime: '09:30',
    });
    expect(due.cards.find((c) => c.id === 'x')).toMatchObject({
      dueDate: '2026-11-07',
      dueTime: '09:30',
    });
    const cleared = showingBoard(due, {
      op: 'card.setDue',
      id: 'x',
      dueDate: null,
      dueTime: '10:00',
    });
    expect(cleared.cards.find((c) => c.id === 'x')).toMatchObject({ dueDate: null, dueTime: null });
  });

  it('shows a label made, changed and deleted, and on and off a card', () => {
    const v = base();
    const made = showingBoard(v, {
      op: 'label.create',
      id: 'L1',
      boardId: 'b',
      name: 'Bug',
      color: '#dc2626',
    });
    expect(made.labels).toEqual([{ id: 'L1', boardId: 'b', name: 'Bug', color: '#dc2626' }]);
    const on = showingBoard(made, { op: 'card.addLabel', cardId: 'x', labelId: 'L1' });
    expect(on.cards.find((c) => c.id === 'x')?.labels).toEqual(['L1']);
    // A label the board does not have is not put on a card, and twice is once.
    expect(showingBoard(made, { op: 'card.addLabel', cardId: 'x', labelId: 'nope' })).toBe(made);
    expect(
      showingBoard(on, { op: 'card.addLabel', cardId: 'x', labelId: 'L1' }).cards.find(
        (c) => c.id === 'x',
      )?.labels,
    ).toEqual(['L1']);
    const changed = showingBoard(on, {
      op: 'label.update',
      id: 'L1',
      name: 'Defect',
      color: '#000000',
    });
    expect(changed.labels[0]).toMatchObject({ name: 'Defect', color: '#000000' });
    expect(
      showingBoard(changed, { op: 'card.removeLabel', cardId: 'x', labelId: 'L1' }).cards.find(
        (c) => c.id === 'x',
      )?.labels,
    ).toEqual([]);
    // Deleted, it is off every card.
    const gone = showingBoard(on, { op: 'label.delete', id: 'L1' });
    expect(gone.labels).toEqual([]);
    expect(gone.cards.every((c) => c.labels.length === 0)).toBe(true);
    // The server's answer keeps the label where it was, and a deleted one is off every card.
    expect(
      settled(
        on,
        { op: 'label.update', id: 'L1', name: 'Z', color: '#000000' },
        { label: { id: 'L1', boardId: 'b', name: 'Z', color: '#000000' } },
      ).labels,
    ).toHaveLength(1);
    expect(
      settled(on, { op: 'label.delete', id: 'L1' }, { deletedLabel: 'L1' }).cards.find(
        (c) => c.id === 'x',
      )?.labels,
    ).toEqual([]);
  });

  it('finds the position among what is shown: the top, between two, and the end, in this list or another', () => {
    const v = base();
    expect(comparePositions(cardPositionFor(v.cards, 'y', 'a', 0), 'a0')).toBe(-1);
    const between = cardPositionFor(v.cards, 'z', 'a', 1);
    expect(comparePositions(between, 'a0')).toBe(1);
    expect(comparePositions(between, 'a1')).toBe(-1);
    expect(comparePositions(cardPositionFor(v.cards, 'x', 'a', 99), 'a1')).toBe(1);
    // Moving within a list leaves the moved card out of the neighbours: x to after y.
    expect(comparePositions(cardPositionFor(v.cards, 'x', 'a', 1), 'a1')).toBe(1);
    expect(topPosition([], 'a')).toBeTruthy();
  });

  it('keeps the server’s card, drops an archived one and a deleted one, and a restored one rejoins', () => {
    const v = base();
    const server = card('x', 'b', 'a9');
    expect(
      settled(
        v,
        { op: 'card.move', id: 'x', listId: 'b', position: 'a9' },
        { card: server },
      ).cards.find((c) => c.id === 'x'),
    ).toBe(server);
    expect(
      settled(v, { op: 'card.archive', id: 'x' }, { card: server }).cards.map((c) => c.id),
    ).toEqual(['y', 'z']);
    expect(
      settled(v, { op: 'card.delete', id: 'x' }, { deletedCard: 'x' }).cards.map((c) => c.id),
    ).toEqual(['y', 'z']);
    const restored = card('r', 'a', 'a5');
    expect(
      settled(v, { op: 'card.restore', id: 'r' }, { card: restored }).cards.map((c) => c.id),
    ).toContain('r');
  });
});
