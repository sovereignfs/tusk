import { describe, expect, it } from 'vitest';
import { MAX_RANGE_DAYS, parseRange } from './range';

const q = (from: string | null, to: string | null) => {
  const params = new URLSearchParams();
  if (from !== null) params.set('from', from);
  if (to !== null) params.set('to', to);
  return parseRange(params);
};

describe('the range the Planner asks for', () => {
  it('is two real dates, in order, of at most nine weeks counting both ends', () => {
    expect(q('2026-11-08', '2026-11-08')).toEqual({
      ok: true,
      from: '2026-11-08',
      to: '2026-11-08',
    });
    expect(q('2026-11-08', '2027-01-08')).toEqual({
      ok: true,
      from: '2026-11-08',
      to: '2027-01-08',
    });
    expect(MAX_RANGE_DAYS).toBe(62);
    // 2026-11-08 + 61 days is the last day of the 62.
    expect(q('2026-11-08', '2027-01-08').ok).toBe(true);
    expect(q('2026-11-08', '2027-01-09').ok).toBe(false);
  });

  it('refuses a missing end, a date that is not one, and an end before the start', () => {
    for (const bad of [
      q(null, '2026-11-08'),
      q('2026-11-08', null),
      q('2026-02-30', '2026-03-02'),
      q('soon', 'later'),
      q('2026-11-09', '2026-11-08'),
      q('2026-11-08 ', '2026-11-09'),
    ])
      expect(bad.ok).toBe(false);
  });
});
