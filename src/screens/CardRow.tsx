'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type HTMLAttributes, useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { completeCard, isCompleted, reopenCard } from '../actions/cards';
import type { LocalRow } from '../local/rows';
import { checksOf } from '../local/store';
import { useSync } from '../sync/react';
import { Checkbox } from '../ui';
import { text } from './fields';
import { ProgressRing } from './ProgressRing';
import { StarButton } from './StarButton';
import styles from './ListScreen.module.css';

const ids = { newId: () => crypto.randomUUID() };

/**
 * One card: a box to tick and the title, which opens the card in the right column (`?card=`), as does a click anywhere else on the row that is not a
 * control of its own (the box, the star, the link). Ticking shows at once and **never flickers back**: the
 * box takes the person's answer the moment they give it, and lets go of it when the working copy says the same, so the short while the write takes
 * is not a moment the box shows the old state.
 */
export function CardRow({
  card,
  open,
  progress,
  rowProps,
  linkProps,
}: {
  card: LocalRow;
  open: boolean;
  /** How many checklist items it has and how many are done, if it has any. */
  progress?: { done: number; total: number } | undefined;
  /** What the row needs to be dragged: set by `SortableCardRow`, and none for a row that is not. */
  rowProps?: Partial<HTMLAttributes<HTMLLIElement>> & {
    ref?: (node: HTMLLIElement | null) => void;
  };
  /** What the link needs, since it is the handle and the one thing a keyboard focuses. */
  linkProps?: Partial<HTMLAttributes<HTMLAnchorElement>> & {
    ref?: (node: HTMLElement | null) => void;
  };
}) {
  const client = useSync();
  const pathname = usePathname();
  const router = useRouter();
  const done = isCompleted(card);
  const [asked, setAsked] = useState<boolean | null>(null);
  const checked = asked ?? done;
  const title = text(card, 'title', 'Untitled card');

  // The copy has caught up with what was asked (or something else changed it): the box goes back to showing the copy.
  useEffect(() => setAsked(null), [done]);

  async function toggle(next: boolean) {
    setAsked(next);
    // Ticking a card ticks its open checklist items in the same mutation, so they are read first; reopening reopens nothing else.
    const items = next ? await client.read((db) => checksOf(db, card.id)) : [];
    const result = next ? completeCard(card, Date.now(), ids, items) : reopenCard(card, ids);
    if (result.ok) void client.commit(result.mutation);
    else setAsked(null);
  }

  return (
    // The row's free space opens the card for a pointer, as the link does; a keyboard has the link (Enter opens it, Space lifts it), so nothing is
    // reachable only by this handler.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <li
      {...rowProps}
      className={`${styles.row} ${checked ? styles.done : ''}`}
      aria-current={open ? 'true' : undefined}
      onClick={(event) => {
        // The row's free space opens the card as the link does; the controls in it keep their own clicks.
        if ((event.target as HTMLElement).closest('a, button, input, label')) return;
        router.push(`${pathname}?card=${card.id}`, { scroll: false });
      }}
    >
      <Checkbox
        id={`tick-${card.id}`}
        label=""
        aria-label={`Done: ${title}`}
        checked={checked}
        onChange={(next) => void toggle(next)}
      />
      <Link
        {...linkProps}
        href={`${pathname}?card=${card.id}`}
        className={styles.name}
        scroll={false}
        // A link can be dragged by the browser too, and one dropped on the page is followed: that is a navigation in the middle of a reorder.
        draggable={false}
      >
        {title}
      </Link>
      {progress && progress.total > 0 ? (
        <ProgressRing done={progress.done} total={progress.total} />
      ) : null}
      <StarButton card={card} />
    </li>
  );
}

/**
 * A card that can be dragged into order (DESIGN.md §10.4). **The row is what is dragged**: a pointer that goes down anywhere on it and moves a few pixels
 * lifts it, and a click that does not move opens the card; the box and the star keep their own clicks. For a keyboard the link is the handle, which
 * dnd-kit insists on (a key pressed in a child of the handle does not pick the row up): Space on it lifts the row and Enter is left to open it. dnd-kit's
 * own `role="button"` is taken off, which would make each card a button to a screen reader.
 */
export function SortableCardRow(props: {
  card: LocalRow;
  open: boolean;
  progress?: { done: number; total: number } | undefined;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.card.id,
  });
  // The pointer starts a drag from the row and the keyboard from the link: one set of listeners, divided between them.
  const { onKeyDown, ...pointer } = (listeners ?? {}) as Record<string, (event: never) => void>;
  return (
    <CardRow
      {...props}
      rowProps={{
        ref: setNodeRef,
        style: {
          transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
          transition,
          opacity: isDragging ? 0.6 : 1,
        },
        ...(pointer as HTMLAttributes<HTMLLIElement>),
      }}
      linkProps={{
        ref: setActivatorNodeRef,
        ...attributes,
        role: undefined,
        ...(onKeyDown
          ? { onKeyDown: onKeyDown as HTMLAttributes<HTMLAnchorElement>['onKeyDown'] }
          : {}),
      }}
    />
  );
}
