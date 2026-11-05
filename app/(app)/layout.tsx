import type { ReactNode } from 'react';
import { AccountMenu } from '@/src/auth/screens/AccountMenu';
import { requireSession } from '@/src/auth/session';
import { Frame } from '@/src/screens/Frame';
import { site } from '@/src/site';
import { SyncProvider } from '@/src/sync/react';
import { AppShell } from '@/src/ui/AppShell';

// Everything for someone who is signed in (DESIGN.md §14.1): the shell, then the working copy and its sync, then the columns. A page inside is a client
// component over the working copy (`useLocal`), and writes through `commit`; nothing in here waits for the network.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  return (
    <SyncProvider accountId={session.user.id}>
      <AppShell
        name={site.name}
        account={
          <AccountMenu
            accountId={session.user.id}
            name={session.user.name}
            email={session.user.email}
          />
        }
      >
        <Frame>{children}</Frame>
      </AppShell>
    </SyncProvider>
  );
}
