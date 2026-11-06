'use client';

import { lastSyncedAt } from '../local/store';
import { useLocal } from '../sync/react';
import styles from './Account.module.css';

/**
 * Settings, Data (DESIGN.md §19): when this device last heard from the server, read from the device. Export, backup, encryption and deleting the account join
 * with the tasks that build them (9.1, 10.3, 14.2, 2.8).
 */
export function DataSection() {
  const at = useLocal(async (db) => ({ at: await lastSyncedAt(db) }));
  return (
    <div className={styles.group}>
      <h2>Sync</h2>
      <p>
        Last synced:{' '}
        {at === undefined
          ? '…'
          : at.at === undefined
            ? 'not yet'
            : new Date(at.at).toLocaleString()}
      </p>
      <p className={styles.hint}>
        Your Desk is kept on this device and sent to the server in the background. Nothing in it
        waits for a connection.
      </p>
    </div>
  );
}
