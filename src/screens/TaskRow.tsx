'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type HTMLAttributes, useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { completeTask, isCompleted, reopenTask } from '../actions/tasks';
import type { LocalRow } from '../local/rows';
import { subtasksOf } from '../local/store';
import { useSync } from '../sync/react';
import { Checkbox } from '../ui';
import { text } from './fields';
import { ProgressRing } from './ProgressRing';
import { StarButton } from './StarButton';
import styles from './ListScreen.module.css';

const ids = { newId: () => crypto.randomUUID() };

/**
 * One task: a box to tick and the title, which opens the task in the right column (`?task=`). Ticking shows at once and **never flickers back**: the
 * box takes the person's answer the moment they give it, and lets go of it when the working copy says the same, so the short while the write takes
 * is not a moment the box shows the old state.
 */
export function TaskRow({
  task,
  open,
  progress,
  rowProps,
  linkProps,
}: {
  task: LocalRow;
  open: boolean;
  /** How many subtasks it has and how many are done, if it has any. */
  progress?: { done: number; total: number } | undefined;
  /** What the row needs to be dragged: set by `SortableTaskRow`, and none for a row that is not. */
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
  const done = isCompleted(task);
  const [asked, setAsked] = useState<boolean | null>(null);
  const checked = asked ?? done;
  const title = text(task, 'title', 'Untitled task');

  // The copy has caught up with what was asked (or something else changed it): the box goes back to showing the copy.
  useEffect(() => setAsked(null), [done]);

  async function toggle(next: boolean) {
    setAsked(next);
    // Ticking a parent ticks its open subtasks in the same mutation, so they are read first; reopening reopens nothing else.
    const subtasks = next ? await client.read((db) => subtasksOf(db, task.id)) : [];
    const result = next ? completeTask(task, Date.now(), ids, subtasks) : reopenTask(task, ids);
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
        id={`tick-${task.id}`}
        label=""
        aria-label={`Done: ${title}`}
        checked={checked}
        onChange={(next) => void toggle(next)}
      />
      <Link
        {...linkProps}
        href={`${pathname}?task=${task.id}`}
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
      <StarButton task={task} />
    </li>
  );
}

/**
 * A task that can be dragged into order (DESIGN.md §11.3). **The link is the handle**: it fills the row beside the box, a click on it opens the task
 * and a drag has to start by moving it, and it is what a keyboard focuses, which dnd-kit insists on (a key pressed in a child of the handle does not
 * pick the row up). dnd-kit's own `role="button"` is taken off, which would make each task a button to a screen reader; Space on the link lifts the
 * row, and Enter is left to open it.
 */
export function SortableTaskRow(props: {
  task: LocalRow;
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
    id: props.task.id,
  });
  return (
    <TaskRow
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
