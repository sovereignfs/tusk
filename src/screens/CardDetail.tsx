'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  deleteCard,
  moveToList,
  restoreCard,
  setStatus,
  statusOf,
  type Status,
  updateCard,
} from '../actions/cards';
import type { LocalRow } from '../local/rows';
import { allChecksOf, cardsOf, checksOf, getRow, listsOf } from '../local/store';
import { useLocal, useSync } from '../sync/react';
import { Button, FormField, Icon, Input, SegmentedControl, Select, Textarea } from '../ui';
import { text } from './fields';
import styles from './CardDetail.module.css';
import { dueOf, setDue } from '../actions/due';
import { readSeries, seriesIdOf } from '../actions/series';
import { describe as describeRule } from '../recurrence';
import { nowHere } from '../time';
import { DuePicker } from '../dates/DuePicker';
import { StarButton } from './StarButton';
import { Checklist } from './Checklist';
import { useUndo } from './Undo';

const ids = { newId: () => crypto.randomUUID() };

/**
 * The right column (DESIGN.md §17.4), present only while `?card=<id>` is set, so that a card can be linked to and reloaded. It shows the card from the
 * working copy and **saves as you leave a field**: there is no Save, and nothing to lose by closing it. Closing replaces the address (DESIGN.md §17.10): a
 * link to the same path with another search parameter does nothing on a route that is already mounted, and a back button should not step through
 * every card that was looked at. **A card that is not there (a stale link, one that was deleted) shows nothing and does not fail.**
 */
export function CardDetail({ cardId }: { cardId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const row = useLocal(async (db) => ({ row: await getRow(db, 'desk_card', cardId) }), [cardId]);
  const close = () => router.replace(pathname);

  return (
    <section className={styles.detail} aria-label="Card">
      <div className={styles.bar}>
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      </div>
      {row === undefined ? null : row.row === undefined || row.row.deletedAt !== null ? (
        <p className={styles.muted}>That card is not here any more.</p>
      ) : (
        <Fields key={row.row.id} card={row.row} onDeleted={close} />
      )}
    </section>
  );
}

function Fields({ card, onDeleted }: { card: LocalRow; onDeleted: () => void }) {
  const client = useSync();
  const offerUndo = useUndo();
  const title = text(card, 'title');
  const description = text(card, 'description');
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftDescription, setDraftDescription] = useState(description);
  const [editing, setEditing] = useState<'title' | 'description' | null>(null);
  const status = statusOf(card);
  // A card that repeats says so, in words; setting and changing it is the repeat picker's (task 5.3).
  const seriesId = seriesIdOf(card);
  const series = useLocal(
    async (db) => ({ row: seriesId ? await getRow(db, 'desk_series', seriesId) : undefined }),
    [seriesId],
  );
  const repeats = readSeries(series?.row);

  // What another device or a sync changed shows here, unless the person is in the middle of typing in that field.
  useEffect(() => {
    if (editing !== 'title') setDraftTitle(title);
  }, [title, editing]);
  useEffect(() => {
    if (editing !== 'description') setDraftDescription(description);
  }, [description, editing]);

  function save(patch: { title?: string; description?: string }) {
    const result = updateCard(card, patch, ids);
    if (result.ok) void client.commit(result.mutation);
    // A title that was emptied is not a title: it goes back to the one the card has.
    else if (result.reason === 'title') setDraftTitle(title);
  }

  async function choose(next: Status) {
    // Done takes the card's open checklist items with it, in one mutation, so they are read first; the others touch the card alone.
    const seriesId = seriesIdOf(card);
    const { items, series } =
      next === 'done'
        ? await client.read(async (db) => ({
            items: await checksOf(db, card.id),
            series: seriesId ? await getRow(db, 'desk_series', seriesId) : undefined,
          }))
        : { items: [], series: undefined };
    const result = setStatus(card, next, Date.now(), ids, items, { series, today: nowHere().date });
    if (result.ok) void client.commit(result.mutation);
  }

  async function remove() {
    // A card takes its live checklist items with it, and Undo brings back those, and not one that was deleted before.
    const items = await client.read((db) => allChecksOf(db, card.id));
    const result = deleteCard(card, ids, items);
    if (!result.ok) return;
    void client.commit(result.mutation);
    offerUndo('Card deleted.', async () => {
      // The rows as they are by then, deleted: the card's deletion time is what says which items went with it.
      const now = await client.read(async (db) => ({
        card: await getRow(db, 'desk_card', card.id),
        items: await allChecksOf(db, card.id),
      }));
      const back = restoreCard(now.card, ids, now.items);
      if (back.ok) return client.commit(back.mutation);
    });
    onDeleted();
  }

  return (
    <>
      <div className={styles.bar}>
        <SegmentedControl<Status>
          aria-label="Status"
          size="sm"
          value={status}
          onChange={(next) => void choose(next)}
          options={[
            { label: 'Open', value: 'open' },
            { label: 'In progress', value: 'in_progress' },
            { label: 'Done', value: 'done' },
          ]}
        />
        <StarButton card={card} />
      </div>
      <div className={styles.bar}>
        <DuePicker
          value={dueOf(card)}
          onChange={(due) => {
            const result = setDue(card, due, ids);
            if (result.ok) void client.commit(result.mutation);
          }}
        />
        {repeats ? (
          <span className={styles.repeats}>
            <Icon name="refresh-cw" aria-hidden /> Repeats {describeRule(repeats.rule)}
          </span>
        ) : null}
      </div>
      <FormField label="Title">
        {(field) => (
          <Input
            {...field}
            value={draftTitle}
            maxLength={500}
            onFocus={() => setEditing('title')}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={() => {
              setEditing(null);
              save({ title: draftTitle });
            }}
            onKeyDown={(event) =>
              event.key === 'Enter' && (event.target as HTMLInputElement).blur()
            }
          />
        )}
      </FormField>
      <FormField label="Description">
        {(field) => (
          <Textarea
            {...field}
            value={draftDescription}
            rows={4}
            autoGrow
            onFocus={() => setEditing('description')}
            onChange={(event) => setDraftDescription(event.target.value)}
            onBlur={() => {
              setEditing(null);
              save({ description: draftDescription });
            }}
          />
        )}
      </FormField>
      <ListPicker card={card} />
      <Checklist card={card} />
      <div>
        <Button variant="secondary" onClick={() => void remove()}>
          Delete
        </Button>
      </div>
    </>
  );
}

/**
 * Which list the card is in, which can be changed (DESIGN.md §10.2). Moving puts it at the top of the other list, in one change; its checklist is where it
 * is. The lists offered are the person's own, as they are in the sidebar; a list that is not theirs is not here, and the server refuses it all the same.
 */
function ListPicker({ card }: { card: LocalRow }) {
  const client = useSync();
  const lists = useLocal(listsOf);
  if (card.table !== 'desk_card' || lists === undefined || lists.length < 2) return null;

  async function move(toListId: string) {
    const destination = await client.read((db) => cardsOf(db, toListId));
    const result = moveToList(card, toListId, destination, ids);
    if (result.ok) void client.commit(result.mutation);
  }

  return (
    <FormField label="List">
      {(field) => (
        <Select {...field} value={card.listId} onChange={(event) => void move(event.target.value)}>
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {text(list, 'title', 'Untitled list')}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  );
}
