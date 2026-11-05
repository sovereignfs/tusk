'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { listsOf, openCounts } from '../local/store';
import { useHasSynced, useLocal } from '../sync/react';
import { colourOf, text } from './fields';
import styles from './Sidebar.module.css';

/**
 * The left column (DESIGN.md §15.2): the views, pinned, then the person's lists with a dot and a count. **It reads the working copy and nothing
 * else**: a list made on this device is here before the server has heard of it, and a new device shows what has arrived so far.
 *
 * The pinned views (Today, Starred, Review) are added by the tasks that build them, to `PINNED`; a link to a page that is not there is worse than none.
 */
export const PINNED: readonly { href: string; label: string }[] = [];

export function Sidebar() {
  const pathname = usePathname();
  const lists = useLocal(listsOf);
  const counts = useLocal(openCounts);
  const synced = useHasSynced();

  return (
    <nav className={styles.sidebar} aria-label="Lists">
      {PINNED.length > 0 ? (
        <ul className={styles.list}>
          {PINNED.map((view) => (
            <li key={view.href}>
              <Link
                href={view.href}
                className={styles.row}
                aria-current={pathname === view.href ? 'page' : undefined}
              >
                <span className={styles.name}>{view.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div>
        <div className={styles.heading}>
          <span>My lists</span>
        </div>
        {lists === undefined || lists.length === 0 ? (
          // A new device has nothing until the server has answered once; after that, none really is none.
          <p className={styles.empty}>
            {synced === false ? 'Loading your lists…' : 'No lists yet.'}
          </p>
        ) : (
          <ul className={styles.list}>
            {lists.map((list) => {
              const href = `/lists/${list.id}`;
              return (
                <li key={list.id}>
                  <Link
                    href={href}
                    className={styles.row}
                    aria-current={pathname === href ? 'page' : undefined}
                  >
                    <span
                      className={styles.dot}
                      style={{ background: colourOf(list) }}
                      aria-hidden
                    />
                    <span className={styles.name}>{text(list, 'title', 'Untitled list')}</span>
                    <span className={styles.count}>{counts?.get(list.id) ?? 0}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}
