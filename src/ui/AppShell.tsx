import type { ReactNode } from 'react';
import styles from './AppShell.module.css';

/**
 * The frame of a signed-in page (DESIGN.md §17.2): a header row and the main area. In the header, the sidebar's button and the app's wordmark, _tusk._, on
 * the left (the elephant is for the places that have room for it: sign-in, the icons), and on the right the notification bell and the person's avatar menu. The main area is given its columns by the page (`ThreeColumnLayout`, task 7.1).
 *
 * It is made here because the design system's `Header` requires an app launcher, which an app has no use for, and its `MobileHeader` never
 * stretches past 768px. **Worth offering to `@sovereignfs/ui`** (a `Header` whose launcher is optional) once a second app wants the same.
 *
 * The bell and the account menu are given, because what they do (read notifications, open settings, sign out) is the notification store's and
 * the auth client's, which this component does not know. Either may be left out until there is one to show.
 */
export function AppShell({
  name,
  toolbar,
  bell,
  account,
  footer,
  children,
}: {
  /** The app's name, whose first two letters are the mark. */
  name: string;
  /** What goes before the logo: the sidebar's button (task 7.8). */
  toolbar?: ReactNode;
  /** The notification bell, at the right of the header (task 8.1). */
  bell?: ReactNode;
  /** The person's avatar menu, at the right of the header (task 2.7). */
  account?: ReactNode;
  /** The phone's footer of five (phase 2, DESIGN.md §18): a place for it in the frame, empty in phase 1, so that adding it changes no route. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.lead}>
          {toolbar}
          {/* The wordmark is set in the design system's typeface (a page may not name another, and may not fetch one), heavy and tight; a screen reader says the name. */}
          <a href="/" className={styles.brand} aria-label={name}>
            <span className={styles.wordmark} aria-hidden>
              tusk.
            </span>
          </a>
        </div>
        <div className={styles.actions}>
          {bell}
          {account}
        </div>
      </header>
      <div className={styles.main}>{children}</div>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </div>
  );
}
