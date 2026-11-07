'use client';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { uuid } from '../access/parse';
import { setFilter, setShowCompleted, setSort } from '../actions/lists';
import { deleteMany, isCompleted, moveCard, restoreMany, type Group } from '../actions/cards';
import {
  FILTERS,
  FILTER_LABELS,
  type Filter,
  filterCards,
  filterOf,
  showsCompleted,
} from '../lists/filter';
import {
  SORTS,
  SORT_LABELS,
  canReorder,
  dropWithinGroup,
  isSort,
  pinFirst,
  sortOf,
  sortCards,
} from '../lists/sort';
import type { LocalRow } from '../local/rows';
import { allChecksOf, cardsOf, checkCounts, getRow } from '../local/store';
import { useHasSynced, useLocal, useSync } from '../sync/react';
import { type LocalNow, nowHere } from '../time';
import { Button, EmptyState, SegmentedControl, Select } from '../ui';
import {
  VERTICAL_AUTOSCROLL,
  useDragClickGuard,
  useOptimisticOrder,
  useReorderSensors,
} from '../ui/dnd';
import { AddCard } from './AddCard';
import { BulkBar } from './BulkBar';
import { SelectionProvider } from './selection';
import { ListColour } from './ListColour';
import { CardRow, SortableCardRow } from './CardRow';
import { useUndo } from './Undo';
import { plain, text } from './fields';
import styles from './ListScreen.module.css';

/**
 * A list (DESIGN.md §17.4), read from the working copy. **A list that is not there for this account says so, with a way back**: an id that is not an
 * id, one that was deleted, one this account never had. It never waits for the network to say so, except on a device that has not yet been sent its
 * lists, where it says it is loading and not that the list is missing. The cards are task 3.4's.
 */
export function ListScreen({ listId }: { listId: string }) {
  const valid = uuid(listId).ok;
  // Wrapped, so that "not found" (a row of `undefined`) is told apart from "not read yet" (no result at all).
  const read = useLocal(
    async (db) => ({ row: valid ? await getRow(db, 'desk_list', listId) : undefined }),
    [listId, valid],
  );
  const synced = useHasSynced();

  if (read === undefined || synced === undefined) return null;
  const list = read.row;
  if (!valid || !list || list.deletedAt !== null) {
    if (valid && synced === false) return <p className={styles.muted}>Loading…</p>;
    return (
      <EmptyState
        icon="inbox"
        heading="That list is not here"
        description="It may have been deleted, or it may belong to someone else."
        action={<Link href="/desk">Go to your lists</Link>}
      />
    );
  }
  // A choice of cards belongs to the list it was made in: another list starts with none.
  return <ListCards key={list.id} list={list} />;
}

/**
 * The list's open cards, which can be dragged into order. The drag is worked out against **the cards as they are shown** (a filter, or a card
 * pinned to the top, makes that fewer than the list has), one row is written, and the screen shows the new order at once (`src/ui/dnd.ts`).
 */
function OpenCards({
  open,
  openId,
  counts,
  reorderable,
  pinNow,
}: {
  open: readonly LocalRow[];
  openId: string | null;
  counts: Map<string, { done: number; total: number }> | undefined;
  /** Only under the order the person made: under a sort, a row has no handle and a drag does nothing. */
  reorderable: boolean;
  /** Now, when what is overdue or due today is pinned to the top: where a drag lands is then worked out with that partition in mind. */
  pinNow: LocalNow | null;
}) {
  const client = useSync();
  const { rendered, show } = useOptimisticOrder(open);
  const guard = useDragClickGuard();
  const sensors = useReorderSensors();

  function onDragEnd(event: DragEndEvent) {
    guard.end();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rendered.findIndex((card) => card.id === active.id);
    const to = rendered.findIndex((card) => card.id === over.id);
    if (from === -1 || to === -1) return;
    // With the pinned cards on top, a drop is worked out among the cards of the group the dragged one is in, since the positions of the two groups do not run on.
    const within = pinNow ? dropWithinGroup(rendered, String(active.id), to, pinNow) : undefined;
    const result = within
      ? moveCard(within.group, String(active.id), within.toIndex, ids)
      : moveCard(rendered, String(active.id), to, ids);
    if (!result.ok) return;
    // What the screen will show once the write has landed: the card at its new position, and the pinned ones still first. A card dropped among the pinned
    // ones that is not pinned goes back to its group, but with a position that is valid and between the neighbours it was dropped between.
    const change = result.mutation.changes[0];
    const position = change && 'position' in change ? change.position : undefined;
    const moved = rendered.map((card) =>
      card.id === active.id && position !== undefined ? ({ ...card, position } as LocalRow) : card,
    );
    const expected = pinNow
      ? pinFirst(sortCards(moved, 'custom'), pinNow)
      : arrayMove(moved, from, to);
    show(expected.map((card) => card.id));
    void client.commit(result.mutation);
  }

  if (!reorderable) {
    return (
      <ul className={styles.cards}>
        {open.map((card) => (
          <CardRow
            key={card.id}
            card={card}
            open={openId === card.id}
            progress={counts?.get(card.id)}
          />
        ))}
      </ul>
    );
  }

  return (
    <DndContext
      id="cards"
      sensors={sensors}
      autoScroll={VERTICAL_AUTOSCROLL}
      collisionDetection={closestCenter}
      onDragStart={guard.begin}
      onDragEnd={onDragEnd}
      onDragCancel={guard.end}
    >
      <SortableContext
        items={rendered.map((card) => card.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className={styles.cards}>
          {rendered.map((card) => (
            <SortableCardRow
              key={card.id}
              card={card}
              open={openId === card.id}
              progress={counts?.get(card.id)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

const ids = { newId: () => crypto.randomUUID() };

/**
 * The list's cards, from the working copy, **the way the person wants to see them, remembered**: the order (`sort`) and whether the Completed
 * section is open (`showCompleted`) are fields of the list, as is the filter (`filter`), so they survive a reload and reach the person's other devices
 * (DESIGN.md §10.5). Under any order but Custom a card has no handle and cannot be dragged, since where it landed would be the
 * sort's doing and not the person's.
 */
function ListCards({ list }: { list: LocalRow }) {
  const client = useSync();
  const offerUndo = useUndo();
  const cards = useLocal((db) => cardsOf(db, list.id), [list.id]);
  const counts = useLocal(checkCounts);
  const openId = useSearchParams().get('card');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const filter = filterOf(list);
  const sort = sortOf(list);
  const showCompleted = (() => {
    const field = list.fields.showCompleted;
    return field !== undefined && 'v' in field && field.v === true;
  })();

  const all = cards ?? [];
  const now = nowHere();
  const sorted = sortCards(
    all.filter((card) => !isCompleted(card)),
    sort,
  );
  // Under the order the person made, what is overdue or due today floats to the top; a partition, so no position changes. Under a sort it is the sort's.
  const ordered = sort === 'custom' ? pinFirst(sorted, now) : sorted;
  const open = filterCards(ordered, filter, now);
  // Most recently finished first, whatever the sort: it is a record of what was done.
  const done = all
    .filter(isCompleted)
    .sort((a, b) => Number(plain(b, 'completedAt')) - Number(plain(a, 'completedAt')));

  function choose(next: string) {
    if (!isSort(next)) return;
    const result = setSort(list, next, ids);
    if (result.ok) void client.commit(result.mutation);
  }

  // What is chosen and is still here: a card that was deleted or moved on another device, or by the bar, is not.
  const here = new Set([...open, ...done].map((card) => card.id));
  const chosenCards = [...open, ...done].filter((card) => chosen.has(card.id));
  const selection = {
    selected: chosen,
    active: chosenCards.length > 0,
    toggle: (id: string) =>
      setChosen((was) => {
        const next = new Set([...was].filter((each) => here.has(each)));
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    clear: () => setChosen(new Set()),
  };

  function chooseFilter(next: Filter) {
    const result = setFilter(list, next, ids);
    if (result.ok) void client.commit(result.mutation);
  }

  function toggleCompleted() {
    const result = setShowCompleted(list, !showCompleted, ids);
    if (result.ok) void client.commit(result.mutation);
  }

  async function deleteCompleted() {
    // Each completed card with the checklist items it has, deleted together; and the undo reads them again by then, deleted, which says which went with which.
    const groups: Group[] = await client.read(async (db) =>
      Promise.all(done.map(async (card) => ({ card, items: await allChecksOf(db, card.id) }))),
    );
    const result = deleteMany(groups, ids);
    if (!result.ok) return;
    for (const mutation of result.mutations) await client.commit(mutation);
    const doneIds = done.map((card) => card.id);
    offerUndo(
      done.length === 1 ? 'Completed card deleted.' : `${done.length} completed cards deleted.`,
      async () => {
        const back: Group[] = await client.read(async (db) => {
          const found: Group[] = [];
          for (const id of doneIds) {
            const card = await getRow(db, 'desk_card', id);
            if (card) found.push({ card, items: await allChecksOf(db, id) });
          }
          return found;
        });
        const restored = restoreMany(back, ids);
        if (restored.ok) for (const mutation of restored.mutations) await client.commit(mutation);
      },
    );
  }

  return (
    <SelectionProvider value={selection}>
      <section aria-label={text(list, 'title', 'List')}>
        <div className={styles.header}>
          <div className={styles.heading}>
            <ListColour list={list} />
            <h1 className={styles.title}>{text(list, 'title', 'Untitled list')}</h1>
          </div>
          <div className={styles.controls}>
            <SegmentedControl<Filter>
              aria-label="Show"
              size="sm"
              value={filter}
              onChange={chooseFilter}
              options={FILTERS.map((value) => ({ label: FILTER_LABELS[value], value }))}
            />
            <Select
              aria-label="Sort by"
              size="sm"
              value={sort}
              onChange={(event) => choose(event.target.value)}
            >
              {SORTS.map((value) => (
                <option key={value} value={value}>
                  {SORT_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {chosenCards.length > 0 ? (
          <BulkBar chosen={chosenCards} listId={list.id} onDone={selection.clear} />
        ) : null}
        <AddCard listId={list.id} cards={open} />
        {cards !== undefined && all.length === 0 ? (
          <p className={styles.muted}>Nothing here yet.</p>
        ) : null}
        <OpenCards
          open={open}
          openId={openId}
          counts={counts}
          reorderable={canReorder(sort)}
          pinNow={sort === 'custom' ? now : null}
        />
        {done.length > 0 && showsCompleted(filter) ? (
          <div className={styles.completed}>
            <div className={styles.completedBar}>
              <button
                type="button"
                className={styles.completedHeading}
                aria-expanded={showCompleted}
                onClick={toggleCompleted}
              >
                <span aria-hidden>{showCompleted ? '▾' : '▸'}</span> Completed ({done.length})
              </button>
              {showCompleted ? (
                <Button variant="secondary" onClick={() => void deleteCompleted()}>
                  Delete completed
                </Button>
              ) : null}
            </div>
            {showCompleted ? (
              <ul className={styles.cards}>
                {done.map((card) => (
                  <CardRow
                    key={card.id}
                    card={card}
                    open={openId === card.id}
                    progress={counts?.get(card.id)}
                  />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </SelectionProvider>
  );
}
