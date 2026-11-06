import { describe, expect, it } from 'vitest';
import type { BoardView, ChecklistItem } from '../workspaces/format';
import { progressOf, showingItems, sortItems, withProgress } from './checklist';

const item = (id: string, position: string, done = false): ChecklistItem => ({
  id,
  cardId: 'c',
  title: id,
  done,
  position,
});

describe('a card’s checklist as the dialog holds it', () => {
  const items = [item('a', 'a0'), item('b', 'a1', true), item('c', 'a2')];
  const ids = (list: readonly ChecklistItem[]) => list.map((each) => each.id).join('');

  it('adds at its position, renames, ticks, unticks, moves and deletes', () => {
    expect(
      ids(
        showingItems(items, { op: 'item.add', id: 'd', cardId: 'c', title: 'D', position: 'a3' }),
      ),
    ).toBe('abcd');
    expect(showingItems(items, { op: 'item.rename', id: 'a', title: 'New' })[0]?.title).toBe('New');
    expect(showingItems(items, { op: 'item.tick', id: 'a' })[0]?.done).toBe(true);
    expect(showingItems(items, { op: 'item.untick', id: 'b' })[1]?.done).toBe(false);
    expect(ids(showingItems(items, { op: 'item.move', id: 'a', position: 'a1V' }))).toBe('bac');
    expect(ids(showingItems(items, { op: 'item.delete', id: 'b' }))).toBe('ac');
  });

  it('counts the ticked and the whole, for the tile’s “2/5”', () => {
    expect(progressOf(items)).toEqual({ done: 1, total: 3 });
    expect(progressOf([])).toEqual({ done: 0, total: 0 });
    expect(progressOf(showingItems(items, { op: 'item.tick', id: 'a' }))).toEqual({
      done: 2,
      total: 3,
    });
  });

  it('keeps items in position order whatever order they are given, and does not change what it was given', () => {
    const copy = JSON.stringify(items);
    expect(ids(sortItems([item('z', 'a2'), item('y', 'a0'), item('x', 'a1')]))).toBe('yxz');
    showingItems(items, { op: 'item.delete', id: 'a' });
    expect(JSON.stringify(items)).toBe(copy);
  });

  it('sets a card’s count on the board, and nothing else', () => {
    const view = {
      cards: [
        { id: 'c', checklist: { done: 0, total: 0 } },
        { id: 'z', checklist: { done: 1, total: 2 } },
      ],
    } as unknown as BoardView;
    const next = withProgress(view, 'c', { done: 2, total: 5 });
    expect(next.cards.map((c) => c.checklist)).toEqual([
      { done: 2, total: 5 },
      { done: 1, total: 2 },
    ]);
  });
});
