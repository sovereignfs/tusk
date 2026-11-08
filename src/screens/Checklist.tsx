'use client';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { type FormEvent, useRef } from 'react';
import { isCompleted } from '../actions/cards';
import {
  addItem,
  deleteItem,
  moveItem,
  renameItem,
  restoreItem,
  tickItem,
  untickItem,
} from '../actions/checks';
import type { LocalRow } from '../local/rows';
import { checkCount, checksOf } from '../local/store';
import { useLocal, useSync } from '../sync/react';
import { Button, Checkbox, Input, useToast } from '@sovereignfs/ui';
import { text } from './fields';
import styles from './CardDetail.module.css';
import {
  VERTICAL_AUTOSCROLL,
  useDragClickGuard,
  useOptimisticOrder,
  useReorderSensors,
} from '../ui/dnd';
import { useUndo } from './Undo';

const ids = { newId: () => crypto.randomUUID() };

/**
 * A card's checklist in the detail column (DESIGN.md §10.3): items in order, each with a tick and a title that is edited in place and saved as it is
 * left, and a field to add another at the bottom. An item has a title and a tick and nothing else, so there is nothing here for a date or a star.
 */
export function Checklist({ card }: { card: LocalRow }) {
  const client = useSync();
  const toast = useToast();
  const offerUndo = useUndo();
  const items = useLocal((db) => checksOf(db, card.id), [card.id]);
  const count = useLocal(checkCount);
  const field = useRef<HTMLInputElement>(null);
  // Where the one made last went, for the next to go below it while the list on the screen is still catching up.
  const last = useRef<{ card: string; position: string } | null>(null);

  function add(event: FormEvent) {
    event.preventDefault();
    const title = field.current?.value ?? '';
    const below = last.current?.card === card.id ? last.current.position : undefined;
    const result = addItem(card, items ?? [], { title }, ids, count ?? 0, below);
    if (!result.ok) {
      if (result.reason === 'limit')
        toast.show({
          title: 'You have as many checklist items as an account can hold.',
          category: 'warning',
        });
      return;
    }
    if (field.current) field.current.value = '';
    const made = result.mutation.changes[0];
    if (made && 'position' in made && made.position)
      last.current = { card: card.id, position: made.position };
    void client.commit(result.mutation);
  }

  function remove(item: LocalRow) {
    const result = deleteItem(item, ids);
    if (!result.ok) return;
    void client.commit(result.mutation);
    offerUndo('Item deleted.', () => {
      const back = restoreItem(item, ids);
      if (back.ok) return client.commit(back.mutation);
    });
  }

  return (
    <section className={styles.section} aria-label="Checklist">
      <h3 className={styles.heading}>Checklist</h3>
      {items !== undefined && items.length > 0 ? <Items items={items} onDelete={remove} /> : null}
      <form onSubmit={add}>
        <Input
          ref={field}
          aria-label="Add an item"
          placeholder="Add an item…"
          maxLength={500}
          autoComplete="off"
        />
      </form>
    </section>
  );
}

function ItemRow({ item, onDelete }: { item: LocalRow; onDelete: () => void }) {
  const client = useSync();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  const title = text(item, 'title');
  const done = isCompleted(item);

  function tick(next: boolean) {
    const result = next ? tickItem(item, Date.now(), ids) : untickItem(item, ids);
    if (result.ok) void client.commit(result.mutation);
  }

  function save(value: string) {
    const result = renameItem(item, value, ids);
    if (result.ok) void client.commit(result.mutation);
  }

  return (
    <li
      ref={setNodeRef}
      className={`${styles.item} ${done ? styles.itemDone : ''}`}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className={styles.handle}
        aria-label={`Move item: ${title}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <Checkbox
        id={`item-${item.id}`}
        label=""
        aria-label={`Done: ${title}`}
        checked={done}
        onChange={tick}
      />
      <input
        className={styles.itemTitle}
        aria-label={`Item: ${title}`}
        defaultValue={title}
        key={title}
        maxLength={500}
        onBlur={(event) => {
          const value = event.currentTarget.value;
          // An emptied title is not a title: the field goes back to what it was.
          if (value.trim() === '') event.currentTarget.value = title;
          else save(value);
        }}
        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      />
      <Button variant="secondary" aria-label={`Delete item: ${title}`} onClick={onDelete}>
        ×
      </Button>
    </li>
  );
}

/**
 * The items, which can be dragged into order by the handle at the left of each row. The handle and not the whole row, because a row has a field in it,
 * and a drag that began on the field would stop a person selecting its text. One row is written (`moveItem`).
 */
function Items({
  items,
  onDelete,
}: {
  items: readonly LocalRow[];
  onDelete: (item: LocalRow) => void;
}) {
  const client = useSync();
  const { rendered, show } = useOptimisticOrder(items);
  const guard = useDragClickGuard();
  const sensors = useReorderSensors();

  function onDragEnd(event: DragEndEvent) {
    guard.end();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rendered.findIndex((item) => item.id === active.id);
    const to = rendered.findIndex((item) => item.id === over.id);
    if (from === -1 || to === -1) return;
    const result = moveItem(rendered, String(active.id), to, ids);
    if (!result.ok) return;
    show(
      arrayMove(
        rendered.map((item) => item.id),
        from,
        to,
      ),
    );
    void client.commit(result.mutation);
  }

  return (
    <DndContext
      id="checklist"
      sensors={sensors}
      autoScroll={VERTICAL_AUTOSCROLL}
      collisionDetection={closestCenter}
      onDragStart={guard.begin}
      onDragEnd={onDragEnd}
      onDragCancel={guard.end}
    >
      <SortableContext
        items={rendered.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className={styles.checklist}>
          {rendered.map((item) => (
            <ItemRow key={item.id} item={item} onDelete={() => onDelete(item)} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
