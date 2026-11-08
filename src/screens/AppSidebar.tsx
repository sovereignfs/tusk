'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { failureMessage, useWorkspaces } from '../boards/workspaces';
import { WORKSPACE_LIMITS, type WorkspaceRow } from '../workspaces/format';
import { Alert, Button, Dialog, FormField, Icon, type IconName, Input } from '@sovereignfs/ui';
import { useSidebar } from '../ui/useSidebar';
import styles from './AppSidebar.module.css';

/**
 * The app's sidebar (DESIGN.md §17.2), at the left of every signed-in page: the places (Home, the Desk, the Planner and the Inbox), then the person's workspaces.
 * **An entry is here only when its page is**: a link to a page that is not there is worse than none.
 */
interface Entry {
  href: string;
  label: string;
  icon: IconName;
  /** The addresses that are this entry's, for the one that is current. */
  under: readonly string[];
}

export const ENTRIES: readonly Entry[] = [
  { href: '/', label: 'Home', icon: 'house', under: ['/'] },
  { href: '/desk', label: 'Desk', icon: 'list-todo', under: ['/desk'] },
  { href: '/planner', label: 'Planner', icon: 'calendar-days', under: ['/planner'] },
  { href: '/inbox', label: 'Inbox', icon: 'inbox', under: ['/inbox'] },
];

const isUnder = (pathname: string, prefixes: readonly string[]) =>
  prefixes.some(
    (prefix) => pathname === prefix || (prefix !== '/' && pathname.startsWith(`${prefix}/`)),
  );

/** The places and the workspaces: what the sidebar holds, and what the phone's drawer holds too. */
function NavigationContent({ rail, pathname }: { rail: boolean; pathname: string }) {
  return (
    <>
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
    </>
  );
}

/** The navigation as the phone's drawer shows it: the same entries and workspaces, full width, with no rail and no collapse. */
export function DrawerNavigation() {
  return (
    <nav className={styles.drawerNav} aria-label="Tusk">
      <NavigationContent rail={false} pathname={usePathname()} />
    </nav>
  );
}

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
      <NavigationContent rail={rail} pathname={pathname} />
      <button
        type="button"
        className={styles.collapse}
        aria-label={rail ? 'Widen the sidebar' : 'Narrow the sidebar'}
        title={rail ? 'Widen the sidebar' : 'Narrow the sidebar'}
        onClick={sidebar.toggleRail}
      >
        <Icon name={rail ? 'panel-left-open' : 'panel-left-close'} aria-hidden />
      </button>
    </nav>
  );
}

/**
 * The workspaces (DESIGN.md §17.2): the person's own under _My workspaces_, and those they are in under _Shared with me_, and after them the way to make
 * one. A rail shows each by its icon, with a divider above them. Nothing is drawn until the list has been read, and nothing at all for a person who has none
 * and cannot make one.
 */
function Workspaces({ rail, pathname }: { rail: boolean; pathname: string }) {
  const { workspaces, ready } = useWorkspaces();
  const [making, setMaking] = useState(false);
  const mine = workspaces.filter((each) => each.role === 'owner');
  const shared = workspaces.filter((each) => each.role !== 'owner');
  if (!ready) return <div className={styles.spacer} />;
  const add = (
    <button
      type="button"
      className={`${styles.row} ${styles.add}`}
      aria-label={rail ? 'Create a workspace' : undefined}
      title={rail ? 'Create a workspace' : undefined}
      onClick={() => setMaking(true)}
    >
      <Icon name="plus" aria-hidden />
      {rail ? null : <span className={styles.label}>Create a workspace</span>}
    </button>
  );
  return (
    <div className={styles.workspaces}>
      {rail ? (
        // A rail: a divider, every workspace as its icon (mine and then those shared with me, for a way into each from any page), and then the +.
        <section aria-label="Workspaces" className={styles.railGroup}>
          <hr className={styles.divider} />
          <ul className={styles.list}>
            {[...mine, ...shared].map((each) => (
              <WorkspaceRow key={each.id} row={each} rail pathname={pathname} />
            ))}
            <li>{add}</li>
          </ul>
        </section>
      ) : (
        <>
          <Group title="My workspaces" pathname={pathname} rows={mine} action={add} />
          {shared.length > 0 ? (
            <Group title="Shared with me" pathname={pathname} rows={shared} />
          ) : null}
        </>
      )}
      {making ? <CreateDialog onClose={() => setMaking(false)} /> : null}
    </div>
  );
}

/** A workspace: its icon (`folder-kanban` until a person can choose one, as they choose its colour) and, in a full sidebar, its name. */
function WorkspaceRow({
  row,
  rail,
  pathname,
}: {
  row: WorkspaceRow;
  rail: boolean;
  pathname: string;
}) {
  return (
    <li>
      <Link
        href={`/w/${row.id}`}
        className={styles.row}
        aria-current={pathname === `/w/${row.id}` ? 'page' : undefined}
        aria-label={rail ? row.name : undefined}
        title={rail ? row.name : undefined}
      >
        <Icon name="folder-kanban" aria-hidden />
        {rail ? null : <span className={styles.label}>{row.name}</span>}
      </Link>
    </li>
  );
}

function Group({
  title,
  rows,
  pathname,
  action,
}: {
  title: string;
  rows: readonly WorkspaceRow[];
  pathname: string;
  action?: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className={styles.heading}>
        <span>{title}</span>
      </div>
      <ul className={styles.list}>
        {rows.map((each) => (
          <WorkspaceRow key={each.id} row={each} rail={false} pathname={pathname} />
        ))}
        {action ? <li>{action}</li> : null}
      </ul>
    </section>
  );
}

/** The + beside _My workspaces_: a name, and Enter makes it. The person is taken to it once the server has said it is theirs. */
export function CreateDialog({ onClose }: { onClose: () => void }) {
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
