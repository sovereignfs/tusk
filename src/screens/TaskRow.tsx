'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { completeTask, isCompleted, reopenTask } from '../actions/tasks';
import type { LocalRow } from '../local/rows';
import { subtasksOf } from '../local/store';
import { useSync } from '../sync/react';
import { Checkbox } from '../ui';
import { text } from './fields';
import { ProgressRing } from './ProgressRing';
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
}: {
  task: LocalRow;
  open: boolean;
  /** How many subtasks it has and how many are done, if it has any. */
  progress?: { done: number; total: number } | undefined;
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
      <Link href={`${pathname}?task=${task.id}`} className={styles.name} scroll={false}>
        {title}
      </Link>
      {progress && progress.total > 0 ? (
        <ProgressRing done={progress.done} total={progress.total} />
      ) : null}
    </li>
  );
}
