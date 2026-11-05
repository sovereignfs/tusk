import { text as textParser } from '../access/parse';
import type { LocalRow } from '../local/rows';
import { after, before, first } from '../position';
import { LIMITS, type Mutation } from '../sync/format';
import type { ActionResult, Ids } from './lists';

/**
 * What a person does to a task (DESIGN.md §11), as pure functions in the same way as the lists' (`lists.ts`): given what is on the screen and what was
 * asked, each returns the mutation, or why there is none. `now` is a parameter, so that a completion time is not read from a clock in here.
 *
 * `tasks` is the list's top-level tasks **as they are rendered**: live, in order. A new task goes at the top, before whatever is first on the screen.
 */
const TITLE = textParser(1, LIMITS.titleChars);
const NOTES = textParser(0, LIMITS.notesChars);

const mutationOf = (ids: Ids, changes: Mutation['changes']): ActionResult => ({
  ok: true,
  mutation: { mutationId: ids.newId(), changes },
});

const plainOf = (row: LocalRow, name: string) => {
  const field = row.fields[name];
  return field !== undefined && 'v' in field ? field.v : undefined;
};

/** Whether a task is done: it has a completion time. A completion time that is ciphertext cannot be read, and counts as not done until the keys are in place. */
export function isCompleted(task: LocalRow): boolean {
  const done = plainOf(task, 'completedAt');
  return typeof done === 'number';
}

/** A new task at the top of its list. `all` is every task row of the account, which counts against the limit (a deleted one until it is removed). */
export function createTask(
  listId: string,
  tasks: readonly LocalRow[],
  input: { title: string },
  ids: Ids,
  allCount = tasks.length,
  /**
   * A position the new task must also sort above: the one the caller made last. A screen shows what the working copy had a moment ago, so a task added
   * in the instant after another is not yet on it, and "before the first on the screen" would put the two at one place. This is that task's position.
   */
  above?: string,
): ActionResult {
  const title = input.title.trim();
  if (!TITLE(title).ok) return { ok: false, reason: 'title' };
  if (allCount >= LIMITS.tasksPerAccount) return { ok: false, reason: 'limit' };
  const shown = tasks[0] && 'position' in tasks[0] ? tasks[0].position : undefined;
  // The topmost of the two, by bytes.
  const top =
    shown !== undefined && above !== undefined ? (shown < above ? shown : above) : (shown ?? above);
  return mutationOf(ids, [
    {
      table: 'task',
      id: ids.newId(),
      listId,
      parentId: null,
      position: top !== undefined ? before(top) : first(),
      fields: { title: { v: title } },
    },
  ]);
}

/** Changes a task's title and/or notes. Only what differs is sent: a field, not a row, which is what lets two devices' edits to different fields both stand. */
export function updateTask(
  task: LocalRow | undefined,
  patch: { title?: string; notes?: string },
  ids: Ids,
): ActionResult {
  if (!task) return { ok: false, reason: 'missing' };
  const fields: Record<string, { v: string }> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!TITLE(title).ok) return { ok: false, reason: 'title' };
    if (plainOf(task, 'title') !== title) fields.title = { v: title };
  }
  if (patch.notes !== undefined) {
    // Notes are plain text, shown as written: a trailing line break is the person's own and is kept.
    if (!NOTES(patch.notes).ok) return { ok: false, reason: 'title' };
    if ((plainOf(task, 'notes') ?? '') !== patch.notes) fields.notes = { v: patch.notes };
  }
  if (Object.keys(fields).length === 0) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [{ table: 'task', id: task.id, fields }]);
}

/**
 * Ticks a task off at `now`. **Ticking one that is done already does nothing**, so that a double tap does one thing and not two: the second finds the
 * first's completion time and leaves it (DESIGN.md §13.1).
 *
 * Completing a parent is **one mutation** that also completes its **open** subtasks (`subtasks` is the parent's, as rendered): one that is done
 * already keeps the time it was done at, which the plugin overwrote (§11.2). Ticking a subtask, the last one included, completes nothing else:
 * finishing the parts is often not finishing the thing.
 */
export function completeTask(
  task: LocalRow | undefined,
  now: number,
  ids: Ids,
  subtasks: readonly LocalRow[] = [],
): ActionResult {
  if (!task) return { ok: false, reason: 'missing' };
  if (isCompleted(task)) return { ok: false, reason: 'nothing' };
  const changes: Mutation['changes'][number][] = [
    { table: 'task', id: task.id, fields: { completedAt: { v: now } } },
  ];
  const isParent = task.table === 'task' && task.parentId === null;
  if (isParent) {
    for (const sub of subtasks) {
      if (!isCompleted(sub))
        changes.push({ table: 'task', id: sub.id, fields: { completedAt: { v: now } } });
    }
  }
  return mutationOf(ids, changes);
}

/** Un-ticks a task. One that is not done is left alone. **Reopening a parent reopens nothing else** (DESIGN.md §11.2). */
export function reopenTask(task: LocalRow | undefined, ids: Ids): ActionResult {
  if (!task) return { ok: false, reason: 'missing' };
  if (!isCompleted(task)) return { ok: false, reason: 'nothing' };
  return mutationOf(ids, [{ table: 'task', id: task.id, fields: { completedAt: { v: null } } }]);
}

/** Deletes a task, which can be undone with `restoreTask` for as long as the row is kept (DESIGN.md §11.5). */
export function deleteTask(task: LocalRow | undefined, ids: Ids): ActionResult {
  if (!task) return { ok: false, reason: 'missing' };
  return mutationOf(ids, [{ table: 'task', id: task.id, deleted: true }]);
}

export function restoreTask(task: LocalRow | undefined, ids: Ids): ActionResult {
  if (!task) return { ok: false, reason: 'missing' };
  return mutationOf(ids, [{ table: 'task', id: task.id, deleted: false }]);
}

/**
 * A subtask of `parent`, at the bottom of its subtasks (a checklist grows downward; it is a new *task* that goes to the top). **Refused unless the
 * parent is a top-level task** that is still there: one level deep, here and at the server (DESIGN.md §11.2). It takes the parent's list.
 */
export function createSubtask(
  parent: LocalRow | undefined,
  subtasks: readonly LocalRow[],
  input: { title: string },
  ids: Ids,
  allCount = 0,
  /** The position of the subtask made last, for the next to go below while the screen is still catching up with it. */
  below?: string,
): ActionResult {
  if (!parent || parent.table !== 'task' || parent.deletedAt !== null)
    return { ok: false, reason: 'missing' };
  if (parent.parentId !== null) return { ok: false, reason: 'nothing' };
  const title = input.title.trim();
  if (!TITLE(title).ok) return { ok: false, reason: 'title' };
  if (allCount >= LIMITS.tasksPerAccount) return { ok: false, reason: 'limit' };
  const last = subtasks.at(-1);
  const shown = last && 'position' in last ? last.position : undefined;
  const bottom =
    shown !== undefined && below !== undefined ? (shown > below ? shown : below) : (shown ?? below);
  return mutationOf(ids, [
    {
      table: 'task',
      id: ids.newId(),
      listId: parent.listId,
      parentId: parent.id,
      position: bottom !== undefined ? after(bottom) : first(),
      fields: { title: { v: title } },
    },
  ]);
}
