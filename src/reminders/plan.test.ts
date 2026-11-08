import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { instantOf } from '../time';
import { slotsFor } from './plan';

/** What is told of a Desk the server cannot read (DESIGN.md §25.2, task 14.6): instants, from the cards that have a date and a time, and nothing else. */
const NOW = Date.parse('2026-11-08T09:00:00Z');
const card = (
  id: string,
  fields: Record<string, unknown>,
  extra: Partial<LocalRow> = {},
): LocalRow =>
  ({
    table: 'desk_card',
    id,
    listId: 'l',
    position: 'a0',
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { v, s: 1 }])),
    ...extra,
  }) as LocalRow;

describe('where a time is in an instant', () => {
  it('is the instant it is that time in the zone, either side of the date line and through a clock change', () => {
    expect(instantOf('UTC', '2026-11-08', '09:30')).toBe(Date.parse('2026-11-08T09:30:00Z'));
    expect(instantOf('Asia/Kolkata', '2026-11-08', '09:30')).toBe(
      Date.parse('2026-11-08T04:00:00Z'),
    );
    expect(instantOf('America/Los_Angeles', '2026-11-08', '09:30')).toBe(
      Date.parse('2026-11-08T17:30:00Z'),
    );
    // A day before the clocks go back in Los Angeles (2026-11-01), and the day after: -7 then -8.
    expect(instantOf('America/Los_Angeles', '2026-10-31', '12:00')).toBe(
      Date.parse('2026-10-31T19:00:00Z'),
    );
    expect(instantOf('America/Los_Angeles', '2026-11-02', '12:00')).toBe(
      Date.parse('2026-11-02T20:00:00Z'),
    );
    // The hour a clock skips (2026-03-08 02:30 in Los Angeles) is the instant just after it.
    expect(instantOf('America/Los_Angeles', '2026-03-08', '02:30')).toBe(
      Date.parse('2026-03-08T10:30:00Z'),
    );
  });
});

describe('the instants of a Desk', () => {
  it('has one for each distinct due time of an open card, to come, in order, and nothing for the rest', () => {
    const cards = [
      card('a', { dueDate: '2026-11-09', dueTime: '10:00' }),
      // Two cards due together are one instant.
      card('b', { dueDate: '2026-11-09', dueTime: '10:00' }),
      card('c', { dueDate: '2026-11-08', dueTime: '09:30' }),
      // No time, done, deleted, already past, too far off, or not a card: none.
      card('d', { dueDate: '2026-11-09' }),
      card('e', { dueDate: '2026-11-09', dueTime: '11:00', completedAt: 5 }),
      card('f', { dueDate: '2026-11-09', dueTime: '12:00' }, { deletedAt: 9 }),
      card('g', { dueDate: '2026-11-07', dueTime: '09:30' }),
      card('h', { dueDate: '2026-12-31', dueTime: '09:30' }),
      {
        ...card('i', { dueDate: '2026-11-09', dueTime: '13:00' }),
        table: 'desk_check',
      } as unknown as LocalRow,
    ];
    expect(slotsFor(cards, 'UTC', NOW)).toEqual([
      Date.parse('2026-11-08T09:30:00Z'),
      Date.parse('2026-11-09T10:00:00Z'),
    ]);
  });

  it('keeps the minute that is now, and is in the zone of the account', () => {
    expect(
      slotsFor([card('a', { dueDate: '2026-11-08', dueTime: '09:00' })], 'UTC', NOW + 20_000),
    ).toEqual([NOW]);
    expect(
      slotsFor([card('a', { dueDate: '2026-11-08', dueTime: '15:00' })], 'Asia/Kolkata', NOW),
    ).toEqual([Date.parse('2026-11-08T09:30:00Z')]);
  });

  it('holds no more than the server takes', () => {
    const many = Array.from({ length: 800 }, (_, i) =>
      card(`c${i}`, {
        dueDate: '2026-11-09',
        dueTime: `${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
      }),
    );
    expect(slotsFor(many, 'UTC', NOW).length).toBeLessThanOrEqual(700);
  });
});
