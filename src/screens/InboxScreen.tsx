'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatDue } from '../format-due';
import { groupByDay, noticeHref, noticeText } from '../inbox/group';
import { type LocalNow, browserZone, localNow } from '../time';
import { Alert, Button } from '../ui';
import type { AssignedCard, Inbox, NoticeRow } from '../workspaces/format';
import styles from './InboxScreen.module.css';

/**
 * The Inbox (DESIGN.md §16), `/inbox`: what a person has been told, newest first and grouped by day in their own zone, each saying who did what to which
 * card or board and opening it; and the cards assigned to them across their boards, by due date, undated last. **A skeleton is shown until it is read.**
 * Opening it marks everything before now as read, on every device, and the sidebar's count goes to nothing.
 */
export function InboxScreen() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [older, setOlder] = useState<readonly NoticeRow[]>([]);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [now] = useState(() => Date.now());

  const load = useCallback(async (before?: NoticeRow): Promise<Inbox | null> => {
    try {
      const query = before ? `?beforeAt=${before.createdAt}&beforeId=${before.id}` : '';
      const reply = await fetch(`/api/inbox${query}`, { cache: 'no-store' });
      if (!reply.ok) {
        setFailed(true);
        return null;
      }
      setFailed(false);
      return (await reply.json()) as Inbox;
    } catch {
      setFailed(true);
      return null;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const first = await load();
      if (!first) return;
      setInbox(first);
      setMore(first.more);
      // Opened: what came before now is read, on every device. The count in the sidebar goes to nothing.
      try {
        const reply = await fetch('/api/inbox/seen', { method: 'POST' });
        if (reply.ok) window.dispatchEvent(new Event('tusk:inbox-seen'));
      } catch {
        // Offline: it is marked the next time it is opened with a connection.
      }
    })();
  }, [load]);

  async function olderPage() {
    const last = [...(inbox?.notices ?? []), ...older].at(-1);
    if (!last) return;
    const page = await load(last);
    if (page) {
      setOlder([...older, ...page.notices]);
      setMore(page.more);
    }
  }

  const notices = [...(inbox?.notices ?? []), ...older];
  const zone = browserZone();
  const groups = groupByDay(notices, now, zone);
  const today = localNow(zone, now);

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
        <>
          <section aria-label="Notifications" className={styles.section}>
            <h2 className={styles.heading}>Notifications</h2>
            {groups.length === 0 ? <p className={styles.muted}>Nothing new.</p> : null}
            {groups.map((group) => (
              <div key={group.date} className={styles.day}>
                <h3 className={styles.dayLabel}>{group.label}</h3>
                <ul className={styles.list}>
                  {group.notices.map((notice) => (
                    <li key={notice.id}>
                      <Link href={noticeHref(notice)} className={styles.notice}>
                        {noticeText(notice)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {more ? (
              <div>
                <Button variant="secondary" size="sm" onClick={() => void olderPage()}>
                  Older notifications
                </Button>
              </div>
            ) : null}
          </section>

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
        </>
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
