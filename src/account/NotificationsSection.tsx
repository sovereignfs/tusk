'use client';

import { useEffect, useState } from 'react';
import { Alert, Checkbox } from '../ui';
import { NOTICE_KINDS, type NoticeKind } from '../workspaces/format';
import styles from './Account.module.css';

const LABELS: Record<NoticeKind, string> = {
  assigned: 'When I am assigned a card',
  comment: 'When someone comments on a card I made or am assigned to',
  added_to_workspace: 'When I am added to a workspace',
  added_to_board: 'When I am added to a board',
  backup_stopped: 'When my automatic backups stop',
  workspace_passed: 'When a workspace is passed to me because its owner left',
};

/**
 * Settings, Notifications (DESIGN.md §16, §19): each kind of notice for the Inbox on or off, **saved with the account** so that it is the same on every
 * device. A kind turned off is not written at all, so it is not in the Inbox later either; those already there stay. Nothing leaves the app in phase 1:
 * reminders, Push and email are phase 2.
 */
export function NotificationsSection() {
  const [off, setOff] = useState<readonly NoticeKind[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const reply = await fetch('/api/settings', { cache: 'no-store' });
        if (!reply.ok) return setFailed(true);
        setOff(((await reply.json()) as { noticesOff: NoticeKind[] }).noticesOff);
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  async function choose(kind: NoticeKind, on: boolean) {
    if (off === null) return;
    const before = off;
    const next = NOTICE_KINDS.filter((each) => (each === kind ? !on : off.includes(each)));
    setOff(next);
    setFailed(false);
    try {
      const reply = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ noticesOff: next }),
      });
      if (reply.ok) return;
    } catch {
      // The same answer as a refusal.
    }
    setOff(before);
    setFailed(true);
  }

  return (
    <div className={styles.group}>
      <h2>Notifications</h2>
      <p className={styles.muted}>
        What is written to your Inbox. A kind you turn off is not written at all.
      </p>
      {failed ? <Alert variant="warning">This needs a connection, and was not saved.</Alert> : null}
      <ul className={styles.list}>
        {NOTICE_KINDS.map((kind) => (
          <li key={kind}>
            <Checkbox
              label={LABELS[kind]}
              checked={off !== null && !off.includes(kind)}
              disabled={off === null}
              onChange={(checked) => void choose(kind, checked)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
