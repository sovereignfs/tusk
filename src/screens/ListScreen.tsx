'use client';

import Link from 'next/link';
import { uuid } from '../access/parse';
import { getRow } from '../local/store';
import { useHasSynced, useLocal } from '../sync/react';
import { EmptyState } from '../ui';
import { text } from './fields';
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
        action={<Link href="/home">Go to your lists</Link>}
      />
    );
  }
  return (
    <section aria-label={text(list, 'title', 'List')}>
      <h1 className={styles.title}>{text(list, 'title', 'Untitled list')}</h1>
      <p className={styles.muted}>There are no tasks to show yet.</p>
    </section>
  );
}
