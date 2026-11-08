'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatTime } from '../format-due';
import { listsOf, visibleCards } from '../local/store';
import {
  type Entry,
  boardEntries,
  chunkOf,
  chunkRange,
  dayParts,
  daysOf,
  deskEntries,
  gapLabel,
  groupByDate,
  layout,
} from '../planner/feed';
import type { Planned, PlannedBoardCard } from '../planner/format';
import { useLocal } from '../sync/react';
import { nowHere } from '../time';
import { Alert, Button } from '../ui';
import styles from './PlannerScreen.module.css';

/**
 * The Planner (DESIGN.md §25.1), `/planner`: one feed of days, before and after today, of the cards that have a date and are the person's. **The Desk's part is
 * read from the working copy** (so a sealed Desk is in it, and it is there offline) and **the boards' part from `GET /api/planner`**, a chunk of four weeks at a time.
 * It opens on today and scrolls both ways without end, a chunk added when the reader goes near an end (and not by itself: a long run of empty days is a short folded row, and would be asked for for ever). A chunk is read **before** the window grows to include it, so that what is added above the reader
 * arrives whole, and the reader's place is kept by the height that was added. A run of empty days is folded into one row that opens when tapped.
 * If the boards cannot be had, the Desk's part is still shown and says so.
 */
/** How near an end, in pixels, the reader is when the next chunk is read. */
const NEAR = 600;

export function PlannerScreen() {
  const [today] = useState(() => nowHere().date);
  const scroller = useRef<HTMLDivElement>(null);
  /** Where the feed itself last put the scroll: the scroll event that arrives for it is ours, and asks for nothing. */
  const ours = useRef<number | null>(null);
  const start = chunkOf(today);
  const [first, setFirst] = useState(start - 1);
  const [last, setLast] = useState(start + 1);
  const [boards, setBoards] = useState<Record<number, readonly PlannedBoardCard[] | 'failed'>>({});
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const reads = useRef(new Map<number, Promise<void>>());
  const edges = useRef({ first: start - 1, last: start + 1, busy: false });
  const kept = useRef<{ height: number; top: number } | null>(null);

  const cards = useLocal(visibleCards);
  const lists = useLocal(listsOf);

  /** Reads one chunk of the boards' part, once. A failure is remembered, and a retry makes the read again. */
  const read = useCallback((index: number): Promise<void> => {
    let pending = reads.current.get(index);
    if (!pending) {
      const { from, to } = chunkRange(index);
      pending = fetch(`/api/planner?from=${from}&to=${to}`, { cache: 'no-store' })
        .then(async (reply) => {
          if (!reply.ok) throw new Error('refused');
          const body = (await reply.json()) as Planned;
          setBoards((now) => ({ ...now, [index]: body.cards }));
        })
        .catch(() => {
          reads.current.delete(index);
          setBoards((now) => ({ ...now, [index]: 'failed' }));
        });
      reads.current.set(index, pending);
    }
    return pending;
  }, []);

  // The first three chunks, then the feed is shown, at today.
  useEffect(() => {
    void Promise.all([start - 1, start, start + 1].map(read)).then(() => setReady(true));
  }, [read, start]);

  const ground = cards !== undefined && lists !== undefined && ready;
  useLayoutEffect(() => {
    if (!ground) return;
    const root = scroller.current;
    const here = root?.querySelector<HTMLElement>(`[data-planner-day="${today}"]`);
    if (root && here) {
      root.scrollTop =
        here.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      ours.current = root.scrollTop;
    }
    // Only the first time the feed is there.
  }, [ground]);

  // Keep the reader's place when days were added above: by the height that came.
  useLayoutEffect(() => {
    const root = scroller.current;
    const before = kept.current;
    if (root && before) {
      root.scrollTop = before.top + (root.scrollHeight - before.height);
      ours.current = root.scrollTop;
      kept.current = null;
    }
  }, [first]);

  const extend = useCallback(
    async (direction: 'up' | 'down') => {
      const mine = edges.current;
      if (mine.busy) return;
      mine.busy = true;
      try {
        if (direction === 'up') {
          await read(mine.first - 1);
          const root = scroller.current;
          if (root) kept.current = { height: root.scrollHeight, top: root.scrollTop };
          mine.first -= 1;
          setFirst(mine.first);
        } else {
          await read(mine.last + 1);
          mine.last += 1;
          setLast(mine.last);
        }
      } finally {
        mine.busy = false;
      }
    },
    [read],
  );

  // When the reader goes near an end, by scrolling or by pushing against it, the next chunk is read and added: once for each move, so that a run of empty days,
  // which folds to one short row, cannot make the feed ask for more for ever.
  useEffect(() => {
    const root = scroller.current;
    if (!ground || !root) return;
    const check = (event: Event) => {
      if (event.type === 'scroll' && ours.current !== null) {
        const mine = ours.current === root.scrollTop;
        ours.current = null;
        if (mine) return;
      }
      if (root.scrollTop < NEAR) void extend('up');
      if (root.scrollHeight - root.scrollTop - root.clientHeight < NEAR) void extend('down');
    };
    const events = ['scroll', 'wheel', 'touchmove'] as const;
    for (const name of events) root.addEventListener(name, check, { passive: true });
    return () => {
      for (const name of events) root.removeEventListener(name, check);
    };
  }, [ground, extend]);

  const from = chunkRange(first).from;
  const to = chunkRange(last).to;
  const rows = useMemo(() => {
    const all: Entry[] = [
      ...(cards && lists ? deskEntries(cards, lists, from, to) : []),
      ...Object.values(boards).flatMap((each) => (each === 'failed' ? [] : boardEntries(each))),
    ].filter((entry) => entry.date >= from && entry.date <= to);
    return layout(daysOf(from, to), groupByDate(all), today, open);
  }, [cards, lists, boards, from, to, today, open]);

  const failed = Object.values(boards).includes('failed');
  const retry = () => {
    const bad = Object.entries(boards).flatMap(([index, each]) =>
      each === 'failed' ? [Number(index)] : [],
    );
    setBoards((now) => Object.fromEntries(Object.entries(now).filter(([, v]) => v !== 'failed')));
    for (const index of bad) void read(index);
  };

  return (
    <div ref={scroller} className={styles.scroller} aria-label="Planner">
      <div className={styles.column}>
        {failed ? (
          <Alert variant="warning">
            The cards assigned to you on boards could not be loaded; your Desk is shown.{' '}
            <Button variant="ghost" size="sm" onClick={retry}>
              Try again
            </Button>
          </Alert>
        ) : null}
        {!ground ? (
          <div className={styles.skeleton} aria-label="Loading the Planner">
            {[0, 1, 2, 3].map((n) => (
              <div key={n} className={styles.bone} />
            ))}
          </div>
        ) : (
          <>
            <ol className={styles.days}>
              {rows.map((row) =>
                row.kind === 'gap' ? (
                  <li key={`gap-${row.from}`} className={styles.gap}>
                    <button
                      type="button"
                      className={styles.gapButton}
                      onClick={() => setOpen((now) => new Set(now).add(row.from))}
                    >
                      {gapLabel(row.from, row.to, today)} · nothing planned
                    </button>
                  </li>
                ) : (
                  <Day key={row.date} date={row.date} entries={row.entries} today={today} />
                ),
              )}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

function Day({ date, entries, today }: { date: string; entries: readonly Entry[]; today: string }) {
  const parts = dayParts(date);
  const isToday = date === today;
  return (
    <li
      className={styles.day}
      data-planner-day={date}
      aria-current={isToday ? 'date' : undefined}
      aria-label={`${parts.weekday} ${parts.month} ${parts.day}, ${parts.year}${isToday ? ', today' : ''}`}
    >
      <div className={styles.head} aria-hidden>
        <span className={styles.weekday}>{parts.weekday}</span>
        <span className={`${styles.number} ${isToday ? styles.today : ''}`}>{parts.day}</span>
      </div>
      {entries.length === 0 ? (
        <p className={styles.empty}>Nothing planned</p>
      ) : (
        <ul className={styles.cards}>
          {entries.map((entry) => (
            <li key={entry.key}>
              <Link
                href={entry.href}
                className={`${styles.card} ${entry.done ? styles.done : ''} ${
                  date < today && !entry.done ? styles.overdue : ''
                }`}
                style={{ '--band': entry.color } as React.CSSProperties}
                data-planner-card={entry.key}
              >
                <span className={styles.title}>{entry.title}</span>
                <span className={styles.meta}>
                  {entry.time ? `${formatTime(entry.time)} · ` : ''}
                  {entry.where}
                  {entry.done ? ' · Done' : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
