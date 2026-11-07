'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { Drawer, ThreeColumnLayout, useIsMobile } from '../ui';
import { useMobileNav } from '../ui/mobile-nav';
import { DrawerNavigation } from './AppSidebar';
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
 * On a phone it is one column at a time (DESIGN.md §18): the page, with the sidebar and the lists in a drawer the header's button opens, and a card's
 * detail as a page of its own in place of the list. It is the same routes and the same data: **a navigation decision is never forked by viewport, only what
 * is rendered** (DESIGN.md §17.1).
 */
export function Frame({ children }: { children: ReactNode }) {
  const card = useSearchParams().get('card');
  const mobile = useIsMobile();
  const nav = useMobileNav();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  // A choice made in the drawer (a place, a list, a search) was made: the drawer has done its work.
  const { setOpen } = nav;
  useEffect(() => setOpen(false), [pathname, search, setOpen]);
  const key = useKey();
  const onDesk = pathname.startsWith('/desk');
  // A Desk that is sealed to a key this device does not have shows nothing of itself (DESIGN.md §9.1): not its lists, not its cards, not a first list.
  // Hidden too while a sealed Desk's key is being looked for: what a device last knew is enough, and nothing blank is shown meanwhile.
  const locked = key.status === 'locked' || (key.sealed && key.status === 'loading');

  return (
    <UndoProvider>
      {locked ? null : <FirstList />}
      <ThreeColumnLayout sidebarHidden={mobile}>
        {locked || mobile ? <div /> : <Sidebar />}
        <div style={{ padding: mobile ? 'var(--sv-space-4)' : 'var(--sv-space-6)' }}>
          {onDesk ? <KeyOffer /> : null}
          {onDesk && key.progress ? (
            <p role="status" aria-label="Sealing the Desk">
              Sealing your Desk with your key
              {key.progress.total > 0
                ? `: ${Math.min(key.progress.done, key.progress.total)} of ${key.progress.total}`
                : ''}
              . You can go on using it.
            </p>
          ) : null}
          {locked && onDesk ? (
            <UnlockKey />
          ) : card && mobile && !locked ? (
            // A card's detail on a phone is a page of its own, in place of the list it was opened from; its Close goes back to the list.
            <CardDetail cardId={card} />
          ) : (
            children
          )}
        </div>
        {card && !mobile && !locked ? <CardDetail cardId={card} /> : null}
      </ThreeColumnLayout>
      {mobile && !locked ? (
        <Drawer
          open={nav.open}
          onClose={() => setOpen(false)}
          aria-label="Navigation"
          title="Navigation"
        >
          <DrawerNavigation />
          <Sidebar />
        </Drawer>
      ) : null}
    </UndoProvider>
  );
}
