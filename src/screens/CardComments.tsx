'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BoardStore } from '../boards/store';
import { Avatar, Button, ConfirmDialog, Textarea } from '@sovereignfs/ui';
import { type CommentPage, type CommentRow, WORKSPACE_LIMITS } from '../workspaces/format';
import styles from './CardComments.module.css';

/**
 * A card's comments in its dialog (DESIGN.md §15.5): newest first, a page at a time, each with its author's avatar and name, when it was written and
 * "edited" if it was. **Text is shown as text, with its line breaks, and never as HTML**: it is a text node, so a `<script>` in a comment is the words
 * `<script>`. A member writes one; its author edits it; its author or a board owner deletes it (the server says which, per comment). Every change is an
 * operation through the board's store, and the comments are read again after it, since a name is read from the account when it is shown.
 */
export function CardComments({
  cardId,
  editable,
  store,
}: {
  cardId: string;
  editable: boolean;
  store: BoardStore;
}) {
  const [comments, setComments] = useState<readonly CommentRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<CommentRow | null>(null);
  const [deleting, setDeleting] = useState<CommentRow | null>(null);
  const [failed, setFailed] = useState(false);

  const read = useCallback(
    async (after?: CommentRow): Promise<CommentPage | null> => {
      try {
        const query = after ? `?beforeAt=${after.createdAt}&beforeId=${after.id}` : '';
        const reply = await fetch(`/api/cards/${cardId}/comments${query}`, { cache: 'no-store' });
        if (!reply.ok) return null;
        setFailed(false);
        return (await reply.json()) as CommentPage;
      } catch {
        setFailed(true);
        return null;
      }
    },
    [cardId],
  );
  /** The newest page, in place of what is shown. */
  const reload = useCallback(async () => {
    const page = await read();
    if (page) {
      setComments(page.comments);
      setMore(page.more);
    }
  }, [read]);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function more_() {
    const last = comments?.at(-1);
    if (!last) return;
    const page = await read(last);
    if (page) {
      setComments([...(comments ?? []), ...page.comments]);
      setMore(page.more);
    }
  }

  async function post() {
    const text = body;
    if (text.trim() === '') return;
    setBody('');
    const done = await store.perform({
      op: 'comment.add',
      id: crypto.randomUUID(),
      cardId,
      body: text,
    });
    if (!done) setBody(text);
    await reload();
  }

  async function saveEdit() {
    if (!editing) return;
    const target = editing;
    setEditing(null);
    if (target.body.trim() === '') return;
    await store.perform({ op: 'comment.edit', id: target.id, body: target.body });
    await reload();
  }

  return (
    <section aria-label="Comments" className={styles.comments}>
      <h3 className={styles.heading}>Comments</h3>
      {editable ? (
        <div className={styles.composer}>
          <Textarea
            aria-label="Write a comment"
            value={body}
            rows={3}
            maxLength={WORKSPACE_LIMITS.commentChars}
            placeholder="Write a comment…"
            onChange={(event) => setBody(event.target.value)}
          />
          <div>
            <Button size="sm" disabled={body.trim() === ''} onClick={() => void post()}>
              Comment
            </Button>
          </div>
        </div>
      ) : null}
      {failed ? <p className={styles.muted}>Comments need a connection.</p> : null}
      {comments === null && !failed ? <p className={styles.muted}>Reading the comments…</p> : null}
      {comments?.length === 0 ? <p className={styles.muted}>No comments yet.</p> : null}
      <ul className={styles.list}>
        {(comments ?? []).map((comment) => (
          <li key={comment.id} className={styles.comment}>
            <Avatar name={comment.authorName} size="sm" />
            <div className={styles.main}>
              <p className={styles.meta}>
                <strong>{comment.authorName}</strong>{' '}
                <time dateTime={new Date(comment.createdAt).toISOString()}>
                  {new Date(comment.createdAt).toLocaleString()}
                </time>
                {comment.editedAt !== null ? <span> · edited</span> : null}
              </p>
              {editing?.id === comment.id ? (
                <div className={styles.composer}>
                  <Textarea
                    aria-label="Edit comment"
                    value={editing.body}
                    rows={3}
                    maxLength={WORKSPACE_LIMITS.commentChars}
                    onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                  />
                  <div className={styles.buttons}>
                    <Button size="sm" onClick={() => void saveEdit()}>
                      Save
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                // A text node, with its line breaks kept by the style: never HTML.
                <p className={styles.text}>{comment.body}</p>
              )}
              {editing?.id !== comment.id && (comment.canEdit || comment.canDelete) ? (
                <div className={styles.buttons}>
                  {comment.canEdit ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Edit comment by ${comment.authorName}`}
                      onClick={() => setEditing(comment)}
                    >
                      Edit
                    </Button>
                  ) : null}
                  {comment.canDelete ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Delete comment by ${comment.authorName}`}
                      onClick={() => setDeleting(comment)}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {more ? (
        <div>
          <Button variant="secondary" size="sm" onClick={() => void more_()}>
            Older comments
          </Button>
        </div>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="Delete this comment?"
          message={<>This cannot be undone.</>}
          confirmLabel="Delete comment"
          destructive
          onConfirm={() => {
            const target = deleting;
            setDeleting(null);
            void store.perform({ op: 'comment.delete', id: target.id }).then(reload);
          }}
        />
      ) : null}
    </section>
  );
}
