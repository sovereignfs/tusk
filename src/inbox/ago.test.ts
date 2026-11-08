import { describe, expect, it } from 'vitest';
import { ago } from './ago';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const before = (ms: number) => NOW - ms;

describe('how long ago', () => {
  it('is just now for the first minute, and for a time a little ahead of this clock', () => {
    expect(ago(before(0), NOW)).toBe('just now');
    expect(ago(before(59_999), NOW)).toBe('just now');
    expect(ago(before(-30_000), NOW)).toBe('just now');
  });

  it('is minutes, hours and days, each until the next begins', () => {
    expect(ago(before(60_000), NOW)).toBe('1m ago');
    expect(ago(before(59 * 60_000 + 59_000), NOW)).toBe('59m ago');
    expect(ago(before(60 * 60_000), NOW)).toBe('1h ago');
    expect(ago(before(23 * 3_600_000 + 59 * 60_000), NOW)).toBe('23h ago');
    expect(ago(before(24 * 3_600_000), NOW)).toBe('1d ago');
    expect(ago(before(6 * 86_400_000 + 3_600_000), NOW)).toBe('6d ago');
  });

  it('is the date from a week on', () => {
    expect(ago(before(7 * 86_400_000), NOW, 'en-US')).toBe('Nov 1');
    expect(ago(Date.parse('2026-08-03T12:00:00Z'), NOW, 'en-US')).toBe('Aug 3');
  });
});
