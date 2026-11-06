import { describe, expect, it } from 'vitest';
import type { WorkspaceRow } from '../workspaces/format';
import { showing, sorted } from './optimistic';

const row = (id: string, name: string, role: 'owner' | 'member' = 'owner'): WorkspaceRow => ({
  id,
  name,
  role,
  createdAt: 1,
  updatedAt: 1,
});

describe('what a workspace operation shows before the server answers', () => {
  const list = [row('a', 'Acme'), row('c', 'Club', 'member')];

  it('adds a workspace made, as its owner and in its place by name', () => {
    const next = showing(list, { op: 'workspace.create', id: 'b', name: 'Book club' }, 9);
    expect(next.map((each) => each.id)).toEqual(['a', 'b', 'c']);
    expect(next[1]).toMatchObject({ role: 'owner', createdAt: 9, updatedAt: 9 });
  });

  it('renames, moves it to where the new name sorts, and leaves the others as they were', () => {
    const next = showing(list, { op: 'workspace.rename', id: 'a', name: 'Zed' }, 9);
    expect(next.map((each) => each.name)).toEqual(['Club', 'Zed']);
    expect(next[0]).toBe(list[1]);
    expect(next[1]).toMatchObject({ updatedAt: 9, role: 'owner' });
  });

  it('removes a workspace deleted, and does nothing for one it does not have', () => {
    expect(showing(list, { op: 'workspace.delete', id: 'a', name: 'Acme' }, 9)).toEqual([list[1]]);
    expect(showing(list, { op: 'workspace.delete', id: 'zz', name: 'x' }, 9)).toEqual(list);
  });

  it('does not change the list it was given', () => {
    const copy = JSON.stringify(list);
    showing(list, { op: 'workspace.create', id: 'b', name: 'B' }, 1);
    showing(list, { op: 'workspace.delete', id: 'a', name: 'Acme' }, 1);
    expect(JSON.stringify(list)).toBe(copy);
  });

  it('sorts as a person reads: case and accents do not decide, and 2 comes before 10', () => {
    expect(
      sorted([row('1', 'team 10'), row('2', 'Éclair'), row('3', 'team 2'), row('4', 'apple')]).map(
        (each) => each.name,
      ),
    ).toEqual(['apple', 'Éclair', 'team 2', 'team 10']);
  });
});
