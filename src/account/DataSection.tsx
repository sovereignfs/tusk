'use client';

import { useCallback, useEffect, useState } from 'react';
import { lastSyncedAt } from '../local/store';
import { addressOf } from '../screens/PublishingSection';
import { deskFile, everythingFile, save } from '../portability/client';
import { useLocal, useSync } from '../sync/react';
import { useKey } from '../screens/KeyContext';
import { BackupSection } from './BackupSection';
import { DeleteAccountSection } from './DeleteAccountSection';
import { EncryptionSection } from './EncryptionSection';
import { ImportSection } from './ImportSection';
import { Button } from '@sovereignfs/ui';
import type { Publication } from '../workspaces/format';
import styles from './Account.module.css';

/**
 * Settings, Data (DESIGN.md §19): when this device last heard from the server, read from the device; and the boards of the person that are published
 * (§14.6), so that they can see what of theirs is public and take it back. Backing up to git is `BackupSection`, the Desk's key `EncryptionSection`, and deleting the account
 * `DeleteAccountSection`.
 */
export function DataSection() {
  const client = useSync();
  const key = useKey();
  const [exporting, setExporting] = useState<'desk' | 'everything' | null>(null);
  const [exportFailed, setExportFailed] = useState(false);
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

  /** Saves the Desk, or the Desk and every workspace the person owns, as one file (DESIGN.md §20.1). */
  async function exportAs(scope: 'desk' | 'everything') {
    setExporting(scope);
    setExportFailed(false);
    try {
      save(scope === 'desk' ? await deskFile(client) : await everythingFile(client));
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(null);
    }
  }

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
        <h2>Export</h2>
        <p>
          Your Desk is made from this device, so it works with no connection. Everything adds the
          workspaces you own, which are read from the server. The file is JSON, has no one's id in
          it (people are named by name and address), and holds no key, link or password.
        </p>
        <div className={styles.row}>
          <Button
            variant="secondary"
            disabled={exporting !== null}
            onClick={() => void exportAs('desk')}
          >
            Export my Desk
          </Button>
          <Button
            variant="secondary"
            disabled={exporting !== null}
            onClick={() => void exportAs('everything')}
          >
            Export everything
          </Button>
        </div>
        {key.sealed ? (
          <p className={styles.muted}>
            Your Desk is sealed on the server, but this file is not: it is plain text, made here
            from your Desk, and anyone who has it can read it. Keep it somewhere you trust.
          </p>
        ) : null}
        {exportFailed ? (
          <p className={styles.muted}>
            That needs a connection. Your Desk can be exported without one; everything cannot.
          </p>
        ) : null}
      </div>
      <ImportSection />
      <BackupSection />
      <EncryptionSection />
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
      <DeleteAccountSection />
    </>
  );
}
