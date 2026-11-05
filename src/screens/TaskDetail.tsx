'use client';

import { usePathname, useRouter } from 'next/navigation';
import { getRow } from '../local/store';
import { useLocal } from '../sync/react';
import { Button } from '../ui';
import { text } from './fields';
import styles from './TaskDetail.module.css';

/**
 * The right column (DESIGN.md §15.2), present only while `?task=<id>` is set, so that a task can be linked to and reloaded. It shows the task
 * from the working copy; its fields and actions are the task screen's (task 3.4). Closing it **replaces** the address (DESIGN.md §15.8): a link
 * to the same path with another search parameter does nothing on a route that is already mounted, and a back button should not step through
 * every task that was looked at.
 */
export function TaskDetail({ taskId }: { taskId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const row = useLocal((db) => getRow(db, 'task', taskId), [taskId]);
  const close = () => router.replace(pathname);

  return (
    <section className={styles.detail} aria-label="Task">
      <div className={styles.bar}>
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      </div>
      {row === undefined ? null : row.deletedAt !== null ? (
        <p className={styles.muted}>That task is not here any more.</p>
      ) : (
        <h2 className={styles.title}>{text(row, 'title', 'Untitled task')}</h2>
      )}
    </section>
  );
}
