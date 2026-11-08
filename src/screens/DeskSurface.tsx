'use client';

import type { ReactNode } from 'react';
import { ResponsiveSurface } from '../ui';
import { DeskCarousel } from './DeskCarousel';

/**
 * What the Desk draws (DESIGN.md §18): the page for the address on a wide screen, and on a phone the carousel of its lists. **The same routes and the same data:**
 * the choice is only what is rendered, and it is made here, in the Desk's layout, so that the carousel is not remounted when a swipe changes the address from
 * one page of the Desk to another.
 */
export function DeskSurface({ children }: { children: ReactNode }) {
  return <ResponsiveSurface web={children} mobile={<DeskCarousel />} />;
}
