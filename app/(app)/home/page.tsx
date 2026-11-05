import { requireAccount } from '@/src/auth/session';
import { HomeScreen } from '@/src/screens/HomeScreen';

export const metadata = { title: 'Home' };

// The first list (DESIGN.md §14.1), which the proxy sends `/` to for someone with a session cookie. A cookie that is forged gets here too, and is
// sent to sign in by this check, which is the one that counts.
export default async function HomePage() {
  await requireAccount();
  return <HomeScreen />;
}
