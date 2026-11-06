'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBoardPeople, useBoardStore } from '../boards/context';
import { DuePicker } from '../dates/DuePicker';
import { formatDue } from '../format-due';
import { browserZone, todayFor } from '../time';
import {
  Avatar,
  Button,
  Checkbox,
  Dialog,
  FormField,
  Input,
  Popover,
  SegmentedControl,
  Textarea,
} from '../ui';
import { CardChecklist } from './CardChecklist';
import { ActivityList } from './ActivityList';
import { CardComments } from './CardComments';
import { MoveCardDialog } from './MoveCardDialog';
import { LabelChip, LabelsEditor } from './LabelsEditor';
import { type CardDetail, WORKSPACE_LIMITS } from '../workspaces/format';
import styles from './CardDialog.module.css';

/**
 * A card, as a dialog over its board (DESIGN.md §15.1, §17.6). **Every field saves as it is left,** with no Save: the title and the description are each
 * an operation, sent through the board's store so that the tile behind it changes at once. A title emptied goes back to the one it had. Someone who may
 * not change the board sees the same, read-only, with the description's line breaks as written. The board is the layout, so this is shown over a board
 * that is already there and is closed by replacing the address, so that Back does not step through every card looked at.
 *
 * Left for the tasks that make them: labels, assignees and the due date as chips, the checklist, and Comments and Activity as tabs.
 */
export function CardDialog({ detail: first }: { detail: CardDetail }) {
  const store = useBoardStore();
  const router = useRouter();
  const editable = store.editable;
  // The card as the board holds it, which is what changes at once when its due date is set.
  const tile = store.view.cards.find((each) => each.id === first.id);
  const [detail, setDetail] = useState(first);
  const [title, setTitle] = useState(first.title);
  const [description, setDescription] = useState(first.description ?? '');
  const [pickingLabels, setPickingLabels] = useState(false);
  const [pickingPeople, setPickingPeople] = useState(false);
  const [moving, setMoving] = useState(false);
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const people = useBoardPeople();
  // What the server last said, which a blank title goes back to and which a draft is compared with.
  const saved = useRef({ title: first.title, description: first.description ?? '' });

  const close = useCallback(() => router.replace(`/b/${detail.boardId}`), [router, detail.boardId]);

  // Another person may have changed the card: when the board is read again with a new version, so is the card, unless it is being typed in.
  const version = store.view.board.version;
  // Counts every change to what is typed, so that a read that began before a keystroke is not allowed to put the old text back over it.
  const touched = useRef(0);
  // Counted in the handler that changes what is typed, **at that moment**, and not in an effect after the next render: a read that finishes between the
  // keystroke and that render would otherwise see nothing typed and put the old text back over it.
  const typeTitle = (next: string) => {
    touched.current += 1;
    setTitle(next);
  };
  const typeDescription = (next: string) => {
    touched.current += 1;
    setDescription(next);
  };
  useEffect(() => {
    const untouched = title === saved.current.title && description === saved.current.description;
    if (!untouched) return;
    let alive = true;
    const started = touched.current;
    void (async () => {
      try {
        const reply = await fetch(`/api/cards/${detail.id}`, { cache: 'no-store' });
        if (reply.status === 404) return close();
        if (!reply.ok || !alive) return;
        const next = ((await reply.json()) as { card: CardDetail }).card;
        // Typed in since the read began: what is on the screen is newer than what was read.
        if (touched.current !== started) return;
        saved.current = { title: next.title, description: next.description ?? '' };
        setDetail(next);
        setTitle(next.title);
        setDescription(next.description ?? '');
      } catch {
        // Offline: what is shown stays.
      }
    })();
    return () => {
      alive = false;
    };
    // Only when the board's version moves: the drafts are read as they are then.
  }, [version, detail.id]);

  async function leaveTitle() {
    const next = title.trim();
    if (next === '') return setTitle(saved.current.title);
    if (next === saved.current.title) return setTitle(next);
    const was = saved.current.title;
    saved.current.title = next;
    setTitle(next);
    if (!(await store.perform({ op: 'card.rename', id: detail.id, title: next }))) {
      saved.current.title = was;
      setTitle(was);
    }
  }

  async function leaveDescription() {
    if (description === saved.current.description) return;
    const was = saved.current.description;
    saved.current.description = description;
    if (!(await store.perform({ op: 'card.describe', id: detail.id, description }))) {
      saved.current.description = was;
      setDescription(was);
    }
  }

  async function clone() {
    // The copy is a card of its own and is opened: it is below this one, and the dialog follows it.
    const copy = crypto.randomUUID();
    if (await store.perform({ op: 'card.clone', id: detail.id, newId: copy }))
      router.replace(`/b/${detail.boardId}/c/${copy}`);
  }

  async function archive() {
    if (await store.perform({ op: 'card.archive', id: detail.id })) close();
  }

  return (
    <Dialog open onClose={close} aria-label={first.title} title="" size="lg">
      <div className={styles.body}>
        <div className={styles.main}>
          {editable ? (
            <FormField label="Title">
              {(field) => (
                <Input
                  {...field}
                  value={title}
                  maxLength={WORKSPACE_LIMITS.cardTitleChars}
                  onChange={(event) => typeTitle(event.target.value)}
                  onBlur={() => void leaveTitle()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              )}
            </FormField>
          ) : (
            <h2 className={styles.title}>{title}</h2>
          )}
          <p className={styles.where}>
            in <strong>{detail.listName}</strong>
            {detail.archived ? ' · archived' : ''}
          </p>

          {/* The chips: the due date now, labels and assignees with their tasks. */}
          <div className={styles.chips}>
            {(tile?.labels ?? [])
              .map((id) => store.view.labels.find((each) => each.id === id))
              .filter((each) => each !== undefined)
              .map((label) => (
                <LabelChip key={label.id} label={label} />
              ))}
            {(tile?.assignees ?? []).map((id) => {
              const person = people?.members.find((each) => each.accountId === id);
              return person ? (
                <span key={id} className={styles.chip}>
                  <Avatar name={person.name} size="sm" /> {person.name}
                </span>
              ) : null;
            })}
            {editable && people ? (
              <Popover
                aria-label="Assignees"
                open={pickingPeople}
                onClose={() => setPickingPeople(false)}
                align="left"
                width={280}
                trigger={
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-expanded={pickingPeople}
                    onClick={() => setPickingPeople((was) => !was)}
                  >
                    Assignees
                  </Button>
                }
              >
                <ul className={styles.picker} aria-label="People on the board">
                  {people.members.map((person) => (
                    <li key={person.accountId}>
                      <Checkbox
                        label={`Assign ${person.name}`}
                        checked={(tile?.assignees ?? []).includes(person.accountId)}
                        onChange={(checked) =>
                          void store.perform(
                            checked
                              ? {
                                  op: 'card.assign',
                                  cardId: detail.id,
                                  accountId: person.accountId,
                                }
                              : {
                                  op: 'card.unassign',
                                  cardId: detail.id,
                                  accountId: person.accountId,
                                },
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
              </Popover>
            ) : null}
            {editable ? (
              <Popover
                aria-label="Labels"
                open={pickingLabels}
                onClose={() => setPickingLabels(false)}
                align="left"
                width={320}
                trigger={
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-expanded={pickingLabels}
                    onClick={() => setPickingLabels((was) => !was)}
                  >
                    Labels
                  </Button>
                }
              >
                <div className={styles.picker}>
                  <LabelsEditor
                    labels={store.view.labels}
                    carried={tile?.labels ?? []}
                    cardId={detail.id}
                    boardId={detail.boardId}
                    perform={store.perform}
                  />
                </div>
              </Popover>
            ) : null}
            {editable ? (
              <DuePicker
                value={{ date: tile?.dueDate ?? null, time: tile?.dueTime ?? null }}
                onChange={(due) =>
                  void store.perform({
                    op: 'card.setDue',
                    id: detail.id,
                    dueDate: due.date,
                    dueTime: due.date === null ? null : due.time,
                  })
                }
              />
            ) : tile?.dueDate ? (
              <span className={styles.chip}>
                Due{' '}
                {formatDue(tile.dueDate, tile.dueTime, todayFor(browserZone(), Date.now())).text}
              </span>
            ) : null}
          </div>

          {editable ? (
            <FormField label="Description">
              {(field) => (
                <Textarea
                  {...field}
                  value={description}
                  rows={6}
                  maxLength={WORKSPACE_LIMITS.descriptionChars}
                  onChange={(event) => typeDescription(event.target.value)}
                  onBlur={() => void leaveDescription()}
                />
              )}
            </FormField>
          ) : (
            <div className={styles.readOnly}>
              <h3 className={styles.heading}>Description</h3>
              {description === '' ? (
                <p className={styles.muted}>No description.</p>
              ) : (
                <p className={styles.text}>{description}</p>
              )}
            </div>
          )}

          <CardChecklist
            cardId={detail.id}
            initial={first.items}
            editable={editable}
            store={store}
          />

          <SegmentedControl<'comments' | 'activity'>
            aria-label="Comments or activity"
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { label: 'Comments', value: 'comments' },
              { label: 'Activity', value: 'activity' },
            ]}
          />
          {tab === 'comments' ? (
            <CardComments cardId={detail.id} editable={editable} store={store} />
          ) : (
            // What happened to this card, read again when the board moves on, since each change is a row.
            <section aria-label="Activity">
              <ActivityList
                url={`/api/cards/${detail.id}/activity`}
                refresh={store.view.board.version}
              />
            </section>
          )}
        </div>
        {editable ? (
          <aside className={styles.side} aria-label="Actions">
            <Button variant="secondary" onClick={() => setMoving(true)}>
              Move
            </Button>
            <Button variant="secondary" onClick={() => void clone()}>
              Clone
            </Button>
            <Button variant="secondary" onClick={() => void archive()}>
              Archive
            </Button>
          </aside>
        ) : null}
      </div>
      {moving ? (
        <MoveCardDialog
          cardId={detail.id}
          assignees={tile?.assignees ?? []}
          store={store}
          onClose={() => setMoving(false)}
        />
      ) : null}
    </Dialog>
  );
}
