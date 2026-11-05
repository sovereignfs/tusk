'use client';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createList, moveList } from '../actions/lists';
import type { LocalRow } from '../local/rows';
import { allLists, listsOf, openCounts } from '../local/store';
import { useHasSynced, useLocal, useSync } from '../sync/react';
import { Icon, useToast } from '../ui';
import {
  VERTICAL_AUTOSCROLL,
  useDragClickGuard,
  useOptimisticOrder,
  useReorderSensors,
} from '../ui/dnd';
import { colourOf, text } from './fields';
import styles from './Sidebar.module.css';

/**
 * The left column (DESIGN.md §15.2): the views, pinned, then the person's lists with a dot and a count, a + to add one, and a drag to put them in
 * order. **It reads the working copy and nothing else**: a list made on this device is here before the server has heard of it, and a new device shows
 * what has arrived so far.
 *
 * The pinned views (Today, Starred, Review) are added by the tasks that build them, to `PINNED`; a link to a page that is not there is worse than none.
 */
export const PINNED: readonly { href: string; label: string }[] = [];

const ids = { newId: () => crypto.randomUUID() };

export function Sidebar() {
  const pathname = usePathname();
  const lists = useLocal(listsOf);
  const counts = useLocal(openCounts);
  const synced = useHasSynced();

  return (
    <nav className={styles.sidebar} aria-label="Lists">
      {PINNED.length > 0 ? (
        <ul className={styles.list}>
          {PINNED.map((view) => (
            <li key={view.href}>
              <Link
                href={view.href}
                className={styles.row}
                aria-current={pathname === view.href ? 'page' : undefined}
              >
                <span className={styles.name}>{view.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div>
        <AddList lists={lists ?? []} />
        {lists === undefined || lists.length === 0 ? (
          // A new device has nothing until the server has answered once; after that, none really is none.
          <p className={styles.empty}>
            {synced === false ? 'Loading your lists…' : 'No lists yet.'}
          </p>
        ) : (
          <Lists lists={lists} counts={counts} pathname={pathname} />
        )}
      </div>
    </nav>
  );
}

/** "My lists" and the + beside it, which turns into a field to name the new list: Enter makes it, Escape or leaving it empty does not. */
function AddList({ lists }: { lists: readonly LocalRow[] }) {
  const client = useSync();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // Every list row there is, deleted ones too, which count against the limit until they are removed for good.
  const everything = useLocal(allLists);

  useEffect(() => {
    if (adding) field.current?.focus();
  }, [adding]);

  const stop = () => {
    setAdding(false);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Read from the field, not from state, which is a keystroke behind when a title is typed and sent in the same breath.
    const title = field.current?.value ?? '';
    const result = createList(lists, { title }, ids, everything ?? lists);
    if (!result.ok) {
      if (result.reason === 'limit') {
        toast.show({
          title: 'You have as many lists as an account can hold.',
          category: 'warning',
        });
      }
      if (result.reason === 'title') {
        // An empty name is no list: leaving the field closes it, and pressing Enter on nothing does nothing.
        if (title.trim() === '') return;
      }
      return;
    }
    stop();
    // The list is in the sidebar the moment it is written. The person is not taken to it: that would need the server for a page, which a device that is
    // offline does not have until the service worker keeps one (task 13.6), and a list that is made offline must not wait for it.
    await client.commit(result.mutation);
  }

  return (
    <>
      <div className={styles.heading}>
        <span>My lists</span>
        <button
          type="button"
          className={styles.add}
          aria-label="Add a list"
          aria-expanded={adding}
          onClick={() => (adding ? stop() : setAdding(true))}
        >
          <Icon name="plus" aria-hidden />
        </button>
      </div>
      {adding ? (
        <form onSubmit={(event) => void submit(event)} className={styles.addForm}>
          <input
            ref={field}
            className={styles.input}
            aria-label="New list name"
            placeholder="Name the list"
            maxLength={500}
            onKeyDown={(event) => event.key === 'Escape' && stop()}
            onBlur={(event) => event.currentTarget.value.trim() === '' && stop()}
          />
        </form>
      ) : null}
    </>
  );
}

/**
 * The lists, which can be dragged into order. The order on the screen is what the drag is worked out against (DESIGN.md §15.8), and while the move is
 * being written the screen already shows it, so that the row does not spring back to where it was and then jump.
 */
function Lists({
  lists,
  counts,
  pathname,
}: {
  lists: readonly LocalRow[];
  counts: Map<string, number> | undefined;
  pathname: string;
}) {
  const client = useSync();
  const { rendered, show } = useOptimisticOrder(lists);
  const guard = useDragClickGuard();
  const sensors = useReorderSensors();

  function onDragEnd(event: DragEndEvent) {
    guard.end();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rendered.findIndex((list) => list.id === active.id);
    const to = rendered.findIndex((list) => list.id === over.id);
    if (from === -1 || to === -1) return;
    const moved = arrayMove(
      rendered.map((list) => list.id),
      from,
      to,
    );
    const result = moveList(rendered, String(active.id), to, ids);
    if (!result.ok) return;
    show(moved);
    void client.commit(result.mutation);
  }

  return (
    // An explicit `id`, or the server and the browser name the drag's pieces differently and React reports a mismatch (DESIGN.md §15.8).
    <DndContext
      id="lists"
      sensors={sensors}
      autoScroll={VERTICAL_AUTOSCROLL}
      collisionDetection={closestCenter}
      onDragStart={guard.begin}
      onDragEnd={onDragEnd}
      onDragCancel={guard.end}
    >
      <SortableContext
        items={rendered.map((list) => list.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className={styles.list}>
          {rendered.map((list) => (
            <ListRow
              key={list.id}
              list={list}
              count={counts?.get(list.id) ?? 0}
              current={pathname === `/lists/${list.id}`}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function ListRow({ list, count, current }: { list: LocalRow; count: number; current: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: list.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      {/* The link is the handle, and the one thing a keyboard focuses, which dnd-kit insists on; its `role="button"` is taken off, so that each list stays a link. */}
      <Link
        ref={setActivatorNodeRef}
        {...attributes}
        role={undefined}
        {...listeners}
        href={`/lists/${list.id}`}
        className={styles.row}
        aria-current={current ? 'page' : undefined}
        // A link can be dragged by the browser too, and one dropped on the page is followed: that is a navigation in the middle of a reorder.
        draggable={false}
      >
        <span className={styles.dot} style={{ background: colourOf(list) }} aria-hidden />
        <span className={styles.name}>{text(list, 'title', 'Untitled list')}</span>
        <span className={styles.count}>{count}</span>
      </Link>
    </li>
  );
}
