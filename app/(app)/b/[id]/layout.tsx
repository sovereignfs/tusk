import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { uuid } from '@/src/access/parse';
import { requireAccount } from '@/src/auth/session';
import { getDatabase } from '@/src/db/boot';
import { BoardScreen } from '@/src/screens/BoardScreen';
import { readBoard } from '@/src/workspaces/reads';

// A board (DESIGN.md §14, §17.5), and whatever its address shows over it. **The board is the layout**, so that it stays mounted, with what it holds in
// memory, while a card's dialog opens and closes over it: the dialog is the page of `/b/<id>/c/<card>`. Whether the board is there for this account is
// decided by the server, in the statement that reads it: a private board of someone else's workspace, one that never was and an id that is not an id
// are the same 404.
export default async function BoardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const accountId = await requireAccount();
  const { id } = await params;
  if (!uuid(id).ok) notFound();
  const view = await readBoard(await getDatabase(), accountId, id);
  if (!view) notFound();
  return <BoardScreen initial={view}>{children}</BoardScreen>;
}
