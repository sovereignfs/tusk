# Epic 3: Lists and tasks

## Status

📋 Planned

## Overview

The product: one person's lists and tasks. A user action here is a pure function in `src/actions/` that produces changes, committed to the local store and synced (epic 13). The access rule that closes the plugin's worst flaw is built first, so that nothing is written without it.

## Related

[`DESIGN.md`](../../DESIGN.md) §7, §10, §11, §15.6

## Tasks

#### ✅ 3.1 — Access rules and input parsing

**Goal:** the machinery that makes "the owner in every statement" hard to get wrong, before there is anything to get wrong.

**Design:** §7. **Depends on:** 1.5, 2.1.

**Technical:**

- `src/access/routes.ts`: every page and route with who may use it. `routes.test.ts` walks `app/` and fails on anything unlisted.
- `src/access/route.ts`: wraps a route: finds the session, checks `Origin` on a write, and calls the handler with the account id.
- `src/access/parse.ts`: small parsers, no new dependency: `uuid`, `text(min, max)`, `isoDate`, `hhmm`, `idArray(max 500)`. Used in the browser too.
- `src/access/two-accounts.ts`: a test helper seeding two accounts, used by every server test to call as the wrong one.

**Accepts when:** a route not listed fails a test; a handler not going through the wrapper fails a test; an unparsable id reaches no statement.

**Done as:** `src/access/routes.ts` lists the three pages and two routes there are, each `public` or `account`; a public route that changes something carries a `because` naming what stands in for a session, and `/api/auth` does. `routes.test.ts` walks `app/` and fails, both ways, on a route with no rule, a rule with no route, a method that does not match, an `account` route not exported as `accountRoute(…)` (a bare function, a lookalike name and an aliased export were each seen to be caught), an `account` page that never calls `requireAccount()`, and a public write with no `because`. `src/access/route.ts` is the wrapper: it answers 404 when sign-in is off, then 401 with no session or an ended one, then 403 for a write whose `Origin` is not `TASKS_URL`'s or is missing (any method that is not a read, so one nobody listed is a write), and only then calls the handler with `{ request, accountId, params }`; the id is better-auth's user id from the session and nothing in the request can set it. `src/access/parse.ts` has `uuid` (lower case, canonical, a version and variant: the form `crypto.randomUUID()` makes, so two spellings are never two rows), `text(min, max)` (counted in characters, refuses NUL, which PostgreSQL would reject, and does not walk a huge string), `isoDate` (a date that exists, leap years included), `hhmm` and `idArray(max 500)`; each answers with a result and a reason that never contains the input, and none depends on the server, so the browser can use them. `src/access/two-accounts.ts` seeds Ada and Grace on a real auth store and builds a request as either, or as nobody, with their cookies and the instance's `Origin`; `route.test.ts` calls the wrapper as each. 34 tests in `src/access`, passing on a file database, sqld and PostgreSQL 16. Seen to fail: an unlisted route, the `Origin` check removed (5 tests), the session check removed (3), and the id pattern loosened to anything (3). Not in this task: `/api/sync`, which does not exist, and so no test that it is `account`; 13.2 adds its rule and the test then covers it. The roles and actions of sharing (Fjord's `policy.ts`) are phase 2.

#### ✅ 3.2 — Positions

**Goal:** order that writes one row per move.

**Design:** §11.3, §22.2. **Depends on:** 1.5.

**Technical:** `src/position.ts` wraps `fractional-indexing` (CC0): `first()`, `before(a)`, `after(a)`, `between(a, b)`. Pure. Its alphabet is digits, upper case, lower case, which is byte order, and why §22.2 needs `COLLATE "C"`. In JavaScript, compare by bytes and never with `localeCompare`. Two devices can make equal keys, so order ties break by id, and `between` with equal keys does not throw.

**Accepts when:** a property test over random sequences of inserts keeps order in JavaScript and through `ORDER BY` on all three databases; keys stay short across 10,000 inserts at the top.

**Done as:** `src/position.ts` wraps `fractional-indexing` 3.4 (CC0; `^3.4.0`, since 4.0 is new and not needed): `first()`, `before(a)`, `after(a)`, `between(a, b)` (either order, `null` for an edge), `many(a, b, n)` for filling a gap (a paste, an import), `isPosition(key)` and `comparePositions(a, b)`, which compares as bytes. It is pure. The library throws for equal keys and for a key it does not accept, and a device can send either, so the wrapper does not: `between(a, a)` is `a`, with the tie broken by id where rows are sorted, and a key that is not a position is treated as no key. `isPosition` also requires base 62 digits only, because the library was found to accept `"a0 "` (a space), which a database would sort by its byte and no device would agree the meaning of. `byPosition` in `src/local/rows.ts` now uses `comparePositions`. The tests (15, in `src/position.test.ts`, and the row ones): five seeded sequences of 2,000 inserts at random places each keep the order and every new key strictly between its neighbours; 10,000 inserts at the top and at the bottom reach keys of 5 characters at most, and 10,000 at random places 16; and 400 keys, including ones where a locale and bytes disagree (`B` and `a`, `a` and `a1`, `aB` and `ab`), come back from `ORDER BY position` in byte order on sqld, a file database and PostgreSQL 16. Seen to fail: `localeCompare` for the comparison (2 tests) and no tolerance for equal or invalid keys (2). **A limit worth knowing:** inserting again and again into the same gap grows a key by about a sixth of a character each time, so about 300 inserts into one gap bring it near half of the 64 characters the server allows (`LIMITS.positionChars`); nothing in an ordinary list does that, but the task that reorders by dragging (3.6) should rewrite a list's positions when a key gets long, and not wait for a refusal.

#### ✅ 3.3 — Lists

**Goal:** add a list from the sidebar, see each with its dot and count, and reorder by dragging.

**Design:** §10. **Depends on:** 3.2, 7.1, 13.4.

**Technical:**

- `src/actions/lists.ts`: `createList`, `renameList`, `setColor`, `moveList`, `deleteList`; `ensureFirstList` for _My tasks_, whose id derives from the account, so that two devices arrive at one. Limit of 200.
- `src/lists/colors.ts`: the six swatches to `--sv-*` tokens, and a validator.
- The sidebar: rows with dot and count from local queries; the + beside "My lists"; drag through `@dnd-kit`, with an explicit `DndContext` `id`. `/lists/<id>`, with a message if it isn't there.
- Rename, colour and delete are in Settings > Lists (2.7), using these actions.

**Accepts when:** it works in a browser, online and off; counts include only top-level open tasks; the 201st list is refused; the wrong account's list is refused at the server (13.2).

**Done as:** `src/actions/lists.ts` has the pure actions `createList`, `renameList`, `setColor`, `moveList`, `deleteList`, `restoreList` and `ensureFirstList`, each given what is on the screen and returning a mutation (or why not: `title`, `limit`, `missing`, `nothing`), with ids passed in so that they read no clock and no database; every mutation they make is run through the server's own validators in the tests. `src/lists/colors.ts` is the one definition of the six colours and their tokens, and the server's validator for a list's `color` now reads it, so the two cannot drift. `src/uuid5.ts` is a synchronous UUIDv5 (SHA-1 written out, held to RFC 4122's example and to Node's own SHA-1 on names of every length around a block), which `firstListId` uses so that two devices that both make _My tasks_ make one row; `FirstList` makes it once a device has heard from the server and the account has no list row of any kind, deleted ones included. The sidebar has the + (an inline field: Enter makes the list, Escape or leaving it empty does not; a 200th list is the last, and the 201st is refused on the device with a toast and at the server with `limit`), the lists with their dot and count, and dragging through `@dnd-kit` with an explicit `DndContext` `id`: the row is a link that stays a link (dnd-kit's own `role="button"` and tab stop are taken off), Space picks up and Enter still opens, the order is worked out against what is rendered, a move is **one change to one row** between the two it lands between, and the screen shows the new order at once and not after the write. `/lists/<id>` shows a list from the working copy, or says that list is not here with a way back for an id that is nonsense, that was deleted, or that this account never had. **Four faults found in a browser and fixed:** a drag of a link ended in a click on it, which opened the list in the middle of a reorder (the click is now caught at the window while a drag is on or has just ended); the browser's own dragging of a link is turned off; "not found" was told from "not read yet" by `undefined` for both, so a list that was missing never said so; and navigating to a new list after making it needs the server for a page, which a device that is offline does not have until the service worker keeps one (13.6), so the person stays where they were and the list is in the sidebar. **A decision the epic did not make:** deleting a list marks **only the list**, and a task of a deleted list is shown nowhere and comes back when the list does, because a mutation holds at most 500 changes and one change for each task of a long list would make Undo a thousand writes; every screen that reads tasks across lists (Today, Starred, Search) and the reminder job must skip tasks of a deleted list, which the tasks that build them are to do. Tests: 15 for the actions, 5 for the id, 3 for the colours, and 12 in Chromium and WebKit (a first list made once however many devices come first, a list made from the +, an empty name, **made with the network off and sent when it comes back**, dragged into order with one row changed on the server, and a list that is not there). Passing on a file database, sqld and PostgreSQL 16. Rename, recolour and delete have no screen until Settings (2.7), which uses these actions.

#### ✅ 3.4 — Tasks

**Goal:** add, edit, complete, reopen and delete a task.

**Design:** §11.1. **Depends on:** 3.3.

**Technical:**

- `src/actions/tasks.ts`: `createTask` (top of the list), `updateTask`, `completeTask`, `reopenTask`, `deleteTask`. Completing a task already complete does nothing, so a double-tap does one thing.
- A row and the add input; `?task=<id>` opens the detail in the right sidebar, which saves as you leave a field; a stale id shows nothing rather than failing. Title and notes limits in `parseField`.

**Accepts when:** keyboard capture works (Enter adds, focus stays); reload shows what was saved, instantly; a test proves the plugin's flaw is gone: a change to another account's task, by any route, changes nothing; a task's detail is linkable and reloadable.

**Done as:** `src/actions/tasks.ts` has the pure actions `createTask` (at the top of the list: `before` the first position on the screen, and 200 inserts at the top stay under 8 characters), `updateTask` (only the field that differs, so two devices' edits to different fields both stand; a title that is blank is refused, notes keep a trailing line break as the person's own), `completeTask` (the time is a parameter; **ticking one that is done does nothing**, so a double tap is one thing), `reopenTask`, `deleteTask` and `restoreTask`; each result is run through the server's validators in the tests. **The plugin's flaw has a test of its own**: every one of these, built for another account's task and sent as the wrong account, is refused and leaves the owner's rows byte for byte as they were, on all three databases. `ListScreen` shows the list's open tasks in order, then the ones that are done under a _Completed (n)_ heading that opens and closes, most recently finished first; `AddTask` is "Add a task…", focused when a list opens (not on a phone, where that would raise the keyboard), and Enter adds the task at the top and clears the field while **the cursor stays**; `TaskRow` is a box and a title that opens the task by `?task=<id>`, and the box takes the person's answer at once and lets go of it when the working copy agrees, so it never shows the old state in between (sampled over twenty frames in a browser). `TaskDetail` shows the task in the right column with _Done_, _Title_ and _Notes_, saves **as you leave a field** (there is no button), puts a title that was emptied back as it was, and says "That task is not here any more." for a stale or deleted id and does not fail; its address can be linked to and reloaded. **Deleting offers Undo** in a bar (`Undo.tsx`), because the design system's toast has no button: one at a time, ten seconds. Found in WebKit and fixed: a form read its title from React state, which is a keystroke behind when a title is typed and sent in the same breath, so a fast Enter added nothing; the add fields (tasks and lists) now read the field itself. Also fixed: a read that meets a copy that was just closed (signing out) is dropped instead of becoming an unhandled rejection. 9 tests for the actions, one of them over the three databases, and 14 in Chromium and WebKit: Enter adds and the cursor stays, an empty title adds nothing, reload shows it at once, ticking and un-ticking, the detail by address edited and reloaded, a stale address, a blank title, delete and Undo, and **adding and ticking with the network off, sent when it comes back**. Not done: subtasks (3.5), the star and dates, and the filter and sort of a list (3.9); completing a repeating task (5.2). A list's screen is the list's tasks only, and a task's position among others is set only on creation until dragging (3.6).

#### 📋 3.5 — Subtasks

**Goal:** one level of subtasks.

**Design:** §11.2. **Depends on:** 3.4.

**Technical:** `createSubtask`, refused unless the parent is top-level; the server's structural check repeats it. A validator refuses a date, star or repeat on a subtask where it can read. Completing a parent is one mutation that sets `completedAt` on its open subtasks only. Reopening reopens nothing; ticking the last does not complete the parent. A progress ring on the row, and a list in the detail, ordered by position.

**Accepts when:** a subtask of a subtask is refused at the server whatever is sent; completing a parent leaves earlier completion times alone; counts on a row match the rows.

#### 📋 3.6 — Manual order

**Goal:** drag tasks into order, correctly, under filters.

**Design:** §11.3, §15.8. **Depends on:** 3.2, 3.4.

**Technical:** `moveTask(id, beforeId, afterId)` computes a position between the given neighbours **as rendered**, writing one row. Subtasks too, within their parent. Available only under Custom. `@dnd-kit` with the sensors of `src/ui/dnd.ts` and `autoScroll` restricted to vertical containers from the start (§15.8). Local-first means no snap back.

**Accepts when:** a drag under a filter lands between the rows it was dropped between; the unseen rows' order is unchanged; only one row is written; keyboard reordering works through `KeyboardSensor`.

#### 📋 3.7 — Undo

**Goal:** every delete can be undone.

**Design:** §11.5. **Depends on:** 3.3, 3.4.

**Technical:** `deleted_at` on list and task; deleting a list marks it, and local queries hide its tasks; `restoreList`, `restoreTask`. Deleting a parent marks its subtasks with the same time, so restore brings back exactly those. A toast with Undo for about ten seconds. All local queries go through helpers that exclude deleted rows. The purge is 13.7.

**Accepts when:** Undo restores a list with its tasks, and a task with its subtasks, exactly as they were; subtasks deleted earlier stay deleted; deleted rows never appear in a list, count, search or export.

#### 📋 3.8 — Moving a task to another list

**Goal:** a task and its subtasks move together.

**Design:** §11.1. **Depends on:** 3.5.

**Technical:** `moveToList(id, toListId)`: one mutation of the task and its subtasks; the task takes a position at the top of the destination, and subtasks keep theirs. A control in the detail.

**Accepts when:** the subtasks move with it; a destination of another account's is refused at the server, with nothing changed.

#### 📋 3.9 — Filter, sort and completed

**Goal:** seeing a list the way one wants, remembered.

**Design:** §11.4. **Depends on:** 3.4.

**Technical:** `sort` and `showCompleted` as list fields. Filters All, Active and Overdue (Overdue arrives with 4.3). A collapsible Completed section, newest first. Deleting a list's completed tasks from its menu, with Undo. `src/lists/sort.ts` is pure. Drag handles are hidden under any sort but Custom, and a drag no-ops there.

**Accepts when:** sort and the section's state survive a reload, per list, and reach another device; a sort other than Custom cannot reorder.

#### 📋 3.10 — Star

**Goal:** mark a task.

**Design:** §11.1. **Depends on:** 3.4.

**Technical:** `setStarred`; a star on the row and in the detail, its own click target. Refused on a subtask.

**Accepts when:** a star survives a reload; a subtask cannot be starred.

#### 📋 3.11 — Bulk select

**Goal:** act on several tasks at once.

**Design:** §15.6. **Depends on:** 3.7, 3.8, 7.5.

**Technical:** selection by ctrl- or cmd-click, or long press from 7.5. `BulkActionBar`: count, Complete, Move to list, Delete, Cancel; `Esc` clears. One mutation, capped at 500 tasks. A repeating task completed in bulk makes its next. Delete gives one Undo for the whole selection.

**Accepts when:** a mutation naming another account's id is refused whole; Undo restores all.
