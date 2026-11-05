import { AccountMenu } from '@/src/auth/screens/AccountMenu';
import { getSession } from '@/src/auth/session';
import { site } from '@/src/site';
import { SyncProvider } from '@/src/sync/react';
import { AppShell } from '@/src/ui/AppShell';
import { EmptyState } from '@/src/ui';

// A placeholder, until the first screens (task 7.1). The page is public until the landing page (task 2.2); with a session, the app is inside the
// person's working copy and its sync (DESIGN.md §8), and the shell shows who is signed in and the way out.
export default async function Home() {
  const session = await getSession();
  const placeholder = (
    <EmptyState
      icon="inbox"
      heading="Tasks is being built"
      description="There is nothing to see here yet."
    />
  );
  if (!session) return <AppShell name={site.name}>{placeholder}</AppShell>;

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
        {placeholder}
      </AppShell>
    </SyncProvider>
  );
}
