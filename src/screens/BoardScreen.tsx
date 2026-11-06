'use client';

import {
  type CollisionDetection,
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  closestCenter,
  closestCorners,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { BoardContext } from '../boards/context';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  cardPositionFor,
  cardsIn,
  endPosition,
  positionFor,
  topPosition,
} from '../boards/board-optimistic';
import { boardFailureMessage, useBoard } from '../boards/store';
import { HORIZONTAL_AUTOSCROLL, useDragClickGuard, useReorderSensors } from '../ui/dnd';
import { Alert, Button, ConfirmDialog, Dialog, EmptyState, Icon, Input, useToast } from '../ui';
import {
  type ArchivedCard,
  type BoardView,
  type CardTile,
  type Op,
  WORKSPACE_LIMITS,
} from '../workspaces/format';
import { TileBody } from './CardTileView';
import { ListColumn } from './ListColumn';
import styles from './BoardScreen.module.css';

/**
 * A board (DESIGN.md §14, §17.5): its header, a thin band of its colour, and its lists side by side, scrolling sideways. The board is **read by the
 * server before the page is sent**, so one that is not the person's is a 404 and never reaches here; what is held here is `useBoard`'s, which shows each
 * change at once and sends it. Only a member of the board changes it (§7.2): for anyone else there is no way to add, drag or configure, and the server
 * would refuse it as well. Cards arrive with task 18.1.
 */
/** A list is dragged among lists, and a card among the cards and the empty places of every list: what each may land on is decided by what it is. */
const collisions: CollisionDetection = (args) => {
  const kind = args.active.data.current?.type;
  const containers = args.droppableContainers.filter((each) =>
    kind === 'list'
      ? each.data.current?.type === 'list'
      : each.data.current?.type === 'card' || each.data.current?.type === 'column',
  );
  return kind === 'list'
    ? closestCenter({ ...args, droppableContainers: containers })
    : closestCorners({ ...args, droppableContainers: containers });
};

export function BoardScreen({
  initial,
  children,
}: {
  initial: BoardView;
  /** What the board's address shows over it: a card's dialog, when its address is the one open. */
  children?: ReactNode;
}) {
  const toast = useToast();
  const router = useRouter();
  const store = useBoard(initial, (reason) =>
    toast.show({ title: boardFailureMessage(reason), category: 'warning' }),
  );
  const { view, editable, offline } = store;
  const sensors = useReorderSensors();
  const guard = useDragClickGuard();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [dragging, setDragging] = useState<CardTile | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
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

  function onDragStart(event: DragStartEvent) {
    guard.begin();
    if (event.active.data.current?.type === 'card')
      setDragging(view.cards.find((each) => each.id === event.active.id) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    guard.end();
    setDragging(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (active.data.current?.type === 'card') {
      const id = String(active.id);
      // On a card: it takes that card's place in that card's list. On the empty part of a list: it goes to the end.
      const target = over.data.current as { type: string; listId: string } | undefined;
      if (!target) return;
      const there = cardsIn(view.cards, target.listId);
      const index =
        target.type === 'card' ? there.findIndex((each) => each.id === over.id) : there.length;
      if (index < 0) return;
      const moving = view.cards.find((each) => each.id === id);
      if (!moving) return;
      const position = cardPositionFor(view.cards, id, target.listId, index);
      if (target.listId === moving.listId && position === moving.position) return;
      void store.perform({ op: 'card.move', id, listId: target.listId, position });
      return;
    }
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
    <BoardContext.Provider value={store}>
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
          <button type="button" className={styles.link} onClick={() => setArchivedOpen(true)}>
            Archived cards
          </button>
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
          collisionDetection={collisions}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            guard.end();
            setDragging(null);
          }}
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
                  cards={cardsIn(view.cards, list.id)}
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
                  onAddCard={(title) =>
                    void store.perform({
                      op: 'card.create',
                      id: crypto.randomUUID(),
                      listId: list.id,
                      title,
                      position: topPosition(view.cards, list.id),
                    })
                  }
                  onArchiveCard={(card) => void store.perform({ op: 'card.archive', id: card.id })}
                  onOpenCard={(card) => router.push(`/b/${view.board.id}/c/${card.id}`)}
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
          <DragOverlay>
            {dragging ? (
              <div className={`${styles.card} ${styles.overlay}`}>
                <TileBody card={dragging} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        {archivedOpen ? (
          <ArchivedDialog
            boardId={view.board.id}
            lists={view.lists}
            editable={editable}
            onClose={() => setArchivedOpen(false)}
            perform={store.perform}
          />
        ) : null}
        {children}
      </div>
    </BoardContext.Provider>
  );
}

/** The board's archived cards (DESIGN.md §15.8), fetched when asked for, with Restore and Delete for someone who may change the board. */
function ArchivedDialog({
  boardId,
  lists,
  editable,
  onClose,
  perform,
}: {
  boardId: string;
  lists: BoardView['lists'];
  editable: boolean;
  onClose: () => void;
  perform: (op: Op) => Promise<boolean>;
}) {
  const [cards, setCards] = useState<readonly ArchivedCard[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState<ArchivedCard | null>(null);

  const read = useCallback(async () => {
    try {
      const reply = await fetch(`/api/boards/${boardId}/archived`, { cache: 'no-store' });
      if (!reply.ok) return setFailed(true);
      setCards(((await reply.json()) as { cards: ArchivedCard[] }).cards);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [boardId]);
  useEffect(() => {
    void read();
  }, [read]);

  async function act(op: Op) {
    await perform(op);
    await read();
  }

  return (
    <Dialog open onClose={onClose} aria-label="Archived cards" title="Archived cards" size="md">
      <div className={styles.dialog}>
        {failed ? <Alert variant="warning">This needs a connection.</Alert> : null}
        {cards === null && !failed ? <p>Reading the archived cards…</p> : null}
        {cards?.length === 0 ? <p>Nothing is archived on this board.</p> : null}
        <ul className={styles.archivedList}>
          {(cards ?? []).map((card) => (
            <li key={card.id} className={styles.archivedRow}>
              <span className={styles.archivedTitle}>
                {card.title}
                <span className={styles.badge}>
                  {' '}
                  in {lists.find((each) => each.id === card.listId)?.name ?? 'a list'}
                </span>
              </span>
              {editable ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Restore ${card.title}`}
                    onClick={() => void act({ op: 'card.restore', id: card.id })}
                  >
                    Restore
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Delete ${card.title}`}
                    onClick={() => setDeleting(card)}
                  >
                    Delete
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {deleting ? (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="Delete this card for good?"
          message={
            <>
              <strong>{deleting.title}</strong> will be deleted with its checklist and comments. Its
              history stays. This cannot be undone.
            </>
          }
          confirmLabel="Delete card"
          destructive
          onConfirm={() => {
            const card = deleting;
            setDeleting(null);
            void act({ op: 'card.delete', id: card.id });
          }}
        />
      ) : null}
    </Dialog>
  );
}
