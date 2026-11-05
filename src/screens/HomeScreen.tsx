'use client';

import { listsOf } from '../local/store';
import { useHasSynced, useLocal } from '../sync/react';
import styles from './ListScreen.module.css';
import { ListScreen } from './ListScreen';

/**
 * The front address for someone signed in (DESIGN.md §14.1): their first list, in the order of the sidebar, read from the device. On a device that
 * has never synced it says it is loading, and on one that has it waits the moment it takes to make *My tasks* for an account that has no list.
 */
export function HomeScreen() {
  const lists = useLocal(listsOf);
  const synced = useHasSynced();
  const first = lists?.[0];
  if (first) return <ListScreen listId={first.id} />;
  if (lists === undefined || synced === undefined) return null;
  return <p className={styles.muted}>{synced ? '' : 'Loading your lists…'}</p>;
}
