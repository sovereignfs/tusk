import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  pageKind,
  parseStored,
  stateFor,
  toggleHidden,
  toggleRail,
  type Stored,
} from './sidebar';

describe('the kind of page', () => {
  it('is a canvas for the Desk and a board, and an index for everything else', () => {
    for (const path of ['/', '/desk', '/desk/abc', '/b/abc', '/b/abc/c/def'])
      expect(pageKind(path), path).toBe('canvas');
    for (const path of ['/boards', '/w/abc', '/inbox', '/planner', '/account', '/bogus'])
      expect(pageKind(path), path).toBe('index');
  });

  it('does not take a page whose name only starts like one of them', () => {
    expect(pageKind('/boards')).toBe('index');
    expect(pageKind('/deskwork')).toBe('index');
  });
});

describe('the default', () => {
  it('is full on an index and a rail on a canvas', () => {
    expect(DEFAULTS).toEqual({ index: 'full', canvas: 'rail' });
    expect(stateFor('index', {})).toBe('full');
    expect(stateFor('canvas', {})).toBe('rail');
  });
});

describe('what was stored', () => {
  it('is read back, and a kind that was not stored keeps its default', () => {
    const stored = parseStored(JSON.stringify({ canvas: { state: 'hidden', shown: 'full' } }));
    expect(stateFor('canvas', stored)).toBe('hidden');
    expect(stateFor('index', stored)).toBe('full');
  });

  it('is ignored when it is not what was written: nothing, nonsense, or a state that does not exist', () => {
    for (const raw of [
      null,
      undefined,
      '',
      'not json',
      '[]',
      '3',
      '{"canvas":"rail"}',
      '{"canvas":{"state":"wide"}}',
    ]) {
      expect(parseStored(raw), String(raw)).toEqual({});
    }
  });

  it('remembers how a hidden one was shown, or a rail when it does not say', () => {
    expect(parseStored('{"index":{"state":"hidden"}}').index).toEqual({
      state: 'hidden',
      shown: 'rail',
    });
    expect(parseStored('{"index":{"state":"full"}}').index).toEqual({
      state: 'full',
      shown: 'full',
    });
  });
});

describe('the buttons', () => {
  it('the header’s hides it and shows it again as it was, whichever it was', () => {
    for (const kind of ['index', 'canvas'] as const) {
      const was = stateFor(kind, {});
      const hidden = toggleHidden(kind, {});
      expect(stateFor(kind, hidden)).toBe('hidden');
      expect(stateFor(kind, toggleHidden(kind, hidden))).toBe(was);
    }
    // A rail that was widened, then hidden, comes back wide.
    const wide = toggleRail('canvas', {});
    expect(stateFor('canvas', toggleHidden('canvas', toggleHidden('canvas', wide)))).toBe('full');
  });

  it('the sidebar’s own makes a full one a rail and a rail full, and does nothing to a hidden one', () => {
    expect(stateFor('index', toggleRail('index', {}))).toBe('rail');
    expect(stateFor('canvas', toggleRail('canvas', {}))).toBe('full');
    const hidden = toggleHidden('index', {});
    expect(toggleRail('index', hidden)).toBe(hidden);
  });

  it('change one kind of page and leave the other as it was', () => {
    const stored: Stored = toggleHidden('canvas', {});
    expect(stateFor('index', stored)).toBe('full');
    expect(stateFor('canvas', toggleRail('index', stored))).toBe('hidden');
  });
});
