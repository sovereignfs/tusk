# Epic 3: Lists and tasks

## Status

📋 Planned

## Overview

The product: one person's lists and tasks, with the access rule that closes the plugin's worst flaw built first, so that nothing is written without it.

## Related

[`DESIGN.md`](../../DESIGN.md) §7, §8, §9, §13.6

## Tasks

#### 📋 3.1 — Access rules and input parsing

**Goal:** the machinery that makes "the owner in every statement" hard to get wrong, before there is anything to get wrong.

**Design:** §7. **Depends on:** 1.5, 2.1.

**Technical:**
- `src/access/routes.ts`: every page, route and action with who may use it. `routes.test.ts` walks `app/` and the action modules and fails on anything unlisted.
- `src/access/action.ts`: `action(parse, fn)` wraps every server action: finds the session, parses input, calls `fn(accountId, input)`, and returns a result (`ok`, `not_found`, `invalid`, `limit`). Nothing is exported from an action file except through it.
- `src/access/parse.ts`: small parsers, no new dependency: `uuid`, `text(min, max)`, `isoDate`, `hhmm`, `idArray(max 500)`.
- `src/access/two-accounts.ts`: a test helper seeding two accounts, used by every store test to call as the wrong one.
- `requireSameOrigin` for route handlers that change something, against `TASKS_URL`.

**Accepts when:** an action not going through the wrapper fails a test; a route not listed fails a test; an unparsable id is `invalid` and reaches no statement.

#### 📋 3.2 — Positions

**Goal:** order that writes one row per move.

**Design:** §9.3, §19.2. **Depends on:** 1.5.

**Technical:** `src/position.ts` wraps `fractional-indexing` (CC0): `first()`, `before(a)`, `after(a)`, `between(a, b)`. Pure. Its alphabet is digits, upper case, lower case, which is byte order, and why §19.2 needs `COLLATE "C"`. On `a === b` (two clients both inserting), it re-derives from the neighbours; a `normalise(rows)` exists only for import.

**Accepts when:** a property test over random sequences of inserts keeps order in JavaScript and through `ORDER BY` on all three databases; keys stay short across 10,000 inserts at the top; `between` with equal keys does not throw.

#### 📋 3.3 — Lists

**Goal:** create, rename, recolour, delete and reorder lists.

**Design:** §8. **Depends on:** 3.1, 3.2, 7.1.

**Technical:**
- `list` table and migrations. `src/tasks/lists.ts`: `listLists(accountId)` with open counts from one `GROUP BY`; `createList`, `renameList`, `setColor`, `moveList`, `deleteList`; `ensureFirstList(accountId)` for *My tasks*, safe to race. Limit of 200.
- `src/tasks/colors.ts`: the six swatches to `--sv-*` tokens; a `CHECK` repeats them.
- Actions, the sidebar, `/lists/<id>`, a list's `not-found`. Rename by double-click or the menu; `ConfirmDialog` on delete naming the open count. Drag through `@dnd-kit`, with an explicit `DndContext` `id`.

**Accepts when:** all of it works in a browser; the wrong account gets `not_found` from each action, with nothing changed; the 201st list is refused; counts include only top-level open tasks of this account.

#### 📋 3.4 — Tasks

**Goal:** add, edit, complete, reopen and delete a task.

**Design:** §9.1. **Depends on:** 3.3.

**Technical:**
- `task` table with `owner_id` and the `CHECK`s of §19.3; indexes for open tasks by list and position. `src/tasks/tasks.ts`: `listTasks`, `getTask`, `createTask` (top of the list), `updateTask`, `completeTask`, `reopenTask`, `deleteTask`. Each names `owner_id` in the statement. `completeTask` guarded with `completed_at IS NULL`, so that a double-tap does one thing.
- Limit of 5,000 open tasks a list; title and notes limits, in parser and `CHECK`.
- Every action returns the rows it changed, for the client store (7.1).
- A row and the add input; `?task=<id>` opens the detail, which saves as you leave a field; a stale id shows nothing rather than failing.

**Accepts when:** keyboard capture works (Enter adds, focus stays); reload shows what was saved; a test proves the plugin's flaw is gone: another account's task id with one's own list id changes nothing; a task's detail is linkable and reloadable.

#### 📋 3.5 — Subtasks

**Goal:** one level of subtasks, held by the statement and the schema.

**Design:** §9.2. **Depends on:** 3.4.

**Technical:** `createSubtask`: `INSERT ... SELECT` from a parent that belongs to the account, is top-level and not deleted, taking its list, and no row means refused. `CHECK` refuses a date, star or series on a subtask. Completing a parent sets `completed_at` on its open subtasks only, in one transaction. Reopening a parent reopens nothing; ticking the last does not complete the parent. A progress ring on the row, and a list in the detail, ordered by position.

**Accepts when:** a subtask of a subtask is refused at the store whatever is sent; completing a parent leaves earlier completion times alone; counts on a row match the rows.

#### 📋 3.6 — Manual order

**Goal:** drag tasks into order, correctly, under filters.

**Design:** §9.3, §13.7. **Depends on:** 3.2, 3.4.

**Technical:** `moveTask(accountId, id, beforeId, afterId)` computes a position between the given neighbours **as rendered**, writing one row. Subtasks too, within their parent. Available only under Custom. `@dnd-kit` with the sensors of `src/ui/dnd.ts` and `autoScroll` restricted to vertical containers from the start (§13.7). The dropped row stays where it landed until the action answers, with no snap back.

**Accepts when:** a drag under a filter lands between the rows it was dropped between; the unseen rows' order is unchanged; only one row is written; keyboard reordering works through `KeyboardSensor`.

#### 📋 3.7 — Undo and purge

**Goal:** every delete can be undone, and nothing lingers.

**Design:** §9.5. **Depends on:** 1.6, 3.3, 3.4.

**Technical:** `deleted_at` on `list` and `task`; deleting a list marks it and reads hide its tasks; `restoreList`, `restoreTask`. Deleting a parent marks its subtasks with the same time, so restore brings back exactly those. A toast with Undo for about ten seconds. A `purge` job (1.6), hourly: hard-deletes what was marked over seven days ago, with its subtasks and empty series. All reads go through helpers in the store that exclude it; a test lists every `select` from the two tables through them.

**Accepts when:** Undo restores a list with its tasks, and a task with its subtasks, exactly as they were; subtasks deleted earlier stay deleted; the job purges at seven days and not before; deleted rows never appear in a list, count, search or export.

#### 📋 3.8 — Moving a task to another list

**Goal:** a task and its subtasks move together.

**Design:** §9.1. **Depends on:** 3.5.

**Technical:** `moveToList(accountId, id, toListId)`: one transaction, both lists named with the owner; the task takes a position at the top of the destination, subtasks keep theirs. A control in the detail.

**Accepts when:** the subtasks move with it; a destination of another account's is `not_found`, with nothing changed.

#### 📋 3.9 — Filter, sort and completed

**Goal:** seeing a list the way one wants, remembered.

**Design:** §9.4. **Depends on:** 3.4.

**Technical:** `sort` and `show_completed` on `list`, saved by action. Filters All, Active and Overdue (Overdue arrives with 4.3). A collapsible Completed section, newest first. Deleting a list's completed tasks from its menu, with Undo. `src/tasks/sort.ts` is pure. Drag handles are hidden under any sort but Custom, and a drag no-ops there.

**Accepts when:** sort and the section's state survive a reload, per list; a sort other than Custom cannot reorder.

#### 📋 3.10 — Star

**Goal:** mark a task.

**Design:** §9.1. **Depends on:** 3.4.

**Technical:** `starred` column; `setStarred`; a star on the row and in the detail, its own click target. `CHECK` keeps it off subtasks. Applies at once, reconciled by 7.1.

**Accepts when:** a star survives a reload; a subtask cannot be starred.

#### 📋 3.11 — Bulk select

**Goal:** act on several tasks at once.

**Design:** §13.6. **Depends on:** 3.7, 3.8, 7.4.

**Technical:** selection by ctrl- or cmd-click, or long press from 7.4. `BulkActionBar`: count, Complete, Move to list, Delete, Cancel; `Esc` clears. Actions take an id array capped at 500, run in one transaction, with the owner in every statement. A repeating task completed in bulk makes its next. Delete gives one Undo for the whole selection.

**Accepts when:** an id of another account's in the array changes nothing of theirs; it is one transaction, so a failure changes nothing; Undo restores all.
