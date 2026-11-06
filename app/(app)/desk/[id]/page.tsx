import { requireAccount } from '@/src/auth/session';
import { ListScreen } from '@/src/screens/ListScreen';

export const metadata = { title: 'List' };

// The list is read from the device by its screen; this only says who may ask (DESIGN.md §17.11).
export default async function ListPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccount();
  const { id } = await params;
  return <ListScreen listId={id} />;
}
