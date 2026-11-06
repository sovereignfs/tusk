'use client';

import { useCallback, useEffect, useState } from 'react';
import { lastSyncedAt } from '../local/store';
import { addressOf } from '../screens/PublishingSection';
import { useLocal } from '../sync/react';
import { Button } from '../ui';
import type { Publication } from '../workspaces/format';
import styles from './Account.module.css';

/**
 * Settings, Data (DESIGN.md §19): when this device last heard from the server, read from the device; and the boards of the person that are published
 * (§14.6), so that they can see what of theirs is public and take it back. Export, backup, encryption and deleting the account join with the tasks that
 * build them (9.1, 10.3, 14.2, 2.8).
 */
export function DataSection() {
  const at = useLocal(async (db) => ({ at: await lastSyncedAt(db) }));
  const [published, setPublished] = useState<readonly Publication[] | null>(null);
  const [failed, setFailed] = useState(false);

  const read = useCallback(async () => {
    try {
      const reply = await fetch('/api/publications', { cache: 'no-store' });
      if (!reply.ok) return setFailed(true);
      setPublished(((await reply.json()) as { publications: Publication[] }).publications);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void read();
  }, [read]);

  async function unpublish(boardId: string) {
    try {
      await fetch('/api/ops', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ opId: crypto.randomUUID(), op: 'board.unpublish', id: boardId }),
      });
    } finally {
      await read();
    }
  }

  return (
    <>
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
      <div className={styles.group}>
        <h2>Published boards</h2>
        {failed ? <p className={styles.muted}>This needs a connection.</p> : null}
        {published?.length === 0 ? (
          <p className={styles.muted}>None of your boards is published.</p>
        ) : null}
        <ul className={styles.list}>
          {(published ?? []).map((each) => (
            <li key={each.boardId} className={styles.publishedRow}>
              <a href={`/b/${each.boardId}`}>{each.boardName}</a>
              <a href={`/p/${each.token}`} className={styles.muted}>
                {addressOf(each.token)}
              </a>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Unpublish ${each.boardName}`}
                onClick={() => void unpublish(each.boardId)}
              >
                Unpublish
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
