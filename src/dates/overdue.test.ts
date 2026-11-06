import { describe, expect, it } from 'vitest';
import { localNow } from '../time';
import { isDueTodayOrOverdue, isOverdue } from './overdue';

const at = (date: string, time: string) => ({ date, time });

describe('overdue', () => {
  it('is a date before today, whatever the time, and a time before now on today', () => {
    const now = at('2026-11-06', '14:30');
    expect(isOverdue({ date: '2026-11-05', time: null }, now)).toBe(true);
    expect(isOverdue({ date: '2026-11-05', time: '23:59' }, now)).toBe(true);
    expect(isOverdue({ date: '2026-11-06', time: '14:29' }, now)).toBe(true);
    expect(isOverdue({ date: '2026-11-06', time: '14:30' }, now)).toBe(false);
    expect(isOverdue({ date: '2026-11-06', time: '14:31' }, now)).toBe(false);
  });

  it('is not a date with no time on today, a later day, or no date at all', () => {
    const now = at('2026-11-06', '23:59');
    expect(isOverdue({ date: '2026-11-06', time: null }, now)).toBe(false);
    expect(isOverdue({ date: '2026-11-07', time: '00:00' }, now)).toBe(false);
    expect(isOverdue({ date: null, time: null }, now)).toBe(false);
    expect(isOverdue({ date: null, time: '08:00' }, now)).toBe(false);
  });

  it('is due today or overdue from the day on, whatever the time', () => {
    const now = at('2026-11-06', '00:00');
    expect(isDueTodayOrOverdue({ date: '2026-11-06', time: '23:59' }, now)).toBe(true);
    expect(isDueTodayOrOverdue({ date: '2026-01-01', time: null }, now)).toBe(true);
    expect(isDueTodayOrOverdue({ date: '2026-11-07', time: null }, now)).toBe(false);
    expect(isDueTodayOrOverdue({ date: null, time: null }, now)).toBe(false);
  });

  it('is decided in the zone the clock is read in: the same instant is two days in two places', () => {
    const instant = Date.UTC(2026, 10, 6, 23, 30);
    const due = { date: '2026-11-06', time: '23:00' };
    expect(isOverdue(due, localNow('UTC', instant))).toBe(true);
    expect(isOverdue(due, localNow('America/Los_Angeles', instant))).toBe(false);
    expect(isOverdue(due, localNow('Pacific/Auckland', instant))).toBe(true);
  });
});
