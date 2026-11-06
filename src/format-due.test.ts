import { describe, expect, it } from 'vitest';
import { formatDue, formatTime } from './format-due';

/** How a due date reads (DESIGN.md §11). The locale is given, so that the answers do not depend on the machine's. */
describe('a due date as shown', () => {
  const today = '2026-11-06';

  it('says Today and Tomorrow, and the day of the month for any other, with the year only when it is not this one', () => {
    expect(formatDue('2026-11-06', null, today, 'en-US').text).toBe('Today');
    expect(formatDue('2026-11-07', null, today, 'en-US').text).toBe('Tomorrow');
    expect(formatDue('2026-03-05', null, today, 'en-US').text).toBe('Mar 5');
    expect(formatDue('2025-03-05', null, today, 'en-US').text).toBe('Mar 5, 2025');
    expect(formatDue('2027-01-02', null, today, 'en-US').text).toBe('Jan 2, 2027');
  });

  it('is the same date wherever it is shown: a floating date is not moved by a zone', () => {
    // Formatted in UTC from its own year, month and day: the first of a month is the first in any zone.
    expect(formatDue('2026-12-01', null, today, 'en-US').text).toBe('Dec 1');
    expect(formatDue('2026-12-01', null, today, 'de-DE').text).toMatch(/1/);
  });

  it('puts the time after the date in the locale’s 12- or 24-hour form', () => {
    expect(formatDue('2026-11-06', '09:00', today, 'en-US').text).toBe('Today, 9:00 AM');
    expect(formatDue('2026-11-07', '17:30', today, 'en-US').text).toBe('Tomorrow, 5:30 PM');
    expect(formatTime('00:05', 'en-GB')).toBe('00:05');
    expect(formatTime('13:45', 'en-GB')).toBe('13:45');
    expect(formatTime('13:45', 'en-US')).toBe('1:45 PM');
  });

  it('is overdue before today, and not today or after', () => {
    expect(formatDue('2026-11-05', null, today, 'en-US').overdue).toBe(true);
    expect(formatDue('2025-12-31', null, today, 'en-US').overdue).toBe(true);
    expect(formatDue('2026-11-06', null, today, 'en-US').overdue).toBe(false);
    expect(formatDue('2026-11-07', null, today, 'en-US').overdue).toBe(false);
  });
});
