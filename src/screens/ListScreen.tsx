'use client';

import Link from 'next/link';
import { uuid } from '../access/parse';
import { useSearchParams } from 'next/navigation';
import { isCompleted } from '../actions/tasks';
import type { LocalRow } from '../local/rows';
import { getRow, subtaskCounts, tasksOf } from '../local/store';
import { useHasSynced, useLocal } from '../sync/react';
import { EmptyState } from '../ui';
import { AddTask } from './AddTask';
import { TaskRow } from './TaskRow';
import { plain, text } from './fields';
import styles from './ListScreen.module.css';

/**
 * A list (DESIGN.md §14.1), read from the working copy. **A list that is not there for this account says so, with a way back**: an id that is not an
 * id, one that was deleted, one this account never had. It never waits for the network to say so, except on a device that has not yet been sent its
 * lists, where it says it is loading and not that the list is missing. The tasks are task 3.4's.
 */
export function ListScreen({ listId }: { listId: string }) {
  const valid = uuid(listId).ok;
  // Wrapped, so that "not found" (a row of `undefined`) is told apart from "not read yet" (no result at all).
  const read = useLocal(
    async (db) => ({ row: valid ? await getRow(db, 'list', listId) : undefined }),
    [listId, valid],
  );
  const synced = useHasSynced();

  if (read === undefined || synced === undefined) return null;
  const list = read.row;
  if (!valid || !list || list.deletedAt !== null) {
    if (valid && synced === false) return <p className={styles.muted}>Loading…</p>;
    return (
      <EmptyState
        icon="inbox"
        heading="That list is not here"
        description="It may have been deleted, or it may belong to someone else."
        action={<Link href="/">Go to your lists</Link>}
      />
    );
  }
  return <ListTasks list={list} />;
}

/** The list's tasks, from the working copy: the open ones in order, then the ones that are done, under a heading that opens and closes. */
function ListTasks({ list }: { list: LocalRow }) {
  const tasks = useLocal((db) => tasksOf(db, list.id), [list.id]);
  const counts = useLocal(subtaskCounts);
  const openId = useSearchParams().get('task');
  const all = tasks ?? [];
  const open = all.filter((task) => !isCompleted(task));
  // Most recently finished first.
  const done = all
    .filter(isCompleted)
    .sort((a, b) => Number(plain(b, 'completedAt')) - Number(plain(a, 'completedAt')));

  return (
    <section aria-label={text(list, 'title', 'List')}>
      <h1 className={styles.title}>{text(list, 'title', 'Untitled list')}</h1>
      <AddTask listId={list.id} tasks={open} />
      {tasks !== undefined && all.length === 0 ? (
        <p className={styles.muted}>Nothing here yet.</p>
      ) : null}
      <ul className={styles.tasks}>
        {open.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            open={openId === task.id}
            progress={counts?.get(task.id)}
          />
        ))}
      </ul>
      {done.length > 0 ? (
        <details className={styles.completed}>
          <summary className={styles.completedHeading}>Completed ({done.length})</summary>
          <ul className={styles.tasks}>
            {done.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                open={openId === task.id}
                progress={counts?.get(task.id)}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
