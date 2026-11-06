'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import type { BoardStore } from '../boards/store';
import { SWATCHES } from '../lists/colors';
import { type BoardRow, WORKSPACE_LIMITS } from '../workspaces/format';
import { LabelsEditor } from './LabelsEditor';
import { Alert, Button, ColorPicker, Dialog, FormField, Input, Textarea } from '../ui';
import styles from './BoardScreen.module.css';

/**
 * A board's settings (DESIGN.md §14.1): its name, any colour, and a description, saved together with Save. For a board's owners and the workspace's
 * owners, from the board's menu; an archived board has none until it is restored.
 */
export function BoardSettingsDialog({
  board,
  store,
  onClose,
}: {
  board: BoardRow;
  store: BoardStore;
  onClose: () => void;
}) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description ?? '');
  const [color, setColor] = useState(board.color);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (next === '') return;
    setBusy(true);
    const done = await store.perform({
      op: 'board.update',
      id: board.id,
      name: next,
      color,
      description,
    });
    setBusy(false);
    if (done) onClose();
  }

  return (
    <Dialog open onClose={onClose} aria-label="Board settings" title="Board settings" size="md">
      <form onSubmit={(event) => void submit(event)} className={styles.dialog}>
        <FormField label="Name">
          {(field) => (
            <Input
              {...field}
              value={name}
              maxLength={WORKSPACE_LIMITS.nameChars}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField label="Description">
          {(field) => (
            <Textarea
              {...field}
              value={description}
              rows={4}
              maxLength={WORKSPACE_LIMITS.boardDescriptionChars}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy}
            />
          )}
        </FormField>
        <ColorPicker
          aria-label="Colour"
          customLabel="Pick any colour"
          swatches={SWATCHES}
          value={color}
          onChange={(value) => {
            if (value !== null) setColor(value.toLowerCase());
          }}
        />
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={name.trim() === ''}>
            Save
          </Button>
        </div>
      </form>
      <div className={styles.dialog}>
        <section aria-label="Labels of the board">
          <h3 className={styles.sectionTitle}>Labels</h3>
          <LabelsEditor labels={store.view.labels} boardId={board.id} perform={store.perform} />
        </section>
      </div>
    </Dialog>
  );
}

/** Deleting a board: its name typed, because it takes every list, card and comment on it, for everyone, and there is no Undo (DESIGN.md §14.4). */
export function DeleteBoardDialog({
  board,
  workspaceId,
  store,
  onClose,
}: {
  board: BoardRow;
  workspaceId: string;
  store: BoardStore;
  onClose: () => void;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (typed !== board.name) return;
    setBusy(true);
    setFailed(false);
    const done = await store.perform({ op: 'board.delete', id: board.id, name: typed });
    setBusy(false);
    if (!done) return setFailed(true);
    onClose();
    router.replace(`/w/${workspaceId}`);
  }

  return (
    <Dialog open onClose={onClose} aria-label="Delete board" title="Delete board" size="md">
      <form onSubmit={(event) => void submit(event)} className={styles.dialog}>
        <p>
          This deletes <strong>{board.name}</strong> with every list, card and comment on it, for
          everyone. It cannot be undone; archiving it can.
        </p>
        {failed ? <Alert variant="error">It was not deleted.</Alert> : null}
        <FormField label="Type the name to confirm">
          {(field) => (
            <Input
              {...field}
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
              disabled={busy}
            />
          )}
        </FormField>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={typed !== board.name}>
            Delete this board
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
