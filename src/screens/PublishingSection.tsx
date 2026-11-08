'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BoardStore } from '../boards/store';
import { Alert, Button, ConfirmDialog, Input } from '@sovereignfs/ui';
import type { BoardRow } from '../workspaces/format';
import styles from './BoardScreen.module.css';

/** The address a token is published at, on this server. */
export const addressOf = (token: string): string => `${window.location.origin}/p/${token}`;

/**
 * Publishing, in a board's Share dialog (DESIGN.md §14.6): for its owners, an address that anyone can open without signing in, read-only and showing the
 * work and no people. **Unpublishing takes the address away for good**: publishing again makes a different one, and the dialog says so before it does.
 */
export function PublishingSection({ board, store }: { board: BoardRow; store: BoardStore }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    try {
      const reply = await fetch(`/api/boards/${board.id}/publication`, { cache: 'no-store' });
      if (reply.ok) setToken(((await reply.json()) as { token: string | null }).token);
    } catch {
      // Offline: what was read stays.
    }
  }, [board.id]);
  useEffect(() => {
    void read();
  }, [read]);

  async function act(op: 'board.publish' | 'board.unpublish') {
    setBusy(true);
    await store.perform({ op, id: board.id });
    await read();
    setBusy(false);
  }

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(addressOf(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The field below can be selected by hand.
    }
  }

  return (
    <section aria-label="Publishing">
      <h3 className={styles.sectionTitle}>Publishing</h3>
      {token === undefined ? (
        <p className={styles.muted}>Reading…</p>
      ) : token === null ? (
        <>
          <p className={styles.muted}>
            Give this board an address that anyone can open, signed in or not. It is read-only and
            shows the cards, labels, due dates and checklists, and none of the people, comments or
            activity.
          </p>
          <Button
            variant="secondary"
            loading={busy}
            disabled={board.archived}
            onClick={() => void act('board.publish')}
          >
            Publish board
          </Button>
        </>
      ) : (
        <>
          <Alert variant="info">Anyone with this address can read this board.</Alert>
          <div className={styles.pickRow}>
            <Input
              aria-label="Public address"
              readOnly
              value={addressOf(token)}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button variant="secondary" loading={busy} onClick={() => setAsking(true)}>
              Unpublish
            </Button>
          </div>
        </>
      )}
      {asking ? (
        <ConfirmDialog
          open
          onClose={() => setAsking(false)}
          title="Unpublish this board?"
          message={
            <>
              The address stops working at once and cannot come back. Publishing it again makes a
              different one.
            </>
          }
          confirmLabel="Unpublish"
          destructive
          onConfirm={() => {
            setAsking(false);
            void act('board.unpublish');
          }}
        />
      ) : null}
    </section>
  );
}
