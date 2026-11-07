import { requireAccount } from '@/src/auth/session';

export const metadata = { title: 'Planner' };

// The Planner (DESIGN.md §25.1) is phase 2: a feed of dates with blocks. The address is here so that the sidebar's entry leads somewhere, and the page is
// blank until it is built.
export default async function PlannerPage() {
  await requireAccount();
  return null;
}
