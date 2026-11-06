import { requireAccount } from '@/src/auth/session';
import { BoardsScreen } from '@/src/screens/BoardsScreen';

export const metadata = { title: 'Boards' };

// The boards index (DESIGN.md §17.3). The page is the shell of it: the Desk comes from the working copy and the rest is read by the screen, so that it
// shows at once, and says it needs a connection when it cannot be had.
export default async function BoardsPage() {
  await requireAccount();
  return <BoardsScreen />;
}
