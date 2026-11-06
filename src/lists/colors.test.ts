import { describe, expect, it } from 'vitest';
import { parseField } from '../sync/validate';
import { DEFAULT_COLOR, SWATCHES, colorOf, isListColor } from './colors';

describe('the colour of a list', () => {
  it('is any #rrggbb, in lower case, and nothing else', () => {
    for (const color of ['#000000', '#ffffff', '#6b7280', '#12ab9f']) {
      expect(isListColor(color), color).toBe(true);
      expect(colorOf(color)).toBe(color);
    }
    for (const other of [
      '',
      'red',
      'purple',
      '#FFF',
      '#ffff',
      '#GGGGGG',
      '#6B7280',
      '6b7280',
      '#6b72801',
      'rgb(0,0,0)',
      'var(--x)',
      null,
      3,
    ]) {
      expect(isListColor(other), String(other)).toBe(false);
      expect(colorOf(other), String(other)).toBe(DEFAULT_COLOR);
    }
  });

  it('is offered as suggestions that are colours, each with a name, and none twice', () => {
    expect(SWATCHES.length).toBeGreaterThan(5);
    for (const swatch of SWATCHES) {
      expect(isListColor(swatch.value), swatch.label).toBe(true);
      expect(swatch.label.length).toBeGreaterThan(0);
    }
    expect(new Set(SWATCHES.map((s) => s.value)).size).toBe(SWATCHES.length);
    expect(isListColor(DEFAULT_COLOR)).toBe(true);
  });

  it('is what the server accepts for a list, and nothing else: the two cannot drift apart', () => {
    for (const color of [...SWATCHES.map((s) => s.value), '#010203'])
      expect(parseField('desk_list', 'color', { v: color }).ok, color).toBe(true);
    for (const other of ['purple', '#FFF', '#12345g', '', 5])
      expect(parseField('desk_list', 'color', { v: other }).ok, String(other)).toBe(false);
    // And ciphertext is a colour the server cannot read.
    expect(parseField('desk_list', 'color', { c: 'YWdl' }).ok).toBe(true);
  });
});
