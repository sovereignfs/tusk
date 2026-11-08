'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDue } from '../format-due';
import { type LocalNow, browserZone, localNow } from '../time';
import { Alert } from '../ui';
import type { AssignedCard, Inbox } from '../workspaces/format';
import styles from './InboxScreen.module.css';

/**
 * The Inbox (DESIGN.md §16), `/inbox`: **what is theirs to do**, the open cards assigned to the person across their boards, by due date, undated last. What they are told
 * is the bell's and `/notifications`'s. A skeleton is shown until it is read.
 */
export function InboxScreen() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [failed, setFailed] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    void (async () => {
      try {
        const reply = await fetch('/api/inbox', { cache: 'no-store' });
        if (!reply.ok) throw new Error('refused');
        setInbox((await reply.json()) as Inbox);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  const today = localNow(browserZone(), now);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Inbox</h1>
      {failed ? <Alert variant="warning">The Inbox needs a connection.</Alert> : null}
      {inbox === null && !failed ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Reading the Inbox">
          <div className={styles.bone} />
          <div className={styles.bone} />
        </div>
      ) : null}

      {inbox ? (
        <section aria-label="Assigned to me" className={styles.section}>
          <h2 className={styles.heading}>Assigned to me</h2>
          {inbox.assigned.length === 0 ? (
            <p className={styles.muted}>No cards are assigned to you.</p>
          ) : (
            <ul className={styles.list}>
              {inbox.assigned.map((card) => (
                <AssignedRow key={card.cardId} card={card} today={today} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function AssignedRow({ card, today }: { card: AssignedCard; today: LocalNow }) {
  const due = card.dueDate ? formatDue(card.dueDate, card.dueTime, today) : null;
  return (
    <li className={styles.assigned}>
      <Link href={`/b/${card.boardId}/c/${card.cardId}`} className={styles.notice}>
        {card.title}
      </Link>
      <span className={styles.muted}>{card.boardName}</span>
      {due ? <span className={due.overdue ? styles.overdue : styles.muted}>{due.text}</span> : null}
    </li>
  );
}
