'use client';

import { useMemo, useState } from 'react';
import { completeCard, isCompleted, restoreCard, setStarred, deleteCard } from '../actions/cards';
import { dueOf } from '../actions/due';
import { cancelCard, dismissCard, markReviewed, restoreDismissal } from '../actions/phone';
import { seriesIdOf } from '../actions/series';
import { type Direction, SwipeCards } from '../cards/SwipeCards';
import { formatDue } from '../format-due';
import type { LocalRow } from '../local/rows';
import { allChecksOf, checksOf, getRow, listsOf, visibleCards } from '../local/store';
import { buildReview } from '../review';
import type { Mutation } from '../sync/format';
import { useLocal, useSync } from '../sync/react';
import { nowHere } from '../time';
import { type Reason, buildToday, dismissedOn } from '../today';
import { Dialog, EmptyState, SegmentedControl } from '../ui';
import { text } from './fields';
import { openCard } from './address';
import { useUndo } from './Undo';
import styles from './StackOverlay.module.css';

const ids = { newId: () => crypto.randomUUID() };

/** Why a card is in Today, in words. */
const REASONS: Record<Reason, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  starred: 'Starred',
};

/** A mutation that also stamps the card as reviewed: the change to the card gets the field, or the card is given a change of its own. */
function withReviewed(mutation: Mutation, card: LocalRow, now: number): Mutation {
  let stamped = false;
  const changes = mutation.changes.map((change) => {
    if (change.table === 'desk_card' && change.id === card.id && !change.deleted) {
      stamped = true;
      return { ...change, fields: { ...(change.fields ?? {}), reviewedAt: { v: now } } };
    }
    return change;
  });
  if (
    !stamped &&
    !mutation.changes.some((c) => c.table === 'desk_card' && c.id === card.id && c.deleted)
  )
    changes.push({ table: 'desk_card', id: card.id, fields: { reviewedAt: { v: now } } });
  return { ...mutation, changes };
}

/**
 * **Today** and **Review** on the phone (DESIGN.md §25.3), from the footer's action button: a full-screen overlay over whatever page is open, **not a
 * navigation**, so closing it leaves the Desk under it at its address. The cards go one at a time (`SwipeCards`), or as a list beside them.
 *
 * | | Up | Down | Left | Right |
 * | Today | Done (a repeat makes its next) | Cancel: delete with Undo (a repeat skips to its next) | Dismiss until tomorrow, with Undo | Star |
 * | Review | the same | the same | only moves on | the same |
 *
 * **In Review any swipe stamps the card as reviewed, in the same mutation**, so that a pass can be stopped and gone on with, on this device or another.
 * Everything is read from the working copy and written to it, online or not.
 */
export function StackOverlay({
  kind,
  listId,
  onClose,
}: {
  kind: 'today' | 'review';
  /** Review of one list's cards. */
  listId?: string;
  onClose: () => void;
}) {
  const client = useSync();
  const offerUndo = useUndo();
  const [view, setView] = useState<'cards' | 'list'>('cards');
  // The day and the hour when it was opened: a pass does not change its mind at midnight.
  const now = useMemo(() => nowHere(), []);
  const data = useLocal(async (db) => ({
    cards: await visibleCards(db),
    lists: await listsOf(db),
  }));
  const review = kind === 'review';
  // The queue is fixed when the data first arrives, so that cards do not reshuffle under a finger as the swipes land.
  const queue = useMemo<LocalRow[] | undefined>(() => {
    if (!data) return undefined;
    if (!review) return buildToday(data.cards, now.date, now.time).map((entry) => entry.card);
    const listRank = new Map(data.lists.map((list, index) => [list.id, index]));
    return buildReview(data.cards, { ...(listId ? { listId } : {}), listRank });
    // `data` is read once: later changes to it are the swipes' own.
  }, [data === undefined]);
  const reasons = useMemo(() => {
    if (!data || review) return new Map<string, Reason>();
    return new Map(buildToday(data.cards, now.date, now.time).map((e) => [e.card.id, e.reason]));
  }, [data, review, now]);

  const title = review ? 'Review' : 'Today';

  async function commit(mutation: Mutation | undefined) {
    if (mutation) await client.commit(mutation);
  }

  async function done(card: LocalRow) {
    const seriesId = seriesIdOf(card);
    const { items, series } = await client.read(async (db) => ({
      items: await checksOf(db, card.id),
      series: seriesId ? await getRow(db, 'desk_series', seriesId) : undefined,
    }));
    const result = completeCard(card, Date.now(), ids, items, { series, today: now.date });
    if (result.ok)
      await commit(review ? withReviewed(result.mutation, card, Date.now()) : result.mutation);
  }

  async function cancel(card: LocalRow) {
    const seriesId = seriesIdOf(card);
    const { items, series } = await client.read(async (db) => ({
      items: await checksOf(db, card.id),
      series: seriesId ? await getRow(db, 'desk_series', seriesId) : undefined,
    }));
    const result = cancelCard(card, items, { series, today: now.date }, ids);
    if (!result.ok) return;
    await commit(result.mutation);
    const made = result.made;
    offerUndo('Card cancelled.', async () => {
      const back = await client.read(async (db) => ({
        row: await getRow(db, 'desk_card', card.id),
        items: await allChecksOf(db, card.id),
        next: made ? await getRow(db, 'desk_card', made) : undefined,
        nextItems: made ? await allChecksOf(db, made) : [],
      }));
      const restored = restoreCard(back.row, ids, back.items);
      if (restored.ok) await commit(restored.mutation);
      // The next occurrence it made goes again, if nobody has touched it (it is still open).
      if (back.next && back.next.table === 'desk_card' && !isCompleted(back.next)) {
        const removed = deleteCard(back.next, ids, back.nextItems);
        if (removed.ok) await commit(removed.mutation);
      }
    });
  }

  async function swipe(direction: Direction, card: LocalRow) {
    const stamp = Date.now();
    if (direction === 'up') return done(card);
    if (direction === 'down') return cancel(card);
    if (direction === 'left') {
      if (review) {
        const result = markReviewed(card, stamp, ids);
        if (result.ok) await commit(result.mutation);
        return;
      }
      const before = dismissedOn(card) ?? null;
      const result = dismissCard(card, now.date, ids);
      if (!result.ok) return;
      await commit(result.mutation);
      offerUndo('Card dismissed until tomorrow.', async () => {
        const row = await client.read((db) => getRow(db, 'desk_card', card.id));
        const undone = restoreDismissal(row, before, ids);
        if (undone.ok) await commit(undone.mutation);
      });
      return;
    }
    // Right: the star, and the due date is left as it is.
    const starred = setStarred(card, true, ids);
    if (starred.ok)
      await commit(review ? withReviewed(starred.mutation, card, stamp) : starred.mutation);
    else if (review) {
      const marked = markReviewed(card, stamp, ids);
      if (marked.ok) await commit(marked.mutation);
    }
  }

  const directions = {
    up: { label: 'Done', icon: 'check' as const },
    down: { label: 'Cancel', icon: 'trash-2' as const },
    left: review
      ? { label: 'Skip', icon: 'chevron-right' as const }
      : { label: 'Dismiss', icon: 'eye-off' as const },
    right: { label: 'Star' },
  };

  const detail = (card: LocalRow) => {
    const due = dueOf(card);
    const shown = due.date ? formatDue(due.date, due.time, now) : null;
    const reason = reasons.get(card.id);
    const list = data?.lists.find((each) => each.id === (card as { listId?: string }).listId);
    return (
      <>
        {reason ? <span className={styles.reason}>{REASONS[reason]}</span> : null}
        {shown ? (
          <span className={shown.overdue ? styles.overdue : undefined}>{shown.text}</span>
        ) : null}
        {review && list ? <span>{text(list, 'title', 'Untitled list')}</span> : null}
      </>
    );
  };

  const open = (card: LocalRow) => {
    onClose();
    openCard(card.id);
  };

  const empty = (
    <EmptyState
      icon="check"
      heading={review ? 'Nothing left to review' : 'Nothing needs you today'}
      description={
        review
          ? 'Every open card has been gone through. Come back when there are more.'
          : 'No card is overdue, due today or starred, or you have put them off until tomorrow.'
      }
    />
  );

  return (
    <Dialog open onClose={onClose} aria-label={title} title={title} size="lg">
      <div className={styles.body}>
        <SegmentedControl<'cards' | 'list'>
          aria-label={`${title}, as`}
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { label: 'Cards', value: 'cards' },
            { label: 'List', value: 'list' },
          ]}
        />
        {queue === undefined ? null : view === 'cards' ? (
          <SwipeCards
            cards={queue}
            directions={directions}
            ariaLabel={`${title}: cards to go through`}
            onSwipe={(direction, card) => void swipe(direction, card)}
            onOpen={open}
            detail={detail}
            empty={empty}
          />
        ) : queue.length === 0 ? (
          empty
        ) : (
          <ul className={styles.list} aria-label={`${title}, as a list`}>
            {queue.map((card) => (
              <li key={card.id} className={styles.row}>
                <button type="button" className={styles.rowTitle} onClick={() => open(card)}>
                  {text(card, 'title', 'Untitled card')}
                </button>
                <span className={styles.rowMeta}>{detail(card)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
