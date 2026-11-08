import { describe, expect, it } from 'vitest';
import { ACTIONS, LABELS, deskListOf, placeOf } from './footer-actions';

describe('the footer’s action', () => {
  it('is where the person is: the Desk, Boards, a board, or elsewhere', () => {
    expect(placeOf('/desk')).toBe('desk');
    expect(placeOf('/desk/3f2a')).toBe('desk');
    expect(placeOf('/')).toBe('boards');
    expect(placeOf('/w/abc')).toBe('boards');
    expect(placeOf('/b/abc')).toBe('board');
    expect(placeOf('/b/abc/c/def')).toBe('board');
    expect(placeOf('/inbox')).toBe('other');
    expect(placeOf('/planner')).toBe('other');
    expect(placeOf('/account')).toBe('other');
    // A page that only starts with the same letters is not the Desk.
    expect(placeOf('/desktop')).toBe('other');
  });

  it('offers what fits each, and every form has a name', () => {
    for (const place of ['desk', 'boards', 'board', 'other'] as const) {
      expect(ACTIONS[place].length).toBeGreaterThan(0);
      for (const action of ACTIONS[place]) expect(LABELS[action]).not.toBe('');
    }
    expect(ACTIONS.board).toEqual(['board-new-card', 'board-new-list']);
    // The Desk has the phone's two swipe views.
    expect(ACTIONS.desk).toEqual(expect.arrayContaining(['today', 'review']));
  });

  it('knows the list a Desk address names, and none for the Desk’s own', () => {
    expect(deskListOf('/desk/3f2a')).toBe('3f2a');
    expect(deskListOf('/desk')).toBeUndefined();
  });
});
