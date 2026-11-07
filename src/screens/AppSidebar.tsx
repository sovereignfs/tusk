'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { unreadLabel } from '../inbox/group';
import { failureMessage, useWorkspaces } from '../boards/workspaces';
import { WORKSPACE_LIMITS, type WorkspaceRow } from '../workspaces/format';
import { Alert, Button, Dialog, FormField, Icon, type IconName, Input } from '../ui';
import { LucideIcon } from '../ui/icons';
import { useSidebar } from '../ui/useSidebar';
import styles from './AppSidebar.module.css';

/**
 * The app's sidebar (DESIGN.md §17.2), at the left of every signed-in page: the places (Home, the Desk and the Inbox), then the person's workspaces. **An entry
 * is here only when its page is**: a link to a page that is not there is worse than none, so the Planner (phase 2) joins when it is built.
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
  { href: '/desk', label: 'Desk', icon: 'list', under: ['/desk'] },
  { href: '/inbox', label: 'Inbox', icon: 'inbox', under: ['/inbox'] },
];

/**
 * How many notices are unread (DESIGN.md §16), fetched with the shell and again when the person comes back to the window, and set to nothing the moment
 * the Inbox has marked them read. The same on every device, since it is a time kept with the account.
 */
function useUnread(): number {
  const [unread, setUnread] = useState(0);
  const read = useCallback(async () => {
    try {
      const reply = await fetch('/api/inbox/unread', { cache: 'no-store' });
      if (reply.ok) setUnread(((await reply.json()) as { unread: number }).unread);
    } catch {
      // Offline: the count that was read stays.
    }
  }, []);
  useEffect(() => {
    void read();
    const again = () => document.visibilityState === 'visible' && void read();
    const seen = () => setUnread(0);
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    window.addEventListener('tusk:inbox-seen', seen);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
      window.removeEventListener('tusk:inbox-seen', seen);
    };
  }, [read]);
  return unread;
}

const isUnder = (pathname: string, prefixes: readonly string[]) =>
  prefixes.some(
    (prefix) => pathname === prefix || (prefix !== '/' && pathname.startsWith(`${prefix}/`)),
  );

/** The places and the workspaces: what the sidebar holds, and what the phone's drawer holds too. */
function NavigationContent({ rail, pathname }: { rail: boolean; pathname: string }) {
  const unread = useUnread();
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
              aria-label={
                entry.href === '/inbox' && unreadLabel(unread)
                  ? `${entry.label}, ${unreadLabel(unread)} unread`
                  : rail
                    ? entry.label
                    : undefined
              }
              title={rail ? entry.label : undefined}
            >
              <Icon name={entry.icon} aria-hidden />
              {rail ? null : <span className={styles.label}>{entry.label}</span>}
              {entry.href === '/inbox' && unreadLabel(unread) ? (
                <span className={styles.unread} aria-hidden>
                  {unreadLabel(unread)}
                </span>
              ) : null}
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
        <LucideIcon name={rail ? 'panel-left-open' : 'panel-left-close'} />
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
  const add = (
    <button
      type="button"
      className={styles.add}
      aria-label="Create a workspace"
      title="Create a workspace"
      onClick={() => setMaking(true)}
    >
      <Icon name="plus" aria-hidden />
    </button>
  );
  return (
    <div className={styles.workspaces}>
      {rail ? (
        // A rail: the +, a divider, and every workspace as its icon, mine and then those shared with me, for a way into each from any page.
        <section aria-label="Workspaces" className={styles.railGroup}>
          {add}
          <hr className={styles.divider} />
          <ul className={styles.list}>
            {[...mine, ...shared].map((each) => (
              <WorkspaceRow key={each.id} row={each} rail pathname={pathname} />
            ))}
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
        <LucideIcon name="folder-kanban" />
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
        {action}
      </div>
      <ul className={styles.list}>
        {rows.map((each) => (
          <WorkspaceRow key={each.id} row={each} rail={false} pathname={pathname} />
        ))}
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
