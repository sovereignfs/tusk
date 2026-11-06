'use client';

import { useSearchParams } from 'next/navigation';
import { listsOf } from '../local/store';
import { useHasSynced, useLocal } from '../sync/react';
import styles from './ListScreen.module.css';
import { ListScreen } from './ListScreen';
import { SearchResults } from './SearchResults';

/**
 * The Desk (DESIGN.md §10, §17.4), which is also the front address for someone signed in: their first list, in the order of the lists column, read from
 * the device. On a device that has never synced it says it is loading, and on one that has it waits the moment it takes to make _Backlog_ for an account
 * that has no list.
 */
export function DeskScreen() {
  const lists = useLocal(listsOf);
  const synced = useHasSynced();
  const first = lists?.[0];
  // `/desk?q=` is a search of the Desk (§10.7), shown in place of the first list.
  const query = useSearchParams().get('q') ?? '';
  if (query.trim() !== '') return <SearchResults query={query} />;
  if (first) return <ListScreen listId={first.id} />;
  if (lists === undefined || synced === undefined) return null;
  return <p className={styles.muted}>{synced ? '' : 'Loading your lists…'}</p>;
}
