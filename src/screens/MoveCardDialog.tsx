'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cardPositionFor } from '../boards/board-optimistic';
import { useBoardPeople } from '../boards/context';
import type { BoardStore } from '../boards/store';
import { Alert, Button, Dialog, FormField, Select } from '@sovereignfs/ui';
import type { MoveTargets } from '../workspaces/format';
import styles from './BoardScreen.module.css';

/**
 * Moving a card (DESIGN.md §15.7): to another list of this board, or to a list of another board of the same workspace that the person is a member of, at
 * the top of the list they choose. **Moving it to another board says first what it will drop**: the assignees who are not members there, by name; its
 * labels are matched by name and colour there and made if missing; its comments, checklist and history go with it.
 */
export function MoveCardDialog({
  cardId,
  assignees,
  store,
  onClose,
}: {
  cardId: string;
  assignees: readonly string[];
  store: BoardStore;
  onClose: () => void;
}) {
  const router = useRouter();
  const people = useBoardPeople();
  const view = store.view;
  const [targets, setTargets] = useState<MoveTargets | null>(null);
  const [failed, setFailed] = useState(false);
  const [boardId, setBoardId] = useState(view.board.id);
  const [listId, setListId] = useState(view.lists[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const reply = await fetch(`/api/boards/${view.board.id}/destinations`, {
          cache: 'no-store',
        });
        if (!reply.ok) return setFailed(true);
        setTargets((await reply.json()) as MoveTargets);
      } catch {
        setFailed(true);
      }
    })();
  }, [view.board.id]);

  const elsewhere = boardId !== view.board.id;
  const there = targets?.boards.find((each) => each.id === boardId);
  const lists = elsewhere ? (there?.lists ?? []) : view.lists;
  const dropped = elsewhere
    ? assignees.filter((each) => !(there?.members ?? []).includes(each))
    : [];
  const nameOf = (id: string) =>
    people?.members.find((each) => each.accountId === id)?.name ?? 'Someone';

  function choose(next: string) {
    setBoardId(next);
    const first = (
      next === view.board.id ? view.lists : targets?.boards.find((each) => each.id === next)?.lists
    )?.[0];
    setListId(first?.id ?? '');
  }

  async function move() {
    if (listId === '') return;
    setBusy(true);
    const done = elsewhere
      ? await store.perform({ op: 'card.moveToBoard', id: cardId, boardId, listId, position: 'a0' })
      : await store.perform({
          op: 'card.move',
          id: cardId,
          listId,
          // The top of the list, among the cards shown there.
          position: cardPositionFor(view.cards, cardId, listId, 0),
        });
    setBusy(false);
    if (!done) return;
    onClose();
    // A card on another board is not on this one: its dialog goes back to the board.
    if (elsewhere) router.replace(`/b/${view.board.id}`);
  }

  return (
    <Dialog open onClose={onClose} aria-label="Move card" title="Move card" size="md">
      <div className={styles.dialog}>
        {failed ? <Alert variant="warning">Moving needs a connection.</Alert> : null}
        <FormField label="Board">
          {(field) => (
            <Select
              {...field}
              value={boardId}
              disabled={targets === null || busy}
              onChange={(event) => choose(event.target.value)}
            >
              <option value={view.board.id}>{view.board.name} (this board)</option>
              {(targets?.boards ?? []).map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="List">
          {(field) => (
            <Select
              {...field}
              value={listId}
              disabled={busy}
              onChange={(event) => setListId(event.target.value)}
            >
              {lists.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        {dropped.length > 0 ? (
          <Alert variant="warning">
            {dropped.map(nameOf).join(', ')} {dropped.length === 1 ? 'is' : 'are'} not on that board
            and will be taken off this card.
          </Alert>
        ) : null}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void move()} loading={busy} disabled={listId === ''}>
            Move
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
