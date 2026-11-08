'use client';

import { type FormEvent, useState } from 'react';
import { useWorkspaces } from '../boards/workspaces';
import { createCard } from '../actions/cards';
import { type Due, createDueCard } from '../actions/due';
import { formatDue } from '../format-due';
import { nowHere } from '../time';
import { createList } from '../actions/lists';
import { allLists, cardCount, cardsOf, listsOf } from '../local/store';
import { useLocal, useSync } from '../sync/react';
import { Alert, Button, Dialog, FormField, Input, Select, useToast } from '@sovereignfs/ui';
import { CreateDialog } from './AppSidebar';
import { CreateBoardDialog } from './WorkspaceBoards';
import { text } from './fields';
import styles from './PhoneFooter.module.css';

const ids = { newId: () => crypto.randomUUID() };

/**
 * A new card from the footer (DESIGN.md §18): a dialog with the title and the list it goes into, which is **the list on screen** unless the person picks another.
 * It is written to the working copy as every card is, at the top of that list, online or not.
 */
export function NewCardDialog({
  listId,
  due,
  onClose,
}: {
  listId?: string;
  /** A date, and a time, the card is made due: from the Planner, where a card must be on a day to be in the feed. The list is then the last one chosen there. */
  due?: Due;
  onClose: () => void;
}) {
  const client = useSync();
  const toast = useToast();
  const lists = useLocal(listsOf);
  const [chosen, setChosen] = useState<string | undefined>(
    () => listId ?? (due ? lastPlannerList() : undefined),
  );
  const [title, setTitle] = useState('');
  const target = lists?.find((each) => each.id === chosen)?.id ?? lists?.[0]?.id;
  const cards = useLocal((db) => (target ? cardsOf(db, target) : Promise.resolve([])), [target]);
  const count = useLocal(cardCount);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!target || !cards) return;
    const result = due
      ? createDueCard(target, cards, { title, due }, ids, count ?? cards.length)
      : createCard(target, cards, { title }, ids, count ?? cards.length);
    if (!result.ok) {
      if (result.reason === 'limit')
        toast.show({
          title: 'You have as many cards as an account can hold.',
          category: 'warning',
        });
      return;
    }
    if (due) rememberPlannerList(target);
    void client.commit(result.mutation);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} aria-label="New card" title="New card" size="sm">
      <form onSubmit={submit} className={styles.form}>
        {due?.date ? (
          <p className={styles.due}>Due {formatDue(due.date, due.time, nowHere().date).text}</p>
        ) : null}
        <FormField label="Title">
          {(field) => (
            <Input
              {...field}
              value={title}
              maxLength={500}
              autoComplete="off"
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="List">
          {(field) => (
            <Select
              {...field}
              value={target ?? ''}
              onChange={(event) => setChosen(event.target.value)}
            >
              {(lists ?? []).map((each) => (
                <option key={each.id} value={each.id}>
                  {text(each, 'title', 'Untitled list')}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={title.trim() === '' || !target}>
            Add card
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The list a card was last added to from the Planner, kept on this device so that the next one starts there. Nothing is kept where storage cannot be read. */
const PLANNER_LIST = 'tusk.planner.list';
function lastPlannerList(): string | undefined {
  try {
    return window.localStorage.getItem(PLANNER_LIST) ?? undefined;
  } catch {
    return undefined;
  }
}
function rememberPlannerList(id: string): void {
  try {
    window.localStorage.setItem(PLANNER_LIST, id);
  } catch {
    // The next card starts at the first list.
  }
}

/** A new list on the Desk, from the footer: named in a dialog and added to the end, as the sidebar's + does. */
export function NewListDialog({ onClose }: { onClose: () => void }) {
  const client = useSync();
  const toast = useToast();
  const lists = useLocal(listsOf);
  const everything = useLocal(allLists);
  const [title, setTitle] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!lists) return;
    const result = createList(lists, { title }, ids, everything ?? lists);
    if (!result.ok) {
      if (result.reason === 'limit')
        toast.show({
          title: 'You have as many lists as an account can hold.',
          category: 'warning',
        });
      return;
    }
    onClose();
    await client.commit(result.mutation);
  }

  return (
    <Dialog open onClose={onClose} aria-label="New list" title="New list" size="sm">
      <form onSubmit={(event) => void submit(event)} className={styles.form}>
        <FormField label="Name">
          {(field) => (
            <Input
              {...field}
              value={title}
              maxLength={500}
              autoComplete="off"
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
        </FormField>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={title.trim() === ''}>
            Add list
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * A new board from the footer: the workspace it goes in is chosen first (the one whose page is open, when there is one), and then it is the board dialog every
 * other way of making one opens. A person with no workspace is offered the workspace dialog, since a board needs one.
 */
export function NewBoardDialog({
  workspaceId,
  onClose,
}: {
  workspaceId?: string;
  onClose: () => void;
}) {
  const { workspaces } = useWorkspaces();
  const [chosen, setChosen] = useState<string | undefined>(workspaceId);
  const [picked, setPicked] = useState(workspaceId !== undefined);
  if (workspaces.length === 0) return <CreateDialog onClose={onClose} />;
  const target = workspaces.find((each) => each.id === chosen)?.id ?? workspaces[0]?.id;
  if (picked && target) return <CreateBoardDialog workspaceId={target} onClose={onClose} />;
  return (
    <Dialog open onClose={onClose} aria-label="Choose a workspace" title="New board" size="sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPicked(true);
        }}
        className={styles.form}
      >
        {workspaces.length === 0 ? <Alert variant="info">Make a workspace first.</Alert> : null}
        <FormField label="Workspace">
          {(field) => (
            <Select
              {...field}
              value={target ?? ''}
              onChange={(event) => setChosen(event.target.value)}
            >
              {workspaces.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Next</Button>
        </div>
      </form>
    </Dialog>
  );
}

export { CreateDialog as NewWorkspaceDialog };
