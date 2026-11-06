import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { DEFAULT_COLOR, SWATCHES } from '../lists/colors';
import { colourOf, plain, text } from './fields';

const list = (
  fields: Record<string, { v: unknown; s: number } | { c: string; s: number }>,
): LocalRow =>
  ({
    table: 'desk_list',
    id: 'x',
    position: 'a0',
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields,
  }) as LocalRow;

describe('reading fields for a screen', () => {
  it('reads a plain field, and nothing for one that is missing or ciphertext, never the ciphertext', () => {
    const row = list({ title: { v: 'Home', s: 1 }, notes: { c: 'YWdlLWVuY3J5cHRpb24', s: 1 } });
    expect(text(row, 'title')).toBe('Home');
    expect(text(row, 'notes', 'unreadable')).toBe('unreadable');
    expect(plain(row, 'notes')).toBeUndefined();
    expect(text(row, 'missing', 'fallback')).toBe('fallback');
    expect(text(undefined, 'title', 'fallback')).toBe('fallback');
    expect(text(list({ title: { v: 5, s: 1 } }), 'title', 'not text')).toBe('not text');
  });

  it("shows a list's colour as it was picked, any #rrggbb, and the neutral one for anything else", () => {
    for (const swatch of SWATCHES)
      expect(colourOf(list({ color: { v: swatch.value, s: 1 } }))).toBe(swatch.value);
    expect(colourOf(list({ color: { v: '#13579b', s: 1 } }))).toBe('#13579b');
    expect(colourOf(list({ color: { v: 'purple', s: 1 } }))).toBe(DEFAULT_COLOR);
    expect(colourOf(list({ color: { c: 'YWdl', s: 1 } }))).toBe(DEFAULT_COLOR);
    expect(colourOf(list({}))).toBe(DEFAULT_COLOR);
  });
});
