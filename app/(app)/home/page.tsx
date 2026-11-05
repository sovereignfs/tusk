import { requireAccount } from '@/src/auth/session';
import { EmptyState } from '@/src/ui';

export const metadata = { title: 'Home' };

// Until the lists (task 3.3) there is nothing to open. The page is for an account, and the layout around it has found who.
export default async function HomePage() {
  await requireAccount();
  return (
    <EmptyState
      icon="inbox"
      heading="Tasks is being built"
      description="There is nothing to see here yet."
    />
  );
}
