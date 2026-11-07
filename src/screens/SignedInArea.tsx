'use client';

import { type ReactNode, useEffect } from 'react';
import { AccountMenu } from '../auth/screens/AccountMenu';
import { WorkspacesProvider } from '../boards/workspaces';
import { rememberIdentity } from '../identity';
import { site } from '../site';
import { SyncProvider } from '../sync/react';
import { AppShell } from '../ui/AppShell';
import { MobileNavProvider } from '../ui/mobile-nav';
import { SidebarToggle } from '../ui/SidebarToggle';
import { AppFrame } from './AppFrame';
import { Frame } from './Frame';
import { KeyProvider } from './KeyContext';
import { RegisterWorker } from './RegisterWorker';
import { ZoneReporter } from './ZoneReporter';

/**
 * Everything for someone who is signed in (DESIGN.md §17.2): the working copy and its sync, then the shell and the columns. **It is the one composition**,
 * made by the server's layout from the session when online, and by the offline shell from the identity kept on the device (`src/identity.ts`), so that
 * the Desk is the same app in both. A page inside is a client component over the working copy (`useLocal`) and writes through `commit`; nothing in
 * here waits for the network. It also keeps the identity for the shell, and registers the service worker.
 */
export function SignedInArea({
  accountId,
  name,
  email,
  modal,
  children,
}: {
  accountId: string;
  name: string;
  email: string;
  /** The dialog slot (`app/(app)/@modal`): empty, unless a page opened Settings as one. */
  modal?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => rememberIdentity({ id: accountId, name, email }), [accountId, name, email]);
  return (
    <SyncProvider accountId={accountId}>
      <KeyProvider accountId={accountId}>
        <ZoneReporter accountId={accountId} />
        <RegisterWorker />
        <WorkspacesProvider>
          <MobileNavProvider>
            <AppShell
              name={site.name}
              toolbar={<SidebarToggle />}
              account={<AccountMenu accountId={accountId} name={name} email={email} />}
            >
              <AppFrame>
                {/* The Desk's own columns. */}
                <Frame>{children}</Frame>
              </AppFrame>
              {modal}
            </AppShell>
          </MobileNavProvider>
        </WorkspacesProvider>
      </KeyProvider>
    </SyncProvider>
  );
}
