'use client';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { type FormEvent, useCallback, useRef, useState } from 'react';
import { progressOf, showingItems, sortItems, withProgress } from '../boards/checklist';
import type { BoardStore } from '../boards/store';
import { after, between, first } from '../position';
import { VERTICAL_AUTOSCROLL, spokenDrag, useDragClickGuard, useReorderSensors } from '../ui/dnd';
import { Button, Checkbox, Input } from '@sovereignfs/ui';
import { type ChecklistItem, type Op, WORKSPACE_LIMITS } from '../workspaces/format';
import styles from './CardChecklist.module.css';

/**
 * A card's checklist in its dialog (DESIGN.md §15.4): items with a tick, a title that is edited in place and saved as it is left, an order the items are
 * dragged into (one row written), a progress bar, and "Add an item", which keeps the cursor for the next. **Every change shows at once** (the dialog holds
 * the items, and tells the board the new count so that the tile's "2/5" follows) and is sent through the board's store; a refusal puts the items back as
 * the server last said they were. Someone who may not change the board sees the list and the bar, and ticks nothing.
 */
export function CardChecklist({
  cardId,
  initial,
  editable,
  store,
}: {
  cardId: string;
  initial: readonly ChecklistItem[];
  editable: boolean;
  store: BoardStore;
}) {
  const [items, setItemsState] = useState(() => sortItems(initial));
  // The items as the latest change left them, which the next change is made from: a state read in a handler is the render's, and a second change typed
  // before the first has rendered would otherwise start from items that do not have it.
  const latest = useRef(items);
  const setItems = useCallback((next: ChecklistItem[]) => {
    latest.current = next;
    setItemsState(next);
  }, []);
  const confirmed = useRef(items);
  const [title, setTitle] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const sensors = useReorderSensors();
  const guard = useDragClickGuard();
  const spoken = spokenDrag((id) => {
    const at = items.findIndex((each) => each.id === id);
    return at < 0
      ? undefined
      : { noun: 'item', name: items[at]?.title ?? '', position: at + 1, total: items.length };
  });

  /** Does one thing: shows it, tells the board the new count, sends it, and puts the items back if it was refused. */
  const act = useCallback(
    async (op: Op) => {
      const next = showingItems(latest.current, op);
      setItems(next);
      const done = await store.perform(op, (view) => withProgress(view, cardId, progressOf(next)));
      if (done) confirmed.current = next;
      else setItems(confirmed.current);
      return done;
    },
    [cardId, setItems, store],
  );

  async function add(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (next === '') return;
    const last = latest.current.at(-1);
    setTitle('');
    await act({
      op: 'item.add',
      id: crypto.randomUUID(),
      cardId,
      title: next,
      position: last ? after(last.position) : first(),
    });
    // The cursor stays for the next item.
    field.current?.focus();
  }

  function onDragEnd(event: DragEndEvent) {
    guard.end();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((each) => each.id === active.id);
    const to = items.findIndex((each) => each.id === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(items, from, to);
    const at = moved.findIndex((each) => each.id === active.id);
    const position = between(moved[at - 1]?.position ?? null, moved[at + 1]?.position ?? null);
    void act({ op: 'item.move', id: String(active.id), position });
  }

  const progress = progressOf(items);
  const full = items.length >= WORKSPACE_LIMITS.itemsPerCard;
  return (
    <section aria-label="Checklist" className={styles.checklist}>
      <h3 className={styles.heading}>
        Checklist
        {progress.total > 0 ? (
          <span className={styles.count}>
            {progress.done}/{progress.total}
          </span>
        ) : null}
      </h3>
      {progress.total > 0 ? (
        <progress
          className={styles.bar}
          max={progress.total}
          value={progress.done}
          aria-label={`${progress.done} of ${progress.total} done`}
        />
      ) : null}
      <DndContext
        accessibility={spoken}
        id={`checklist-${cardId}`}
        sensors={sensors}
        autoScroll={VERTICAL_AUTOSCROLL}
        collisionDetection={closestCenter}
        onDragStart={guard.begin}
        onDragEnd={onDragEnd}
        onDragCancel={guard.end}
      >
        <SortableContext
          items={items.map((each) => each.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className={styles.items}>
            {items.map((item) => (
              <ItemRow key={item.id} item={item} editable={editable} act={act} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {editable ? (
        full ? (
          <p className={styles.muted}>A card can hold {WORKSPACE_LIMITS.itemsPerCard} items.</p>
        ) : (
          <form onSubmit={(event) => void add(event)} className={styles.add}>
            <Input
              ref={field}
              aria-label="Add an item"
              value={title}
              maxLength={WORKSPACE_LIMITS.cardTitleChars}
              placeholder="Add an item…"
              onChange={(event) => setTitle(event.target.value)}
            />
            {/* Not disabled while the field is empty: a disabled default button stops Enter from submitting, and a field filled and submitted at once would be lost. */}
            <Button type="submit" size="sm">
              Add
            </Button>
          </form>
        )
      ) : null}
    </section>
  );
}

function ItemRow({
  item,
  editable,
  act,
}: {
  item: ChecklistItem;
  editable: boolean;
  act: (op: Op) => Promise<boolean>;
}) {
  const sortable = useSortable({ id: item.id, disabled: !editable });
  const [draft, setDraft] = useState(item.title);
  const [editing, setEditing] = useState(false);
  const shown = editing ? draft : item.title;
  const style = {
    transform: sortable.transform
      ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
      : undefined,
    transition: sortable.transition,
  };

  function leave() {
    setEditing(false);
    const next = draft.trim();
    if (next === '' || next === item.title) return setDraft(item.title);
    void act({ op: 'item.rename', id: item.id, title: next });
  }

  return (
    <li ref={sortable.setNodeRef} style={style} className={styles.row}>
      {editable ? (
        <button
          type="button"
          ref={sortable.setActivatorNodeRef}
          className={styles.handle}
          aria-label={`Move ${item.title}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          ⋮⋮
        </button>
      ) : null}
      <Checkbox
        label={editable ? '' : item.title}
        aria-label={`Done: ${item.title}`}
        checked={item.done}
        disabled={!editable}
        onChange={(checked) => void act({ op: checked ? 'item.tick' : 'item.untick', id: item.id })}
      />
      {editable ? (
        <Input
          aria-label={`Item: ${item.title}`}
          value={shown}
          maxLength={WORKSPACE_LIMITS.cardTitleChars}
          className={item.done ? styles.done : undefined}
          onFocus={() => {
            setDraft(item.title);
            setEditing(true);
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={leave}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      ) : null}
      {editable ? (
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Delete item ${item.title}`}
          onClick={() => void act({ op: 'item.delete', id: item.id })}
        >
          Delete
        </Button>
      ) : null}
    </li>
  );
}
