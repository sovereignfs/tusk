'use client';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { type FormEvent, useRef } from 'react';
import {
  completeTask,
  createSubtask,
  deleteTask,
  isCompleted,
  moveTask,
  reopenTask,
  restoreTask,
  updateTask,
} from '../actions/tasks';
import type { LocalRow } from '../local/rows';
import { subtasksOf, taskCount } from '../local/store';
import { useLocal, useSync } from '../sync/react';
import { Button, Checkbox, Input, useToast } from '../ui';
import { text } from './fields';
import styles from './TaskDetail.module.css';
import {
  VERTICAL_AUTOSCROLL,
  useDragClickGuard,
  useOptimisticOrder,
  useReorderSensors,
} from '../ui/dnd';
import { useUndo } from './Undo';

const ids = { newId: () => crypto.randomUUID() };

/**
 * A task's subtasks in the detail column (DESIGN.md §11.2): a checklist, in order, each with a tick and a title that is edited in place and saved as it
 * is left, and a field to add another at the bottom. **A subtask is one level deep and has no date, star or repeat**, so there is nothing here for them.
 */
export function Subtasks({ parent }: { parent: LocalRow }) {
  const client = useSync();
  const toast = useToast();
  const offerUndo = useUndo();
  const subtasks = useLocal((db) => subtasksOf(db, parent.id), [parent.id]);
  const count = useLocal(taskCount);
  const field = useRef<HTMLInputElement>(null);
  // Where the one made last went, for the next to go below it while the list on the screen is still catching up.
  const last = useRef<{ parent: string; position: string } | null>(null);

  function add(event: FormEvent) {
    event.preventDefault();
    const title = field.current?.value ?? '';
    const below = last.current?.parent === parent.id ? last.current.position : undefined;
    const result = createSubtask(parent, subtasks ?? [], { title }, ids, count ?? 0, below);
    if (!result.ok) {
      if (result.reason === 'limit')
        toast.show({
          title: 'You have as many tasks as an account can hold.',
          category: 'warning',
        });
      return;
    }
    if (field.current) field.current.value = '';
    const made = result.mutation.changes[0];
    if (made && 'position' in made && made.position)
      last.current = { parent: parent.id, position: made.position };
    void client.commit(result.mutation);
  }

  function remove(sub: LocalRow) {
    const result = deleteTask(sub, ids);
    if (!result.ok) return;
    void client.commit(result.mutation);
    offerUndo('Subtask deleted.', () => {
      const back = restoreTask(sub, ids);
      if (back.ok) return client.commit(back.mutation);
    });
  }

  return (
    <section className={styles.subtasks} aria-label="Subtasks">
      <h3 className={styles.heading}>Subtasks</h3>
      {subtasks !== undefined && subtasks.length > 0 ? (
        <Checklist subtasks={subtasks} onDelete={remove} />
      ) : null}
      <form onSubmit={add}>
        <Input
          ref={field}
          aria-label="Add a subtask"
          placeholder="Add a subtask…"
          maxLength={500}
          autoComplete="off"
        />
      </form>
    </section>
  );
}

function SubtaskRow({ sub, onDelete }: { sub: LocalRow; onDelete: () => void }) {
  const client = useSync();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sub.id });
  const title = text(sub, 'title');
  const done = isCompleted(sub);

  function tick(next: boolean) {
    const result = next ? completeTask(sub, Date.now(), ids) : reopenTask(sub, ids);
    if (result.ok) void client.commit(result.mutation);
  }

  function save(value: string) {
    const result = updateTask(sub, { title: value }, ids);
    if (result.ok) void client.commit(result.mutation);
  }

  return (
    <li
      ref={setNodeRef}
      className={`${styles.subtask} ${done ? styles.subtaskDone : ''}`}
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
        aria-label={`Move subtask: ${title}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <Checkbox
        id={`sub-${sub.id}`}
        label=""
        aria-label={`Done: ${title}`}
        checked={done}
        onChange={tick}
      />
      <input
        className={styles.subtaskTitle}
        aria-label={`Subtask: ${title}`}
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
      <Button variant="secondary" aria-label={`Delete subtask: ${title}`} onClick={onDelete}>
        ×
      </Button>
    </li>
  );
}

/**
 * The checklist, which can be dragged into order by the handle at the left of each row. The handle and not the whole row, because a row has a field
 * in it, and a drag that began on the field would stop a person selecting its text. One row is written (`moveTask`).
 */
function Checklist({
  subtasks,
  onDelete,
}: {
  subtasks: readonly LocalRow[];
  onDelete: (sub: LocalRow) => void;
}) {
  const client = useSync();
  const { rendered, show } = useOptimisticOrder(subtasks);
  const guard = useDragClickGuard();
  const sensors = useReorderSensors();

  function onDragEnd(event: DragEndEvent) {
    guard.end();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rendered.findIndex((sub) => sub.id === active.id);
    const to = rendered.findIndex((sub) => sub.id === over.id);
    if (from === -1 || to === -1) return;
    const result = moveTask(rendered, String(active.id), to, ids);
    if (!result.ok) return;
    show(
      arrayMove(
        rendered.map((sub) => sub.id),
        from,
        to,
      ),
    );
    void client.commit(result.mutation);
  }

  return (
    <DndContext
      id="subtasks"
      sensors={sensors}
      autoScroll={VERTICAL_AUTOSCROLL}
      collisionDetection={closestCenter}
      onDragStart={guard.begin}
      onDragEnd={onDragEnd}
      onDragCancel={guard.end}
    >
      <SortableContext items={rendered.map((sub) => sub.id)} strategy={verticalListSortingStrategy}>
        <ul className={styles.checklist}>
          {rendered.map((sub) => (
            <SubtaskRow key={sub.id} sub={sub} onDelete={() => onDelete(sub)} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
