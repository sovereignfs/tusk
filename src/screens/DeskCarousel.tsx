'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { LocalRow } from '../local/rows';
import { listsOf } from '../local/store';
import { useHasSynced, useLocal } from '../sync/react';
import {
  SwipableMobileCarousel,
  SwipableMobileCarouselSlide,
  SwipableMobileCarouselSlideBody,
  useCarouselRouteSync,
} from '../ui';
import { DeskScreen } from './DeskScreen';
import { ListScreen } from './ListScreen';
import { useSearchQuery } from './search-query';
import { SearchResults } from './SearchResults';
import { text } from './fields';

/** The list a Desk address names: `/desk/<id>`, or nothing for `/desk`. */
function listIdOf(pathname: string): string | undefined {
  const match = /^\/desk\/([^/]+)/.exec(pathname);
  return match?.[1];
}

/**
 * The Desk on a phone (DESIGN.md §18): one slide per list, swiped sideways, **at the same addresses as everywhere**. A slide is `/desk/<id>`, and `/desk` is the
 * first. Swiping settles on a slide and replaces the address with that list's, so a reload comes back to it; following a link to a list (from the drawer) moves
 * the carousel there (`useCarouselRouteSync`, which tells the two apart). **A swipe shows no spinner:** every list is already in the working copy, each
 * slide's cards are read from it, and the carousel keeps the neighbours of the one on screen mounted.
 *
 * What is not a slide draws itself: a search (`#q=`), an id that is not one of this account's lists (the list screen says so, with a way back), and an
 * account with no list yet. It decides nothing by width: it is shown instead of the page by `DeskSurface`, which is what asks.
 */
export function DeskCarousel() {
  const lists = useLocal(listsOf);
  const synced = useHasSynced();
  const pathname = usePathname();
  const query = useSearchQuery();

  if (query.trim() !== '') return <SearchResults query={query} />;
  if (lists === undefined || synced === undefined) return null;
  if (lists.length === 0) return <DeskScreen />;
  const current = listIdOf(pathname);
  if (current !== undefined && !lists.some((list) => list.id === current))
    return <ListScreen listId={current} />;
  return <Slides lists={lists} pathname={pathname} />;
}

/**
 * The slides, mounted only once the lists are known: the carousel opens on the list the address names (a reload at `/desk/<id>`), which it could not if its
 * position were worked out before there were any lists to find it in.
 */
function Slides({ lists, pathname }: { lists: LocalRow[]; pathname: string }) {
  const router = useRouter();
  const ids = lists.map((list) => list.id);
  const { activeIndex, onSettle } = useCarouselRouteSync({
    indexForPathname: (path) => {
      const at = ids.indexOf(listIdOf(path) ?? '');
      return at < 0 ? 0 : at;
    },
    pathForIndex: (index) => `/desk/${ids[index] ?? ''}`,
    pathname,
    onNavigate: (path) => router.replace(path, { scroll: false }),
  });

  return (
    <SwipableMobileCarousel aria-label="Your lists" activeIndex={activeIndex} onSettle={onSettle}>
      {lists.map((list) => (
        <SwipableMobileCarouselSlide
          key={list.id}
          slideKey={list.id}
          label={text(list, 'title', 'Untitled list')}
        >
          <SwipableMobileCarouselSlideBody>
            {/* Clear of the dots, which sit over the bottom of the slide: the last card scrolls above them. */}
            <div style={{ paddingBottom: 'var(--sv-space-10)' }}>
              <ListScreen listId={list.id} />
            </div>
          </SwipableMobileCarouselSlideBody>
        </SwipableMobileCarouselSlide>
      ))}
    </SwipableMobileCarousel>
  );
}
