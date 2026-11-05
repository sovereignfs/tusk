import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { LIST_COLORS, colorToken } from '../lists/colors';
import { colourOf, plain, text } from './fields';

const list = (
  fields: Record<string, { v: unknown; s: number } | { c: string; s: number }>,
): LocalRow =>
  ({
    table: 'list',
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

  it("shows a list's colour as its token, and black for anything else", () => {
    for (const name of LIST_COLORS)
      expect(colourOf(list({ color: { v: name, s: 1 } }))).toBe(colorToken(name));
    expect(colourOf(list({ color: { v: 'purple', s: 1 } }))).toBe(colorToken('black'));
    expect(colourOf(list({ color: { c: 'YWdl', s: 1 } }))).toBe(colorToken('black'));
    expect(colourOf(list({}))).toBe(colorToken('black'));
  });
});
