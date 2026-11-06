import type { WorkspaceRow, WorkspaceSort } from '../workspaces/format';

/**
 * The order of the boards index (DESIGN.md §17.3). A person's own workspaces go by what they chose: by name (case and accents do not decide, and 2 comes
 * before 10), by when they were made (the newest first), or by when anything in them last changed (the most recent first). Those shared with them are by
 * name, whatever was chosen. Pure. A tie is broken by name and then id, so that the order never shuffles.
 */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const byName = (a: WorkspaceRow, b: WorkspaceRow) =>
  collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function sortWorkspaces(rows: readonly WorkspaceRow[], sort: WorkspaceSort): WorkspaceRow[] {
  const copy = [...rows];
  if (sort === 'created') return copy.sort((a, b) => b.createdAt - a.createdAt || byName(a, b));
  if (sort === 'updated') return copy.sort((a, b) => b.updatedAt - a.updatedAt || byName(a, b));
  return copy.sort(byName);
}

/** The two sections: those the person owns, sorted as chosen, and those shared with them, by name. */
export function sections(
  rows: readonly WorkspaceRow[],
  sort: WorkspaceSort,
): { mine: WorkspaceRow[]; shared: WorkspaceRow[] } {
  return {
    mine: sortWorkspaces(
      rows.filter((each) => each.role === 'owner'),
      sort,
    ),
    shared: sortWorkspaces(
      rows.filter((each) => each.role !== 'owner'),
      'name',
    ),
  };
}
