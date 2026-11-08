import { describe, expect, it } from 'vitest';
import type { NoticeRow } from '../workspaces/format';
import { merge } from './notifications';

const row = (id: string, createdAt: number): NoticeRow => ({
  id,
  kind: 'assigned',
  actorName: 'Ada',
  workspaceId: null,
  boardId: null,
  cardId: null,
  subject: 'x',
  createdAt,
  read: false,
});

describe('the first page read again, with the older ones already loaded', () => {
  it('keeps the older notices that are older than the page, in order, and drops what the page now holds', () => {
    const first = [row('e', 50), row('d', 40), row('c', 30)];
    const kept = [row('e', 50), row('d', 40), row('c', 30), row('b', 20), row('a', 10)];
    expect(merge(first, kept).map((n) => n.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  it('does not bring back an older one the page has moved past, or repeat one', () => {
    // 'c' was loaded as older, but the page has since grown past it.
    const first = [row('f', 60), row('e', 50), row('d', 40), row('c', 30)];
    expect(merge(first, [row('c', 30), row('b', 20)]).map((n) => n.id)).toEqual([
      'f',
      'e',
      'd',
      'c',
      'b',
    ]);
    // Two at one time are told apart by the id, as the cursor tells them.
    expect(merge([row('b', 30)], [row('a', 30), row('c', 30)]).map((n) => n.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('is the page alone when nothing older was loaded, and nothing when the page is empty', () => {
    expect(merge([row('a', 1)], []).map((n) => n.id)).toEqual(['a']);
    expect(merge([], [row('a', 1)])).toEqual([]);
  });
});
