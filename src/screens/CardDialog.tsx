'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBoardStore } from '../boards/context';
import { Button, Dialog, FormField, Input, Textarea } from '../ui';
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
  const [detail, setDetail] = useState(first);
  const [title, setTitle] = useState(first.title);
  const [description, setDescription] = useState(first.description ?? '');
  // What the server last said, which a blank title goes back to and which a draft is compared with.
  const saved = useRef({ title: first.title, description: first.description ?? '' });

  const close = useCallback(() => router.replace(`/b/${detail.boardId}`), [router, detail.boardId]);

  // Another person may have changed the card: when the board is read again with a new version, so is the card, unless it is being typed in.
  const version = store.view.board.version;
  useEffect(() => {
    const untouched = title === saved.current.title && description === saved.current.description;
    if (!untouched) return;
    let alive = true;
    void (async () => {
      try {
        const reply = await fetch(`/api/cards/${detail.id}`, { cache: 'no-store' });
        if (reply.status === 404) return close();
        if (!reply.ok || !alive) return;
        const next = ((await reply.json()) as { card: CardDetail }).card;
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
                  onChange={(event) => setTitle(event.target.value)}
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

          {/* The chips (labels, assignees, due date) go here, with 18.2's successors. */}

          {editable ? (
            <FormField label="Description">
              {(field) => (
                <Textarea
                  {...field}
                  value={description}
                  rows={6}
                  maxLength={WORKSPACE_LIMITS.descriptionChars}
                  onChange={(event) => setDescription(event.target.value)}
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

          {/* The checklist, and Comments and Activity as tabs, go here. */}
        </div>
        {editable ? (
          <aside className={styles.side} aria-label="Actions">
            <Button variant="secondary" onClick={() => void archive()}>
              Archive
            </Button>
          </aside>
        ) : null}
      </div>
    </Dialog>
  );
}
