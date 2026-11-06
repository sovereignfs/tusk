import { describe, expect, it } from 'vitest';
import { addDays, isValidZone, localNow, todayFor, zoneOrUtc } from './time';

/**
 * The idea of today (DESIGN.md §11). **None of it reads the machine's zone,** so every case here gives the same answer under any `TZ`; `pnpm test:zones`
 * runs this file under UTC, Pacific/Auckland and America/Los_Angeles to show it.
 */
const at = (iso: string) => Date.parse(iso);

describe('today in a zone', () => {
  it('is the date there, either side of midnight', () => {
    // 23:30 UTC on the 5th is the 6th in Auckland (UTC+13 in November) and still the 5th in Los Angeles (UTC-8).
    const now = at('2026-11-05T23:30:00Z');
    expect(todayFor('UTC', now)).toBe('2026-11-05');
    expect(todayFor('Pacific/Auckland', now)).toBe('2026-11-06');
    expect(todayFor('America/Los_Angeles', now)).toBe('2026-11-05');
    // Just past midnight UTC: the 6th in UTC, the 5th in Los Angeles.
    expect(todayFor('UTC', at('2026-11-06T00:00:00Z'))).toBe('2026-11-06');
    expect(todayFor('America/Los_Angeles', at('2026-11-06T00:00:00Z'))).toBe('2026-11-05');
    // A zone behind the date line is a day behind.
    expect(todayFor('Pacific/Pago_Pago', at('2026-11-06T05:00:00Z'))).toBe('2026-11-05');
  });

  it('writes midnight as 00:00 and never 24:00', () => {
    expect(localNow('UTC', at('2026-11-06T00:00:00Z'))).toEqual({
      date: '2026-11-06',
      time: '00:00',
    });
    expect(localNow('America/Los_Angeles', at('2026-11-06T08:00:00Z'))).toEqual({
      date: '2026-11-06',
      time: '00:00',
    });
  });

  it('follows daylight saving, which a fixed offset would not', () => {
    // Los Angeles ends daylight saving on 2026-11-01: 08:30 UTC is 01:30 PDT, and 09:30 UTC is 01:30 PST, the same wall time an hour later.
    expect(localNow('America/Los_Angeles', at('2026-11-01T08:30:00Z'))).toEqual({
      date: '2026-11-01',
      time: '01:30',
    });
    expect(localNow('America/Los_Angeles', at('2026-11-01T09:30:00Z'))).toEqual({
      date: '2026-11-01',
      time: '01:30',
    });
    // Across the spring change (2026-03-08) the offset moves from -8 to -7: 09:59 UTC is 01:59 and 10:00 UTC is 03:00.
    expect(localNow('America/Los_Angeles', at('2026-03-08T09:59:00Z')).time).toBe('01:59');
    expect(localNow('America/Los_Angeles', at('2026-03-08T10:00:00Z')).time).toBe('03:00');
    // Auckland starts daylight saving on 2026-09-27 and the date still turns at its own midnight.
    expect(todayFor('Pacific/Auckland', at('2026-09-26T11:59:00Z'))).toBe('2026-09-26');
    expect(todayFor('Pacific/Auckland', at('2026-09-26T12:00:00Z'))).toBe('2026-09-27');
  });

  it('is UTC for a zone that is not one', () => {
    const now = at('2026-11-05T23:30:00Z');
    for (const bad of ['', 'Mars/Olympus', 'not a zone', 'UTC+13']) {
      expect(isValidZone(bad), bad).toBe(false);
      expect(todayFor(bad, now), bad).toBe('2026-11-05');
      expect(zoneOrUtc(bad)).toBe('UTC');
    }
    expect(isValidZone(undefined)).toBe(false);
    expect(isValidZone(7)).toBe(false);
    expect(isValidZone('Europe/Berlin')).toBe(true);
    expect(isValidZone('x'.repeat(65))).toBe(false);
  });

  it('writes a date as year, month and day, each padded', () => {
    expect(todayFor('UTC', at('2026-01-02T03:04:05Z'))).toBe('2026-01-02');
  });
});

describe('moving a date by days', () => {
  it('is the calendar’s: months, years and leap days', () => {
    expect(addDays('2026-11-05', 1)).toBe('2026-11-06');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-11-05', 7)).toBe('2026-11-12');
    expect(addDays('2026-11-05', 0)).toBe('2026-11-05');
    expect(addDays('2026-11-05', 365)).toBe('2027-11-05');
  });

  it('does not change across a daylight saving change, which has no part in it', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('refuses what is not a date', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '', 'tomorrow', '2026-11-05T00:00'])
      expect(() => addDays(bad, 1), bad).toThrow(RangeError);
  });
});
