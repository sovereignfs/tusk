import { requireSession } from '../auth/session';
import { authSettings } from '../auth/server';
import { AccountShell } from './AccountShell';
import { DataSection } from './DataSection';
import { PreferencesSection } from './PreferencesSection';
import { ProfileSection } from './ProfileSection';
import { type AccountQuery, sectionOf } from './query';
import { SecuritySection } from './SecuritySection';

/**
 * Settings, in one place (DESIGN.md §19), as a dialog over the page it was opened from or at an address of its own. The sections are server-rendered and
 * handed to the shell, which only shows the one that is open.
 */
export async function AccountPanel({ query }: { query: AccountQuery }) {
  const { user } = await requireSession();
  const minLength = authSettings()?.passwordMinLength ?? 10;
  return (
    <AccountShell
      initial={sectionOf(query)}
      panels={{
        profile: <ProfileSection name={user.name} email={user.email} />,
        security: <SecuritySection passwordMinLength={minLength} />,
        preferences: <PreferencesSection />,
        data: <DataSection />,
      }}
    />
  );
}
