import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { LIMITS } from '../sync/format';
import { parseMutation } from '../sync/validate';
import type { Ids } from './lists';
import { type Group, deleteMany, restoreMany } from './tasks';

let n = 0;
const ids: Ids = { newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
const uuid = (i: number) => `70000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const task = (i: number, extra: Record<string, unknown> = {}): LocalRow =>
  ({
    table: 'task',
    id: uuid(i),
    listId: uuid(0),
    parentId: null,
    position: 'a0',
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: { title: { v: 't', s: 1 } },
    ...extra,
  }) as LocalRow;

describe('acting on many tasks at once', () => {
  it('deletes each with its live subtasks, in one mutation when they fit', () => {
    const groups: Group[] = [
      {
        task: task(1),
        subtasks: [task(2, { parentId: uuid(1) }), task(3, { parentId: uuid(1), deletedAt: 9 })],
      },
      { task: task(4), subtasks: [] },
    ];
    const result = deleteMany(groups, ids);
    if (!result.ok) throw new Error('nothing');
    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0]?.changes.map((c) => c.id)).toEqual([uuid(1), uuid(2), uuid(4)]);
    expect(parseMutation(result.mutations[0]).ok).toBe(true);
  });

  it('splits a long list into mutations the server takes, and never a parent from its subtasks', () => {
    // 300 parents of two subtasks each: 900 changes.
    const groups: Group[] = Array.from({ length: 300 }, (_, i) => ({
      task: task(1000 + i * 3),
      subtasks: [
        task(1001 + i * 3, { parentId: uuid(1000 + i * 3) }),
        task(1002 + i * 3, { parentId: uuid(1000 + i * 3) }),
      ],
    }));
    const result = deleteMany(groups, ids);
    if (!result.ok) throw new Error('nothing');
    expect(result.mutations.length).toBeGreaterThan(1);
    for (const m of result.mutations) {
      expect(m.changes.length).toBeLessThanOrEqual(LIMITS.changes);
      expect(parseMutation(m).ok).toBe(true);
      // Every subtask is in the mutation of its parent: the ids in threes, parent first.
      const sequence = m.changes.map((c) => Number(c.id.slice(-12)));
      for (let i = 0; i < sequence.length; i += 3) {
        expect(sequence[i]).toBe(1000 + Math.floor(((sequence[i] ?? 0) - 1000) / 3) * 3);
        expect(sequence[i + 1]).toBe((sequence[i] ?? 0) + 1);
        expect(sequence[i + 2]).toBe((sequence[i] ?? 0) + 2);
      }
    }
    expect(result.mutations.flatMap((m) => m.changes)).toHaveLength(900);
    expect(new Set(result.mutations.map((m) => m.mutationId)).size).toBe(result.mutations.length);
  });

  it('has nothing to do for nothing', () => {
    expect(deleteMany([], ids)).toEqual({ ok: false, reason: 'nothing' });
    expect(restoreMany([], ids)).toEqual({ ok: false, reason: 'nothing' });
  });

  it('restores exactly those that were deleted with each parent', () => {
    const parent = task(1, { deletedAt: 5_000 });
    const groups: Group[] = [
      {
        task: parent,
        subtasks: [
          task(2, { parentId: uuid(1), deletedAt: 5_000 }),
          task(3, { parentId: uuid(1), deletedAt: 1_000 }),
        ],
      },
    ];
    const result = restoreMany(groups, ids);
    if (!result.ok) throw new Error('nothing');
    expect(result.mutations[0]?.changes).toEqual([
      { table: 'task', id: uuid(1), deleted: false },
      { table: 'task', id: uuid(2), deleted: false },
    ]);
  });
});
