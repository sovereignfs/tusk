'use client';

import { useEffect, useState } from 'react';
import { type ThemeChoice, chooseTheme, readTheme } from '../theme/preferences';
import { SegmentedControl } from '../ui';
import styles from './Account.module.css';

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Settings, Preferences (DESIGN.md §19): the theme, which is about this screen and so is kept on this device and applied at once. What arranges a person's
 * data (the first day of the week, how workspaces are sorted) is saved with the account and joins with the tasks that use it. What is chosen is read once
 * the page is in the browser, so the server draws the default first.
 */
export function PreferencesSection() {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  useEffect(() => {
    setTheme(readTheme(storage()));
  }, []);
  return (
    <div className={styles.group}>
      <h2>Appearance</h2>
      <div className={styles.fit}>
        <SegmentedControl<ThemeChoice>
          aria-label="Theme"
          value={theme}
          onChange={(next) => {
            setTheme(next);
            chooseTheme(
              next,
              document.documentElement,
              window.matchMedia('(prefers-color-scheme: dark)').matches,
              storage(),
            );
          }}
          options={[
            { label: 'System', value: 'system' },
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
          ]}
        />
      </div>
      <p className={styles.hint}>Applies at once, on this device.</p>
    </div>
  );
}
