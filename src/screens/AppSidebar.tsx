'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { failureMessage, useWorkspaces } from '../boards/workspaces';
import { WORKSPACE_LIMITS, type WorkspaceRow } from '../workspaces/format';
import { Alert, Button, Dialog, FormField, Icon, type IconName, Input } from '../ui';
import { useSidebar } from '../ui/useSidebar';
import styles from './AppSidebar.module.css';

/**
 * The app's sidebar (DESIGN.md §17.2), at the left of every signed-in page: the places, then the person's workspaces. **An entry is here only when its
 * page is**: a link to a page that is not there is worse than none. So today it holds the Desk; Boards (16.4), the Inbox (8.1) and the Planner (phase
 * 2) join as they are built, and the Desk's entry goes when Boards holds its tile. The workspaces come with 16.2.
 */
interface Entry {
  href: string;
  label: string;
  icon: IconName;
  /** The addresses that are this entry's, for the one that is current. */
  under: readonly string[];
}

export const ENTRIES: readonly Entry[] = [
  {
    href: '/desk',
    label: 'Desk',
    icon: 'layout-dashboard',
    under: ['/', '/desk'],
  },
];

const isUnder = (pathname: string, prefixes: readonly string[]) =>
  prefixes.some(
    (prefix) => pathname === prefix || (prefix !== '/' && pathname.startsWith(`${prefix}/`)),
  );

export function AppSidebar() {
  const pathname = usePathname();
  const sidebar = useSidebar();
  if (!sidebar.available || sidebar.state === 'hidden') return null;
  const rail = sidebar.state === 'rail';

  return (
    <nav
      className={`${styles.sidebar} ${rail ? styles.rail : ''}`}
      aria-label="Tusk"
      data-sidebar={sidebar.state}
    >
      <ul className={styles.list}>
        {ENTRIES.map((entry) => (
          <li key={entry.href}>
            <Link
              href={entry.href}
              className={styles.row}
              aria-current={isUnder(pathname, entry.under) ? 'page' : undefined}
              // A rail shows the icon alone, so the name is the label and the tooltip, and a full sidebar says it in words.
              aria-label={rail ? entry.label : undefined}
              title={rail ? entry.label : undefined}
            >
              <Icon name={entry.icon} aria-hidden />
              {rail ? null : <span className={styles.label}>{entry.label}</span>}
            </Link>
          </li>
        ))}
      </ul>
      <Workspaces rail={rail} pathname={pathname} />
      <button
        type="button"
        className={styles.collapse}
        aria-label={rail ? 'Widen the sidebar' : 'Narrow the sidebar'}
        title={rail ? 'Widen the sidebar' : 'Narrow the sidebar'}
        onClick={sidebar.toggleRail}
      >
        <Icon name={rail ? 'chevron-right' : 'chevron-left'} aria-hidden />
      </button>
    </nav>
  );
}

/**
 * The workspaces (DESIGN.md §17.2): the person's own under _My workspaces_ with a + to make one, and those they are in under _Shared with me_. A rail
 * shows each by its first letter. Nothing is drawn until the list has been read, and nothing at all for a person who has none and cannot make one.
 */
function Workspaces({ rail, pathname }: { rail: boolean; pathname: string }) {
  const { workspaces, ready } = useWorkspaces();
  const [making, setMaking] = useState(false);
  const mine = workspaces.filter((each) => each.role === 'owner');
  const shared = workspaces.filter((each) => each.role !== 'owner');
  if (!ready) return <div className={styles.spacer} />;
  return (
    <div className={styles.workspaces}>
      <Group
        title="My workspaces"
        rail={rail}
        pathname={pathname}
        rows={mine}
        action={
          <button
            type="button"
            className={styles.add}
            aria-label="Create a workspace"
            title="Create a workspace"
            onClick={() => setMaking(true)}
          >
            <Icon name="plus" aria-hidden />
          </button>
        }
      />
      {shared.length > 0 ? (
        <Group title="Shared with me" rail={rail} pathname={pathname} rows={shared} />
      ) : null}
      {making ? <CreateDialog onClose={() => setMaking(false)} /> : null}
    </div>
  );
}

function Group({
  title,
  rows,
  rail,
  pathname,
  action,
}: {
  title: string;
  rows: readonly WorkspaceRow[];
  rail: boolean;
  pathname: string;
  action?: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      {rail ? (
        action
      ) : (
        <div className={styles.heading}>
          <span>{title}</span>
          {action}
        </div>
      )}
      <ul className={styles.list}>
        {rows.map((each) => (
          <li key={each.id}>
            <Link
              href={`/w/${each.id}`}
              className={styles.row}
              aria-current={pathname === `/w/${each.id}` ? 'page' : undefined}
              aria-label={rail ? each.name : undefined}
              title={rail ? each.name : undefined}
            >
              <span className={styles.initial} aria-hidden>
                {([...each.name][0] ?? '?').toUpperCase()}
              </span>
              {rail ? null : <span className={styles.label}>{each.name}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The + beside _My workspaces_: a name, and Enter makes it. The person is taken to it once the server has said it is theirs. */
function CreateDialog({ onClose }: { onClose: () => void }) {
  const { perform } = useWorkspaces();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;
    setBusy(true);
    setError(null);
    const id = crypto.randomUUID();
    const result = await perform({ op: 'workspace.create', id, name: trimmed });
    setBusy(false);
    if (!result.ok) {
      setError(failureMessage(result.reason));
      return;
    }
    onClose();
    window.location.assign(`/w/${id}`);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      aria-label="Create a workspace"
      title="Create a workspace"
      size="md"
    >
      <form onSubmit={(event) => void submit(event)} className={styles.create}>
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
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={name.trim() === ''}>
            Create workspace
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
