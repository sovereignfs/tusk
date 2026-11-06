import type { ReactNode } from 'react';
import { requireSession } from '@/src/auth/session';
import { SignedInArea } from '@/src/screens/SignedInArea';

// Everything for someone who is signed in (DESIGN.md §17.2): the session is checked here, and the composition is `SignedInArea`, which the offline shell
// makes too. A page inside is a client component over the working copy (`useLocal`), and writes through `commit`; nothing in it waits for the network.
export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
  modal,
}: {
  children: ReactNode;
  /** The dialog slot (`app/(app)/@modal`): empty, unless a page opened Settings as one. */
  modal: ReactNode;
}) {
  const session = await requireSession();
  return (
    <SignedInArea
      accountId={session.user.id}
      name={session.user.name}
      email={session.user.email}
      modal={modal}
    >
      {children}
    </SignedInArea>
  );
}
