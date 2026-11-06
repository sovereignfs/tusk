'use client';

import { useEffect } from 'react';
import { browserZone } from '../time';

/**
 * Reports the browser's time zone to the account (DESIGN.md §11), so that the server's jobs agree with the person's own clock. It is sent when it is not
 * what this browser last reported **for this account**, and not on every load; one that could not be sent is tried again on the next. Nothing is shown.
 * In the browser itself the zone is always the browser's, so the screen needs none of this.
 */
export function ZoneReporter({ accountId }: { accountId: string }) {
  useEffect(() => {
    const zone = browserZone();
    const key = `tusk.zone.${accountId}`;
    try {
      if (window.localStorage.getItem(key) === zone) return;
    } catch {
      // Storage is not there: it is reported on every load, which is a small request.
    }
    void (async () => {
      try {
        const reply = await fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ timeZone: zone }),
        });
        if (reply.ok) window.localStorage.setItem(key, zone);
      } catch {
        // Offline, or no storage: the next load tries again.
      }
    })();
  }, [accountId]);
  return null;
}
