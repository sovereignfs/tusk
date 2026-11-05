'use client';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { uuid } from '../access/parse';
import { setShowCompleted, setSort } from '../actions/lists';
import { deleteMany, isCompleted, moveTask, restoreMany, type Group } from '../actions/tasks';
import { SORTS, SORT_LABELS, canReorder, isSort, sortOf, sortTasks } from '../lists/sort';
import type { LocalRow } from '../local/rows';
import { allSubtasksOf, getRow, subtaskCounts, tasksOf } from '../local/store';
import { useHasSynced, useLocal, useSync } from '../sync/react';
import { Button, EmptyState, SegmentedControl, Select } from '../ui';
import {
  VERTICAL_AUTOSCROLL,
  useDragClickGuard,
  useOptimisticOrder,
  useReorderSensors,
} from '../ui/dnd';
import { AddTask } from './AddTask';
import { SortableTaskRow, TaskRow } from './TaskRow';
import { useUndo } from './Undo';
import { plain, text } from './fields';
import styles from './ListScreen.module.css';

/**
 * A list (DESIGN.md §14.1), read from the working copy. **A list that is not there for this account says so, with a way back**: an id that is not an
 * id, one that was deleted, one this account never had. It never waits for the network to say so, except on a device that has not yet been sent its
 * lists, where it says it is loading and not that the list is missing. The tasks are task 3.4's.
 */
export function ListScreen({ listId }: { listId: string }) {
  const valid = uuid(listId).ok;
  // Wrapped, so that "not found" (a row of `undefined`) is told apart from "not read yet" (no result at all).
  const read = useLocal(
    async (db) => ({ row: valid ? await getRow(db, 'list', listId) : undefined }),
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
        action={<Link href="/">Go to your lists</Link>}
      />
    );
  }
  return <ListTasks list={list} />;
}

/**
 * The list's open tasks, which can be dragged into order. The drag is worked out against **the tasks as they are shown** (a filter, or a task
 * pinned to the top, makes that fewer than the list has), one row is written, and the screen shows the new order at once (`src/ui/dnd.ts`).
 */
function OpenTasks({
  open,
  openId,
  counts,
  reorderable,
}: {
  open: readonly LocalRow[];
  openId: string | null;
  counts: Map<string, { done: number; total: number }> | undefined;
  /** Only under the order the person made: under a sort, a row has no handle and a drag does nothing. */
  reorderable: boolean;
}) {
  const client = useSync();
  const { rendered, show } = useOptimisticOrder(open);
  const guard = useDragClickGuard();
  const sensors = useReorderSensors();

  function onDragEnd(event: DragEndEvent) {
    guard.end();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rendered.findIndex((task) => task.id === active.id);
    const to = rendered.findIndex((task) => task.id === over.id);
    if (from === -1 || to === -1) return;
    const result = moveTask(rendered, String(active.id), to, { newId: () => crypto.randomUUID() });
    if (!result.ok) return;
    show(
      arrayMove(
        rendered.map((task) => task.id),
        from,
        to,
      ),
    );
    void client.commit(result.mutation);
  }

  if (!reorderable) {
    return (
      <ul className={styles.tasks}>
        {open.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            open={openId === task.id}
            progress={counts?.get(task.id)}
          />
        ))}
      </ul>
    );
  }

  return (
    <DndContext
      id="tasks"
      sensors={sensors}
      autoScroll={VERTICAL_AUTOSCROLL}
      collisionDetection={closestCenter}
      onDragStart={guard.begin}
      onDragEnd={onDragEnd}
      onDragCancel={guard.end}
    >
      <SortableContext
        items={rendered.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className={styles.tasks}>
          {rendered.map((task) => (
            <SortableTaskRow
              key={task.id}
              task={task}
              open={openId === task.id}
              progress={counts?.get(task.id)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

type Filter = 'all' | 'active';

const ids = { newId: () => crypto.randomUUID() };

/**
 * The list's tasks, from the working copy, **the way the person wants to see them, remembered**: the order (`sort`) and whether the Completed
 * section is open (`showCompleted`) are fields of the list, so they survive a reload and reach the person's other devices (DESIGN.md §11.4). The
 * filter is for now and is not remembered. Under any order but Custom a task has no handle and cannot be dragged, since where it landed would be the
 * sort's doing and not the person's.
 */
function ListTasks({ list }: { list: LocalRow }) {
  const client = useSync();
  const offerUndo = useUndo();
  const tasks = useLocal((db) => tasksOf(db, list.id), [list.id]);
  const counts = useLocal(subtaskCounts);
  const openId = useSearchParams().get('task');
  const [filter, setFilter] = useState<Filter>('all');
  const sort = sortOf(list);
  const showCompleted = (() => {
    const field = list.fields.showCompleted;
    return field !== undefined && 'v' in field && field.v === true;
  })();

  const all = tasks ?? [];
  const open = sortTasks(
    all.filter((task) => !isCompleted(task)),
    sort,
  );
  // Most recently finished first, whatever the sort: it is a record of what was done.
  const done = all
    .filter(isCompleted)
    .sort((a, b) => Number(plain(b, 'completedAt')) - Number(plain(a, 'completedAt')));

  function choose(next: string) {
    if (!isSort(next)) return;
    const result = setSort(list, next, ids);
    if (result.ok) void client.commit(result.mutation);
  }

  function toggleCompleted() {
    const result = setShowCompleted(list, !showCompleted, ids);
    if (result.ok) void client.commit(result.mutation);
  }

  async function deleteCompleted() {
    // Each completed task with the subtasks it has, deleted together; and the undo reads them again by then, deleted, which says which went with which.
    const groups: Group[] = await client.read(async (db) =>
      Promise.all(done.map(async (task) => ({ task, subtasks: await allSubtasksOf(db, task.id) }))),
    );
    const result = deleteMany(groups, ids);
    if (!result.ok) return;
    for (const mutation of result.mutations) await client.commit(mutation);
    const doneIds = done.map((task) => task.id);
    offerUndo(
      done.length === 1 ? 'Completed task deleted.' : `${done.length} completed tasks deleted.`,
      async () => {
        const back: Group[] = await client.read(async (db) => {
          const found: Group[] = [];
          for (const id of doneIds) {
            const task = await getRow(db, 'task', id);
            if (task) found.push({ task, subtasks: await allSubtasksOf(db, id) });
          }
          return found;
        });
        const restored = restoreMany(back, ids);
        if (restored.ok) for (const mutation of restored.mutations) await client.commit(mutation);
      },
    );
  }

  return (
    <section aria-label={text(list, 'title', 'List')}>
      <div className={styles.header}>
        <h1 className={styles.title}>{text(list, 'title', 'Untitled list')}</h1>
        <div className={styles.controls}>
          <SegmentedControl<Filter>
            aria-label="Show"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Active', value: 'active' },
            ]}
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
      <AddTask listId={list.id} tasks={open} />
      {tasks !== undefined && all.length === 0 ? (
        <p className={styles.muted}>Nothing here yet.</p>
      ) : null}
      <OpenTasks open={open} openId={openId} counts={counts} reorderable={canReorder(sort)} />
      {done.length > 0 && filter === 'all' ? (
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
            <ul className={styles.tasks}>
              {done.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  open={openId === task.id}
                  progress={counts?.get(task.id)}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
