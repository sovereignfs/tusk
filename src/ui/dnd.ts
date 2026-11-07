import {
  type Announcements,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * What every drag-to-reorder in the app shares (DESIGN.md §15.8), so that what each of those paid to learn is paid for once:
 *
 *  - **The sensors.** A pointer has to move a few pixels before it is a drag, so that a click on a row follows its link and ticks its box, and the
 *    keyboard picks a row up with Space, moves it with the arrows and puts it down with Space or lets it go with Escape. **Enter is left to the row's
 *    link**, which opens it.
 *  - **Auto-scroll only up and down.** dnd-kit scrolls whatever scrolls while a row is dragged near an edge, including a carousel sideways in the middle
 *    of a reorder; the horizontal threshold is zero, so nothing scrolls sideways.
 *  - **The click that ends a drag is not a click on a link.** The row is under the pointer when it is let go, and the browser clicks it.
 *  - **The order the person just made stays on the screen** until the working copy shows it too, so that a row does not spring back to where it was for
 *    the moment the write takes, and then jump.
 *
 * Each `DndContext` needs an explicit `id`, or the server and the browser name its pieces differently and React reports a mismatch.
 */
export function useReorderSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );
}

/** Pass to `DndContext`'s `autoScroll`: vertical only. */
export const VERTICAL_AUTOSCROLL = { threshold: { x: 0, y: 0.2 } } as const;

/** Pass to `DndContext`'s `autoScroll` on a board: sideways only, since its lists are columns side by side and scroll that way (DESIGN.md §17.5). */
export const HORIZONTAL_AUTOSCROLL = { threshold: { x: 0.15, y: 0 } } as const;

/**
 * Swallows the click that ends a drag. Call `begin()` when a drag starts and `end()` when it ends or is cancelled; the click comes straight after the
 * pointer is released, so the guard is held a moment longer. One listener, put on the window once.
 */
export function useDragClickGuard(): { begin: () => void; end: () => void } {
  const dragging = useRef(false);
  useEffect(() => {
    const swallow = (event: MouseEvent) => {
      if (!dragging.current) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('click', swallow, true);
    return () => window.removeEventListener('click', swallow, true);
  }, []);
  const begin = useCallback(() => {
    dragging.current = true;
  }, []);
  const end = useCallback(() => {
    setTimeout(() => (dragging.current = false), 150);
  }, []);
  return { begin, end };
}

/**
 * `rows` in the order the person has just made, until `rows` itself shows it. `show(ids)` is told the new order at the drop; if the working copy never
 * shows it (the write failed) the screen goes back to what the copy says after three seconds, and does not keep an order that is not so.
 */
export function useOptimisticOrder<T extends { id: string }>(
  rows: readonly T[],
): {
  rendered: readonly T[];
  show: (ids: readonly string[]) => void;
} {
  const [shown, setShown] = useState<readonly string[] | null>(null);
  const order = rows.map((row) => row.id).join();
  const rendered = shown
    ? [...rows].sort((a, b) => shown.indexOf(a.id) - shown.indexOf(b.id))
    : rows;

  useEffect(() => {
    if (shown && shown.join() === order) setShown(null);
  }, [shown, order]);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), 3000);
    return () => clearTimeout(timer);
  }, [shown]);

  return { rendered, show: setShown };
}

/** What a drag says of a thing it is moving or has come over. */
export interface Spoken {
  /** `list`, `card` or `item`. */
  readonly noun: string;
  /** What a person calls it (its title). **Never its id**: dnd-kit's own words read the id aloud. */
  readonly name: string;
  /** Where it is among its neighbours, from 1. */
  readonly position: number;
  readonly total: number;
  /** For a card, the list it is in. */
  readonly inside?: string;
}

const where = (about: Spoken) =>
  `position ${about.position} of ${about.total}${about.inside ? ` in ${about.inside}` : ''}`;

/**
 * What a drag says aloud (DESIGN.md §17.8). dnd-kit announces a pick-up, a move, a drop and a cancel in a live region, but in its own words, which name a thing by
 * its id ("Draggable item f0ed12b5-… was moved over droppable area f0ed…"): nothing a person could use. These say what it is and where it is, in order, so that a
 * drag by the keyboard can be done and checked by ear. `about` names a thing by its id, as the screen knows it, or `undefined` for what it does not know.
 */
export function spokenDrag(about: (id: string) => Spoken | undefined): {
  announcements: Announcements;
  screenReaderInstructions: { draggable: string };
} {
  const of = (id: string | number) => about(String(id));
  const pickedUp = (it: Spoken) =>
    `Picked up ${it.noun} ${it.name}, ${where(it)}. Move it with the arrow keys, drop it with Space, cancel with Escape.`;
  return {
    screenReaderInstructions: {
      draggable:
        'To pick this up, press Space. Move it with the arrow keys, drop it with Space, or cancel with Escape.',
    },
    announcements: {
      onDragStart({ active }) {
        const it = of(active.id);
        return it ? pickedUp(it) : 'Picked up.';
      },
      onDragOver({ active, over }) {
        const it = of(active.id);
        const there = over ? of(over.id) : undefined;
        if (!it || !there) return undefined;
        // The first thing after a pick-up is "over itself", in the same render as the pick-up, which would be replaced by it unheard: so it says the pick-up.
        if (over && String(over.id) === String(active.id)) return pickedUp(it);
        return there.noun === it.noun
          ? `${it.name} is over ${where(there)}.`
          : `${it.name} is over ${there.noun} ${there.name}.`;
      },
      onDragEnd({ active, over }) {
        const it = of(active.id);
        const there = over ? of(over.id) : undefined;
        if (!it) return 'Dropped.';
        return there && there.noun === it.noun
          ? `Dropped ${it.noun} ${it.name} at ${where(there)}.`
          : `Dropped ${it.noun} ${it.name}.`;
      },
      onDragCancel({ active }) {
        const it = of(active.id);
        return it ? `Cancelled. ${it.name} stays where it was.` : 'Cancelled.';
      },
    },
  };
}
