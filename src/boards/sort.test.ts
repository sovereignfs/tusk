import { describe, expect, it } from 'vitest';
import type { WorkspaceRow } from '../workspaces/format';
import { sections, sortWorkspaces } from './sort';

const row = (
  id: string,
  name: string,
  createdAt: number,
  updatedAt: number,
  role: 'owner' | 'member' = 'owner',
): WorkspaceRow => ({ id, name, role, createdAt, updatedAt });
const rows = [
  row('a', 'Zebra', 3, 10),
  row('b', 'apple', 1, 30),
  row('c', 'Team 10', 2, 20),
  row('d', 'Team 2', 4, 5),
];
const ids = (list: readonly WorkspaceRow[]) => list.map((each) => each.id).join('');

describe('the order of the boards index', () => {
  it('goes by name as a person reads it: case does not decide and 2 comes before 10', () => {
    expect(ids(sortWorkspaces(rows, 'name'))).toBe('bdca');
  });

  it('puts the newest made first, or the most recently changed first, and breaks a tie by name', () => {
    expect(ids(sortWorkspaces(rows, 'created'))).toBe('dacb');
    expect(ids(sortWorkspaces(rows, 'updated'))).toBe('bcad');
    const tied = [row('x', 'Beta', 1, 1), row('y', 'alpha', 1, 1)];
    expect(ids(sortWorkspaces(tied, 'created'))).toBe('yx');
  });

  it('keeps the shared ones by name whatever was chosen, apart from the ones owned', () => {
    const all = [
      ...rows,
      row('e', 'Shared B', 9, 99, 'member'),
      row('f', 'Shared A', 1, 1, 'member'),
    ];
    const split = sections(all, 'updated');
    expect(ids(split.mine)).toBe('bcad');
    expect(ids(split.shared)).toBe('fe');
  });

  it('does not change the list it was given', () => {
    const copy = JSON.stringify(rows);
    sortWorkspaces(rows, 'updated');
    sections(rows, 'created');
    expect(JSON.stringify(rows)).toBe(copy);
  });
});
