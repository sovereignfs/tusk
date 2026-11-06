import { requireAccount } from '@/src/auth/session';
import { InboxScreen } from '@/src/screens/InboxScreen';

export const metadata = { title: 'Inbox' };

// The Inbox (DESIGN.md §16). The page is the shell of it: the screen reads what the person has been told and what is assigned to them, and shows a skeleton
// until it has.
export default async function InboxPage() {
  await requireAccount();
  return <InboxScreen />;
}
