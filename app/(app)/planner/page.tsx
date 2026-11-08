import { requireAccount } from '@/src/auth/session';
import { PlannerScreen } from '@/src/screens/PlannerScreen';

export const metadata = { title: 'Planner' };

// The Planner (DESIGN.md §25.1): a feed of days. The page is the shell of it; the screen reads the Desk from the working copy and the boards from `/api/planner`.
export default async function PlannerPage() {
  await requireAccount();
  return <PlannerScreen />;
}
