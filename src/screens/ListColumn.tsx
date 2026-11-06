'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { WORKSPACE_LIMITS, type CardTile, type LabelRow, type ListRow } from '../workspaces/format';
import { CardTileView } from './CardTileView';
import { Button, ConfirmDialog, Dialog, FormField, Icon, Input, Menu } from '../ui';
import styles from './BoardScreen.module.css';

/**
 * A list on a board (DESIGN.md §14.2): its header, with the name and how many cards it holds, dragged by that header to reorder and with a menu to
 * configure (rename), change its position, and delete. **A viewer gets none of it**: the header is a heading and nothing more. Its cards arrive with
 * task 18.1; the column is where they will go.
 */
export function ListColumn({
  list,
  cards,
  labels,
  index,
  count,
  editable,
  filtering,
  onRename,
  onMove,
  onDelete,
  onAddCard,
  onArchiveCard,
  onCloneCard,
  onOpenCard,
}: {
  list: ListRow;
  /** Its open cards, top to bottom. */
  cards: readonly CardTile[];
  /** The board's labels. */
  labels: readonly LabelRow[];
  /** Where it is now, from 0, and how many lists there are. */
  index: number;
  count: number;
  editable: boolean;
  /** A search is on: the lists and cards are not dragged. */
  filtering: boolean;
  onRename(name: string): void;
  /** To this place among the others, from 0. */
  onMove(index: number): void;
  onDelete(): void;
  /** A card with this title at the top of the list. */
  onAddCard(title: string): void;
  onArchiveCard(card: CardTile): void;
  onCloneCard(card: CardTile): void;
  onOpenCard(card: CardTile): void;
}) {
  const sortable = useSortable({
    id: list.id,
    data: { type: 'list' },
    disabled: !editable || filtering,
  });
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<'configure' | 'position' | 'delete' | null>(null);
  const [adding, setAdding] = useState(false);
  const addField = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState('');
  // The cards' area takes a card dropped on an empty list, or below the last one.
  const drop = useDroppable({ id: `column:${list.id}`, data: { type: 'column', listId: list.id } });
  useEffect(() => {
    if (adding) addField.current?.querySelector('input')?.focus();
  }, [adding]);
  const submitCard = (event: FormEvent) => {
    event.preventDefault();
    const next = title.trim();
    if (next === '') return;
    onAddCard(next);
    setTitle('');
  };

  const style = {
    transform: sortable.transform
      ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
      : undefined,
    transition: sortable.transition,
  };
  const heading = (
    <>
      <h2 className={styles.listName}>{list.name}</h2>
      <span className={styles.count} aria-label={`${cards.length} open cards`}>
        {cards.length}
      </span>
    </>
  );

  return (
    <section
      ref={sortable.setNodeRef}
      style={style}
      className={`${styles.column} ${sortable.isDragging ? styles.dragging : ''}`}
      aria-label={list.name}
    >
      <div className={styles.listHeader}>
        {editable ? (
          // The drag handle is the title, and not the whole header: the menu beside it is its own button, and a key pressed on it is not a pick-up.
          <div
            className={`${styles.listTitle} ${styles.handle}`}
            {...sortable.attributes}
            {...sortable.listeners}
            aria-label={`${list.name}, drag to reorder`}
            aria-roledescription="sortable list"
          >
            {heading}
          </div>
        ) : (
          <div className={styles.listTitle}>{heading}</div>
        )}
        {editable ? (
          <Menu
            aria-label={`Options of ${list.name}`}
            open={menu}
            onClose={() => setMenu(false)}
            align="right"
            width={220}
            trigger={
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`List options for ${list.name}`}
                aria-expanded={menu}
                onClick={() => setMenu((was) => !was)}
              >
                <Icon name="ellipsis-vertical" aria-hidden />
              </button>
            }
            items={[
              { label: 'Add card', icon: 'plus', onSelect: () => setAdding(true) },
              { label: 'Configure', icon: 'pencil', onSelect: () => setDialog('configure') },
              { type: 'separator' },
              {
                label: 'Move left',
                disabled: index === 0,
                onSelect: () => onMove(index - 1),
              },
              {
                label: 'Move right',
                disabled: index === count - 1,
                onSelect: () => onMove(index + 1),
              },
              { label: 'Move to position…', onSelect: () => setDialog('position') },
              { type: 'separator' },
              {
                label: 'Delete',
                icon: 'trash-2',
                destructive: true,
                onSelect: () => setDialog('delete'),
              },
            ]}
          />
        ) : null}
      </div>
      {editable ? (
        adding ? (
          <form ref={addField} onSubmit={submitCard} className={styles.addCard}>
            <Input
              aria-label={`Title of a new card in ${list.name}`}
              value={title}
              maxLength={WORKSPACE_LIMITS.cardTitleChars}
              placeholder="Add a card…"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setAdding(false);
                  setTitle('');
                }
              }}
              onBlur={() => {
                if (title.trim() === '') setAdding(false);
              }}
            />
          </form>
        ) : (
          <button type="button" className={styles.addCardButton} onClick={() => setAdding(true)}>
            <Icon name="plus" aria-hidden /> Add a card
          </button>
        )
      ) : null}
      <div ref={drop.setNodeRef} className={styles.cards}>
        <SortableContext
          items={cards.map((each) => each.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((card) => (
            <CardTileView
              key={card.id}
              card={card}
              labels={labels}
              editable={editable}
              draggable={!filtering}
              onArchive={() => onArchiveCard(card)}
              onClone={() => onCloneCard(card)}
              onOpen={() => onOpenCard(card)}
            />
          ))}
        </SortableContext>
      </div>

      {dialog === 'configure' ? (
        <ConfigureDialog
          list={list}
          onClose={() => setDialog(null)}
          onSave={(name) => {
            setDialog(null);
            onRename(name);
          }}
        />
      ) : null}
      {dialog === 'position' ? (
        <PositionDialog
          index={index}
          count={count}
          onClose={() => setDialog(null)}
          onSave={(to) => {
            setDialog(null);
            onMove(to);
          }}
        />
      ) : null}
      {dialog === 'delete' ? (
        <ConfirmDialog
          open
          onClose={() => setDialog(null)}
          title="Delete this list?"
          message={
            <>
              <strong>{list.name}</strong> will be deleted
              {list.cards > 0
                ? ` with its ${list.cards} open ${list.cards === 1 ? 'card' : 'cards'}, and everything on them`
                : ''}
              . This cannot be undone.
            </>
          }
          confirmLabel="Delete list"
          destructive
          onConfirm={() => {
            setDialog(null);
            onDelete();
          }}
        />
      ) : null}
    </section>
  );
}

function ConfigureDialog({
  list,
  onClose,
  onSave,
}: {
  list: ListRow;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(list.name);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (next === '') return;
    if (next === list.name) onClose();
    else onSave(next);
  };
  return (
    <Dialog open onClose={onClose} aria-label="Configure list" title="Configure list" size="sm">
      <form onSubmit={submit} className={styles.dialog}>
        <FormField label="Name">
          {(field) => (
            <Input
              {...field}
              value={name}
              maxLength={WORKSPACE_LIMITS.nameChars}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </FormField>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={name.trim() === ''}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PositionDialog({
  index,
  count,
  onClose,
  onSave,
}: {
  index: number;
  count: number;
  onClose: () => void;
  onSave: (index: number) => void;
}) {
  const [value, setValue] = useState(String(index + 1));
  const number = Number(value);
  const valid = Number.isInteger(number) && number >= 1 && number <= count;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    if (number - 1 === index) onClose();
    else onSave(number - 1);
  };
  return (
    <Dialog open onClose={onClose} aria-label="Move list" title="Move list" size="sm">
      <form onSubmit={submit} className={styles.dialog}>
        <FormField label={`Position, from 1 to ${count}`}>
          {(field) => (
            <Input
              {...field}
              type="number"
              min={1}
              max={count}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
        </FormField>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid}>
            Move
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
