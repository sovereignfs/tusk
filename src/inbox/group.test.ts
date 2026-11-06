import { describe, expect, it } from 'vitest';
import type { NoticeRow } from '../workspaces/format';
import { groupByDay, noticeHref, noticeText, unreadLabel } from './group';

/** How the Inbox reads (DESIGN.md §16), with the time and the zone given: no clock is read. */
const at = (iso: string) => Date.parse(iso);
const notice = (id: string, createdAt: number, extra: Partial<NoticeRow> = {}): NoticeRow => ({
  id,
  kind: 'assigned',
  actorName: 'Ada',
  workspaceId: 'w',
  boardId: 'b',
  cardId: 'c',
  subject: 'Pay the invoice',
  createdAt,
  ...extra,
});

describe('notices grouped by the day they were written', () => {
  const now = at('2026-11-06T12:00:00Z');

  it('says Today, Yesterday and the date, newest day first and newest notice first within it', () => {
    const list = [
      notice('old', at('2026-11-01T10:00:00Z')),
      notice('t1', at('2026-11-06T08:00:00Z')),
      notice('y1', at('2026-11-05T20:00:00Z')),
      notice('t2', at('2026-11-06T09:30:00Z')),
      notice('last-year', at('2025-12-24T10:00:00Z')),
    ];
    const groups = groupByDay(list, now, 'UTC', 'en-US');
    expect(groups.map((g) => g.label)).toEqual([
      'Today',
      'Yesterday',
      'Sun, Nov 1',
      'Wed, Dec 24, 2025',
    ]);
    expect(groups[0]?.notices.map((n) => n.id)).toEqual(['t2', 't1']);
  });

  it('uses the person’s own zone: the same moment is a different day in another', () => {
    // 10:00 UTC on the 6th is 23:00 on the 6th in Auckland and 02:00 on the 6th in Los Angeles.
    const morning = at('2026-11-06T10:00:00Z');
    const late = notice('late', at('2026-11-05T23:30:00Z'));
    expect(groupByDay([late], morning, 'UTC', 'en-US')[0]?.label).toBe('Yesterday');
    // 23:30 UTC on the 5th is 12:30 on the 6th in Auckland: today there.
    expect(groupByDay([late], morning, 'Pacific/Auckland', 'en-US')[0]?.label).toBe('Today');
    expect(groupByDay([late], morning, 'America/Los_Angeles', 'en-US')[0]?.label).toBe('Yesterday');
  });

  it('breaks a tie by id so that the order never shuffles, and does not change what it was given', () => {
    const list = [notice('a', 5), notice('b', 5)];
    const copy = JSON.stringify(list);
    expect(groupByDay(list, 5, 'UTC')[0]?.notices.map((n) => n.id)).toEqual(['b', 'a']);
    expect(JSON.stringify(list)).toBe(copy);
    expect(groupByDay([], now, 'UTC')).toEqual([]);
  });
});

describe('what a notice says and where it goes', () => {
  it('names who did what to what', () => {
    expect(noticeText(notice('n', 1))).toBe('Ada assigned you to Pay the invoice');
    expect(noticeText(notice('n', 1, { kind: 'comment' }))).toBe(
      'Ada commented on Pay the invoice',
    );
    expect(noticeText(notice('n', 1, { kind: 'added_to_workspace', subject: 'Acme' }))).toBe(
      'Ada added you to the workspace Acme',
    );
    expect(noticeText(notice('n', 1, { kind: 'added_to_board', subject: 'Roadmap' }))).toBe(
      'Ada added you to the board Roadmap',
    );
    expect(noticeText(notice('n', 1, { actorName: null, subject: '' }))).toBe(
      'Someone assigned you to a card',
    );
  });

  it('opens the card, or the board, or the workspace, whichever it is about', () => {
    expect(noticeHref({ workspaceId: 'w', boardId: 'b', cardId: 'c' })).toBe('/b/b/c/c');
    expect(noticeHref({ workspaceId: 'w', boardId: 'b', cardId: null })).toBe('/b/b');
    expect(noticeHref({ workspaceId: 'w', boardId: null, cardId: null })).toBe('/w/w');
    expect(noticeHref({ workspaceId: null, boardId: null, cardId: null })).toBe('/boards');
  });

  it('counts unread as nothing, the number, or 99+', () => {
    expect(unreadLabel(0)).toBeNull();
    expect(unreadLabel(7)).toBe('7');
    expect(unreadLabel(99)).toBe('99');
    expect(unreadLabel(100)).toBe('99+');
    expect(unreadLabel(250)).toBe('99+');
  });
});
