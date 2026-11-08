'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@sovereignfs/ui';
import type { ActivityPage, ActivityRow } from '../workspaces/format';
import styles from './ActivityList.module.css';

/**
 * A list of activity, read a page at a time (DESIGN.md §15.6): newest first, each row its sentence and when it happened. Used for a board's, a card's and
 * a person's own. `url` is the route that serves it; the page after is asked for by the last row's time and id, so one is never skipped or repeated.
 * `refresh` makes it read again from the top, as when a change has just been made.
 */
export function ActivityList({
  url,
  refresh = 0,
  showBoard = false,
}: {
  url: string;
  refresh?: number;
  showBoard?: boolean;
}) {
  const [rows, setRows] = useState<readonly ActivityRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const read = useCallback(
    async (after?: ActivityRow): Promise<ActivityPage | null> => {
      try {
        const query = after ? `?beforeAt=${after.createdAt}&beforeId=${after.id}` : '';
        const reply = await fetch(`${url}${query}`, { cache: 'no-store' });
        if (!reply.ok) return reply.status === 404 ? { activity: [], more: false } : null;
        setFailed(false);
        return (await reply.json()) as ActivityPage;
      } catch {
        setFailed(true);
        return null;
      }
    },
    [url],
  );

  useEffect(() => {
    void (async () => {
      const first = await read();
      if (first) {
        setRows(first.activity);
        setMore(first.more);
      }
    })();
  }, [read, refresh]);

  async function older() {
    const last = rows?.at(-1);
    if (!last) return;
    const next = await read(last);
    if (next) {
      setRows([...(rows ?? []), ...next.activity]);
      setMore(next.more);
    }
  }

  return (
    <div className={styles.activity}>
      {failed ? <p className={styles.muted}>Activity needs a connection.</p> : null}
      {rows === null && !failed ? <p className={styles.muted}>Reading the activity…</p> : null}
      {rows?.length === 0 ? <p className={styles.muted}>Nothing has happened yet.</p> : null}
      <ul className={styles.list}>
        {(rows ?? []).map((row) => (
          <li key={row.id} className={styles.row}>
            <span className={styles.text}>{row.text}</span>
            {showBoard && row.boardName ? (
              <span className={styles.muted}>on {row.boardName}</span>
            ) : null}
            <time className={styles.muted} dateTime={new Date(row.createdAt).toISOString()}>
              {new Date(row.createdAt).toLocaleString()}
            </time>
          </li>
        ))}
      </ul>
      {more ? (
        <div>
          <Button variant="secondary" size="sm" onClick={() => void older()}>
            Older activity
          </Button>
        </div>
      ) : null}
    </div>
  );
}
