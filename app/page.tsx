import { AccountMenu } from '@/src/auth/screens/AccountMenu';
import { getSession } from '@/src/auth/session';
import { site } from '@/src/site';
import { AppShell } from '@/src/ui/AppShell';
import { EmptyState } from '@/src/ui';

// A placeholder, until the first screens (task 7.1). The page is public until the landing page (task 2.2); with a session, the shell shows who is
// signed in and the way out.
export default async function Home() {
  const session = await getSession();
  return (
    <AppShell
      name={site.name}
      {...(session
        ? { account: <AccountMenu name={session.user.name} email={session.user.email} /> }
        : {})}
    >
      <EmptyState
        icon="inbox"
        heading="Tasks is being built"
        description="There is nothing to see here yet."
      />
    </AppShell>
  );
}
