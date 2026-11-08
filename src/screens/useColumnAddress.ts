'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type RefObject, useEffect, useRef } from 'react';

/** A board's own address, `/b/<id>`: the one that has lists to land on. A card's dialog is another address, over the same board, and writes nothing. */
const BOARD_ADDRESS = /^\/b\/[^/]+$/;

/**
 * **A board's column has an address** (DESIGN.md §18): `/b/<id>?list=<list id>`. Where a board's lists are snapped one at a time (a phone, by the style sheet: this
 * asks the browser whether the row snaps, and never how wide the screen is), the list that has settled at the left edge is written to the address with `replace`,
 * so a reload comes back to it and a link to it opens there; and a board opened at such an address scrolls to the list it names. Where the row does not snap
 * (a desktop, where the lists are side by side) it does nothing and the address is left alone.
 *
 * Only what is on screen is written, and only after the scrolling has stopped: a swipe is one replacement, not one for each pixel.
 */
export function useColumnAddress(columns: RefObject<HTMLElement | null>, listCount: number) {
  const router = useRouter();
  const pathname = usePathname();
  const wanted = useSearchParams().get('list');
  const named = useRef(wanted);
  named.current = wanted;
  const here = useRef(pathname);
  here.current = pathname;
  const opened = useRef(false);
  // The time of the last scroll this made, whose scroll events are not a person's.
  const ours = useRef(0);

  // Open on the list the address names, once the lists are there.
  useEffect(() => {
    const row = columns.current;
    if (!row || opened.current || listCount === 0) return;
    opened.current = true;
    if (!named.current || !snaps(row)) return;
    const target = columnsOf(row).find((each) => each.dataset.list === named.current);
    if (!target) return;
    ours.current = Date.now();
    row.scrollTo({ left: offsetOf(row, target), behavior: 'instant' });
  }, [columns, listCount]);

  // Write the list that settled.
  useEffect(() => {
    const row = columns.current;
    if (!row) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (Date.now() - ours.current < 300) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!snaps(row) || !BOARD_ADDRESS.test(here.current)) return;
        const left = row.scrollLeft;
        let nearest: HTMLElement | undefined;
        let best = Infinity;
        for (const each of columnsOf(row)) {
          const gap = Math.abs(offsetOf(row, each) - left);
          if (gap < best) {
            best = gap;
            nearest = each;
          }
        }
        const id = nearest?.dataset.list;
        if (id && id !== named.current)
          router.replace(`${here.current}?list=${encodeURIComponent(id)}`, { scroll: false });
      }, 150);
    };
    row.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      row.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [columns, router]);
}

const snaps = (row: HTMLElement) => getComputedStyle(row).scrollSnapType.includes('x');
const columnsOf = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>('[data-list]')];
/** Where a column stops when it is snapped to the left edge: its distance from the row's start, less the row's own padding (which `scroll-padding-left` keeps). */
const offsetOf = (row: HTMLElement, column: HTMLElement) =>
  column.getBoundingClientRect().left -
  row.getBoundingClientRect().left +
  row.scrollLeft -
  (Number.parseFloat(getComputedStyle(row).scrollPaddingLeft) || 0);

/** The id of the list that is at the left edge of a snapped row, or of the first when it does not snap: the list a phone is showing. */
export function listOnScreen(row: HTMLElement | null): string | undefined {
  if (!row) return undefined;
  const all = columnsOf(row);
  if (!snaps(row)) return all[0]?.dataset.list;
  let nearest: HTMLElement | undefined;
  let best = Infinity;
  for (const each of all) {
    const gap = Math.abs(offsetOf(row, each) - row.scrollLeft);
    if (gap < best) {
      best = gap;
      nearest = each;
    }
  }
  return nearest?.dataset.list;
}
