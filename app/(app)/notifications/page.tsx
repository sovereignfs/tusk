import { requireAccount } from '@/src/auth/session';
import { NotificationsScreen } from '@/src/screens/NotificationsScreen';

export const metadata = { title: 'Notifications' };

// What the person is told (DESIGN.md §16), the whole list: the page is the shell of it, and the screen reads and changes the notices the bell shares.
export default async function NotificationsPage() {
  await requireAccount();
  return <NotificationsScreen />;
}
