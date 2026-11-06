import { notFound } from 'next/navigation';
import { uuid } from '@/src/access/parse';
import { requireAccount } from '@/src/auth/session';
import { getDatabase } from '@/src/db/boot';
import { CardDialog } from '@/src/screens/CardDialog';
import { cardDetail } from '@/src/workspaces/reads';

export const metadata = { title: 'Card' };

// A card, as a dialog over its board (DESIGN.md §17.6), at an address of its own so that it can be linked to and reloaded. A card on a board that is not
// the person's, one that never was, one of another board than the address names, and an id that is not an id are the same 404.
export default async function CardPage({
  params,
}: {
  params: Promise<{ id: string; cardId: string }>;
}) {
  const accountId = await requireAccount();
  const { id, cardId } = await params;
  if (!uuid(id).ok || !uuid(cardId).ok) notFound();
  const detail = await cardDetail(await getDatabase(), accountId, cardId);
  if (!detail || detail.boardId !== id) notFound();
  return <CardDialog detail={detail} />;
}
