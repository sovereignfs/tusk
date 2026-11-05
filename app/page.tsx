import { redirect } from 'next/navigation';
import { getSession } from '@/src/auth/session';
import { site } from '@/src/site';
import { AppShell } from '@/src/ui/AppShell';
import { EmptyState } from '@/src/ui';

// A placeholder, until the landing page (task 2.2), which also makes `/` the first list for someone signed in without a redirect. Until then a person
// who is signed in goes to the app, and a visitor sees the shell with nothing in it.
export default async function Landing() {
  if (await getSession()) redirect('/home');
  return (
    <AppShell name={site.name}>
      <EmptyState
        icon="inbox"
        heading="Tasks is being built"
        description="There is nothing to see here yet."
      />
    </AppShell>
  );
}
