'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { isCompleted } from '../actions/cards';
import { listsOf, searchable } from '../local/store';
import { searchDesk } from '../local/search';
import { useLocal } from '../sync/react';
import { text } from './fields';
import styles from './SearchResults.module.css';

/**
 * The results of a search of the Desk (DESIGN.md §10.7), shown in the content column at `/desk?q=`. **Read from the working copy and computed in the
 * browser**, so it works offline; it is re-worked as the copy changes and as the query is typed, without asking the server for anything. A card links to
 * where it is, and the checklist items that matched are shown under it.
 */
export function SearchResults({ query }: { query: string }) {
  const data = useLocal(searchable);
  const lists = useLocal(listsOf);
  const hits = useMemo(
    () => (data ? searchDesk(data.cards, data.checks, query) : undefined),
    [data, query],
  );
  const listTitle = (listId: string) => {
    const list = lists?.find((each) => each.id === listId);
    return list ? text(list, 'title', 'Untitled list') : '';
  };

  return (
    <section className={styles.results} aria-label="Search results">
      <h1 className={styles.title}>Search</h1>
      <p className={styles.count} role="status" aria-live="polite">
        {hits === undefined
          ? 'Searching…'
          : hits.length === 0
            ? `Nothing matches “${query}”.`
            : `${hits.length} ${hits.length === 1 ? 'card matches' : 'cards match'} “${query}”.`}
      </p>
      {hits && hits.length > 0 ? (
        <ul className={styles.list}>
          {hits.map((hit) => {
            const done = isCompleted(hit.card);
            return (
              <li key={hit.card.id} className={styles.hit}>
                <Link
                  className={`${styles.name} ${done ? styles.done : ''}`}
                  href={`/desk/${hit.card.listId}?card=${hit.card.id}`}
                >
                  {text(hit.card, 'title', 'Untitled card')}
                </Link>
                <span className={styles.where}>
                  {listTitle(hit.card.listId)}
                  {done ? ' · Done' : ''}
                </span>
                {hit.snippet ? <p className={styles.snippet}>{hit.snippet}</p> : null}
                {hit.items.length > 0 ? (
                  <ul className={styles.items} aria-label="Checklist items that match">
                    {hit.items.map((item) => (
                      <li key={item.id} className={isCompleted(item) ? styles.tickedItem : ''}>
                        {text(item, 'title', 'Untitled item')}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
