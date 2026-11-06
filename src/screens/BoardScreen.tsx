'use client';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { endPosition, positionFor } from '../boards/board-optimistic';
import { boardFailureMessage, useBoard } from '../boards/store';
import { HORIZONTAL_AUTOSCROLL, useDragClickGuard, useReorderSensors } from '../ui/dnd';
import { Alert, Button, EmptyState, Icon, Input, useToast } from '../ui';
import { WORKSPACE_LIMITS, type BoardView } from '../workspaces/format';
import { ListColumn } from './ListColumn';
import styles from './BoardScreen.module.css';

/**
 * A board (DESIGN.md §14, §17.5): its header, a thin band of its colour, and its lists side by side, scrolling sideways. The board is **read by the
 * server before the page is sent**, so one that is not the person's is a 404 and never reaches here; what is held here is `useBoard`'s, which shows each
 * change at once and sends it. Only a member of the board changes it (§7.2): for anyone else there is no way to add, drag or configure, and the server
 * would refuse it as well. Cards arrive with task 18.1.
 */
export function BoardScreen({ initial }: { initial: BoardView }) {
  const toast = useToast();
  const store = useBoard(initial, (reason) =>
    toast.show({ title: boardFailureMessage(reason), category: 'warning' }),
  );
  const { view, editable, offline } = store;
  const sensors = useReorderSensors();
  const guard = useDragClickGuard();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const addForm = useRef<HTMLFormElement>(null);
  // The field is put in front of the person who asked for it.
  useEffect(() => {
    if (adding) addForm.current?.querySelector('input')?.focus();
  }, [adding]);

  if (store.gone) {
    return (
      <div className={styles.page}>
        <EmptyState
          heading="That board is not here any more"
          description="It was deleted, or it is not one you can see now."
          action={<Link href={`/w/${view.workspace.id}`}>Back to the workspace</Link>}
        />
      </div>
    );
  }

  function addList(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (next === '') return;
    void store.perform({
      op: 'list.create',
      id: crypto.randomUUID(),
      boardId: view.board.id,
      name: next,
      position: endPosition(view.lists),
    });
    setName('');
    setAdding(false);
  }

  function onDragEnd(event: DragEndEvent) {
    guard.end();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const to = view.lists.findIndex((each) => each.id === over.id);
    if (to < 0) return;
    // The list lands where the one it was dropped on was; one row is written.
    void store.perform({
      op: 'list.move',
      id: String(active.id),
      position: positionFor(view.lists, String(active.id), to),
    });
  }

  const full = view.lists.length >= WORKSPACE_LIMITS.listsPerBoard;
  return (
    <div className={styles.page}>
      <div className={styles.band} style={{ background: view.board.color }} aria-hidden />
      <header className={styles.header}>
        <Link href={`/w/${view.workspace.id}`} className={styles.crumb}>
          {view.workspace.name}
        </Link>
        <h1 className={styles.title}>{view.board.name}</h1>
        {view.board.archived ? (
          <span className={styles.badge}>Archived</span>
        ) : !view.can.edit ? (
          <span className={styles.badge}>Viewing</span>
        ) : null}
      </header>
      {offline ? (
        <Alert variant="warning">
          This board needs a connection. It is as it was when it was last read, and cannot be
          changed until you are back online.
        </Alert>
      ) : null}
      <DndContext
        id={`board-${view.board.id}`}
        sensors={sensors}
        autoScroll={HORIZONTAL_AUTOSCROLL}
        collisionDetection={closestCenter}
        onDragStart={guard.begin}
        onDragEnd={onDragEnd}
        onDragCancel={guard.end}
      >
        <SortableContext
          items={view.lists.map((each) => each.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className={styles.columns}>
            {view.lists.map((list, index) => (
              <ListColumn
                key={list.id}
                list={list}
                index={index}
                count={view.lists.length}
                editable={editable}
                onRename={(next) =>
                  void store.perform({ op: 'list.rename', id: list.id, name: next })
                }
                onMove={(to) =>
                  void store.perform({
                    op: 'list.move',
                    id: list.id,
                    position: positionFor(view.lists, list.id, to),
                  })
                }
                onDelete={() => void store.perform({ op: 'list.delete', id: list.id })}
              />
            ))}
            {editable ? (
              <div className={styles.add}>
                {adding ? (
                  <form ref={addForm} onSubmit={addList} className={styles.addForm}>
                    <Input
                      aria-label="Name of the new list"
                      value={name}
                      maxLength={WORKSPACE_LIMITS.nameChars}
                      placeholder="Name of the list"
                      onChange={(event) => setName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setAdding(false);
                          setName('');
                        }
                      }}
                    />
                    <div className={styles.actions}>
                      <Button type="submit" disabled={name.trim() === ''}>
                        Add list
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setAdding(false);
                          setName('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={full}
                    title={full ? 'A board can hold 100 lists.' : undefined}
                    onClick={() => setAdding(true)}
                  >
                    <Icon name="plus" aria-hidden /> Add a list
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
