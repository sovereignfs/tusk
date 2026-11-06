'use client';

import { useSortable } from '@dnd-kit/sortable';
import { useState } from 'react';
import type { CardTile, LabelRow } from '../workspaces/format';
import { useBoardPeople } from '../boards/context';
import { formatDue } from '../format-due';
import { browserZone, todayFor } from '../time';
import { Avatar, Icon, Menu } from '../ui';
import styles from './BoardScreen.module.css';

/**
 * A card on a board (DESIGN.md §15.1): its title and the badges for what it has, as a tile. **It is dragged by its whole surface, with no handle:** a
 * press that does not move is a click (the pointer sensor needs a few pixels), and the keyboard picks up a focused card with Space, moves it with the
 * arrows and puts it down with Space. The menu beside it is its own button, outside the draggable surface, so a key pressed on it is not a pick-up.
 * A click or Enter opens it (its dialog, `CardDialog`); the badges for labels, checklist, comments and people join as their tasks are built.
 */
export function CardTileView({
  card,
  editable,
  labels,
  onArchive,
  onClone,
  onOpen,
}: {
  card: CardTile;
  /** The board's labels, to draw the ones the card carries. */
  labels: readonly LabelRow[];
  editable: boolean;
  onArchive: () => void;
  onClone: () => void;
  onOpen: () => void;
}) {
  const sortable = useSortable({
    id: card.id,
    data: { type: 'card', listId: card.listId },
    disabled: !editable,
  });
  const [menu, setMenu] = useState(false);
  const style = {
    transform: sortable.transform
      ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
      : undefined,
    transition: sortable.transition,
  };
  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`${styles.cardWrap} ${sortable.isDragging ? styles.dragging : ''}`}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- dnd-kit's attributes give it role="button" and a place in the tab order */}
      <div
        ref={sortable.setActivatorNodeRef}
        className={styles.card}
        {...sortable.attributes}
        {...sortable.listeners}
        onClick={onOpen}
        onKeyDown={(event) => {
          sortable.listeners?.onKeyDown?.(event);
          // Enter opens it; Space is the pick-up.
          if (event.key === 'Enter') onOpen();
        }}
        aria-label={card.title}
        aria-roledescription="sortable card"
      >
        <TileBody card={card} labels={labels} />
      </div>
      {editable ? (
        <div className={styles.cardMenu}>
          <Menu
            aria-label={`Options of ${card.title}`}
            open={menu}
            onClose={() => setMenu(false)}
            align="right"
            width={180}
            trigger={
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Card options for ${card.title}`}
                aria-expanded={menu}
                onClick={() => setMenu((was) => !was)}
              >
                <Icon name="ellipsis-vertical" aria-hidden />
              </button>
            }
            items={[
              { label: 'Clone', icon: 'copy', onSelect: onClone },
              { label: 'Archive', icon: 'archive', onSelect: onArchive },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

/** What a tile shows, also drawn in the overlay that follows the pointer. */
export function TileBody({ card, labels }: { card: CardTile; labels: readonly LabelRow[] }) {
  const people = useBoardPeople();
  const assigned = card.assignees.flatMap((id) => {
    const person = people?.members.find((each) => each.accountId === id);
    return person ? [person] : [];
  });
  const carried = card.labels
    .map((id) => labels.find((each) => each.id === id))
    .filter((each): each is LabelRow => each !== undefined);
  // A due date is floating, shown as written; today is the browser's own (DESIGN.md §11), and overdue is the danger colour.
  const due = card.dueDate
    ? formatDue(card.dueDate, card.dueTime, todayFor(browserZone(), Date.now()))
    : null;
  return (
    <>
      {carried.length > 0 ? (
        <span
          className={styles.labelBars}
          aria-label={`Labels: ${carried.map((each) => each.name || each.color).join(', ')}`}
        >
          {carried.map((each) => (
            // A label's colour is its own and is data: a small bar of it, with no text on it.
            <span key={each.id} className={styles.labelBar} style={{ background: each.color }} />
          ))}
        </span>
      ) : null}
      <span className={styles.cardTitle}>{card.title}</span>
      {card.dueDate ||
      card.hasDescription ||
      card.checklist.total > 0 ||
      card.comments > 0 ||
      assigned.length > 0 ? (
        <span className={styles.badges}>
          {due ? (
            <span className={`${styles.badge} ${due.overdue ? styles.overdue : ''}`}>
              <Icon name="calendar" aria-hidden /> {due.text}
            </span>
          ) : null}
          {assigned.length > 0 ? (
            <span
              className={styles.assignees}
              aria-label={`Assigned to ${assigned.map((each) => each.name).join(', ')}`}
            >
              {assigned.slice(0, 3).map((person) => (
                <Avatar key={person.accountId} name={person.name} size="sm" />
              ))}
              {assigned.length > 3 ? (
                <span className={styles.badge}>+{assigned.length - 3}</span>
              ) : null}
            </span>
          ) : null}
          {card.checklist.total > 0 ? (
            <span
              className={styles.badge}
              aria-label={`${card.checklist.done} of ${card.checklist.total} checklist items done`}
            >
              <Icon name="check" aria-hidden /> {card.checklist.done}/{card.checklist.total}
            </span>
          ) : null}
          {card.comments > 0 ? (
            <span className={styles.badge} aria-label={`${card.comments} comments`}>
              <Icon name="message-square" aria-hidden /> {card.comments}
            </span>
          ) : null}
          {card.hasDescription ? (
            <span className={styles.badge} aria-label="Has a description">
              <Icon name="file-text" aria-hidden />
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );
}
