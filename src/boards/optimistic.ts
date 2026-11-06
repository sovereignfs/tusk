import type { Op, WorkspaceRow } from '../workspaces/format';

/**
 * What a screen shows of a workspace operation before the server has answered (DESIGN.md §14.7): the same change the server will make, to the list the
 * screen holds. Pure, so that it is tested with no browser. The server's answer replaces what this guessed.
 */
export function showing(
  workspaces: readonly WorkspaceRow[],
  request: Op,
  now: number,
): WorkspaceRow[] {
  switch (request.op) {
    case 'workspace.create':
      return sorted([
        ...workspaces.filter((each) => each.id !== request.id),
        { id: request.id, name: request.name, role: 'owner', createdAt: now, updatedAt: now },
      ]);
    case 'workspace.rename':
      return sorted(
        workspaces.map((each) =>
          each.id === request.id ? { ...each, name: request.name, updatedAt: now } : each,
        ),
      );
    case 'workspace.delete':
      return workspaces.filter((each) => each.id !== request.id);
    // Nothing about people is guessed. Leaving is *not* shown at once, as a delete is: it can be refused (the last owner may not leave), and the screen
    // that is showing the workspace would have gone with it. The list is changed when the server has said yes.
    case 'member.leave':
    case 'member.add':
    case 'member.setRole':
    case 'member.remove':
      return [...workspaces];
  }
}

/** By name, as the server lists them (case and accents do not decide), and by id for a tie. */
export function sorted(workspaces: readonly WorkspaceRow[]): WorkspaceRow[] {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return [...workspaces].sort((a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
}
