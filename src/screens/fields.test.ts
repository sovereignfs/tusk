import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { LIST_COLOURS, colourOf, plain, text } from './fields';

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

  it('maps each of the six colours to a token, and anything else to black', () => {
    expect(Object.keys(LIST_COLOURS)).toEqual(['black', 'grey', 'green', 'blue', 'amber', 'red']);
    for (const [name, value] of Object.entries(LIST_COLOURS)) {
      expect(colourOf(list({ color: { v: name, s: 1 } }))).toBe(value);
      // A token and never a colour of its own, so that dark mode and theming keep working.
      expect(value).toMatch(/^var\(--sv-color-[a-z-]+\)$/);
    }
    expect(colourOf(list({ color: { v: 'purple', s: 1 } }))).toBe(LIST_COLOURS.black);
    expect(colourOf(list({ color: { v: 'toString', s: 1 } }))).toBe(LIST_COLOURS.black);
    expect(colourOf(list({}))).toBe(LIST_COLOURS.black);
  });
});
