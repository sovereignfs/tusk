import { requireAccount } from '@/src/auth/session';

export const metadata = { title: 'Board' };

// The board itself is the layout's (DESIGN.md §14, §17.5); this address shows nothing over it.
export default async function BoardPage() {
  await requireAccount();
  return null;
}
