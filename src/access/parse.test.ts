import { describe, expect, it } from 'vitest';
import { MAX_IDS, hhmm, idArray, isoDate, text, uuid } from './parse';

const ID = '3f2b8c1e-5d4a-4e7b-9c10-0a1b2c3d4e5f';
const good = (parser: (v: unknown) => { ok: boolean }, value: unknown) =>
  expect(parser(value).ok, JSON.stringify(value)).toBe(true);
const bad = (parser: (v: unknown) => { ok: boolean }, value: unknown) =>
  expect(parser(value).ok, JSON.stringify(value)).toBe(false);

describe('uuid', () => {
  it('takes what crypto.randomUUID makes', () => {
    good(uuid, ID);
    for (let i = 0; i < 20; i++) good(uuid, crypto.randomUUID());
  });

  it('refuses what is not an id, in particular what would be harmful in a statement or a path', () => {
    for (const value of [
      '',
      'abc',
      ID.toUpperCase(), // the same id spelled another way would be another row
      ID.slice(1),
      `${ID} `,
      `${ID}\n`,
      "' OR 1=1 --",
      `${ID}'; DROP TABLE task; --`,
      '../../etc/passwd',
      ID.replace(/-/g, ''),
      '00000000-0000-0000-0000-000000000000', // no version, no variant
      null,
      undefined,
      42,
      {},
      [ID],
      { toString: () => ID },
    ])
      bad(uuid, value);
  });

  it('never repeats the input in its reason', () => {
    const result = uuid("' OR 1=1 --");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain('OR 1=1');
  });
});

describe('text', () => {
  const title = text(1, 500);

  it('takes text within its bounds, line breaks and all', () => {
    good(title, 'Buy milk');
    good(title, 'a');
    good(title, 'a'.repeat(500));
    good(text(0, 20_000), '');
    good(text(0, 20_000), 'line one\nline two');
  });

  it('refuses the empty, the too long, what is not text, and NUL', () => {
    bad(title, '');
    bad(title, 'a'.repeat(501));
    bad(title, 5);
    bad(title, null);
    bad(title, ['a']);
    bad(title, 'before\u0000after');
  });

  it('counts a person’s characters, not the code units a string is made of', () => {
    good(text(1, 3), '😀😀😀'); // three characters, six code units
    bad(text(1, 3), '😀😀😀😀');
    bad(text(2, 3), '😀');
  });

  it('does not walk a huge string to find out it is too long', () => {
    expect(title('x'.repeat(10_000_000)).ok).toBe(false);
  });
});

describe('isoDate', () => {
  it('takes a date that exists', () => {
    for (const value of ['2026-11-05', '2024-02-29', '2000-02-29', '0001-01-01', '2026-12-31'])
      good(isoDate, value);
  });

  it('refuses one that does not, and what is not a date', () => {
    for (const value of [
      '2026-02-29', // 2026 is not a leap year
      '1900-02-29',
      '2026-04-31',
      '2026-13-01',
      '2026-00-10',
      '2026-01-00',
      '0000-01-01',
      '2026-1-5',
      '2026/11/05',
      '2026-11-05T00:00:00Z',
      ' 2026-11-05',
      '20261105',
      '',
      null,
      20261105,
    ])
      bad(isoDate, value);
  });
});

describe('hhmm', () => {
  it('takes a time on a 24-hour clock', () => {
    for (const value of ['00:00', '09:05', '12:30', '23:59']) good(hhmm, value);
  });

  it('refuses the rest', () => {
    for (const value of ['24:00', '12:60', '9:05', '09:5', '09:05:00', '9am', '', null, 905])
      bad(hhmm, value);
  });
});

describe('idArray', () => {
  it('takes a list of ids, an empty one included, and keeps their order', () => {
    const other = crypto.randomUUID();
    const result = idArray()([ID, other]);
    expect(result).toEqual({ ok: true, value: [ID, other] });
    good(idArray(), []);
  });

  it('takes up to 500 and refuses 501', () => {
    const ids = Array.from({ length: MAX_IDS }, () => crypto.randomUUID());
    good(idArray(), ids);
    bad(idArray(), [...ids, crypto.randomUUID()]);
    bad(
      idArray(3),
      Array.from({ length: 4 }, () => crypto.randomUUID()),
    );
  });

  it('refuses a list with one bad id in it, and what is not a list, so that no part of it is used', () => {
    bad(idArray(), [ID, 'nope']);
    bad(idArray(), [ID, null]);
    bad(idArray(), ID);
    bad(idArray(), { 0: ID, length: 1 });
    bad(idArray(), null);
  });
});
