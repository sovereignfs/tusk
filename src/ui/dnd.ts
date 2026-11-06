import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
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
