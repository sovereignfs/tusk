'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { useWorkspaces } from '../boards/workspaces';
import { Icon, MobileAppsDrawer, MobileFooter } from '../ui';
import { LucideIcon } from '../ui/icons';
import { useMobileNav } from '../ui/mobile-nav';
import { ENTRIES } from './AppSidebar';
import { NewBoardDialog, NewCardDialog, NewListDialog, NewWorkspaceDialog } from './FooterDialogs';
import { ACTIONS, type Action, BOARD_ACTION, LABELS, deskListOf, placeOf } from './footer-actions';

/** The icon of a place, as the sidebar draws it. */
function iconOf(href: string): ReactNode {
  const entry = ENTRIES.find((each) => each.href === href);
  if (!entry) return null;
  return entry.icon === 'list-todo' || entry.icon === 'calendar-days' ? (
    <LucideIcon name={entry.icon} />
  ) : (
    <Icon name={entry.icon as never} aria-hidden />
  );
}

const ACTION_ICONS: Record<Action, ReactNode> = {
  'new-card': <Icon name="plus" aria-hidden />,
  'new-list': <Icon name="plus" aria-hidden />,
  'choose-list': <LucideIcon name="list-todo" />,
  'new-board': <Icon name="plus" aria-hidden />,
  'new-workspace': <LucideIcon name="folder-kanban" />,
  'board-new-list': <Icon name="plus" aria-hidden />,
  'board-new-card': <Icon name="plus" aria-hidden />,
};

/**
 * The phone's footer (DESIGN.md §18): **Desk | Boards | action | Planner | Inbox**. The four places are links, and the current one says so. The middle button
 * opens what fits where the person is (`footer-actions.ts`): on the Desk a new card, a new list and the list selector; on Boards a new board and a new workspace;
 * inside a board a new card and a new list; elsewhere a new card. Each form is a button with its own name. A card made here goes into the list on screen.
 *
 * It is the design system's `MobileFooter`, which publishes its own height as `--sv-shell-footer-height` so that sheets and dialogs clear it. **Its middle
 * button is named by the design system ("Apps")**, which an app cannot change; what it opens, and each choice in it, is named here. Worth offering upstream: a
 * launcher that takes its own name.
 *
 * It is drawn on a phone and not beside the sidebar, and it is `AppShell`'s `footer` slot: no route depends on it.
 */
export function PhoneFooter() {
  const pathname = usePathname();
  const place = placeOf(pathname);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Action | null>(null);
  const nav = useMobileNav();
  useWorkspaces();

  function choose(action: Action) {
    setOpen(false);
    if (action === 'board-new-list' || action === 'board-new-card')
      window.dispatchEvent(new CustomEvent(BOARD_ACTION, { detail: { action } }));
    else if (action === 'choose-list') nav.setOpen(true);
    else setDialog(action);
  }

  const here = (href: string) => {
    const entry = ENTRIES.find((each) => each.href === href);
    return (
      entry?.under.some(
        (prefix) => pathname === prefix || (prefix !== '/' && pathname.startsWith(`${prefix}/`)),
      ) ?? false
    );
  };
  const link = (href: string, label: string) => ({
    icon: iconOf(href),
    label,
    href,
    active: here(href),
  });
  const workspaceOnScreen = /^\/w\/([^/]+)/.exec(pathname)?.[1];

  return (
    <>
      <MobileFooter
        leftIcons={[link('/desk', 'Desk'), link('/', 'Boards')]}
        rightIcons={[link('/planner', 'Planner'), link('/inbox', 'Inbox')]}
        launcherIcon={<Icon name="plus" size="md" aria-hidden />}
        launcherOpen={open}
        onOpenApps={() => setOpen(true)}
      />
      <MobileAppsDrawer
        open={open}
        onClose={() => setOpen(false)}
        aria-label="What to add"
        items={ACTIONS[place].map((action) => ({
          key: action,
          icon: ACTION_ICONS[action],
          label: LABELS[action],
          onClick: () => choose(action),
        }))}
      />
      {dialog === 'new-card' ? (
        <NewCardDialog listId={deskListOf(pathname)} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'new-list' ? <NewListDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'new-board' ? (
        <NewBoardDialog
          {...(workspaceOnScreen ? { workspaceId: workspaceOnScreen } : {})}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'new-workspace' ? <NewWorkspaceDialog onClose={() => setDialog(null)} /> : null}
    </>
  );
}
