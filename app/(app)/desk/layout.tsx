import type { ReactNode } from 'react';
import { DeskSurface } from '@/src/screens/DeskSurface';

// The Desk's pages (`/desk`, `/desk/<id>`) share this, so that on a phone one carousel stays mounted as a swipe changes the address (DESIGN.md §18).
export default function DeskLayout({ children }: { children: ReactNode }) {
  return <DeskSurface>{children}</DeskSurface>;
}
