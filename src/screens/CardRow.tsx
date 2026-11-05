'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
 * One card: a box to tick and the title, which opens the card in the right column (`?card=`). Ticking shows at once and **never flickers back**: the
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
    <li
      {...rowProps}
      className={`${styles.row} ${checked ? styles.done : ''}`}
      aria-current={open ? 'true' : undefined}
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
 * A card that can be dragged into order (DESIGN.md §10.4). **The link is the handle**: it fills the row beside the box, a click on it opens the task
 * and a drag has to start by moving it, and it is what a keyboard focuses, which dnd-kit insists on (a key pressed in a child of the handle does not
 * pick the row up). dnd-kit's own `role="button"` is taken off, which would make each card a button to a screen reader; Space on the link lifts the
 * row, and Enter is left to open it.
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
      }}
      linkProps={{ ref: setActivatorNodeRef, ...attributes, role: undefined, ...listeners }}
    />
  );
}
