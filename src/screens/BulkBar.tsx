'use client';

import { useEffect } from 'react';
import { type Selected, completeMany, moveMany } from '../actions/bulk';
import { type Group, deleteMany, restoreMany } from '../actions/cards';
import { seriesIdOf } from '../actions/series';
import type { LocalRow } from '../local/rows';
import { allChecksOf, cardsOf, checksOf, getRow, listsOf } from '../local/store';
import { useLocal, useSync } from '../sync/react';
import { nowHere } from '../time';
import { Button, Select } from '@sovereignfs/ui';
import { text } from './fields';
import styles from './ListScreen.module.css';
import { useUndo } from './Undo';

const ids = { newId: () => crypto.randomUUID() };

/**
 * The bar for the cards that are chosen (DESIGN.md §10.6): how many, and Complete, Move to list, Delete and Cancel. **Each is one mutation, in chunks if it
 * is large** (`src/actions/bulk.ts`), made from what the working copy has when it is pressed. Delete gives **one Undo for the whole choice**. Escape
 * is Cancel. `chosen` is in the order the cards are shown.
 */
export function BulkBar({
  chosen,
  listId,
  onDone,
}: {
  chosen: readonly LocalRow[];
  listId: string;
  onDone: () => void;
}) {
  const client = useSync();
  const offerUndo = useUndo();
  const lists = useLocal(listsOf);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onDone();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  /** The chosen cards with their items and series, read now. */
  async function selected(): Promise<Selected[]> {
    return client.read((db) =>
      Promise.all(
        chosen.map(async (card) => {
          const seriesId = seriesIdOf(card);
          return {
            card,
            items: await checksOf(db, card.id),
            series: seriesId ? await getRow(db, 'desk_series', seriesId) : undefined,
          };
        }),
      ),
    );
  }

  async function commitAll(
    result: { ok: true; mutations: { mutationId: string }[] } | { ok: false },
  ) {
    if (!result.ok) return;
    for (const mutation of result.mutations) await client.commit(mutation);
  }

  async function complete() {
    const result = completeMany(await selected(), Date.now(), nowHere().date, ids);
    await commitAll(result);
    onDone();
  }

  async function move(toListId: string) {
    if (toListId === '') return;
    const destination = await client.read((db) => cardsOf(db, toListId));
    const result = moveMany(await selected(), toListId, destination, ids);
    await commitAll(result);
    onDone();
  }

  async function remove() {
    // Each card with the checklist items it has, deleted together; the Undo reads them again by then, deleted, which says which went with which.
    const groups: Group[] = await client.read((db) =>
      Promise.all(chosen.map(async (card) => ({ card, items: await allChecksOf(db, card.id) }))),
    );
    const result = deleteMany(groups, ids);
    if (!result.ok) return;
    for (const mutation of result.mutations) await client.commit(mutation);
    const gone = chosen.map((card) => card.id);
    onDone();
    offerUndo(gone.length === 1 ? 'Card deleted.' : `${gone.length} cards deleted.`, async () => {
      const back: Group[] = await client.read(async (db) => {
        const found: Group[] = [];
        for (const id of gone) {
          const card = await getRow(db, 'desk_card', id);
          if (card) found.push({ card, items: await allChecksOf(db, id) });
        }
        return found;
      });
      const restored = restoreMany(back, ids);
      if (restored.ok) for (const mutation of restored.mutations) await client.commit(mutation);
    });
  }

  const others = (lists ?? []).filter((list) => list.id !== listId);
  return (
    <div className={styles.bulk} role="toolbar" aria-label="Chosen cards">
      <span className={styles.bulkCount} role="status" aria-live="polite">
        {chosen.length} chosen
      </span>
      <Button variant="secondary" size="sm" onClick={() => void complete()}>
        Complete
      </Button>
      {others.length > 0 ? (
        <Select
          aria-label="Move to list"
          size="sm"
          value=""
          onChange={(event) => void move(event.target.value)}
        >
          <option value="">Move to list…</option>
          {others.map((list) => (
            <option key={list.id} value={list.id}>
              {text(list, 'title', 'Untitled list')}
            </option>
          ))}
        </Select>
      ) : null}
      <Button variant="secondary" size="sm" onClick={() => void remove()}>
        Delete
      </Button>
      <Button variant="secondary" size="sm" onClick={onDone}>
        Cancel
      </Button>
    </div>
  );
}
