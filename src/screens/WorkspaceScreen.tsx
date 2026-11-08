'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { WorkspaceBoards } from './WorkspaceBoards';
import { WorkspaceSettings } from './WorkspaceSettings';
import type { WorkspaceRow } from '../workspaces/format';
import { failureMessage, useWorkspaces } from '../boards/workspaces';
import { Alert, Button, Dialog, FormField, Icon, Input } from '@sovereignfs/ui';
import styles from './WorkspaceScreen.module.css';

/**
 * A workspace (DESIGN.md §13, §17.11): its name, a gear that opens its settings (`WorkspaceSettings`: name, people, leaving), and its boards as tiles (`WorkspaceBoards`). **Deleting one is typed**: its owners confirm by
 * writing its name, because a shared space is not deleted by accident and there is no Undo (§13.1). The workspace is read by the server before the page is
 * sent, so one that is not the person's is a 404 and never reaches here; what is held here follows the list in memory, so that a rename shows at once.
 */
export function WorkspaceScreen({ workspace }: { workspace: WorkspaceRow }) {
  const { workspaces, ready } = useWorkspaces();
  const router = useRouter();
  const live = workspaces.find((each) => each.id === workspace.id);
  // Gone from the list once it has been read: deleted here or by another owner, and there is nothing left to show.
  const gone = ready && live === undefined;
  const current = live ?? workspace;
  const owner = current.role === 'owner';
  const [confirming, setConfirming] = useState(false);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    if (gone) router.replace('/');
  }, [gone, router]);

  if (gone) return null;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{current.name}</h1>
        <span className={styles.role}>{owner ? 'Owner' : 'Member'}</span>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Workspace settings"
          onClick={() => setSettings(true)}
        >
          <Icon name="settings" aria-hidden />
        </Button>
      </header>
      <WorkspaceBoards workspaceId={current.id} />
      {settings ? (
        <WorkspaceSettings
          workspace={current}
          onClose={() => setSettings(false)}
          onDelete={() => {
            setSettings(false);
            setConfirming(true);
          }}
        />
      ) : null}
      {confirming ? (
        <DeleteDialog
          workspace={current}
          onClose={() => setConfirming(false)}
          onDeleted={() => router.replace('/')}
        />
      ) : null}
    </div>
  );
}

export function DeleteDialog({
  workspace,
  onClose,
  onDeleted,
}: {
  workspace: WorkspaceRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { perform } = useWorkspaces();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (typed !== workspace.name) return;
    setBusy(true);
    setError(null);
    const result = await perform({ op: 'workspace.delete', id: workspace.id, name: typed });
    setBusy(false);
    if (!result.ok) {
      setError(failureMessage(result.reason));
      return;
    }
    onClose();
    onDeleted();
  }

  return (
    <Dialog open onClose={onClose} aria-label="Delete workspace" title="Delete workspace" size="md">
      <form onSubmit={(event) => void submit(event)} className={styles.dialog}>
        <p>
          This deletes <strong>{workspace.name}</strong> with every board, list, card and comment in
          it, for everyone in it. It cannot be undone.
        </p>
        {error ? <Alert variant="error">{error}</Alert> : null}
        <FormField label={`Type the name to confirm`}>
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
          <Button type="submit" loading={busy} disabled={typed !== workspace.name}>
            Delete this workspace
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
