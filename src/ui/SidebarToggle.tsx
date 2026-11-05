'use client';

import { Icon } from './index';
import { useSidebar } from './useSidebar';
import styles from './AppShell.module.css';

/** The header's button for the sidebar (DESIGN.md §17.2): hides it, and shows it again as it was. It is not there on a phone, which has no sidebar. */
export function SidebarToggle() {
  const sidebar = useSidebar();
  if (!sidebar.available) return null;
  const hidden = sidebar.state === 'hidden';
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label={hidden ? 'Show the sidebar' : 'Hide the sidebar'}
      aria-expanded={!hidden}
      onClick={sidebar.toggleHidden}
    >
      <Icon name="panel-left" aria-hidden />
    </button>
  );
}
