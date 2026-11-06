import type { ReactNode } from 'react';
import { AccountMenu } from '@/src/auth/screens/AccountMenu';
import { requireSession } from '@/src/auth/session';
import { AppFrame } from '@/src/screens/AppFrame';
import { WorkspacesProvider } from '@/src/boards/workspaces';
import { Frame } from '@/src/screens/Frame';
import { ZoneReporter } from '@/src/screens/ZoneReporter';
import { site } from '@/src/site';
import { SyncProvider } from '@/src/sync/react';
import { AppShell } from '@/src/ui/AppShell';
import { SidebarToggle } from '@/src/ui/SidebarToggle';

// Everything for someone who is signed in (DESIGN.md §17.2): the shell, then the working copy and its sync, then the columns. A page inside is a client
// component over the working copy (`useLocal`), and writes through `commit`; nothing in here waits for the network.
export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
  modal,
}: {
  children: ReactNode;
  /** The dialog slot (`app/(app)/@modal`): empty, unless a page opened Settings as one. */
  modal: ReactNode;
}) {
  const session = await requireSession();
  return (
    <SyncProvider accountId={session.user.id}>
      <ZoneReporter accountId={session.user.id} />
      <WorkspacesProvider>
        <AppShell
          name={site.name}
          toolbar={<SidebarToggle />}
          account={
            <AccountMenu
              accountId={session.user.id}
              name={session.user.name}
              email={session.user.email}
            />
          }
        >
          <AppFrame>
            {/* The Desk's own columns; they move into the Desk's pages with task 3.12. */}
            <Frame>{children}</Frame>
          </AppFrame>
          {modal}
        </AppShell>
      </WorkspacesProvider>
    </SyncProvider>
  );
}
