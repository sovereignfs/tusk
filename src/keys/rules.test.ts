import { describe, expect, it } from 'vitest';
import { type KeyInfo, SHORTCUT_HELP, isTyping, shortcutOf } from './rules';

/** The keys of the page (DESIGN.md §17.8): what each asks for, and the many places where it asks for nothing. */
const key = (k: string, extra: Partial<KeyInfo> = {}): KeyInfo => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});
const on = { onCard: true, dragging: false };
const page = { onCard: false, dragging: false };

describe('what a key asks for', () => {
  it('is new, search, next, previous, complete, close and help, for the keys the design names', () => {
    expect(shortcutOf(key('n'), null, page)).toBe('new');
    expect(shortcutOf(key('/'), null, page)).toBe('search');
    expect(shortcutOf(key('j'), null, page)).toBe('next');
    expect(shortcutOf(key('k'), null, page)).toBe('previous');
    expect(shortcutOf(key('e'), null, on)).toBe('complete');
    expect(shortcutOf(key('Escape'), null, page)).toBe('close');
    expect(shortcutOf(key('?', { shiftKey: true }), null, page)).toBe('help');
    expect(shortcutOf(key('ArrowDown'), null, on)).toBe('next');
    expect(shortcutOf(key('ArrowUp'), null, on)).toBe('previous');
  });

  it('leaves the arrows to the page unless a card has the focus, and completes only a card', () => {
    expect(shortcutOf(key('ArrowDown'), null, page)).toBeNull();
    expect(shortcutOf(key('ArrowUp'), null, page)).toBeNull();
    expect(shortcutOf(key('e'), null, page)).toBeNull();
  });

  it('asks for nothing while typing: a letter in a title, a note, a menu or an editable region is a letter', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea'])
      for (const k of ['n', '/', 'j', 'k', 'e', '?', 'ArrowDown'])
        expect(shortcutOf(key(k), { tagName }, on), `${k} in ${tagName}`).toBeNull();
    expect(shortcutOf(key('n'), { tagName: 'DIV', isContentEditable: true }, on)).toBeNull();
    expect(isTyping({ tagName: 'DIV' })).toBe(false);
    expect(isTyping({ tagName: 'BUTTON' })).toBe(false);
    expect(isTyping(null)).toBe(false);
    // A button, a link or a card is not typed into.
    expect(shortcutOf(key('n'), { tagName: 'A' }, on)).toBe('new');
    expect(shortcutOf(key('n'), { tagName: 'BUTTON' }, on)).toBe('new');
  });

  it('closes even while typing, which is the way out of a field', () => {
    expect(shortcutOf(key('Escape'), { tagName: 'INPUT' }, page)).toBe('close');
    expect(shortcutOf(key('Escape'), { tagName: 'TEXTAREA' }, page)).toBe('close');
  });

  it('asks for nothing with ctrl, cmd or alt held, which are the browser’s and the system’s, or with shift but for the question mark', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const)
      for (const k of ['n', '/', 'j', 'k', 'e', 'Escape', 'ArrowDown'])
        expect(shortcutOf(key(k, { [mod]: true }), null, on), `${k} with ${mod}`).toBeNull();
    for (const k of ['N', 'J', 'K', 'E'])
      expect(shortcutOf(key(k, { shiftKey: true }), null, on), k).toBeNull();
    expect(shortcutOf(key('?', { shiftKey: true }), null, on)).toBe('help');
  });

  it('asks for nothing of a key something has already taken, and leaves a drag by the keyboard its keys', () => {
    expect(shortcutOf(key('j', { defaultPrevented: true }), null, on)).toBeNull();
    const dragging = { onCard: true, dragging: true };
    for (const k of ['n', '/', 'j', 'k', 'e', 'ArrowDown', 'ArrowUp', 'Escape'])
      expect(shortcutOf(key(k), null, dragging), k).toBeNull();
  });

  it('asks for nothing of other keys', () => {
    for (const k of ['a', 'x', 'N', 'Enter', ' ', 'Tab', 'ArrowLeft', 'ArrowRight', '1', ''])
      expect(shortcutOf(key(k), null, on), JSON.stringify(k)).toBeNull();
  });

  it('is listed in the help, each key once and with what it does', () => {
    expect(SHORTCUT_HELP.map((row) => row.keys[0])).toEqual([
      'n',
      '/',
      'j',
      'k',
      'e',
      'Enter',
      'Space',
      'Esc',
      '?',
    ]);
    for (const row of SHORTCUT_HELP) expect(row.does.length).toBeGreaterThan(0);
  });
});
