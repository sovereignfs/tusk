'use client';

import type { ReactNode } from 'react';
import { Shortcuts } from '../keys/Shortcuts';
import { AppSidebar } from './AppSidebar';
import styles from './AppFrame.module.css';

/**
 * Below the header of every signed-in page (DESIGN.md §17.2): the app's sidebar, then the page. The page has the rest of the width and scrolls on its
 * own, so that the sidebar stays where it is. What a page does with its width is its own: the Desk has columns of its own (`Frame`).
 */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.frame}>
      <Shortcuts />
      <AppSidebar />
      <div className={styles.page}>{children}</div>
    </div>
  );
}
