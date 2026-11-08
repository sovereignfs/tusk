'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type MouseEvent, useEffect, useState } from 'react';
import { ago } from '../inbox/ago';
import { noticeHref, noticeText } from '../inbox/group';
import { useNotifications } from '../inbox/notifications';
import { Icon, NotificationsPanel } from '@sovereignfs/ui';
import type { NoticeKind } from '../workspaces/format';

/**
 * The bell beside the avatar (DESIGN.md §16, task 8.8): the design system's `NotificationsPanel` over the notices this person has, the number unread on it, and for each
 * notice an icon for its kind, the words, how long ago, and a dot while it is unread. **Opening a notice reads it** and goes where it points; each can be dismissed; the
 * panel says "Mark all read", "Clear all" and "View all" (`/notifications`). The latest few are shown, and the rest are the page's.
 *
 * The panel makes its own links, which would load the page again; a click on one inside it is taken here and made a navigation of the app, and the panel is made again
 * for the new place so that it is closed. Offline it shows what it last had.
 */
export const BELL_LIMIT = 20;

/** The icon of each kind of notice: a name the design system has. */
const ICONS: Record<
  NoticeKind,
  'user-round-plus' | 'message-square' | 'users' | 'alert-triangle' | 'calendar' | 'clock'
> = {
  assigned: 'user-round-plus',
  comment: 'message-square',
  added_to_workspace: 'users',
  added_to_board: 'users',
  workspace_passed: 'users',
  backup_stopped: 'alert-triangle',
  brief: 'calendar',
  reminder: 'clock',
};

export function NotificationBell() {
  const { notices, unread, read, dismiss, readAll, clearAll } = useNotifications();
  const router = useRouter();
  const pathname = usePathname();
  // The time the labels are made from: now, and again each minute, so that "5m ago" is not stale.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const items = notices.slice(0, BELL_LIMIT).map((notice) => {
    const href = noticeHref(notice);
    return {
      id: notice.id,
      icon: <Icon name={ICONS[notice.kind]} size="md" aria-hidden />,
      title: noticeText(notice),
      timeLabel: ago(notice.createdAt, now),
      read: notice.read,
      href,
      onOpen: () => read([notice.id]),
      onDismiss: () => dismiss([notice.id]),
    };
  });

  return (
    // A capture, so that it comes before the link's own handler, which still runs (it reads the notice).
    <div
      onClickCapture={(event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = (event.target as Element).closest?.('a[href]');
        const href = link?.getAttribute('href');
        if (!href || !href.startsWith('/') || href.startsWith('//')) return;
        event.preventDefault();
        router.push(href);
      }}
    >
      <NotificationsPanel
        // Made again with each place, which closes it.
        key={pathname}
        items={items}
        unreadCount={unread}
        onMarkAllRead={readAll}
        onClearAll={clearAll}
        emptyMessage="Nothing new."
        viewAllHref="/notifications"
        align="right"
      />
    </div>
  );
}
