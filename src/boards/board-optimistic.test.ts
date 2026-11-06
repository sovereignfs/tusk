import { describe, expect, it } from 'vitest';
import { comparePositions } from '../position';
import type { BoardView, ListRow } from '../workspaces/format';
import { endPosition, positionFor, settled, showingBoard, sortLists } from './board-optimistic';

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
  can: { edit: true, admin: true },
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
    const kept = settled(guess, { list: list('b', 'a1', 'Doing!'), version: 9 });
    expect(kept.lists[1]?.name).toBe('Doing!');
    expect(kept.board.version).toBe(9);
    expect(names(settled(kept, { deletedList: 'a', version: 10 }))).toEqual(['b', 'c']);
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
