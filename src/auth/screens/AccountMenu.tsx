'use client';

import { authClient } from '../client';
import { UserMenu } from '../../ui';

/**
 * The avatar menu at the right of the header: who the person is (name and address) and *Sign out*. Signing out ends the session and goes to the
 * front page; the rest of what signing out does (the local copy of the person's tasks) is task 13.4. Settings joins this menu with task 2.7.
 */
export function AccountMenu({ name, email }: { name: string; email: string }) {
  return (
    <UserMenu
      name={name}
      email={email}
      size="sm"
      aria-label="User menu"
      items={[
        {
          label: 'Sign out',
          icon: 'log-out',
          destructive: true,
          onSelect: () => {
            void authClient.signOut().finally(() => window.location.assign('/'));
          },
        },
      ]}
    />
  );
}
