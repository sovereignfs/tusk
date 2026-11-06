'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type Identity, readIdentity } from '../identity';
import { DeskScreen } from './DeskScreen';
import { ListScreen } from './ListScreen';
import { SignedInArea } from './SignedInArea';
import styles from './ListScreen.module.css';

/**
 * The Desk with no server document (DESIGN.md §17.9). The service worker answers a Desk address with the one page it keeps, `/shell`, which holds nothing
 * of a person and is the same for everyone; this is what that page is. It finds who is signed in on the device (`src/identity.ts`), makes the same
 * composition the server's layout makes, and **chooses the screen from the address**, since the page it came in is not the page of the address:
 * `/desk/<list>` is that list and anything else the Desk's first. The Desk's screens read the working copy and write through `commit`, so they need none of the
 * server.
 */
const LIST = /^\/desk\/([0-9a-f-]{36})$/;

export function OfflineApp() {
  const pathname = usePathname();
  // Not known until the page is in the browser: the server renders nothing of a person.
  const [who, setWho] = useState<Identity | null | undefined>(undefined);
  useEffect(() => setWho(readIdentity()), []);

  if (who === undefined) return null;
  if (who === null)
    return (
      <main className={styles.muted} style={{ padding: 'var(--sv-space-6)' }}>
        <p>Sign in to use Tusk. This needs a connection.</p>
        <p>
          <Link href="/sign-in">Sign in</Link>
        </p>
      </main>
    );
  const list = LIST.exec(pathname)?.[1];
  return (
    <SignedInArea accountId={who.id} name={who.name} email={who.email}>
      {list ? <ListScreen listId={list} /> : <DeskScreen />}
    </SignedInArea>
  );
}
