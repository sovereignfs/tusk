'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '../ui';
import { useSidebar } from '../ui/useSidebar';
import styles from './AppSidebar.module.css';

/**
 * The app's sidebar (DESIGN.md §17.2), at the left of every signed-in page: the places, then the person's workspaces. **An entry is here only when its
 * page is**: a link to a page that is not there is worse than none. So today it holds the Desk; Boards (16.4), the Inbox (8.1) and the Planner (phase
 * 2) join as they are built, and the Desk's entry goes when Boards holds its tile. The workspaces come with 16.2.
 */
interface Entry {
  href: string;
  label: string;
  icon: IconName;
  /** The addresses that are this entry's, for the one that is current. */
  under: readonly string[];
}

export const ENTRIES: readonly Entry[] = [
  {
    href: '/home',
    label: 'Desk',
    icon: 'layout-dashboard',
    under: ['/', '/home', '/desk', '/lists'],
  },
];

const isUnder = (pathname: string, prefixes: readonly string[]) =>
  prefixes.some(
    (prefix) => pathname === prefix || (prefix !== '/' && pathname.startsWith(`${prefix}/`)),
  );

export function AppSidebar() {
  const pathname = usePathname();
  const sidebar = useSidebar();
  if (!sidebar.available || sidebar.state === 'hidden') return null;
  const rail = sidebar.state === 'rail';

  return (
    <nav
      className={`${styles.sidebar} ${rail ? styles.rail : ''}`}
      aria-label="Tusk"
      data-sidebar={sidebar.state}
    >
      <ul className={styles.list}>
        {ENTRIES.map((entry) => (
          <li key={entry.href}>
            <Link
              href={entry.href}
              className={styles.row}
              aria-current={isUnder(pathname, entry.under) ? 'page' : undefined}
              // A rail shows the icon alone, so the name is the label and the tooltip, and a full sidebar says it in words.
              aria-label={rail ? entry.label : undefined}
              title={rail ? entry.label : undefined}
            >
              <Icon name={entry.icon} aria-hidden />
              {rail ? null : <span className={styles.label}>{entry.label}</span>}
            </Link>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={styles.collapse}
        aria-label={rail ? 'Widen the sidebar' : 'Narrow the sidebar'}
        title={rail ? 'Widen the sidebar' : 'Narrow the sidebar'}
        onClick={sidebar.toggleRail}
      >
        <Icon name={rail ? 'chevron-right' : 'chevron-left'} aria-hidden />
      </button>
    </nav>
  );
}
