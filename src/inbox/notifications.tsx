'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { NoticeRow, NotificationsPage } from '../workspaces/format';

/**
 * What a person is told, in the browser (DESIGN.md §16, tasks 8.8 and 8.9): **one copy, shared by the bell and by `/notifications`**, so that what one changes the other
 * shows at once. It reads the first page when the app opens, again every minute while the window is in view, when it comes to the front and when the network comes back,
 * and keeps what it last had when a read fails (offline it says nothing of the network). An older page is read on request and kept when the first page is read again.
 * A change is shown at once and sent after, and **put right by reading again if the server refuses it**.
 */
export interface Notifications {
  readonly notices: readonly NoticeRow[];
  /** How many are unread, up to 100, as the server counted them. */
  readonly unread: number;
  readonly more: boolean;
  /** `loading` until the first read ends; `failed` if it could not be had and there is nothing to show. */
  readonly status: 'loading' | 'ready' | 'failed';
  readonly read: (ids: readonly string[]) => void;
  readonly dismiss: (ids: readonly string[]) => void;
  readonly readAll: () => void;
  readonly clearAll: () => void;
  readonly older: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

const EMPTY: Notifications = {
  notices: [],
  unread: 0,
  more: false,
  status: 'loading',
  read: () => undefined,
  dismiss: () => undefined,
  readAll: () => undefined,
  clearAll: () => undefined,
  older: async () => undefined,
  refresh: async () => undefined,
};

const Context = createContext<Notifications>(EMPTY);
export const useNotifications = (): Notifications => useContext(Context);

/** How often the first page is read again while the window is in view. */
export const REFRESH_MS = 60_000;

/** The first page, with the older notices already loaded that are older than it, in order and with none twice. */
export function merge(
  first: readonly NoticeRow[],
  kept: readonly NoticeRow[],
): readonly NoticeRow[] {
  const edge = first.at(-1);
  const older = edge
    ? kept.filter(
        (each) =>
          each.createdAt < edge.createdAt ||
          (each.createdAt === edge.createdAt && each.id < edge.id),
      )
    : [];
  return [...first, ...older];
}

async function send(path: string, body: unknown): Promise<boolean> {
  try {
    const reply = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return reply.ok;
  } catch {
    return false;
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<readonly NoticeRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [more, setMore] = useState(false);
  const [status, setStatus] = useState<Notifications['status']>('loading');
  const latest = useRef(notices);
  latest.current = notices;
  // A change in flight, so that a read that began before it does not put the old state back over it.
  const changing = useRef(0);

  const refresh = useCallback(async () => {
    const asked = changing.current;
    try {
      const reply = await fetch('/api/notifications', { cache: 'no-store' });
      if (!reply.ok) throw new Error('refused');
      const page = (await reply.json()) as NotificationsPage;
      if (asked !== changing.current) return;
      setNotices(merge(page.notices, latest.current));
      setUnread(page.unread);
      // More is known of the first page; if older ones are already loaded, they have their own end.
      setMore((was) => (latest.current.length > page.notices.length ? was : page.more));
      setStatus('ready');
    } catch {
      // Offline, or refused: what there was stays, and a first read that failed says so.
      setStatus((was) => (was === 'loading' ? 'failed' : was));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const again = () => document.visibilityState === 'visible' && void refresh();
    const tick = setInterval(again, REFRESH_MS);
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    window.addEventListener('online', again);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
      window.removeEventListener('online', again);
    };
  }, [refresh]);

  const change = useCallback(
    (path: string, body: unknown, show: () => void) => {
      changing.current += 1;
      show();
      void send(path, body).then((ok) => {
        // Refused or not reached: read again, which puts it right. When it is done, reads may go on.
        changing.current += 1;
        if (!ok) void refresh();
      });
    },
    [refresh],
  );

  const value = useMemo<Notifications>(
    () => ({
      notices,
      unread,
      more,
      status,
      read: (ids) => {
        if (ids.length === 0) return;
        const named = new Set(ids);
        const was = latest.current.filter((each) => named.has(each.id) && !each.read).length;
        if (was === 0) return;
        change('/api/notifications/read', { ids }, () => {
          setNotices((now) =>
            now.map((each) => (named.has(each.id) ? { ...each, read: true } : each)),
          );
          setUnread((now) => Math.max(0, now - was));
        });
      },
      dismiss: (ids) => {
        if (ids.length === 0) return;
        const named = new Set(ids);
        const was = latest.current.filter((each) => named.has(each.id) && !each.read).length;
        change('/api/notifications/dismiss', { ids }, () => {
          setNotices((now) => now.filter((each) => !named.has(each.id)));
          setUnread((now) => Math.max(0, now - was));
        });
      },
      readAll: () =>
        change('/api/notifications/read', { all: true }, () => {
          setNotices((now) => now.map((each) => ({ ...each, read: true })));
          setUnread(0);
        }),
      clearAll: () =>
        change('/api/notifications/dismiss', { all: true }, () => {
          setNotices([]);
          setUnread(0);
          setMore(false);
        }),
      older: async () => {
        const last = latest.current.at(-1);
        if (!last) return;
        try {
          const reply = await fetch(
            `/api/notifications?beforeAt=${last.createdAt}&beforeId=${last.id}`,
            { cache: 'no-store' },
          );
          if (!reply.ok) return;
          const page = (await reply.json()) as NotificationsPage;
          setNotices((now) => {
            const have = new Set(now.map((each) => each.id));
            return [...now, ...page.notices.filter((each) => !have.has(each.id))];
          });
          setMore(page.more);
        } catch {
          // Offline: the button is still there for when the network is.
        }
      },
      refresh,
    }),
    [notices, unread, more, status, change, refresh],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
