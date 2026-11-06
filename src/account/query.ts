/**
 * Which part of Settings an address asks for (DESIGN.md §19): `/account?section=security`. Pure, so that what a stray or hostile address does is tested
 * with no browser. Only sections that exist can be asked for: Notifications and Activity join with the tasks that fill them (8.1, 17.6), and an address that
 * names one of those, or nothing, opens Profile.
 */
export const SECTIONS = ['profile', 'security', 'preferences', 'data'] as const;
export type AccountSection = (typeof SECTIONS)[number];

export interface AccountQuery {
  section?: string | undefined;
}

export function sectionOf(query: AccountQuery): AccountSection {
  const asked = query.section;
  return (SECTIONS as readonly string[]).includes(asked ?? '')
    ? (asked as AccountSection)
    : 'profile';
}

/** The first value of a search parameter, which is all one of ours is. */
export const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;
