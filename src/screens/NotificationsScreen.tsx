'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ago } from '../inbox/ago';
import { groupByDay, noticeHref, noticeText } from '../inbox/group';
import { useNotifications } from '../inbox/notifications';
import { browserZone } from '../time';
import { Alert, Button, Icon } from '../ui';
import styles from './NotificationsScreen.module.css';

/**
 * What the person is told, the whole list (DESIGN.md §16, task 8.9), at `/notifications`: **the bell's "View all"**. Newest first, grouped by the day in their own zone,
 * read and unread told apart, each openable (which reads it) and dismissable, with "Mark all read" and "Clear all", and older ones on request. It is the same copy the bell
 * has (`useNotifications`), so a change in one is in the other at once. A skeleton is shown until the first read ends.
 */
export function NotificationsScreen() {
  const { notices, unread, more, status, read, dismiss, readAll, clearAll, older } =
    useNotifications();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);
  const groups = groupByDay(notices, now, browserZone());

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>Notifications</h1>
        {notices.length > 0 ? (
          <div className={styles.actions}>
            {unread > 0 ? (
              <Button variant="secondary" size="sm" onClick={readAll}>
                Mark all read
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={clearAll}>
              Clear all
            </Button>
          </div>
        ) : null}
      </div>
      {status === 'failed' ? (
        <Alert variant="warning">Notifications need a connection.</Alert>
      ) : null}
      {status === 'loading' ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Reading your notifications">
          <div className={styles.bone} />
          <div className={styles.bone} />
        </div>
      ) : null}
      {status === 'ready' && notices.length === 0 ? (
        <p className={styles.muted}>Nothing new.</p>
      ) : null}
      {groups.map((group) => (
        <section key={group.date} className={styles.day} aria-label={group.label}>
          <h2 className={styles.dayLabel}>{group.label}</h2>
          <ul className={styles.list}>
            {group.notices.map((notice) => (
              <li
                key={notice.id}
                className={`${styles.row} ${notice.read ? styles.read : ''}`}
                data-notice={notice.id}
                data-read={notice.read ? 'true' : 'false'}
              >
                {notice.read ? null : (
                  <span className={styles.dot} role="img" aria-label="Unread" />
                )}
                <Link
                  href={noticeHref(notice)}
                  className={styles.notice}
                  onClick={() => read([notice.id])}
                >
                  {noticeText(notice)}
                </Link>
                <span className={styles.time}>{ago(notice.createdAt, now)}</span>
                <button
                  type="button"
                  className={styles.dismiss}
                  aria-label={`Dismiss: ${noticeText(notice)}`}
                  onClick={() => dismiss([notice.id])}
                >
                  <Icon name="x" size="sm" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {more ? (
        <div>
          <Button variant="secondary" size="sm" onClick={() => void older()}>
            Older notifications
          </Button>
        </div>
      ) : null}
    </div>
  );
}
