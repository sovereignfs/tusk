'use client';

import { ActivityList } from '../screens/ActivityList';
import styles from './Account.module.css';

/**
 * Settings, Activity (DESIGN.md §15.6, §19): what the person did themselves, across the boards they can still see, newest first. It is read from the
 * server, which holds it to those boards, and says it needs a connection when it cannot be had.
 */
export function ActivitySection() {
  return (
    <div className={styles.group}>
      <h2>Activity</h2>
      <p className={styles.muted}>What you have done, on the boards you can still see.</p>
      <ActivityList url="/api/activity" showBoard />
    </div>
  );
}
