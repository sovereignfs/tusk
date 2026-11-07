import { requireSession } from '../auth/session';
import { authSettings } from '../auth/server';
import { AccountShell } from './AccountShell';
import { ActivitySection } from './ActivitySection';
import { DataSection } from './DataSection';
import { NotificationsSection } from './NotificationsSection';
import { PreferencesSection } from './PreferencesSection';
import { ProfileSection } from './ProfileSection';
import { type AccountQuery, sectionOf } from './query';
import { SecuritySection } from './SecuritySection';
import { signInsOf } from './sign-ins';

/**
 * Settings, in one place (DESIGN.md §19), as a dialog over the page it was opened from or at an address of its own. The sections are server-rendered and
 * handed to the shell, which only shows the one that is open.
 */
export async function AccountPanel({ query }: { query: AccountQuery }) {
  const { user } = await requireSession();
  const settings = authSettings();
  const minLength = settings?.passwordMinLength ?? 10;
  const signIns = await signInsOf(user.id);
  return (
    <AccountShell
      initial={sectionOf(query)}
      panels={{
        profile: <ProfileSection name={user.name} email={user.email} />,
        security: (
          <SecuritySection
            passwordMinLength={minLength}
            hasPassword={signIns.hasPassword}
            sovereign={
              settings?.sovereign ? { linkedAccountId: signIns.sovereignAccountId } : undefined
            }
            email={user.email}
            result={{
              linked: query.linked === '1',
              unlinked: query.unlinked === '1',
              error: query.error ?? null,
            }}
          />
        ),
        preferences: <PreferencesSection />,
        notifications: <NotificationsSection />,
        activity: <ActivitySection />,
        data: <DataSection />,
      }}
    />
  );
}
