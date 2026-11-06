# Epic 3: The Desk

## Status

⏳ In progress: 3.1 to 3.10 are done, built as Tasks' lists and tasks; 15.2 turns them into the Desk's lists and cards. 3.11 to 3.13 are left.

## Overview

A person's own board: private, offline-first, and as plain as Google Tasks. An action here is a pure function in `src/actions/` that produces changes,
committed to the local store and synced (epic 13). The access rule that closes the tasks plugin's worst flaw was built first, so that nothing is written
without it. The done tasks below say "list", "task" and "subtask", as they were built; the Desk calls them lists, cards and checklist items.

## Related

[`DESIGN.md`](../../DESIGN.md) §7.1, §10, §17.4, §17.8

## Tasks

#### ✅ 3.1 — Access rules and input parsing

**Goal:** the machinery that makes "the owner in every statement" hard to get wrong, before there is anything to get wrong.

**Design:** §7.1. **Depends on:** 1.5, 2.1.

**Technical:**

- `src/access/routes.ts`: every page and route with who may use it. `routes.test.ts` walks `app/` and fails on anything unlisted.
- `src/access/route.ts`: wraps a route: finds the session, checks `Origin` on a write, and calls the handler with the account id.
- `src/access/parse.ts`: small parsers, no new dependency: `uuid`, `text(min, max)`, `isoDate`, `hhmm`, `idArray(max 500)`. Used in the browser too.
- `src/access/two-accounts.ts`: a test helper seeding two accounts, used by every server test to call as the wrong one.

**Accepts when:** a route not listed fails a test; a handler not going through the wrapper fails a test; an unparsable id reaches no statement.

**Done as:** `src/access/routes.ts` lists the three pages and two routes there are, each `public` or `account`; a public route that changes something carries a `because` naming what stands in for a session, and `/api/auth` does. `routes.test.ts` walks `app/` and fails, both ways, on a route with no rule, a rule with no route, a method that does not match, an `account` route not exported as `accountRoute(…)` (a bare function, a lookalike name and an aliased export were each seen to be caught), an `account` page that never calls `requireAccount()`, and a public write with no `because`. `src/access/route.ts` is the wrapper: it answers 404 when sign-in is off, then 401 with no session or an ended one, then 403 for a write whose `Origin` is not `TASKS_URL`'s or is missing (any method that is not a read, so one nobody listed is a write), and only then calls the handler with `{ request, accountId, params }`; the id is better-auth's user id from the session and nothing in the request can set it. `src/access/parse.ts` has `uuid` (lower case, canonical, a version and variant: the form `crypto.randomUUID()` makes, so two spellings are never two rows), `text(min, max)` (counted in characters, refuses NUL, which PostgreSQL would reject, and does not walk a huge string), `isoDate` (a date that exists, leap years included), `hhmm` and `idArray(max 500)`; each answers with a result and a reason that never contains the input, and none depends on the server, so the browser can use them. `src/access/two-accounts.ts` seeds Ada and Grace on a real auth store and builds a request as either, or as nobody, with their cookies and the instance's `Origin`; `route.test.ts` calls the wrapper as each. 34 tests in `src/access`, passing on a file database, sqld and PostgreSQL 16. Seen to fail: an unlisted route, the `Origin` check removed (5 tests), the session check removed (3), and the id pattern loosened to anything (3). Not in this task: `/api/sync`, which does not exist, and so no test that it is `account`; 13.2 adds its rule and the test then covers it. The roles and actions of sharing (Fjord's `policy.ts`) are phase 2.

#### ✅ 3.2 — Positions

**Goal:** order that writes one row per move.

**Design:** §10.4, §23.2. **Depends on:** 1.5.

**Technical:** `src/position.ts` wraps `fractional-indexing` (CC0): `first()`, `before(a)`, `after(a)`, `between(a, b)`. Pure. Its alphabet is digits, upper case, lower case, which is byte order, and why §22.2 needs `COLLATE "C"`. In JavaScript, compare by bytes and never with `localeCompare`. Two devices can make equal keys, so order ties break by id, and `between` with equal keys does not throw.

**Accepts when:** a property test over random sequences of inserts keeps order in JavaScript and through `ORDER BY` on all three databases; keys stay short across 10,000 inserts at the top.

**Done as:** `src/position.ts` wraps `fractional-indexing` 3.4 (CC0; `^3.4.0`, since 4.0 is new and not needed): `first()`, `before(a)`, `after(a)`, `between(a, b)` (either order, `null` for an edge), `many(a, b, n)` for filling a gap (a paste, an import), `isPosition(key)` and `comparePositions(a, b)`, which compares as bytes. It is pure. The library throws for equal keys and for a key it does not accept, and a device can send either, so the wrapper does not: `between(a, a)` is `a`, with the tie broken by id where rows are sorted, and a key that is not a position is treated as no key. `isPosition` also requires base 62 digits only, because the library was found to accept `"a0 "` (a space), which a database would sort by its byte and no device would agree the meaning of. `byPosition` in `src/local/rows.ts` now uses `comparePositions`. The tests (15, in `src/position.test.ts`, and the row ones): five seeded sequences of 2,000 inserts at random places each keep the order and every new key strictly between its neighbours; 10,000 inserts at the top and at the bottom reach keys of 5 characters at most, and 10,000 at random places 16; and 400 keys, including ones where a locale and bytes disagree (`B` and `a`, `a` and `a1`, `aB` and `ab`), come back from `ORDER BY position` in byte order on sqld, a file database and PostgreSQL 16. Seen to fail: `localeCompare` for the comparison (2 tests) and no tolerance for equal or invalid keys (2). **A limit worth knowing:** inserting again and again into the same gap grows a key by about a sixth of a character each time, so about 300 inserts into one gap bring it near half of the 64 characters the server allows (`LIMITS.positionChars`); nothing in an ordinary list does that, but the task that reorders by dragging (3.6) should rewrite a list's positions when a key gets long, and not wait for a refusal.

#### ✅ 3.3 — Lists

**Goal:** add a list from the sidebar, see each with its dot and count, and reorder by dragging.

**Design:** §10.1. **Depends on:** 3.2, 7.1, 13.4.

**Technical:**

- `src/actions/lists.ts`: `createList`, `renameList`, `setColor`, `moveList`, `deleteList`; `ensureFirstList` for _My tasks_, whose id derives from the account, so that two devices arrive at one. Limit of 200.
- `src/lists/colors.ts`: the six swatches to `--sv-*` tokens, and a validator.
- The sidebar: rows with dot and count from local queries; the + beside "My lists"; drag through `@dnd-kit`, with an explicit `DndContext` `id`. `/lists/<id>`, with a message if it isn't there.
- Rename, colour and delete are in Settings > Lists (2.7), using these actions.

**Accepts when:** it works in a browser, online and off; counts include only top-level open tasks; the 201st list is refused; the wrong account's list is refused at the server (13.2).

**Done as:** `src/actions/lists.ts` has the pure actions `createList`, `renameList`, `setColor`, `moveList`, `deleteList`, `restoreList` and `ensureFirstList`, each given what is on the screen and returning a mutation (or why not: `title`, `limit`, `missing`, `nothing`), with ids passed in so that they read no clock and no database; every mutation they make is run through the server's own validators in the tests. `src/lists/colors.ts` is the one definition of the six colours and their tokens, and the server's validator for a list's `color` now reads it, so the two cannot drift. `src/uuid5.ts` is a synchronous UUIDv5 (SHA-1 written out, held to RFC 4122's example and to Node's own SHA-1 on names of every length around a block), which `firstListId` uses so that two devices that both make _My tasks_ make one row; `FirstList` makes it once a device has heard from the server and the account has no list row of any kind, deleted ones included. The sidebar has the + (an inline field: Enter makes the list, Escape or leaving it empty does not; a 200th list is the last, and the 201st is refused on the device with a toast and at the server with `limit`), the lists with their dot and count, and dragging through `@dnd-kit` with an explicit `DndContext` `id`: the row is a link that stays a link (dnd-kit's own `role="button"` and tab stop are taken off), Space picks up and Enter still opens, the order is worked out against what is rendered, a move is **one change to one row** between the two it lands between, and the screen shows the new order at once and not after the write. `/lists/<id>` shows a list from the working copy, or says that list is not here with a way back for an id that is nonsense, that was deleted, or that this account never had. **Four faults found in a browser and fixed:** a drag of a link ended in a click on it, which opened the list in the middle of a reorder (the click is now caught at the window while a drag is on or has just ended); the browser's own dragging of a link is turned off; "not found" was told from "not read yet" by `undefined` for both, so a list that was missing never said so; and navigating to a new list after making it needs the server for a page, which a device that is offline does not have until the service worker keeps one (13.6), so the person stays where they were and the list is in the sidebar. **A decision the epic did not make:** deleting a list marks **only the list**, and a task of a deleted list is shown nowhere and comes back when the list does, because a mutation holds at most 500 changes and one change for each task of a long list would make Undo a thousand writes; every screen that reads tasks across lists (Today, Starred, Search) and the reminder job must skip tasks of a deleted list, which the tasks that build them are to do. Tests: 15 for the actions, 5 for the id, 3 for the colours, and 12 in Chromium and WebKit (a first list made once however many devices come first, a list made from the +, an empty name, **made with the network off and sent when it comes back**, dragged into order with one row changed on the server, and a list that is not there). Passing on a file database, sqld and PostgreSQL 16. Rename, recolour and delete have no screen until Settings (2.7), which uses these actions.

#### ✅ 3.4 — Tasks

**Goal:** add, edit, complete, reopen and delete a task.

**Design:** §10.2. **Depends on:** 3.3.

**Technical:**

- `src/actions/tasks.ts`: `createTask` (top of the list), `updateTask`, `completeTask`, `reopenTask`, `deleteTask`. Completing a task already complete does nothing, so a double-tap does one thing.
- A row and the add input; `?task=<id>` opens the detail in the right sidebar, which saves as you leave a field; a stale id shows nothing rather than failing. Title and notes limits in `parseField`.

**Accepts when:** keyboard capture works (Enter adds, focus stays); reload shows what was saved, instantly; a test proves the plugin's flaw is gone: a change to another account's task, by any route, changes nothing; a task's detail is linkable and reloadable.

**Done as:** `src/actions/tasks.ts` has the pure actions `createTask` (at the top of the list: `before` the first position on the screen, and 200 inserts at the top stay under 8 characters), `updateTask` (only the field that differs, so two devices' edits to different fields both stand; a title that is blank is refused, notes keep a trailing line break as the person's own), `completeTask` (the time is a parameter; **ticking one that is done does nothing**, so a double tap is one thing), `reopenTask`, `deleteTask` and `restoreTask`; each result is run through the server's validators in the tests. **The plugin's flaw has a test of its own**: every one of these, built for another account's task and sent as the wrong account, is refused and leaves the owner's rows byte for byte as they were, on all three databases. `ListScreen` shows the list's open tasks in order, then the ones that are done under a _Completed (n)_ heading that opens and closes, most recently finished first; `AddTask` is "Add a task…", focused when a list opens (not on a phone, where that would raise the keyboard), and Enter adds the task at the top and clears the field while **the cursor stays**; `TaskRow` is a box and a title that opens the task by `?task=<id>`, and the box takes the person's answer at once and lets go of it when the working copy agrees, so it never shows the old state in between (sampled over twenty frames in a browser). `TaskDetail` shows the task in the right column with _Done_, _Title_ and _Notes_, saves **as you leave a field** (there is no button), puts a title that was emptied back as it was, and says "That task is not here any more." for a stale or deleted id and does not fail; its address can be linked to and reloaded. **Deleting offers Undo** in a bar (`Undo.tsx`), because the design system's toast has no button: one at a time, ten seconds. Found in WebKit and fixed: a form read its title from React state, which is a keystroke behind when a title is typed and sent in the same breath, so a fast Enter added nothing; the add fields (tasks and lists) now read the field itself. Also fixed: a read that meets a copy that was just closed (signing out) is dropped instead of becoming an unhandled rejection. 9 tests for the actions, one of them over the three databases, and 14 in Chromium and WebKit: Enter adds and the cursor stays, an empty title adds nothing, reload shows it at once, ticking and un-ticking, the detail by address edited and reloaded, a stale address, a blank title, delete and Undo, and **adding and ticking with the network off, sent when it comes back**. Not done: subtasks (3.5), the star and dates, and the filter and sort of a list (3.9); completing a repeating task (5.2). A list's screen is the list's tasks only, and a task's position among others is set only on creation until dragging (3.6).

#### ✅ 3.5 — Subtasks

**Goal:** one level of subtasks.

**Design:** §10.3. **Depends on:** 3.4.

**Technical:** `createSubtask`, refused unless the parent is top-level; the server's structural check repeats it. A validator refuses a date, star or repeat on a subtask where it can read. Completing a parent is one mutation that sets `completedAt` on its open subtasks only. Reopening reopens nothing; ticking the last does not complete the parent. A progress ring on the row, and a list in the detail, ordered by position.

**Accepts when:** a subtask of a subtask is refused at the server whatever is sent; completing a parent leaves earlier completion times alone; counts on a row match the rows.

**Done as:** `createSubtask` puts a subtask at the **bottom** of its parent's subtasks (a checklist grows downward; a new _task_ goes to the top), in the parent's list, and is refused unless the parent is a top-level task that is there; the server's check (a subtask of a subtask, a parent in another list, a task that has subtasks made one) was there from 13.2 and is tested again with the actions' own mutations. **A subtask has no date, star or repeat**: `parseStructure` refuses a change that makes one with any of them, and the server refuses, after the mutation is applied, any subtask whose merged fields hold a due date or time, a repeat or a star that is on, which catches an edit of one that already is a subtask and a task with a date made one; a field that is empty, false or ciphertext is let through, since the server holds nothing against what it cannot read. `completeTask(parent, now, ids, subtasks)` is **one mutation** that completes the parent and its **open** subtasks only, so one that was done keeps the time it was done at (seen on the server in a browser), reopening a parent reopens nothing else, and ticking a subtask, the last one included, completes nothing but itself. The row shows a ring with how many of its subtasks are done, which a screen reader is told in words ("1 of 3 subtasks done"), and the counts come from the same rows the detail lists. The detail column has the checklist in order, a tick and a title that is edited in place and saved as it is left (an emptied one goes back), a delete that offers Undo, and "Add a subtask…" with the cursor staying. The seed has subtasks at none done, some, and all while the parent is open. Tests: 13 for the actions and the rule, 3 at the server, 1 at the validator, and 8 in Chromium and WebKit (added from the keyboard in order, the ring, ticking a parent against the server's times, the last one, delete and Undo, editing in place). Not done: deleting a parent takes its subtasks with it only in 3.7, which marks them with the same time so that Undo brings back exactly those; moving a task with its subtasks to another list is 3.8; dragging subtasks into order is 3.6.

#### ✅ 3.6 — Manual order

**Goal:** drag tasks into order, correctly, under filters.

**Design:** §10.4, §17.10. **Depends on:** 3.2, 3.4.

**Technical:** `moveTask(id, beforeId, afterId)` computes a position between the given neighbours **as rendered**, writing one row. Subtasks too, within their parent. Available only under Custom. `@dnd-kit` with the sensors of `src/ui/dnd.ts` and `autoScroll` restricted to vertical containers from the start (§15.8). Local-first means no snap back.

**Accepts when:** a drag under a filter lands between the rows it was dropped between; the unseen rows' order is unchanged; only one row is written; keyboard reordering works through `KeyboardSensor`.

**Done as:** `src/actions/order.ts` is the one rule for putting a row in order, and `moveList` and the new `moveTask` both use it: given the rows **as rendered**, the id and the index it is to have afterwards, it finds the two rows it will sit between and writes **one change to one row**, so the rows that are not shown (a filter, a deleted task, anything pinned) keep the order they had. The epic's signature `moveTask(id, beforeId, afterId)` is `moveTask(rendered, id, toIndex)` here, so that lists and tasks share the index that `arrayMove` gives. Tested for every task to every place, for a screen that shows three of six rows (the move lands between the two shown rows and writes only that one), for a tie, and through the server's validators. `src/ui/dnd.ts` is what every reorder shares, as the epic asked: the sensors (a pointer moves six pixels before it is a drag, so a click opens and a tick ticks; the keyboard lifts with **Space**, moves with the arrows, drops with Space and lets go with Escape, **Enter left to the link**), **auto-scroll only up and down** (the horizontal threshold is zero, so nothing scrolls sideways in the middle of a reorder), the guard that swallows the click which ends a drag, and the order that stays on the screen until the working copy shows it, which is how a row never springs back. The open tasks of a list, the subtasks in the detail and the lists in the sidebar all use it, each in a `DndContext` with its own `id`. **The link is the handle** for a task and a list: dnd-kit only lifts a row for a key pressed on the very element that has the drag's listeners, and not on a child of it, so the listeners are on the link (the one thing a keyboard focuses, which fills the row beside the box), with dnd-kit's `role="button"` taken off so that each stays a link to a screen reader. A subtask has a **handle** of its own at the left, because its row holds a field and a drag that began in the field would stop a person selecting its text. Tests: 4 for `moveTask`, and in Chromium and WebKit a task dragged to the top (the screen changes at once, the page does not navigate, **only that task's position changes on the server**, the other two are as they were, and the order is the same after a reload), the same by keyboard (Space, two arrows, Space; then Enter opens the task), and a subtask dragged by its handle and the same after a reload. Not done: the filter and sort that make the screen show fewer rows (3.9: dragging is to be switched off outside Custom, and the action is already written for it), and the touch gestures and the check in the iOS Simulator (7.5). A real fault found on the way: dnd-kit measures the rows again after each move, so a second arrow pressed in the same instant is taken against the first measurement; a person is slower than that, and the browser test pauses a moment between keys.

#### ✅ 3.7 — Undo

**Goal:** every delete can be undone.

**Design:** §10.6. **Depends on:** 3.3, 3.4.

**Technical:** `deleted_at` on list and task; deleting a list marks it, and local queries hide its tasks; `restoreList`, `restoreTask`. Deleting a parent marks its subtasks with the same time, so restore brings back exactly those. A toast with Undo for about ten seconds. All local queries go through helpers that exclude deleted rows. The purge is 13.7.

**Accepts when:** Undo restores a list with its tasks, and a task with its subtasks, exactly as they were; subtasks deleted earlier stay deleted; deleted rows never appear in a list, count, search or export.

**Done as:** every delete offers ten seconds of Undo in the bar (`Undo.tsx`), which 3.4 made and 3.5 and this use for a task, a subtask and, once Settings has a way to delete one (2.7), a list. **Deleting a list marks only the list** (`deleteList`/`restoreList`, 3.3): a task of a deleted list is a live row that no screen shows, and Undo brings the list back with its tasks exactly as they were, including those that were already deleted, which stay so. **Deleting a parent marks its live subtasks in the same mutation**, which the server stamps with one time for every row in it (tested), so `restoreTask(parent, ids, allSubtasks)` brings back exactly the subtasks whose deletion time is the parent's and leaves one that was deleted before; deleting a subtask is only that subtask. `visibleTasks(db)` is the one way a view that looks across lists (Today, Starred, Search, export) reads tasks: not deleted, not under a deleted task, **not in a deleted list**; the seed's long list, the sidebar's counts (which are shown only for lists that are) and a list's own screen already agree. Tests: 5 for the actions (including the exact restore and the earlier-deleted subtask), `visibleTasks` against every kind of row it must leave out, and a list restored with its tasks; one at the server that a parent and the subtasks deleted with it carry one time and an earlier one an earlier time; and in Chromium and WebKit a task with three subtasks, one deleted before: deleting the parent removes it, Undo brings back the parent and the two and not the one. Not done: the purge of rows after seven days (13.7), and the screens that read across lists, which are to use `visibleTasks` (the tests of those tasks are to hold them to it).

#### ✅ 3.8 — Moving a task to another list

**Goal:** a task and its subtasks move together.

**Design:** §10.2. **Depends on:** 3.5.

**Technical:** `moveToList(id, toListId)`: one mutation of the task and its subtasks; the task takes a position at the top of the destination, and subtasks keep theirs. A control in the detail.

**Accepts when:** the subtasks move with it; a destination of another account's is refused at the server, with nothing changed.

**Done as:** `moveToList(task, subtasks, toListId, destination, ids)` is **one mutation**: the task takes the top of the destination (`before` its first task as shown, or the first position if it is empty) and **every subtask it has, deleted ones too**, gets the new list and keeps the position it has among its siblings. Deleted subtasks have to move as well, because the server refuses a task that leaves any of them behind, and a change to a deleted row that did not say so would **restore** it (an edit of a deleted row does), so a deleted subtask moves with `deleted: true`, which keeps the time it was deleted at; a test holds that. A subtask is not moved by itself, and moving to the list it is in does nothing. The detail has a _List_ picker of the person's own lists. Moving to another account's list is refused by the server (`unavailable`, as for a row that is not there) and **nothing is changed**, tested with the action's own mutation on all three databases. In Chromium and WebKit a task with a subtask moves, and on the server both are in the new list, the subtask still under its parent, and the destination shows the task and its subtask. Not done: moving a _repeating_ task, which is 5.5's, and the series that would have to go with it.

#### ✅ 3.9 — Filter, sort and completed

**Goal:** seeing a list the way one wants, remembered.

**Design:** §10.5. **Depends on:** 3.4.

**Technical:** `sort` and `showCompleted` as list fields. Filters All, Active and Overdue (Overdue arrives with 4.3). A collapsible Completed section, newest first. Deleting a list's completed tasks from its menu, with Undo. `src/lists/sort.ts` is pure. Drag handles are hidden under any sort but Custom, and a drag no-ops there.

**Accepts when:** sort and the section's state survive a reload, per list, and reach another device; a sort other than Custom cannot reorder.

**Done as:** `src/lists/sort.ts` is pure: four sorts (`custom`, `created` newest first, `due` soonest first with a time breaking a tie and undated tasks last in their own order, and `title` as a person reads it, by letters and not by code, with digits by value: "task 2" before "task 10"), `sortOf(list)` reading the list's field (anything unknown or unreadable is `custom`) and `canReorder`, which is true for `custom` only; the server's validator for a list's `sort` takes exactly these. `setSort` and `setShowCompleted` are actions on the list's fields, so **both are remembered per list and reach the person's other devices**, and a browser test reads them back from the server. The list's header has the filter (_All_, _Active_) and _Sort by_; **under any sort but Custom a row has no handle and a drag does nothing** (the rows are plain, not sortable, and a test drags one and sees nothing move), and back on Custom the order the person made is there. _Active_ hides the Completed section, whose heading is now a button (`aria-expanded`) that opens and closes it, remembered as the list's `showCompleted`, newest finished first. **Delete completed** is by the heading when it is open: it deletes the done tasks with their live subtasks and offers Undo, and a long list is **several mutations that never split a parent from its subtasks** (`deleteMany`, tested at 900 changes against the 500 a mutation holds), the undo the same several. Tests: 11 for the sorts, 4 for acting on many, and in Chromium and WebKit a sort that orders, will not drag, and holds after a reload and on the server; the Completed section open on reload, per list, with Active hiding it; and Delete completed with its Undo. Not done: the filter **Overdue**, which arrives with 4.3 as the epic says, and the list's menu, which Settings (2.7) completes; the controls are in the header and not in a menu, since there is no menu component in the design system to put them in and a menu of two things is worse than two things. The filter is not remembered, and the epic does not ask for it.

#### ✅ 3.10 — Star

**Goal:** mark a task.

**Design:** §10.2. **Depends on:** 3.4.

**Technical:** `setStarred`; a star on the row and in the detail, its own click target. Refused on a subtask.

**Accepts when:** a star survives a reload; a subtask cannot be starred.

**Done as:** `setStarred` (and `isStarred`) set the task's `starred` field; a subtask is refused here and by the server's validator (tested both ways). The star is `StarButton`, **its own click target**: a button, pressed or not (`aria-pressed`, named _Star_ or _Remove the star_), which opens nothing and does not start a drag of its row. It is on every row and in the detail, and a subtask has none. The design system has no star icon, so the glyph is text (`☆` and `★`) and a star icon is for `@sovereignfs/ui` to offer; nothing was forked. Tests: 2 for the action, one for the validator, and in Chromium and WebKit a star that does not open the task, is on the server, survives a reload and shows in the detail, and a subtask with none. Not done: the Starred view across lists, which is 6.1.

#### ✅ 3.12 — The Desk in the new shell

**Goal:** the Desk at `/desk`, in the Tusk shell, looking like the Sovereign Tasks screenshot, with lists of any colour and cards dragged by their row.

**Design:** §10.1, §17.4, §17.7, §17.8, §17.11. **Depends on:** 7.8, 15.2.

**Technical:**

- **Routes:** `/desk` (the first list, as `/home` did) and `/desk/<listId>`, with `?card=` for the detail; `/home` and `/lists/<id>` removed, and
  `routes.ts` with them. `proxy.ts` sends `/` to `/desk` for a request with a session cookie.
- **Layout:** the app's sidebar as a rail (7.8), then the Desk's lists column, the list, and the detail on the right while `?card=` is set, inside the
  shell's content area. The Description field and the Checklist named so.
- **Colour:** a list's colour through `ColorPicker` (any `#rrggbb`), its dot in the column; the six swatches' names read as their colours for lists
  made before, in `src/lists/colors.ts`. The parser takes `#rrggbb`.
- **Drag by the row:** the row is the drag source, with the checkbox and star keeping their clicks, a click on the row opening the card, and the
  keyboard on a focused row; the title is no longer the handle. `src/ui/dnd.ts` keeps what every drag shares.
- Browser tests move to the new addresses.

**Accepts when:** `/` signed in shows the Desk at `/desk`; every Desk test passes at the new addresses; a list's colour picked freely shows on its dot and
survives a reload and a second device; a row drags from anywhere but its controls, and a click opens it.

**Done as:** the Desk's pages are `app/(app)/desk/page.tsx` (the first list, `DeskScreen`) and `app/(app)/desk/[id]/page.tsx`; `/home` and `/lists/<id>` are gone, from `routes.ts` and the tests too, and the proxy shows the Desk at `/` for a session cookie (the address stays `/`, which the sidebar treats as the Desk). The lists column is headed _Desk_ with its +. A list's colour is any `#rrggbb` in lower case: `src/lists/colors.ts` is the one definition (`HEX_COLOR`, nine `SWATCHES` the picker suggests, a neutral `DEFAULT_COLOR`, `colorOf`), the validator takes only that for a list's `color`, and the six named colours and their tokens are gone (they were never released). `ListColour` is the dot beside the list's name; it opens the design system's `ColorPicker` in a `Popover`, writes a suggestion at once, and writes a colour dragged for in the native picker once it has settled for 400 ms, so that it is one change and not one per pixel. The card row is the drag source: the pointer's listeners are on the row and the keyboard's stay on the link, which is still the one thing a keyboard focuses (Space lifts, Enter opens); a click on the row's free space opens the card as the link does, and the box and star keep their own clicks. That click handler is the one lint suppression in the change, with its reason beside it: nothing is reachable only through it. Tests: the colour module and its agreement with the server's validator; two browser tests, in Chromium and WebKit (a suggestion and a colour of one's own are written, shown, the same after a reload and on the server; a card is dragged from the ring of its checklist, and a click on the ring opens it); the existing drag tests (by the title, by keyboard) pass unchanged. **Not as the epic said:** the Desk's three columns are still `Frame` inside the app's layout and not in the Desk's own pages, which a second page of the Desk will want and nothing needs yet; and the lists column's own rows are still dragged by their link, not by the whole row.

#### ✅ 3.13 — In progress

**Goal:** a Desk card can be marked in progress, shown by a small icon, and its status always converges.

**Design:** §8.4, §10.2. **Depends on:** 3.12.

**Technical:** `startedAt` as a field; `startCard` (sets it, clears `completedAt`), and `completeCard` and `reopenCard` as §10.2 says (reopening clears
both). `statusOf(card)`, pure: Done if `completedAt`, In progress if only `startedAt`, else Open. The icon beside the title (`loader-circle`, from
`@sovereignfs/ui` once it is there, raised in `sovereign` with the star; a text stand-in until a release with it is pinned), with an accessible name. A
Status control in the detail (Open, In progress, Done) and "Mark in progress" in a card's menu. The checkbox ticks to Done from either state.

**Accepts when:** two devices, one marking a card in progress and one done, offline, both end at Done, in the convergence suite; reopening a done card
leaves it Open; the icon has a name for a screen reader; `statusOf` is tested alone.

**Done as:** `statusOf(card)` in `src/actions/cards.ts` is pure and tested alone: Done if there is a completion time, whatever else there is; In progress if there is only a start time; otherwise Open; a cleared or ciphertext time is not a time. `startCard` writes **only the start time on an open card**, so that a completion made meanwhile on another device still stands, and on a done card it is a reopening and clears the completion time too; `reopenCard` clears both, sending the start time only when there is one; `setStatus` is the detail's choice of the three. The mark is `InProgressMark`: Lucide's `loader-circle` drawn inline (the design system has no such icon yet, so it goes when a release that has one is pinned), named _In progress_ for a screen reader, in the muted text colour and turning slowly, and still for anyone who has asked for less motion. It is by the title of a card that is in progress and not done. The detail's _Done_ box is a _Status_ control of _Open_, _In progress_ and _Done_ (`SegmentedControl`), and choosing Done still takes the open checklist items with it. Tests: the status, `startCard`, `reopenCard` and `setStatus` in `cards.test.ts`; two cases on two devices in `devices.test.ts` (one starts and the other finishes, whichever arrives last, both are Done; both start, both are in progress, and they agree); one browser test, in Chromium and WebKit (the mark, the times on the server, after a reload, Done, back to In progress, Open), and the three older ones that used the _Done_ box now use the control. The checklist drag test was made to wait for its rows to stop moving, since it failed now and then on a busy machine and passed alone. **Not as the epic said:** there is no _Mark in progress_ in a card's menu, because a card has no menu yet; the detail's control is the way, and a menu on a card is for whichever task builds one.

#### 📋 3.11 — Bulk select

**Goal:** act on several Desk cards at once.

**Design:** §10.6. **Depends on:** 3.7, 3.8, 3.12.

**Technical:** selection by ctrl- or cmd-click (and by long press on the phone, in phase 2). `BulkActionBar`: count, Complete, Move to list, Delete,
Cancel; `Esc` clears. One mutation, chunked as `deleteMany` is. A repeating card completed in bulk makes its next. Delete gives one Undo for the whole
selection.

**Accepts when:** a mutation naming another account's id is refused whole; Undo restores all, and only those.
