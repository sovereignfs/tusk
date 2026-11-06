/**
 * The keyboard shortcuts of the page (DESIGN.md §17.8), as a pure function from a key and where it was pressed to what it asks for. **The page does
 * what the answer says** (`useShortcuts`); this only decides, so that when a key counts is tested without a page.
 *
 * - `n` a new card, `/` search, `j` and `k` (and the up and down arrows, when a card has the focus) the next and the previous card, `e` completes the
 *   card in focus, `Esc` closes what is open, `?` lists them. Enter opens the card in focus, and the card does that itself.
 * - **Nothing counts while typing:** in an input, a textarea, a select or an editable region a key is a letter. **Nothing counts with ctrl, cmd or alt**,
 *   which are the browser's and the system's (shift is allowed for `?` alone). A key a drag has already taken is not looked at again.
 */
export type Shortcut = 'new' | 'search' | 'next' | 'previous' | 'complete' | 'close' | 'help';

export interface KeyInfo {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented?: boolean;
  readonly repeat?: boolean;
}

export interface TargetInfo {
  readonly tagName?: string | undefined;
  readonly isContentEditable?: boolean | undefined;
}

/** What the page knows that the key alone does not. */
export interface Where {
  /** A card, a row or a tile, has the focus: only then do the arrows move among cards, and they are the page's to scroll otherwise. */
  readonly onCard: boolean;
  /** A card is being dragged by the keyboard, which takes the arrows and Space. */
  readonly dragging: boolean;
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Whether a key pressed here is being typed into something. */
export function isTyping(target: TargetInfo | null): boolean {
  return (
    !!target &&
    (target.isContentEditable === true || TYPING.has((target.tagName ?? '').toUpperCase()))
  );
}

export function shortcutOf(
  event: KeyInfo,
  target: TargetInfo | null,
  where: Where = { onCard: false, dragging: false },
): Shortcut | null {
  if (event.defaultPrevented) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  // Escape is for closing, and closes while typing too: it is the only way out of a field that has no other.
  if (event.key === 'Escape') return where.dragging ? null : 'close';
  if (isTyping(target)) return null;
  if (event.key === '?') return 'help';
  if (event.shiftKey) return null;
  if (where.dragging) return null;
  switch (event.key) {
    case 'n':
      return 'new';
    case '/':
      return 'search';
    case 'j':
      return 'next';
    case 'k':
      return 'previous';
    case 'e':
      return where.onCard ? 'complete' : null;
    case 'ArrowDown':
      return where.onCard ? 'next' : null;
    case 'ArrowUp':
      return where.onCard ? 'previous' : null;
    default:
      return null;
  }
}

/** The list the help shows: the keys, and what each does. */
export const SHORTCUT_HELP: readonly { keys: readonly string[]; does: string }[] = [
  { keys: ['n'], does: 'New card' },
  { keys: ['/'], does: 'Search' },
  { keys: ['j', '↓'], does: 'Next card' },
  { keys: ['k', '↑'], does: 'Previous card' },
  { keys: ['e'], does: 'Complete the card (on the Desk)' },
  { keys: ['Enter'], does: 'Open the card' },
  { keys: ['Space'], does: 'Pick a card up, then the arrows move it, and Space puts it down' },
  { keys: ['Esc'], does: 'Close' },
  { keys: ['?'], does: 'This list' },
];
