'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { leaveDevice } from '../../sync/signout';
import { useOptionalSync } from '../../sync/react';
import { ConfirmDialog, UserMenu } from '../../ui';
import { authClient } from '../client';

/**
 * The avatar menu at the right of the header: who the person is (name and address) and *Sign out*. Signing out leaves this device (`leaveDevice`): it
 * sends what it can, asks before it throws away what it cannot, ends the session, and deletes this person's tasks from the device. Settings joins this
 * menu with task 2.7.
 */
export function AccountMenu({
  accountId,
  name,
  email,
}: {
  accountId: string;
  name: string;
  email: string;
}) {
  const client = useOptionalSync();
  const router = useRouter();
  // The dialog is a promise the flow awaits: it resolves true to leave anyway and false to stay.
  const [unsent, setUnsent] = useState<number | null>(null);
  const answer = useRef<(leave: boolean) => void>(() => undefined);
  const [offline, setOffline] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    setOffline(false);
    setLeaving(true);
    const channel = new BroadcastChannel(`tusk-${accountId}`);
    const result = await leaveDevice({
      accountId,
      client: client ?? undefined,
      confirmLosing: (count) =>
        new Promise<boolean>((resolve) => {
          answer.current = resolve;
          setUnsent(count);
        }),
      endSession: async () => {
        const { error } = await authClient.signOut();
        // A session that is already gone is as signed out as one that was just ended; only a failure to reach the server is a failure.
        if (error && error.status !== 401) throw new Error('could not sign out');
      },
      announce: () => channel.postMessage({ type: 'left' }),
    });
    channel.close();
    setUnsent(null);
    setLeaving(false);
    if (result.status === 'left') window.location.assign('/');
    if (result.status === 'offline') setOffline(true);
  }

  return (
    <>
      <UserMenu
        name={name}
        email={email}
        size="sm"
        aria-label="User menu"
        items={[
          // A soft navigation, so that Settings is a dialog over this page and not a page that replaces it (`app/(app)/@modal/(.)account`).
          { label: 'Settings', icon: 'settings', onSelect: () => router.push('/account') },
          {
            label: leaving ? 'Signing out…' : 'Sign out',
            icon: 'log-out',
            destructive: true,
            onSelect: () => void signOut(),
          },
        ]}
      />
      <ConfirmDialog
        open={unsent !== null}
        onClose={() => answer.current(false)}
        onConfirm={() => answer.current(true)}
        title="Some changes have not been sent"
        message={
          <>
            {unsent === 1 ? '1 change' : `${unsent ?? 0} changes`} on this device could not be sent,
            and will be lost if you sign out. Stay signed in and they will be sent when you are back
            online.
          </>
        }
        confirmLabel="Sign out anyway"
        cancelLabel="Stay signed in"
        destructive
      />
      <ConfirmDialog
        open={offline}
        onClose={() => setOffline(false)}
        onConfirm={() => void signOut()}
        title="You are offline"
        message="Signing out needs a connection, so that no one else can use your session. Your tasks stay on this device until it is done."
        confirmLabel="Try again"
        cancelLabel="Not now"
      />
    </>
  );
}
