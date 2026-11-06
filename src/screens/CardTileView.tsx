'use client';

import { useSortable } from '@dnd-kit/sortable';
import { useState } from 'react';
import type { CardTile } from '../workspaces/format';
import { Icon, Menu } from '../ui';
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
  onArchive,
  onOpen,
}: {
  card: CardTile;
  editable: boolean;
  onArchive: () => void;
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
        <TileBody card={card} />
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
            items={[{ label: 'Archive', icon: 'archive', onSelect: onArchive }]}
          />
        </div>
      ) : null}
    </div>
  );
}

/** What a tile shows, also drawn in the overlay that follows the pointer. */
export function TileBody({ card }: { card: CardTile }) {
  return (
    <>
      <span className={styles.cardTitle}>{card.title}</span>
      {card.dueDate || card.hasDescription ? (
        <span className={styles.badges}>
          {card.dueDate ? (
            <span className={styles.badge}>
              <Icon name="calendar" aria-hidden /> {card.dueDate}
              {card.dueTime ? ` ${card.dueTime}` : ''}
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
