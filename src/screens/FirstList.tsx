'use client';

import { useEffect, useRef } from 'react';
import { ensureFirstList } from '../actions/lists';
import { allLists } from '../local/store';
import { useAccountId, useHasSynced, useLocal, useSync } from '../sync/react';

/**
 * Makes *My tasks* for an account that has never had a list, so that there is always somewhere to type (DESIGN.md §10). It waits until this device has
 * heard from the server once, so that a new device does not make one for an account that has lists it has not been sent yet, and the list's id is the
 * account's own, so that two devices that both make it make one row. It renders nothing.
 */
export function FirstList() {
  const client = useSync();
  const accountId = useAccountId();
  const synced = useHasSynced();
  const lists = useLocal(allLists);
  const made = useRef(false);

  useEffect(() => {
    if (made.current || synced === undefined || lists === undefined) return;
    const result = ensureFirstList(accountId, lists, synced, { newId: () => crypto.randomUUID() });
    if (!result.ok) return;
    made.current = true;
    void client.commit(result.mutation);
  }, [accountId, client, lists, synced]);

  return null;
}
