'use client';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createList, moveList } from '../actions/lists';
import type { LocalRow } from '../local/rows';
import { allLists, listsOf, openCounts } from '../local/store';
import { useHasSynced, useLocal, useSync } from '../sync/react';
import { Icon, useToast } from '@sovereignfs/ui';
import {
  VERTICAL_AUTOSCROLL,
  spokenDrag,
  useDragClickGuard,
  useOptimisticOrder,
  useReorderSensors,
} from '../ui/dnd';
import { colourOf, text } from './fields';
import { addressOf, replaceQuery, setQuery, useSearchQuery } from './search-query';
import styles from './Sidebar.module.css';

/**
 * The Desk's lists column (DESIGN.md §17.4): the views, pinned, then the person's lists with a dot and a count, a + to add one, and a drag to put them in
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
      <SearchBox />
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

/**
 * The search field at the top of the lists column (DESIGN.md §10.7). Typing searches the Desk: the results are the content column at `/desk#q=`, which
 * is the address kept as it is typed (replaced, so that the back button is not a step for each letter) **as a fragment, which is never sent to the server**
 * (`search-query.ts`). From another page the first letter goes there.
 * Empty, it is the Desk's first list again; Escape empties it.
 */
function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const asked = useSearchQuery();
  const current = pathname === '/desk' ? asked : '';
  const [value, setValue] = useState(current);
  // The address changed elsewhere (a link, the back button): the field says what it says.
  useEffect(() => setValue(current), [current]);

  function change(next: string) {
    setValue(next);
    if (pathname === '/desk') replaceQuery(next);
    else {
      setQuery(next);
      router.push(addressOf(next));
    }
  }

  return (
    <div className={styles.search}>
      <input
        type="search"
        className={styles.input}
        aria-label="Search the Desk"
        data-shortcut="search"
        placeholder="Search"
        maxLength={200}
        value={value}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && value !== '' && change('')}
      />
    </div>
  );
}

/** "Desk" and the + beside it, which turns into a field to name the new list: Enter makes it, Escape or leaving it empty does not. */
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
        <span>Desk</span>
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

  const spoken = spokenDrag((id) => {
    const at = rendered.findIndex((list) => list.id === id);
    return at < 0
      ? undefined
      : {
          noun: 'list',
          name: text(rendered[at], 'title', 'Untitled'),
          position: at + 1,
          total: rendered.length,
        };
  });

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
      accessibility={spoken}
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
              current={pathname === `/desk/${list.id}`}
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
        href={`/desk/${list.id}`}
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
