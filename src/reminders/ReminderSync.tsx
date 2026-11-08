'use client';

import { useEffect, useRef, useState } from 'react';
import { visibleCards } from '../local/store';
import { cipherOf } from '../local/seal';
import { useKey } from '../screens/KeyContext';
import { useSync } from '../sync/react';
import { slotsFor } from './plan';
import { forgetWake, keepWake, wakeChosen } from './wake';

/** What the other parts of the app say to this one when a setting that it reads has changed (Settings, Notifications). */
export const SETTINGS_CHANGED = 'tusk-settings-changed';

interface Read {
  remindersOn: boolean;
  timeZone: string;
}

const REPLAN_MS = 60 * 60 * 1000;
const QUIET_MS = 3000;

/**
 * Reminders for a Desk the server cannot read (DESIGN.md §25.2, task 14.6), from the browser's side; it draws nothing. **Only while this device has the key**, since only then
 * can the Desk be read:
 *
 *  - **the times**: when the working copy changes (and every hour, as the fortnight moves on), the instants at which an open card with a date and a time is due are worked
 *    out (`slotsFor`) and sent, whole, if they are not what was last sent. Only the instants go (`PUT /api/reminders/slots`); a card, a title and a count do not. With
 *    reminders turned off nothing is planned, and what was sent is replaced with nothing.
 *  - **the keys**: if the person chose, on this device, to have the card named in a reminder, the Desk's list keys are given to the service worker (`wake.ts`); otherwise,
 *    and whenever the Desk is locked or has no key, what it was given is taken back.
 *
 * Nothing here waits for the network to be right: a failed upload is tried at the next change or the next hour, and the Desk never shows it.
 */
export function ReminderSync({ accountId }: { accountId: string }) {
  const client = useSync();
  const key = useKey();
  const [settings, setSettings] = useState<Read | null>(null);
  const [chosen, setChosen] = useState(() => wakeChosen(accountId));
  const sent = useRef<string | undefined>(undefined);

  // The account's settings: when this starts, when the tab is looked at again, and when Settings says it changed one.
  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const reply = await fetch('/api/settings', { cache: 'no-store' });
        if (!reply.ok) return;
        const body = (await reply.json()) as Read;
        if (alive) setSettings({ remindersOn: body.remindersOn, timeZone: body.timeZone });
      } catch {
        // Offline: what was known stays.
      }
      if (alive) setChosen(wakeChosen(accountId));
    };
    void read();
    const onVisible = () => document.visibilityState === 'visible' && void read();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(SETTINGS_CHANGED, read);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(SETTINGS_CHANGED, read);
    };
  }, [accountId]);

  const ready = key.status === 'unlocked' && key.sealed && !key.moving && settings !== null;
  const remindersOn = settings?.remindersOn === true;
  const zone = settings?.timeZone ?? 'UTC';

  useEffect(() => {
    // Not decided yet: nothing is sent and nothing is taken back until it is known what this device has.
    if (key.status === 'loading') return undefined;
    if (!ready) {
      sent.current = undefined;
      // No key on this device (or a Desk with none): the service worker is given nothing.
      void forgetWake();
      return undefined;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const upload = async () => {
      const cards = await client.read((db) => visibleCards(db));
      const plan = remindersOn ? slotsFor(cards, zone, Date.now()) : [];
      const signature = JSON.stringify(plan);
      if (signature === sent.current) return;
      // Nothing planned and nothing ever sent from here: there is nothing to replace.
      if (plan.length === 0 && sent.current === undefined) {
        sent.current = signature;
        return;
      }
      const reply = await fetch('/api/reminders/slots', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slots: plan }),
      });
      if (reply.ok) sent.current = signature;
    };

    const keys = async () => {
      if (!chosen) return void (await forgetWake());
      const cipher = cipherOf(client.db);
      const list = cipher ? await cipher.listKeys(client.db) : [];
      if (list.length === 0) return void (await forgetWake());
      await keepWake({ accountId, zone, keys: list });
    };

    const run = () => {
      if (!alive) return;
      void upload().catch(() => undefined);
      void keys().catch(() => undefined);
    };
    run();
    const quiet = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, QUIET_MS);
    };
    const stop = client.subscribe(quiet);
    const hourly = setInterval(run, REPLAN_MS);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      clearInterval(hourly);
      stop();
    };
  }, [accountId, chosen, client, key.status, ready, remindersOn, zone]);

  return null;
}
