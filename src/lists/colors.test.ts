import { describe, expect, it } from 'vitest';
import { parseField } from '../sync/validate';
import { DEFAULT_COLOR, LIST_COLORS, colorToken, isListColor } from './colors';

describe('a list’s colour', () => {
  it('is one of six, each a design token and never a colour of its own', () => {
    expect([...LIST_COLORS]).toEqual(['black', 'grey', 'green', 'blue', 'amber', 'red']);
    for (const color of LIST_COLORS) {
      expect(isListColor(color)).toBe(true);
      expect(colorToken(color)).toMatch(/^var\(--sv-color-[a-z-]+\)$/);
    }
    expect(new Set(LIST_COLORS.map(colorToken)).size).toBe(6);
  });

  it('is black for anything that is not one, including words an object has', () => {
    for (const other of ['purple', '', 'BLACK', 'toString', '__proto__', null, undefined, 3, {}]) {
      expect(isListColor(other)).toBe(false);
      expect(colorToken(other)).toBe(colorToken(DEFAULT_COLOR));
    }
  });

  it('is what the server accepts for a list, and nothing else: the two cannot drift apart', () => {
    for (const color of LIST_COLORS)
      expect(parseField('list', 'color', { v: color }).ok).toBe(true);
    expect(parseField('list', 'color', { v: 'purple' }).ok).toBe(false);
  });
});
