import { describe, expect, it } from 'vitest';
import { backupFingerprint, backupMessage, backupPath } from './path';

/** What a backup is called, what it says, and the fingerprint of what it holds (DESIGN.md §21.3, §21.4): pure, with the clock passed in. */
describe('backupPath and backupMessage', () => {
  it('name a backup by its UTC time, so that names sort in order', () => {
    const at = new Date('2026-11-06T14:30:00Z');
    expect(backupPath(at)).toBe('tusk/2026-11-06_14-30-00.json');
    expect(backupMessage(at)).toBe('Tusk backup 2026-11-06 14:30:00 UTC');
  });

  it('pad every part, and read the time as UTC whatever the zone of the machine is', () => {
    expect(backupPath(new Date('2026-01-02T03:04:05Z'))).toBe('tusk/2026-01-02_03-04-05.json');
    // The same instant written with an offset is the same name.
    expect(backupPath(new Date('2026-01-02T04:04:05+01:00'))).toBe('tusk/2026-01-02_03-04-05.json');
    expect(backupPath(new Date('2026-12-31T23:59:59.999Z'))).toBe('tusk/2026-12-31_23-59-59.json');
    expect(backupPath(new Date('2027-01-01T00:00:00Z'))).toBe('tusk/2027-01-01_00-00-00.json');
  });

  it('sort as the times do', () => {
    const times = [
      '2026-11-06T09:00:00Z',
      '2026-11-06T14:30:00Z',
      '2026-11-07T00:00:01Z',
      '2027-02-01T10:00:00Z',
      '2026-03-09T23:59:59Z',
    ].map((t) => new Date(t));
    const byTime = [...times].sort((a, b) => a.getTime() - b.getTime()).map(backupPath);
    expect(byTime).toEqual([...byTime].sort());
  });
});

describe('backupFingerprint', () => {
  const stamps = ['w:1:100', 'b:2:5:100:', 'm:1:a:owner'];

  it('is the same for the same state, in any order of the stamps, and 32 hex characters', () => {
    const one = backupFingerprint(7, stamps);
    expect(one).toMatch(/^[0-9a-f]{32}$/);
    expect(backupFingerprint(7, [...stamps].reverse())).toBe(one);
  });

  it('changes with the Desk’s counter and with any stamp', () => {
    const base = backupFingerprint(7, stamps);
    expect(backupFingerprint(8, stamps)).not.toBe(base);
    expect(backupFingerprint(7, ['w:1:101', ...stamps.slice(1)])).not.toBe(base);
    expect(backupFingerprint(7, [...stamps, 'b:3:1:1:'])).not.toBe(base);
    expect(backupFingerprint(7, stamps.slice(1))).not.toBe(base);
  });

  it('does not run a counter and a stamp together into another state', () => {
    expect(backupFingerprint(1, ['2'])).not.toBe(backupFingerprint(12, []));
  });
});
