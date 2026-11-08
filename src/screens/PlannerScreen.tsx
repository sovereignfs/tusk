'use client';

import Link from 'next/link';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { formatTime } from '../format-due';
import type { Due } from '../actions/due';
import { openCard } from './address';
import { NewCardDialog } from './FooterDialogs';
import { useKey } from './KeyContext';
import { listsOf, seriesOf, visibleCards } from '../local/store';
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
  nowIndex,
  previewEntries,
  slotBetween,
} from '../planner/feed';
import type { Planned, PlannedBoardCard } from '../planner/format';
import { useLocal } from '../sync/react';
import { localNow, browserZone, nowHere } from '../time';
import { Alert, Button, Icon } from '../ui';
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

/**
 * Where the reader was, kept for this tab (`sessionStorage`) so that coming back from a card, which on a phone replaces the feed and on a board is a page of
 * its own, is to the same day and the same place on the screen, with the runs they had opened still open. Only a place near today is kept: coming back must not
 * mean reading half a year. A storage that cannot be read or written leaves the feed at today.
 */
const KEPT = 'tusk.planner.at';
const KEPT_CHUNKS = 4;
interface Kept {
  readonly date: string;
  readonly offset: number;
  readonly open: readonly string[];
}
function readKept(today: string): Kept | null {
  try {
    const raw = typeof window === 'undefined' ? null : window.sessionStorage.getItem(KEPT);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (typeof value !== 'object' || value === null) return null;
    const { date, offset, open } = value as Record<string, unknown>;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (typeof offset !== 'number' || !Number.isFinite(offset)) return null;
    if (Math.abs(chunkOf(date) - chunkOf(today)) > KEPT_CHUNKS) return null;
    const days = Array.isArray(open)
      ? open.filter(
          (each): each is string => typeof each === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(each),
        )
      : [];
    return { date, offset, open: days.slice(0, 50) };
  } catch {
    return null;
  }
}
function writeKept(kept: Kept): void {
  try {
    window.sessionStorage.setItem(KEPT, JSON.stringify(kept));
  } catch {
    // Nowhere to keep it: the feed opens on today.
  }
}

export function PlannerScreen() {
  const [today] = useState(() => nowHere().date);
  const scroller = useRef<HTMLDivElement>(null);
  /** Where the feed itself last put the scroll: the scroll event that arrives for it is ours, and asks for nothing. */
  const ours = useRef<number | null>(null);
  const start = chunkOf(today);
  const [kept] = useState(() => readKept(today));
  const reach = kept ? chunkOf(kept.date) : start;
  const lowest = Math.min(start, reach) - 1;
  const highest = Math.max(start, reach) + 1;
  const [first, setFirst] = useState(lowest);
  const [last, setLast] = useState(highest);
  const [boards, setBoards] = useState<Record<number, readonly PlannedBoardCard[] | 'failed'>>({});
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(kept?.open ?? []));
  const reads = useRef(new Map<number, Promise<void>>());
  const edges = useRef({ first: lowest, last: highest, busy: false });
  const held = useRef<{ height: number; top: number } | null>(null);

  // The time now, on the minute, for the line on today.
  const [nowTime, setNowTime] = useState(() => localNow(browserZone(), Date.now()).time);
  useEffect(() => {
    const tick = setInterval(() => setNowTime(localNow(browserZone(), Date.now()).time), 15_000);
    return () => clearInterval(tick);
  }, []);
  const key = useKey();
  /** The place being added to: a day, and a time when it is a gap between two timed cards. */
  const [adding, setAdding] = useState<Due | null>(null);

  const cards = useLocal(visibleCards);
  const lists = useLocal(listsOf);
  const series = useLocal(seriesOf);

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
    const wanted = Array.from({ length: highest - lowest + 1 }, (_, n) => lowest + n);
    void Promise.all(wanted.map(read)).then(() => setReady(true));
  }, [read, lowest, highest]);

  const ground = cards !== undefined && lists !== undefined && ready;
  useLayoutEffect(() => {
    if (!ground) return;
    const root = scroller.current;
    // Where the reader was if that day is there, else today at the top.
    const day = (date: string) =>
      root?.querySelector<HTMLElement>(`[data-planner-day="${date}"]`) ?? null;
    const back = kept ? day(kept.date) : null;
    const here = back ?? day(today);
    if (root && here) {
      root.scrollTop =
        here.getBoundingClientRect().top -
        root.getBoundingClientRect().top +
        root.scrollTop -
        (back && kept ? kept.offset : 0);
      ours.current = root.scrollTop;
    }
    // Only the first time the feed is there.
  }, [ground]);

  // Keep the reader's place when days were added above: by the height that came.
  useLayoutEffect(() => {
    const root = scroller.current;
    const before = held.current;
    if (root && before) {
      root.scrollTop = before.top + (root.scrollHeight - before.height);
      ours.current = root.scrollTop;
      held.current = null;
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
          if (root) held.current = { height: root.scrollHeight, top: root.scrollTop };
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

  // Keep the place, a moment after the reader stops, and when a run is opened.
  useEffect(() => {
    const root = scroller.current;
    if (!ground || !root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      const top = root.getBoundingClientRect().top;
      const day = [...root.querySelectorAll<HTMLElement>('[data-planner-day]')].find(
        (each) => each.getBoundingClientRect().bottom > top + 1,
      );
      const date = day?.dataset.plannerDay;
      if (day && date)
        writeKept({ date, offset: day.getBoundingClientRect().top - top, open: [...open] });
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(save, 150);
    };
    later();
    root.addEventListener('scroll', later, { passive: true });
    return () => {
      clearTimeout(timer);
      root.removeEventListener('scroll', later);
    };
  }, [ground, open]);

  const from = chunkRange(first).from;
  const to = chunkRange(last).to;
  const rows = useMemo(() => {
    const all: Entry[] = [
      ...(cards && lists ? deskEntries(cards, lists, from, to) : []),
      // A repeating card's occurrences after the one that is open, worked out from its rule (task 19.4).
      ...(cards && lists && series ? previewEntries(cards, series, lists, from, to, today) : []),
      ...Object.values(boards).flatMap((each) => (each === 'failed' ? [] : boardEntries(each))),
    ].filter((entry) => entry.date >= from && entry.date <= to);
    return layout(daysOf(from, to), groupByDate(all), today, open);
  }, [cards, lists, series, boards, from, to, today, open]);

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
        {key.status === 'locked' ? (
          <Alert variant="info">
            Your Desk is sealed and locked, so only the cards assigned to you on boards are shown.{' '}
            <Link href="/desk">Unlock it on the Desk</Link>.
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
                  <Day
                    key={row.date}
                    date={row.date}
                    entries={row.entries}
                    today={today}
                    now={row.date === today ? nowTime : null}
                    onAdd={(time) => setAdding({ date: row.date, time })}
                  />
                ),
              )}
            </ol>
          </>
        )}
      </div>
      {adding ? <NewCardDialog due={adding} onClose={() => setAdding(null)} /> : null}
    </div>
  );
}

function Day({
  date,
  entries,
  today,
  now,
  onAdd,
}: {
  date: string;
  entries: readonly Entry[];
  today: string;
  /** The time now (`HH:MM`) on today, which draws the line for it; null on any other day. */
  now: string | null;
  /** Add a card here: to the day, or at a time of it. */
  onAdd: (time: string | null) => void;
}) {
  const parts = dayParts(date);
  const isToday = date === today;
  const line = now === null ? null : nowIndex(entries, now);
  // "Any time" is named only where it is needed to tell the cards that have no time from those that have one.
  const named =
    entries.some((entry) => entry.time === null) && entries.some((entry) => entry.time !== null);
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
        <button
          type="button"
          className={styles.empty}
          // The name holds the visible words, and says what pressing it does.
          aria-label={`Nothing planned, add a card on ${parts.weekday} ${parts.month} ${parts.day}`}
          data-planner-add={date}
          onClick={() => onAdd(null)}
        >
          Nothing planned
          <span className={styles.plus} aria-hidden>
            +
          </span>
        </button>
      ) : (
        <ul className={styles.cards}>
          {named ? <li className={styles.caption}>Any time</li> : null}
          {entries.map((entry, index) => {
            const before = entries[index - 1]?.time;
            const free = before && entry.time ? slotBetween(before, entry.time) : null;
            return (
              <Fragment key={entry.key}>
                {free ? (
                  <li>
                    <button
                      type="button"
                      className={styles.free}
                      data-planner-slot={free}
                      onClick={() => onAdd(free)}
                    >
                      Add at {formatTime(free)}
                      <span className={styles.plus} aria-hidden>
                        +
                      </span>
                    </button>
                  </li>
                ) : null}
                {line === index ? <NowLine /> : null}
                <li>
                  <Link
                    href={entry.href}
                    className={`${styles.card} ${entry.done ? styles.done : ''} ${
                      date < today && !entry.done ? styles.overdue : ''
                    }`}
                    style={{ '--band': entry.color } as React.CSSProperties}
                    data-planner-card={entry.key}
                    data-shortcut-card=""
                    onClick={(event) => {
                      // A Desk card opens over the Planner, from the working copy and with no navigation; a click to open it in a new tab goes by its address.
                      if (
                        entry.source !== 'desk' ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.button !== 0
                      )
                        return;
                      event.preventDefault();
                      openCard(entry.id);
                    }}
                  >
                    <span className={styles.title}>
                      {entry.preview ? (
                        <Icon name="refresh-cw" className={styles.repeat} aria-hidden />
                      ) : null}
                      {entry.title}
                    </span>
                    <span className={styles.meta}>
                      {entry.time ? `${formatTime(entry.time)} · ` : ''}
                      {entry.where}
                      {entry.done ? ' · Done' : ''}
                      {entry.preview ? ' · Repeats' : ''}
                    </span>
                  </Link>
                </li>
              </Fragment>
            );
          })}
          {line === entries.length ? <NowLine /> : null}
          <li>
            <button
              type="button"
              className={styles.more}
              aria-label={`Add a card on ${parts.weekday} ${parts.month} ${parts.day}`}
              data-planner-add={date}
              onClick={() => onAdd(null)}
            >
              <span aria-hidden>+</span> Add a card
            </button>
          </li>
        </ul>
      )}
    </li>
  );
}

/** The line for now among today's timed cards. */
function NowLine() {
  return <li className={styles.now} aria-hidden data-planner-now="" />;
}
