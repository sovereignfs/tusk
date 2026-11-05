import { site } from '@/src/site';
import { AppShell } from '@/src/ui/AppShell';
import { EmptyState } from '@/src/ui';

// A placeholder, until the first screens (task 7.1). The page is public: signing in is task 2.1.
export default function Home() {
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
