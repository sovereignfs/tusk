'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThreeColumnLayout, useIsMobile } from '../ui';
import { FirstList } from './FirstList';
import { Sidebar } from './Sidebar';
import { CardDetail } from './CardDetail';
import { KeyOffer } from './KeyOffer';
import { useKey } from './KeyContext';
import { UnlockKey } from './UnlockKey';
import { UndoProvider } from './Undo';

/**
 * Below the shell's header (DESIGN.md §17.4): a sidebar of 280px, the content, and a right sidebar of 360px **that is there only while a card is
 * open**, so that it shows two columns at first. The dimensions are the design system's defaults, matched to the reference screenshot.
 *
 * The content has about 24px of padding, set by the page inside it and not here, since a page may want its header to reach the edge.
 *
 * On a phone this is not the layout (task 7.2 is the mobile shell). It is the same routes and the same data, with the columns it cannot fit left
 * out: **a navigation decision is never forked by viewport, only what is rendered** (DESIGN.md §17.1).
 */
export function Frame({ children }: { children: ReactNode }) {
  const card = useSearchParams().get('card');
  const mobile = useIsMobile();
  const key = useKey();
  const onDesk = usePathname().startsWith('/desk');
  // A Desk that is sealed to a key this device does not have shows nothing of itself (DESIGN.md §9.1): not its lists, not its cards, not a first list.
  const locked = key.status === 'locked';

  return (
    <UndoProvider>
      {locked ? null : <FirstList />}
      <ThreeColumnLayout sidebarHidden={mobile}>
        {locked ? <div /> : <Sidebar />}
        <div style={{ padding: mobile ? 'var(--sv-space-4)' : 'var(--sv-space-6)' }}>
          {onDesk ? <KeyOffer /> : null}
          {locked && onDesk ? <UnlockKey /> : children}
        </div>
        {card && !mobile && !locked ? <CardDetail cardId={card} /> : null}
      </ThreeColumnLayout>
    </UndoProvider>
  );
}
