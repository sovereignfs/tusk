import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import type { LocalRow } from '../local/rows';
import { LIMITS, type Mutation } from '../sync/format';
import { applyMutation } from '../sync/apply';
import { account, makeStore, rowOf, snapshot } from '../sync/test-support';
import { parseMutation } from '../sync/validate';
import type { ActionResult, Ids } from './lists';
import {
  completeTask,
  createSubtask,
  createTask,
  deleteTask,
  isCompleted,
  reopenTask,
  restoreTask,
  updateTask,
} from './tasks';

const { leg } = testTarget();

function counting(): Ids {
  let n = 0;
  return { newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
}
const LIST = '10000000-0000-4000-8000-000000000001';
const T1 = '20000000-0000-4000-8000-000000000001';

const task = (
  id: string,
  position: string,
  fields: Record<string, { v: unknown; s: number }> = {},
): LocalRow =>
  ({
    table: 'task',
    id,
    listId: LIST,
    parentId: null,
    position,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: { title: { v: 'Buy milk', s: 1 }, ...fields },
  }) as LocalRow;

const mutationOf = (result: ActionResult): Mutation => {
  if (!result.ok) throw new Error(`no mutation: ${result.reason}`);
  return result.mutation;
};
const accepted = (result: ActionResult) => expect(parseMutation(mutationOf(result)).ok).toBe(true);

describe('making a task', () => {
  it('goes at the top of the list, with its title trimmed, and is a mutation the server takes', () => {
    const tasks = [task(T1, 'a0'), task('20000000-0000-4000-8000-000000000002', 'a1')];
    const result = createTask(LIST, tasks, { title: '  Water the plants ' }, counting());
    accepted(result);
    const change = mutationOf(result).changes[0] as {
      position: string;
      listId: string;
      parentId: null;
      fields: unknown;
    };
    expect(change).toMatchObject({
      table: 'task',
      listId: LIST,
      parentId: null,
      fields: { title: { v: 'Water the plants' } },
    });
    expect(change.position < 'a0').toBe(true);
  });

  it('is the first position in an empty list, and each new one sorts above the last, however many', () => {
    const empty = mutationOf(createTask(LIST, [], { title: 'First' }, counting())).changes[0] as {
      position: string;
    };
    let top = empty.position;
    for (let i = 0; i < 200; i++) {
      const next = mutationOf(createTask(LIST, [task(T1, top)], { title: `n${i}` }, counting()))
        .changes[0] as { position: string };
      expect(next.position < top).toBe(true);
      top = next.position;
    }
    expect(top.length).toBeLessThan(8);
  });

  it('refuses an empty or too long title, and a full account', () => {
    for (const title of ['', '   ', '\n', 'x'.repeat(LIMITS.titleChars + 1)]) {
      expect(createTask(LIST, [], { title }, counting())).toEqual({ ok: false, reason: 'title' });
    }
    expect(createTask(LIST, [], { title: 'x' }, counting(), LIMITS.tasksPerAccount)).toEqual({
      ok: false,
      reason: 'limit',
    });
    expect(createTask(LIST, [], { title: 'x' }, counting(), LIMITS.tasksPerAccount - 1).ok).toBe(
      true,
    );
  });
});

describe('making tasks in quick succession', () => {
  it('puts each above the last, though the screen has not caught up with the one before', () => {
    // The screen still shows only the first task when the second and third are made.
    const shown = [task(T1, 'a5')];
    let above: string | undefined;
    const made: string[] = [];
    for (let i = 0; i < 5; i++) {
      const change = mutationOf(
        createTask(LIST, shown, { title: `n${i}` }, counting(), shown.length, above),
      ).changes[0] as { position: string };
      made.push(change.position);
      above = change.position;
    }
    expect(made).toEqual([...made].sort().reverse());
    expect(new Set(made).size).toBe(5);
    expect((made[0] as string) < 'a5').toBe(true);
  });

  it('is the screen’s top when that is the higher, and the last one made when the screen is empty', () => {
    expect(
      (
        mutationOf(createTask(LIST, [task(T1, 'a0')], { title: 'x' }, counting(), 1, 'a5'))
          .changes[0] as { position: string }
      ).position < 'a0',
    ).toBe(true);
    expect(
      (
        mutationOf(createTask(LIST, [], { title: 'x' }, counting(), 0, 'a3')).changes[0] as {
          position: string;
        }
      ).position < 'a3',
    ).toBe(true);
  });
});

describe('editing a task', () => {
  const t = task(T1, 'a0', { notes: { v: 'two pints', s: 1 } });

  it('sends only the field that differs', () => {
    expect(
      mutationOf(updateTask(t, { title: 'Buy oat milk', notes: 'two pints' }, counting())).changes,
    ).toEqual([{ table: 'task', id: T1, fields: { title: { v: 'Buy oat milk' } } }]);
    expect(mutationOf(updateTask(t, { notes: 'three pints\n' }, counting())).changes).toEqual([
      { table: 'task', id: T1, fields: { notes: { v: 'three pints\n' } } },
    ]);
    accepted(updateTask(t, { title: 'x', notes: 'y' }, counting()));
  });

  it('does nothing when nothing differs, and refuses a bad title or notes that are too long', () => {
    expect(updateTask(t, { title: ' Buy milk ', notes: 'two pints' }, counting())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(updateTask(t, {}, counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(updateTask(t, { title: '  ' }, counting())).toEqual({ ok: false, reason: 'title' });
    expect(updateTask(t, { notes: 'n'.repeat(LIMITS.notesChars + 1) }, counting())).toEqual({
      ok: false,
      reason: 'title',
    });
    expect(updateTask(task(T1, 'a0'), { notes: '' }, counting())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(updateTask(undefined, { title: 'x' }, counting())).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
});

describe('ticking off', () => {
  it('stamps the time given, and ticking one that is done already does nothing, so a double tap is one thing', () => {
    const open = task(T1, 'a0');
    const first = completeTask(open, 1_800_000_000_000, counting());
    accepted(first);
    expect(mutationOf(first).changes).toEqual([
      { table: 'task', id: T1, fields: { completedAt: { v: 1_800_000_000_000 } } },
    ]);
    const done = task(T1, 'a0', { completedAt: { v: 1_800_000_000_000, s: 2 } });
    expect(completeTask(done, 1_800_000_999_999, counting())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(isCompleted(done)).toBe(true);
    expect(isCompleted(open)).toBe(false);
    expect(isCompleted(task(T1, 'a0', { completedAt: { v: null, s: 2 } }))).toBe(false);
  });

  it('reopens one that is done, and leaves one that is not', () => {
    const done = task(T1, 'a0', { completedAt: { v: 5, s: 2 } });
    expect(mutationOf(reopenTask(done, counting())).changes).toEqual([
      { table: 'task', id: T1, fields: { completedAt: { v: null } } },
    ]);
    accepted(reopenTask(done, counting()));
    expect(reopenTask(task(T1, 'a0'), counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(completeTask(undefined, 1, counting())).toEqual({ ok: false, reason: 'missing' });
    expect(reopenTask(undefined, counting())).toEqual({ ok: false, reason: 'missing' });
  });
});

const sub = (
  id: string,
  position: string,
  parentId: string,
  fields: Record<string, { v: unknown; s: number }> = {},
): LocalRow =>
  ({
    table: 'task',
    id,
    listId: LIST,
    parentId,
    position,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: { title: { v: id, s: 1 }, ...fields },
  }) as LocalRow;
const S1 = '40000000-0000-4000-8000-000000000001';
const S2 = '40000000-0000-4000-8000-000000000002';
const S3 = '40000000-0000-4000-8000-000000000003';

describe('a subtask', () => {
  const parent = task(T1, 'a0');

  it('goes at the bottom of its parent’s subtasks, in the parent’s list, and is a mutation the server takes', () => {
    const subs = [sub(S1, 'a0', T1), sub(S2, 'a1', T1)];
    const result = createSubtask(parent, subs, { title: ' Book the flights ' }, counting());
    accepted(result);
    const change = mutationOf(result).changes[0] as {
      listId: string;
      parentId: string;
      position: string;
      fields: unknown;
    };
    expect(change).toMatchObject({
      table: 'task',
      listId: LIST,
      parentId: T1,
      fields: { title: { v: 'Book the flights' } },
    });
    expect(change.position > 'a1').toBe(true);
    expect(
      (
        mutationOf(createSubtask(parent, [], { title: 'First' }, counting())).changes[0] as {
          position: string;
        }
      ).position,
    ).toBe('a0');
  });

  it('is refused unless the parent is a top-level task that is there', () => {
    expect(createSubtask(sub(S1, 'a0', T1), [], { title: 'x' }, counting())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(createSubtask(undefined, [], { title: 'x' }, counting())).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(
      createSubtask({ ...parent, deletedAt: 5 } as LocalRow, [], { title: 'x' }, counting()),
    ).toEqual({ ok: false, reason: 'missing' });
    expect(
      createSubtask(
        { ...parent, table: 'list' } as unknown as LocalRow,
        [],
        { title: 'x' },
        counting(),
      ),
    ).toEqual({ ok: false, reason: 'missing' });
  });

  it('refuses a bad title and a full account, and each goes below the one made before it', () => {
    expect(createSubtask(parent, [], { title: '  ' }, counting())).toEqual({
      ok: false,
      reason: 'title',
    });
    expect(createSubtask(parent, [], { title: 'x' }, counting(), LIMITS.tasksPerAccount)).toEqual({
      ok: false,
      reason: 'limit',
    });
    let below: string | undefined;
    const made: string[] = [];
    for (let i = 0; i < 5; i++) {
      const change = mutationOf(createSubtask(parent, [], { title: `s${i}` }, counting(), 0, below))
        .changes[0] as { position: string };
      made.push(change.position);
      below = change.position;
    }
    expect(made).toEqual([...made].sort());
    expect(new Set(made).size).toBe(5);
  });

  it('completing the parent completes its open subtasks in the same mutation, and leaves the time of those already done alone', () => {
    const subs = [
      sub(S1, 'a0', T1),
      sub(S2, 'a1', T1, { completedAt: { v: 1_700_000_000_000, s: 2 } }),
      sub(S3, 'a2', T1),
    ];
    const result = completeTask(parent, 1_800_000_000_000, counting(), subs);
    accepted(result);
    const changes = mutationOf(result).changes;
    expect(changes.map((c) => c.id)).toEqual([T1, S1, S3]);
    for (const change of changes)
      expect(change.fields).toEqual({ completedAt: { v: 1_800_000_000_000 } });
    // The one that was done is not in it: its completion time is not touched.
    expect(changes.some((c) => c.id === S2)).toBe(false);
  });

  it('ticking a subtask completes nothing else, the last one included, and reopening a parent reopens nothing', () => {
    const subs = [sub(S1, 'a0', T1, { completedAt: { v: 5, s: 2 } }), sub(S2, 'a1', T1)];
    // The last open subtask ticked: only itself.
    const last = completeTask(subs[1], 9, counting(), []);
    expect(mutationOf(last).changes).toEqual([
      { table: 'task', id: S2, fields: { completedAt: { v: 9 } } },
    ]);
    // Even given subtasks, a subtask has none to complete.
    expect(
      mutationOf(completeTask(subs[1], 9, counting(), [sub(S3, 'a0', S2)])).changes,
    ).toHaveLength(1);
    // Reopening a parent: itself only.
    const done = task(T1, 'a0', { completedAt: { v: 5, s: 2 } });
    expect(mutationOf(reopenTask(done, counting())).changes).toHaveLength(1);
  });

  it('is still one thing when the parent is ticked twice', () => {
    const done = task(T1, 'a0', { completedAt: { v: 5, s: 2 } });
    expect(completeTask(done, 9, counting(), [sub(S1, 'a0', T1)])).toEqual({
      ok: false,
      reason: 'nothing',
    });
  });
});

describe('deleting', () => {
  it('marks the task, and the undo clears it', () => {
    const t = task(T1, 'a0');
    expect(mutationOf(deleteTask(t, counting())).changes).toEqual([
      { table: 'task', id: T1, deleted: true },
    ]);
    expect(mutationOf(restoreTask(t, counting())).changes).toEqual([
      { table: 'task', id: T1, deleted: false },
    ]);
    accepted(deleteTask(t, counting()));
    expect(deleteTask(undefined, counting())).toEqual({ ok: false, reason: 'missing' });
  });
});

describe(`the plugin's flaw is gone (${leg}): another account's task cannot be changed by any of these, by any route`, () => {
  let database: Database;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ database, close } = await makeStore());
  });
  afterAll(async () => close());

  it('is refused, and changes nothing, for each thing a person does to a task', async () => {
    const [ada, grace] = [account(), account()];
    const ids = counting();
    let clock = 1_800_000_000_000;
    const apply = (owner: string, m: Mutation) =>
      applyMutation(database, owner, m, { now: (clock += 1000) });

    const listId = '30000000-0000-4000-8000-000000000001';
    const taskId = '30000000-0000-4000-8000-000000000002';
    await apply(ada, {
      mutationId: ids.newId(),
      changes: [
        { table: 'list', id: listId, position: 'a0', fields: { title: { v: 'Ada' } } },
        { table: 'task', id: taskId, listId, position: 'a0', fields: { title: { v: 'Ada’s' } } },
      ],
    });
    const graceList = '30000000-0000-4000-8000-000000000003';
    await apply(grace, {
      mutationId: ids.newId(),
      changes: [
        { table: 'list', id: graceList, position: 'a0', fields: { title: { v: 'Grace' } } },
      ],
    });
    const before = await snapshot(database, ada);

    // What Grace's screen would produce if it somehow held Ada's task, which it cannot: the actions take no account and so cannot name one, and the
    // server decides whose a row is, by the session.
    const hers = { ...task(taskId, 'a0'), listId } as LocalRow;
    const attempts = [
      updateTask(hers, { title: 'mine now', notes: 'mine' }, ids),
      completeTask(hers, clock, ids),
      deleteTask(hers, ids),
      restoreTask(hers, ids),
      createTask(listId, [], { title: 'into Ada’s list' }, ids),
      createTask(graceList, [], { title: 'x' }, ids),
    ];
    const results = [];
    for (const attempt of attempts.slice(0, 5))
      results.push(await apply(grace, mutationOf(attempt)));
    expect(results.every((r) => r.status === 'refused')).toBe(true);
    expect(await snapshot(database, ada)).toEqual(before);
    expect((await rowOf(database, 'task', taskId))?.deleted_at).toBeNull();
    // Her own list is hers: the last attempt is an ordinary one, and is let through.
    expect((await apply(grace, mutationOf(attempts[5] as ActionResult))).status).toBe('applied');
  });
});
