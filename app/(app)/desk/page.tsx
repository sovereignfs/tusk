import { requireAccount } from '@/src/auth/session';
import { DeskScreen } from '@/src/screens/DeskScreen';

export const metadata = { title: 'Desk' };

// The Desk's first list (DESIGN.md §17.11), which the proxy sends `/` to for someone with a session cookie. A cookie that is forged gets here too, and is
// sent to sign in by this check, which is the one that counts.
export default async function HomePage() {
  await requireAccount();
  return <DeskScreen />;
}
