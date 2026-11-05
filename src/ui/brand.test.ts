import { describe, expect, it } from 'vitest';
import { markOf } from './brand';

describe('markOf', () => {
  it('is the first two letters, the first a capital', () => {
    expect(markOf('Tasks')).toBe('Ta');
    expect(markOf('  tasks  ')).toBe('Ta');
  });

  it('takes whole characters, not halves of a pair', () => {
    expect(markOf('🌿grow')).toBe('🌿g');
  });

  it('falls back to the app’s own letter for an empty name', () => {
    expect(markOf('')).toBe('T');
  });
});
