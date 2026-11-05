'use client';

import { isStarred, setStarred } from '../actions/tasks';
import type { LocalRow } from '../local/rows';
import { useSync } from '../sync/react';
import styles from './StarButton.module.css';

const ids = { newId: () => crypto.randomUUID() };

/**
 * A star (DESIGN.md §11.1), **its own click target**: a click on it stars or un-stars and opens nothing, and a drag of the row does not start on it.
 * It is a button that is pressed or not, named for what it does. The design system has no star icon yet, so the glyph is text; an icon for it belongs in
 * `@sovereignfs/ui`. A subtask has none, and renders nothing.
 */
export function StarButton({ task }: { task: LocalRow }) {
  const client = useSync();
  if (task.table !== 'task' || task.parentId !== null) return null;
  const starred = isStarred(task);
  return (
    <button
      type="button"
      className={`${styles.star} ${starred ? styles.on : ''}`}
      aria-pressed={starred}
      aria-label={starred ? 'Remove the star' : 'Star'}
      title={starred ? 'Remove the star' : 'Star'}
      // A pointer down on it is not the start of a drag of the row it is in.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => {
        const result = setStarred(task, !starred, ids);
        if (result.ok) void client.commit(result.mutation);
      }}
    >
      <span aria-hidden>{starred ? '★' : '☆'}</span>
    </button>
  );
}
