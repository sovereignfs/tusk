'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { failureMessage, useWorkspaces } from '../boards/workspaces';
import { SWATCHES } from '../lists/colors';
import { WORKSPACE_LIMITS, type BoardRow } from '../workspaces/format';
import { Alert, Button, ColorPicker, Dialog, FormField, Icon, Input } from '../ui';
import styles from './WorkspaceBoards.module.css';

/** The colour a new board offers first: blue, among the suggestions (DESIGN.md §17.7). */
const FIRST_COLOUR = SWATCHES[6]?.value ?? '#2563eb';

/**
 * A workspace's boards as tiles (DESIGN.md §13.3, §17.3): the ones the person can see (a private board only for its members and the workspace's owners,
 * which the server decides), archived ones behind _Archived_, and a tile to create one. Read when the page opens and when the person comes back to it,
 * since another may have made one; nothing is kept on the device.
 */
export function WorkspaceBoards({ workspaceId }: { workspaceId: string }) {
  const [boards, setBoards] = useState<readonly BoardRow[] | null>(null);
  const [creating, setCreating] = useState(false);

  const read = useCallback(async () => {
    try {
      const reply = await fetch(`/api/workspaces/${workspaceId}/boards`, { cache: 'no-store' });
      if (!reply.ok) return;
      setBoards(((await reply.json()) as { boards: BoardRow[] }).boards);
    } catch {
      // Offline: the tiles that were read stay.
    }
  }, [workspaceId]);
  useEffect(() => {
    void read();
    const again = () => document.visibilityState === 'visible' && void read();
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
    };
  }, [read]);

  const open = (boards ?? []).filter((each) => !each.archived);
  const archived = (boards ?? []).filter((each) => each.archived);
  return (
    <section aria-label="Boards" className={styles.section}>
      {boards === null ? (
        <p className={styles.muted}>Reading the boards…</p>
      ) : (
        <ul className={styles.tiles}>
          {open.map((board) => (
            <li key={board.id}>
              <Tile board={board} />
            </li>
          ))}
          <li>
            <button type="button" className={styles.create} onClick={() => setCreating(true)}>
              <Icon name="plus" aria-hidden /> Create board
            </button>
          </li>
        </ul>
      )}
      {archived.length > 0 ? (
        <details className={styles.archived}>
          <summary>Archived ({archived.length})</summary>
          <ul className={styles.tiles}>
            {archived.map((board) => (
              <li key={board.id}>
                <Tile board={board} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {creating ? (
        <CreateBoardDialog workspaceId={workspaceId} onClose={() => setCreating(false)} />
      ) : null}
    </section>
  );
}

function Tile({ board }: { board: BoardRow }) {
  return (
    <Link href={`/b/${board.id}`} className={styles.tile}>
      {/* The colour is the board's own and is data: a band, with the name in the page's text colour on the page's own background. */}
      <span className={styles.tileBand} style={{ background: board.color }} aria-hidden />
      <span className={styles.tileName}>{board.name}</span>
      {board.visibility === 'private' ? (
        <span className={styles.tileNote}>
          <Icon name="lock" aria-hidden /> Private
        </span>
      ) : null}
    </Link>
  );
}

function CreateBoardDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const { perform } = useWorkspaces();
  const router = useRouter();
  const [name, setName] = useState('');
  const [color, setColor] = useState(FIRST_COLOUR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (next === '') return;
    setBusy(true);
    setError(null);
    const id = crypto.randomUUID();
    const result = await perform({ op: 'board.create', id, workspaceId, name: next, color });
    setBusy(false);
    if (!result.ok) {
      setError(
        result.reason === 'limit'
          ? 'A workspace can hold 500 boards.'
          : failureMessage(result.reason, result.detail),
      );
      return;
    }
    onClose();
    router.push(`/b/${id}`);
  }

  return (
    <Dialog open onClose={onClose} aria-label="Create board" title="Create board" size="md">
      <form onSubmit={(event) => void submit(event)} className={styles.dialog}>
        {error ? <Alert variant="error">{error}</Alert> : null}
        <FormField label="Name">
          {(field) => (
            <Input
              {...field}
              value={name}
              maxLength={WORKSPACE_LIMITS.nameChars}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
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
            Create board
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
