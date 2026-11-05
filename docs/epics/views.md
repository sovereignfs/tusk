# Epic 6: Views

## Status

📋 Planned

## Overview

Ways of seeing tasks across lists. No view owns data, and each reuses the row and the detail.

## Related

[`DESIGN.md`](../../DESIGN.md) §12

## Tasks

#### 📋 6.1 — Starred

**Goal:** every starred task, in one place.

**Design:** §12.3. **Depends on:** 3.10, 4.2, 7.1.

**Technical:** `/starred`, `listStarred(accountId)`: top-level, open, by due date with undated last. The same pane component with no add input, no dragging and no bulk, showing each row's list. A pinned sidebar row with a count. A static route, and no pseudo-id.

**Accepts when:** a row behaves as in a list (complete, un-star, open, move); the view has no way to add or drag.

#### 📋 6.2 — Search

**Goal:** find a task by what it says.

**Design:** §12.4. **Depends on:** 3.5, 7.1.

**Technical:** `/search?q=`. `searchTasks(accountId, q)`: `lower(title) LIKE lower(?) ESCAPE '\'`, and notes, with `%`, `_` and `\` escaped by one helper, `owner_id` in the statement, so that the limit of 50 applies to the account's own. Subtasks show under their parent. Newest change first. A box always on the page, at every width.

**Accepts when:** a search for `%` matches only a literal `%`; another account's many matching tasks do not displace one's own; the difference in case folding on SQLite is covered by a test that states it.

#### 📋 6.3 — Today

**Goal:** go through what needs attention, one card at a time.

**Design:** §12.2. **Depends on:** 3.7, 4.3, 5.4, 7.1.

**Technical:** `/today`. `src/today.ts`, pure: `buildToday(tasks, today)`, classifying and ordering (overdue oldest first, due today by time, starred by title), once per task. The server decides, from the account's zone. `SwipeStack` from `@sovereignfs/ui`, with buttons always shown. Up completes, right sets today, left sets tomorrow (both through `snooze`, this occurrence only), down deletes with Undo. A failed action says so and returns the card. An end state with a link back.

**Accepts when:** `buildToday` is tested with no clock; each gesture and each button does its action; a snoozed repeating task keeps its series; an accidental delete is recovered by Undo; it works with a keyboard alone.
