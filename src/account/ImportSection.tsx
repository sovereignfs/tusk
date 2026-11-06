'use client';

import { useState } from 'react';
import { useWorkspaces } from '../boards/workspaces';
import { cardCount, checkCount, listsOf } from '../local/store';
import { importDesk, type ImportedDesk } from '../portability/import-desk';
import {
  MAX_FILE_BYTES,
  type Summary,
  describeSummary,
  summarise,
  validateFile,
} from '../portability/validate';
import type { TuskExport } from '../portability/format';
import { useSync } from '../sync/react';
import { Alert, Button, FormField, Select } from '../ui';
import styles from './Account.module.css';

const ids = { newId: () => crypto.randomUUID() };

type Stage =
  | { kind: 'idle' }
  | { kind: 'refused'; error: string }
  | { kind: 'ready'; source: string; file: TuskExport; summary: Summary }
  | { kind: 'working' }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string };

/**
 * Settings, Data, Import (DESIGN.md §20.2). A file is read and checked here, **before anything is asked or written**, and what it holds is said ("your Desk:
 * 3 lists, 40 cards; 1 workspace, 4 boards, 312 cards") and the person asked, since importing twice makes two copies. **It always creates:** Desk lists are
 * added to the Desk, through sync like any change, so it works with no network; a board goes into a workspace the person chooses and workspaces are made
 * with them as owner, by the server, in one transaction, which needs a connection and says so. A file that is refused changes nothing.
 */
export function ImportSection() {
  const client = useSync();
  const workspaces = useWorkspaces();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [target, setTarget] = useState('');

  async function choose(file: File | undefined) {
    if (!file) return;
    setTarget('');
    if (file.size > MAX_FILE_BYTES)
      return setStage({ kind: 'refused', error: 'the file is over 50 MB' });
    const source = await file.text();
    const read = validateFile(source);
    if (!read.ok) return setStage({ kind: 'refused', error: read.error });
    setStage({ kind: 'ready', source, file: read.file, summary: summarise(read.file) });
  }

  /** The Desk's part as mutations, worked out against what the Desk has: pure, and nothing is committed here. */
  async function deskPart(file: TuskExport): Promise<ImportedDesk | undefined> {
    if (!file.desk) return undefined;
    const existing = await client.read(async (db) => ({
      lists: await listsOf(db),
      listRows: (await db.getAll('desk_list')).length,
      cardRows: await cardCount(db),
      checkRows: await checkCount(db),
      seriesRows: (await db.getAll('desk_series')).length,
    }));
    return importDesk(file.desk, existing, ids);
  }

  async function run() {
    if (stage.kind !== 'ready') return;
    const { file, source } = stage;
    setStage({ kind: 'working' });
    try {
      const desk = await deskPart(file);
      if (desk && !desk.ok)
        return setStage({
          kind: 'failed',
          message: `Your Desk would have more ${desk.reason} than an account can hold. Nothing was imported.`,
        });
      const serverSide = file.scope !== 'desk';
      let said = '';
      if (serverSide) {
        const workspace = file.scope === 'board' ? target : '';
        if (file.scope === 'board' && workspace === '')
          return setStage({ kind: 'failed', message: 'Choose a workspace for the board.' });
        const reply = await fetch(
          `/api/import${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''}`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: source },
        );
        if (!reply.ok) {
          const body = (await reply.json().catch(() => ({}))) as { error?: string };
          return setStage({
            kind: 'failed',
            message: `The server did not import it (${body.error ?? reply.status}). Nothing was imported.`,
          });
        }
        const made = (await reply.json()) as {
          workspaces: number;
          boards: number;
          cards: number;
          peopleDropped: number;
        };
        said = `${made.workspaces > 0 ? `${made.workspaces} workspace${made.workspaces === 1 ? '' : 's'}, ` : ''}${made.boards} board${made.boards === 1 ? '' : 's'}, ${made.cards} card${made.cards === 1 ? '' : 's'}`;
        if (made.peopleDropped > 0)
          said += `. ${made.peopleDropped} ${made.peopleDropped === 1 ? 'person who is' : 'people who are'} not in the workspace ${made.peopleDropped === 1 ? 'was' : 'were'} not assigned`;
        await workspaces.reload();
      }
      if (desk?.ok) {
        for (const mutation of desk.mutations) await client.commit(mutation);
        said = `${desk.counts.lists} list${desk.counts.lists === 1 ? '' : 's'}, ${desk.counts.cards} card${desk.counts.cards === 1 ? '' : 's'} added to your Desk${said ? `; ${said}` : ''}`;
      }
      setStage({ kind: 'done', message: `Imported: ${said}.` });
    } catch {
      setStage({
        kind: 'failed',
        message: 'That needs a connection. Nothing was imported.',
      });
    }
  }

  const choosable = workspaces.workspaces;
  return (
    <div className={styles.group}>
      <h2>Import</h2>
      <p>
        Choose a file made by Export. Importing always adds: it never replaces or merges, so
        importing the same file twice makes two copies. Comments and activity are kept in the file
        as a record and are not imported.
      </p>
      <input
        type="file"
        accept="application/json,.json"
        aria-label="File to import"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared once it is held, so that choosing the same file again (to import it twice) is a choice the browser tells us of.
          event.target.value = '';
          void choose(file);
        }}
      />
      {stage.kind === 'refused' ? (
        <Alert variant="warning">
          This file cannot be imported: {stage.error}. Nothing was changed.
        </Alert>
      ) : null}
      {stage.kind === 'ready' ? (
        <div className={styles.group}>
          <p role="status">
            This file holds {describeSummary(stage.summary)}
            {stage.summary.people > 0
              ? `. ${stage.summary.people} ${stage.summary.people === 1 ? 'person is' : 'people are'} named in it; anyone who is not a member of the workspace it goes into will not be assigned`
              : ''}
            .
          </p>
          {stage.file.scope === 'board' ? (
            <FormField label="Into which workspace?">
              {(field) => (
                <Select
                  {...field}
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="">Choose a workspace…</option>
                  {choosable.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          <div className={styles.row}>
            <Button
              disabled={stage.file.scope === 'board' && target === ''}
              onClick={() => void run()}
            >
              Import
            </Button>
            <Button variant="secondary" onClick={() => setStage({ kind: 'idle' })}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {stage.kind === 'working' ? <p role="status">Importing…</p> : null}
      {stage.kind === 'done' ? <p role="status">{stage.message}</p> : null}
      {stage.kind === 'failed' ? <Alert variant="warning">{stage.message}</Alert> : null}
    </div>
  );
}
