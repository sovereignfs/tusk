'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  completeTask,
  deleteTask,
  isCompleted,
  reopenTask,
  restoreTask,
  updateTask,
} from '../actions/tasks';
import type { LocalRow } from '../local/rows';
import { getRow, subtasksOf } from '../local/store';
import { useLocal, useSync } from '../sync/react';
import { Button, Checkbox, FormField, Input, Textarea } from '../ui';
import { text } from './fields';
import styles from './TaskDetail.module.css';
import { Subtasks } from './Subtasks';
import { useUndo } from './Undo';

const ids = { newId: () => crypto.randomUUID() };

/**
 * The right column (DESIGN.md §15.2), present only while `?task=<id>` is set, so that a task can be linked to and reloaded. It shows the task from the
 * working copy and **saves as you leave a field**: there is no Save, and nothing to lose by closing it. Closing replaces the address (DESIGN.md §15.8): a
 * link to the same path with another search parameter does nothing on a route that is already mounted, and a back button should not step through
 * every task that was looked at. **A task that is not there (a stale link, one that was deleted) shows nothing and does not fail.**
 */
export function TaskDetail({ taskId }: { taskId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const row = useLocal(async (db) => ({ row: await getRow(db, 'task', taskId) }), [taskId]);
  const close = () => router.replace(pathname);

  return (
    <section className={styles.detail} aria-label="Task">
      <div className={styles.bar}>
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      </div>
      {row === undefined ? null : row.row === undefined || row.row.deletedAt !== null ? (
        <p className={styles.muted}>That task is not here any more.</p>
      ) : (
        <Fields key={row.row.id} task={row.row} onDeleted={close} />
      )}
    </section>
  );
}

function Fields({ task, onDeleted }: { task: LocalRow; onDeleted: () => void }) {
  const client = useSync();
  const offerUndo = useUndo();
  const title = text(task, 'title');
  const notes = text(task, 'notes');
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftNotes, setDraftNotes] = useState(notes);
  const [editing, setEditing] = useState<'title' | 'notes' | null>(null);
  const done = isCompleted(task);

  // What another device or a sync changed shows here, unless the person is in the middle of typing in that field.
  useEffect(() => {
    if (editing !== 'title') setDraftTitle(title);
  }, [title, editing]);
  useEffect(() => {
    if (editing !== 'notes') setDraftNotes(notes);
  }, [notes, editing]);

  function save(patch: { title?: string; notes?: string }) {
    const result = updateTask(task, patch, ids);
    if (result.ok) void client.commit(result.mutation);
    // A title that was emptied is not a title: it goes back to the one the task has.
    else if (result.reason === 'title') setDraftTitle(title);
  }

  async function tick(next: boolean) {
    // A parent ticked off takes its open subtasks with it, in one mutation; reopening reopens nothing else.
    const subtasks = next ? await client.read((db) => subtasksOf(db, task.id)) : [];
    const result = next ? completeTask(task, Date.now(), ids, subtasks) : reopenTask(task, ids);
    if (result.ok) void client.commit(result.mutation);
  }

  function remove() {
    const result = deleteTask(task, ids);
    if (!result.ok) return;
    void client.commit(result.mutation);
    offerUndo('Task deleted.', () => {
      const back = restoreTask(task, ids);
      if (back.ok) return client.commit(back.mutation);
    });
    onDeleted();
  }

  return (
    <>
      <Checkbox
        id={`detail-tick-${task.id}`}
        label="Done"
        checked={done}
        onChange={(next) => void tick(next)}
      />
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
      <FormField label="Notes">
        {(field) => (
          <Textarea
            {...field}
            value={draftNotes}
            rows={4}
            autoGrow
            onFocus={() => setEditing('notes')}
            onChange={(event) => setDraftNotes(event.target.value)}
            onBlur={() => {
              setEditing(null);
              save({ notes: draftNotes });
            }}
          />
        )}
      </FormField>
      {task.table === 'task' && task.parentId === null ? <Subtasks parent={task} /> : null}
      <div>
        <Button variant="secondary" onClick={remove}>
          Delete
        </Button>
      </div>
    </>
  );
}
