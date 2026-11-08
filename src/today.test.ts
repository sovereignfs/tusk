import { describe, expect, it } from 'vitest';
import type { LocalRow } from './local/rows';
import { buildToday, reasonFor } from './today';

/** Today (DESIGN.md §25.3), with no clock: the day and the time are given. */
let n = 0;
const card = (
  title: string,
  fields: Record<string, string | number | boolean | null> = {},
  extra: Partial<LocalRow> = {},
): LocalRow =>
  ({
    table: 'desk_card',
    id: `c${String(++n).padStart(3, '0')}`,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    listId: 'l1',
    position: 'a0',
    fields: Object.fromEntries(
      Object.entries({ title, ...fields }).map(([k, v]) => [k, { v, s: 1 }]),
    ),
    ...extra,
  }) as unknown as LocalRow;

const TODAY = '2026-11-08';
const titles = (rows: ReturnType<typeof buildToday>) =>
  rows.map((r) => `${r.reason}:${(r.card.fields.title as { v: string }).v}`);

describe('buildToday', () => {
  it('has the overdue, then what is due today, then the starred, each card once and for the first reason that fits', () => {
    const rows = buildToday(
      [
        card('Starred only', { starred: true }),
        card('Today b', { dueDate: TODAY, dueTime: '15:00' }),
        card('Overdue old', { dueDate: '2026-11-01' }),
        card('Today a', { dueDate: TODAY, dueTime: '09:00' }),
        card('Overdue and starred', { dueDate: '2026-11-05', starred: true }),
        card('Future', { dueDate: '2026-11-20' }),
        card('Nothing'),
      ],
      TODAY,
    );
    expect(titles(rows)).toEqual([
      'overdue:Overdue old',
      'overdue:Overdue and starred',
      'today:Today a',
      'today:Today b',
      'starred:Starred only',
    ]);
  });

  it('puts due today with no time after those with one, and settles a tie by title and then id', () => {
    const rows = buildToday(
      [
        card('Zed', { dueDate: TODAY }),
        card('Alpha', { dueDate: TODAY }),
        card('Timed', { dueDate: TODAY, dueTime: '23:00' }),
      ],
      TODAY,
    );
    expect(titles(rows)).toEqual(['today:Timed', 'today:Alpha', 'today:Zed']);
  });

  it('orders the starred by title, case aside', () => {
    expect(
      titles(
        buildToday([card('beta', { starred: true }), card('Alpha', { starred: true })], TODAY),
      ),
    ).toEqual(['starred:Alpha', 'starred:beta']);
  });

  it('leaves out what is done, deleted, or dismissed for today, and takes back what was dismissed on another day', () => {
    const rows = buildToday(
      [
        card('Done', { dueDate: '2026-11-01', completedAt: 5 }),
        card('Deleted', { dueDate: '2026-11-01' }, { deletedAt: 9 }),
        card('Dismissed today', { dueDate: '2026-11-01', dismissedOn: TODAY }),
        card('Dismissed yesterday', { dueDate: '2026-11-01', dismissedOn: '2026-11-07' }),
      ],
      TODAY,
    );
    expect(titles(rows)).toEqual(['overdue:Dismissed yesterday']);
    // And the next day it is back.
    expect(
      titles(
        buildToday([card('Back', { dueDate: '2026-11-01', dismissedOn: TODAY })], '2026-11-09'),
      ),
    ).toEqual(['overdue:Back']);
  });

  it('counts a card due today at an hour that has passed as overdue, when it is given the time', () => {
    const late = card('Late', { dueDate: TODAY, dueTime: '08:00' });
    expect(reasonFor(late, TODAY)).toBe('today');
    expect(reasonFor(late, TODAY, '07:59')).toBe('today');
    expect(reasonFor(late, TODAY, '08:01')).toBe('overdue');
    expect(reasonFor(card('No time', { dueDate: TODAY }), TODAY, '23:59')).toBe('today');
  });

  it('gives the same order whatever order the cards came in', () => {
    const cards = [
      card('b', { dueDate: '2026-11-02' }),
      card('a', { dueDate: '2026-11-02' }),
      card('c', { starred: true }),
      card('d', { dueDate: TODAY }),
    ];
    expect(titles(buildToday([...cards].reverse(), TODAY))).toEqual(
      titles(buildToday(cards, TODAY)),
    );
  });
});
