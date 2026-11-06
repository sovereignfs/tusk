import { notFound } from 'next/navigation';
import { uuid } from '@/src/access/parse';
import { requireAccount } from '@/src/auth/session';
import { getDatabase } from '@/src/db/boot';
import { WorkspaceScreen } from '@/src/screens/WorkspaceScreen';
import { workspaceOf } from '@/src/workspaces/reads';

export const metadata = { title: 'Workspace' };

// A workspace (DESIGN.md §13, §17.11). Whether it is there for this account is decided by the server, in the statement that reads it: one that does not
// exist and one that is someone else's are the same 404.
export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const accountId = await requireAccount();
  const { id } = await params;
  if (!uuid(id).ok) notFound();
  const workspace = await workspaceOf(await getDatabase(), accountId, id);
  if (!workspace) notFound();
  return <WorkspaceScreen workspace={workspace} />;
}
