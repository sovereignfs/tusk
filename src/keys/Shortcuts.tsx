'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { closeCard } from '../screens/address';
import { Dialog } from '../ui';
import { SHORTCUT_HELP, type Shortcut, isTyping, shortcutOf } from './rules';
import styles from './Shortcuts.module.css';

/**
 * The keyboard of the page (DESIGN.md §17.8), listening on the whole signed-in area. `shortcutOf` decides what a key asks for; this does it, by finding
 * the thing in the page: the field marked `data-shortcut="new-card"` or `"search"`, and the cards marked `data-shortcut-card`, in the order they are in.
 * A screen takes part by carrying the marks, and needs no code of its own: the Desk's rows and a board's tiles are found the same way.
 */
const CARD = '[data-shortcut-card]';

/**
 * The field a mark names. A page's own comes before one in a sidebar: a board has its search, and the lists column beside it has the Desk's.
 */
function marked(name: string): HTMLElement | undefined {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-shortcut="${name}"]`));
  return all.find((each) => !each.closest('nav')) ?? all[0];
}

const cards = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(CARD));
const focusedCard = (): HTMLElement | null =>
  document.activeElement instanceof HTMLElement
    ? document.activeElement.closest<HTMLElement>(CARD)
    : null;

function go(direction: 'next' | 'previous') {
  const all = cards();
  if (all.length === 0) return;
  const at = focusedCard();
  const index = at ? all.indexOf(at) : -1;
  const target =
    direction === 'next'
      ? all[index < 0 ? 0 : Math.min(index + 1, all.length - 1)]
      : all[index < 0 ? all.length - 1 : Math.max(index - 1, 0)];
  target?.focus();
  target?.scrollIntoView({ block: 'nearest' });
}

/**
 * Something open that has its own Escape: a dialog, a menu, a list of choices, a picker in the card's detail, or the bar of chosen cards. What it closes
 * is not ours to close as well. (A button that is expanded elsewhere, the sidebar's, is not one.)
 */
const holdsEscape = (): boolean =>
  document.querySelector(
    '[role="dialog"], [role="menu"], [role="listbox"], [role="toolbar"], [aria-label="Card"] [aria-expanded="true"]',
  ) !== null;

export function Shortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const card = useSearchParams().get('card');
  const [help, setHelp] = useState(false);

  useEffect(() => {
    // Whether something with its own Escape was open when the key went down: asked first, in the capture phase, because by the time this hears the key
    // that thing has heard it too and closed, and would then look as if nothing was open.
    let heldEscape = false;
    const onCapture = (event: KeyboardEvent) => {
      if (event.key === 'Escape') heldEscape = holdsEscape();
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const active = document.activeElement;
      const onCard = focusedCard() !== null;
      // A card picked up by the keyboard is a drag: dnd-kit marks its handle as pressed, and the arrows and Space are its.
      const dragging =
        active instanceof HTMLElement && active.closest('[aria-pressed="true"]') !== null && onCard;
      const action: Shortcut | null = shortcutOf(event, target, { onCard, dragging });
      if (action === null) return;

      if (action === 'close') {
        // In a field, Escape leaves it; the next one closes. Something open with its own Escape is left to close itself.
        if (isTyping(target)) {
          target?.blur();
          return;
        }
        if (help) setHelp(false);
        else if (card && !heldEscape) closeCard();
        return;
      }

      event.preventDefault();
      switch (action) {
        case 'new': {
          const field = marked('new-card');
          if (field instanceof HTMLInputElement) field.focus();
          else field?.click();
          return;
        }
        case 'search': {
          const field = marked('search');
          field?.focus();
          if (field instanceof HTMLInputElement) field.select();
          return;
        }
        case 'next':
        case 'previous':
          go(action);
          return;
        case 'complete': {
          const at = focusedCard();
          const box = at?.closest('li')?.querySelector<HTMLInputElement>('input[type="checkbox"]');
          if (!at || !box) return;
          const index = cards().indexOf(at);
          box.click();
          // The card leaves the open ones once written: the focus goes to the one that took its place, and is not lost to the page.
          window.setTimeout(() => {
            const all = cards();
            all[Math.min(index, all.length - 1)]?.focus();
          }, 120);
          return;
        }
        case 'help':
          setHelp(true);
          return;
      }
    };
    window.addEventListener('keydown', onCapture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onCapture, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [router, pathname, card, help]);

  if (!help) return null;
  return (
    <Dialog
      open
      onClose={() => setHelp(false)}
      aria-label="Keyboard shortcuts"
      title="Keyboard shortcuts"
      size="sm"
    >
      <dl className={styles.list}>
        {SHORTCUT_HELP.map((row) => (
          <div key={row.keys.join()} className={styles.row}>
            <dt className={styles.keys}>
              {row.keys.map((each) => (
                <kbd key={each} className={styles.key}>
                  {each}
                </kbd>
              ))}
            </dt>
            <dd className={styles.does}>{row.does}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
