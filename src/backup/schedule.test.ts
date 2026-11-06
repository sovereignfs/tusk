import { describe, expect, it } from 'vitest';
import { FREQUENCIES, INTERVAL_MS, isFrequency, isMode, nextBackup, spreadMs } from './schedule';

/** When an automatic backup is due (DESIGN.md §21.4): pure, with the clock passed in. */
const NOW = Date.parse('2026-11-06T14:30:00Z');
const ACCOUNTS = Array.from({ length: 200 }, (_, n) => `account-${n}`);

describe('spreadMs', () => {
  it('is the same for an account every time, and within a tenth of the interval, ten minutes at most', () => {
    for (const frequency of FREQUENCIES) {
      const room = Math.min(10 * 60_000, INTERVAL_MS[frequency] / 10);
      for (const id of ACCOUNTS) {
        const spread = spreadMs(id, frequency);
        expect(spread).toBe(spreadMs(id, frequency));
        expect(spread).toBeGreaterThanOrEqual(0);
        expect(spread).toBeLessThan(room);
      }
    }
  });

  it('differs between accounts, so that they do not all fall on one minute', () => {
    const minutes = new Set(ACCOUNTS.map((id) => Math.floor(spreadMs(id, 'daily') / 60_000)));
    expect(minutes.size).toBeGreaterThan(5);
  });
});

describe('nextBackup', () => {
  it('is one interval from now, plus the spread, when a mode or frequency is chosen', () => {
    for (const frequency of FREQUENCIES)
      expect(nextBackup(frequency, NOW, 'ada')).toBe(
        NOW + INTERVAL_MS[frequency] + spreadMs('ada', frequency),
      );
    expect(INTERVAL_MS).toEqual({
      hourly: 3_600_000,
      '6h': 21_600_000,
      daily: 86_400_000,
      weekly: 604_800_000,
    });
  });

  it('keeps its place after a run: the time it was claimed for plus an interval, with no drift by how long the run took or how late it began', () => {
    const due = NOW - 90_000;
    expect(nextBackup('daily', NOW, 'ada', due)).toBe(due + INTERVAL_MS.daily);
    // A job that ran a minute late, and another a few seconds late, stay on the same grid.
    expect(nextBackup('hourly', due + 3_000, 'ada', due)).toBe(due + INTERVAL_MS.hourly);
    expect(nextBackup('hourly', due + 60_000, 'ada', due)).toBe(due + INTERVAL_MS.hourly);
  });

  it('starts over from now when the server missed more than an interval, and never returns a time that has passed', () => {
    const missed = NOW - 3 * INTERVAL_MS.daily;
    expect(nextBackup('daily', NOW, 'ada', missed)).toBe(
      NOW + INTERVAL_MS.daily + spreadMs('ada', 'daily'),
    );
    // An interval exactly missed is missed.
    expect(nextBackup('daily', NOW, 'ada', NOW - INTERVAL_MS.daily)).toBeGreaterThan(NOW);
    for (const frequency of FREQUENCIES)
      for (const late of [
        0,
        1,
        59_999,
        INTERVAL_MS[frequency] - 1,
        INTERVAL_MS[frequency],
        INTERVAL_MS[frequency] * 5,
      ])
        expect(nextBackup(frequency, NOW, 'ada', NOW - late)).toBeGreaterThan(NOW);
  });

  it('ignores a due time that is in the future', () => {
    expect(nextBackup('daily', NOW, 'ada', NOW + 1000)).toBe(
      NOW + INTERVAL_MS.daily + spreadMs('ada', 'daily'),
    );
  });
});

describe('the names', () => {
  it('are the ones the design has', () => {
    expect([...FREQUENCIES]).toEqual(['hourly', '6h', 'daily', 'weekly']);
    expect(isFrequency('6h')).toBe(true);
    expect(isFrequency('monthly')).toBe(false);
    expect(isFrequency(undefined)).toBe(false);
    expect(isMode('auto')).toBe(true);
    expect(isMode('manual')).toBe(true);
    expect(isMode('off')).toBe(false);
  });
});
