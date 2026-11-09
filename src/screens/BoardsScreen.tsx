'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { sections } from '../boards/sort';
import { useWorkspaces } from '../boards/workspaces';
import { deskSummary } from '../local/store';
import { useLocal } from '../sync/react';
import { nowHere } from '../time';
import { Alert, Avatar, Button, EmptyState, Icon, useToast } from '@sovereignfs/ui';
import {
  type BoardsIndex,
  type IndexWorkspace,
  WORKSPACE_SORTS,
  type WorkspaceRow,
  type WorkspaceSort,
} from '../workspaces/format';
import { CreateDialog } from './AppSidebar';
import { CreateBoardDialog, Tile } from './WorkspaceBoards';
import { DeleteDialog } from './WorkspaceScreen';
import { WorkspaceSettings } from './WorkspaceSettings';
import styles from './BoardsScreen.module.css';

const SORT_LABELS: Record<WorkspaceSort, string> = {
  name: 'Title (A–Z)',
  oldest: 'Created first',
  created: 'Created last',
  updated: 'Recently updated',
};

/**
 * Home (DESIGN.md §17.3), the workspaces, at `/`: **Pinned** first, with the Desk as its first item and a tile of its own (the size of a board's), and then _My workspaces_ and
 * _Shared with me_, each workspace a section of its boards. **The Desk is read from the working copy, so its tile is there offline;** everything else is read from the server and says it needs
 * a connection when it cannot be had, and shows a skeleton until it is. The sort of the person's own workspaces is kept with the account, so it is the
 * same on every device.
 */
export function BoardsScreen() {
  const { workspaces, ready } = useWorkspaces();
  const toast = useToast();
  const [index, setIndex] = useState<BoardsIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<WorkspaceSort>('name');
  const [making, setMaking] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceRow | null>(null);
  const [now] = useState(() => nowHere());
  const desk = useLocal((db) => deskSummary(db, now), [now]);

  const read = useCallback(async () => {
    try {
      const reply = await fetch('/api/boards', { cache: 'no-store' });
      if (!reply.ok) return setFailed(true);
      setIndex((await reply.json()) as BoardsIndex);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void read();
    const again = () => document.visibilityState === 'visible' && void read();
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    window.addEventListener('online', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
      window.removeEventListener('online', again);
    };
  }, [read]);
  // The first read tells which sort the account keeps; after that the person's own choice stands until it is refused.
  const [adopted, setAdopted] = useState(false);
  useEffect(() => {
    if (index && !adopted) {
      setSort(index.sort);
      setAdopted(true);
    }
  }, [index, adopted]);

  async function choose(next: WorkspaceSort) {
    const before = sort;
    setSort(next);
    try {
      const reply = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceSort: next }),
      });
      if (reply.ok) return;
    } catch {
      // Falls through to the same answer as a refusal.
    }
    setSort(before);
    toast.show({
      title: 'The sort could not be saved. It needs a connection.',
      category: 'warning',
    });
  }

  const entryOf = (id: string): IndexWorkspace =>
    index?.workspaces.find((each) => each.id === id) ?? {
      id,
      boards: [],
      people: [],
      peopleCount: 0,
    };
  const { mine, shared } = sections(workspaces, sort);
  const loading = !ready || (index === null && !failed);

  const section = (row: WorkspaceRow) => (
    <WorkspaceSection
      key={row.id}
      row={row}
      entry={entryOf(row.id)}
      onSettings={() => setSettingsFor(row.id)}
    />
  );
  const settingsRow = workspaces.find((each) => each.id === settingsFor);

  return (
    <div className={styles.page}>
      <h1 className={styles.srOnly}>Home</h1>

      <section aria-label="Pinned" className={styles.group}>
        <div className={styles.groupHeader}>
          <h2 className={styles.groupTitle}>Pinned</h2>
        </div>
        <ul className={styles.tiles}>
          <li>
            <Link href="/desk" className={styles.desk}>
              <span className={styles.deskTitle}>
                <Icon name="list-todo" aria-hidden />
                <span className={styles.deskName}>Desk</span>
              </span>
              {desk ? (
                <span className={styles.deskCounts}>
                  {desk.open} open · {desk.dueToday} due today ·{' '}
                  <span className={desk.overdue > 0 ? styles.deskOverdue : undefined}>
                    {desk.overdue} overdue
                  </span>
                </span>
              ) : null}
            </Link>
          </li>
        </ul>
      </section>

      {failed ? (
        <Alert variant="warning">
          Workspaces and boards need a connection. Your Desk is here as it always is.
        </Alert>
      ) : null}
      {loading ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Reading the boards">
          <div className={styles.bone} />
          <div className={styles.bone} />
        </div>
      ) : null}

      {ready && workspaces.length === 0 && !failed ? (
        <EmptyState
          icon="users"
          heading="No workspaces yet"
          description="A workspace holds boards you share with other people."
          action={<Button onClick={() => setMaking(true)}>Create a workspace</Button>}
        />
      ) : null}

      {mine.length > 0 ? (
        <section aria-label="My workspaces" className={styles.group}>
          <div className={styles.groupHeader}>
            <h2 className={styles.groupTitle}>My workspaces</h2>
            <div role="group" aria-label="Sort my workspaces" className={styles.sorts}>
              {WORKSPACE_SORTS.map((each) => (
                <button
                  key={each}
                  type="button"
                  className={styles.sort}
                  aria-pressed={sort === each}
                  onClick={() => void choose(each)}
                >
                  {SORT_LABELS[each]}
                </button>
              ))}
            </div>
          </div>
          {mine.map(section)}
        </section>
      ) : null}
      {shared.length > 0 ? (
        <section aria-label="Shared with me" className={styles.group}>
          <div className={styles.groupHeader}>
            <h2 className={styles.groupTitle}>Shared with me</h2>
          </div>
          {shared.map(section)}
        </section>
      ) : null}

      {making ? <CreateDialog onClose={() => setMaking(false)} /> : null}
      {settingsRow ? (
        <WorkspaceSettings
          workspace={settingsRow}
          onClose={() => setSettingsFor(null)}
          onDelete={() => {
            setSettingsFor(null);
            setDeleting(settingsRow);
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteDialog workspace={deleting} onClose={() => setDeleting(null)} onDeleted={() => {}} />
      ) : null}
    </div>
  );
}

function WorkspaceSection({
  row,
  entry,
  onSettings,
}: {
  row: WorkspaceRow;
  entry: IndexWorkspace;
  onSettings: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const open = entry.boards.filter((each) => !each.archived);
  const archived = entry.boards.filter((each) => each.archived);
  const more = entry.peopleCount - entry.people.length;
  return (
    <section aria-label={row.name} className={styles.workspace}>
      <div className={styles.workspaceHeader}>
        <div className={styles.workspaceTitle}>
          <h3 className={styles.workspaceName}>
            <Link href={`/w/${row.id}`}>{row.name}</Link>
          </h3>
          <span className={styles.count}>
            {open.length} {open.length === 1 ? 'board' : 'boards'}
          </span>
        </div>
        <span className={styles.people} aria-label={`${entry.peopleCount} people`}>
          {entry.people.map((person) => (
            <Avatar key={person.accountId} name={person.name} size="sm" />
          ))}
          {more > 0 ? <span className={styles.more}>+{more}</span> : null}
        </span>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Settings of ${row.name}`}
          onClick={onSettings}
        >
          <Icon name="settings" aria-hidden />
        </Button>
      </div>
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
        <CreateBoardDialog workspaceId={row.id} onClose={() => setCreating(false)} />
      ) : null}
    </section>
  );
}
