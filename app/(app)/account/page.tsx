import { AccountPanel } from '@/src/account/AccountPanel';
import { one } from '@/src/account/query';
import { requireAccount } from '@/src/auth/session';

export const metadata = { title: 'Settings' };

/**
 * Settings at an address of its own (DESIGN.md §19): reached directly, by a bookmark or a refresh. From a page of the app, the menu's *Settings* is a soft
 * navigation here that is intercepted and shown as a dialog over that page instead (`app/(app)/@modal/(.)account`); the content is the same.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccount();
  const query = await searchParams;
  return <AccountPanel query={{ section: one(query.section) }} />;
}
