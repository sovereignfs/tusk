# Epic 6: Views

## Status

📋 Planned

## Overview

Ways of seeing tasks across lists. No view owns data, and each reuses the row and the detail. Cards are one component, used by Today and Review alike.

## Related

[`DESIGN.md`](../../DESIGN.md) §14

## Tasks

#### 📋 6.1 — Starred

**Goal:** every starred task, in one place.

**Design:** §14.3. **Depends on:** 3.10, 4.2, 7.1.

**Technical:** `/starred`. A local query: top-level, open, by due date with undated last. The same pane component with no add input, no dragging and no bulk, showing each row's list. A pinned sidebar row with a count. A static route, and no pseudo-id.

**Accepts when:** a row behaves as in a list (complete, un-star, open, move); the view has no way to add or drag.

#### 📋 6.2 — Search

**Goal:** find a task by what it says.

**Design:** §14.5. **Depends on:** 3.5, 7.1.

**Technical:** `/search?q=`. `src/local/search.ts` scans titles and notes in the browser, with Unicode case folding, across the account's rows, opened fields included on an encrypted account. Subtasks show under their parent. Newest change first. A box always on the page, at every width.

**Accepts when:** a search for `%` matches only a literal `%`; "É" finds "é"; it works offline and on an encrypted account; 10,000 tasks search without visible delay.

#### 📋 6.3 — Today

**Goal:** what needs attention, as a list, and as a modal on a phone.

**Design:** §14.2. **Depends on:** 3.7, 4.3, 7.3.

**Technical:** `/today`. `src/today.ts`, pure: `buildToday(tasks, today)`, classifying and ordering (overdue oldest first, due today by time, starred by title), once per task, leaving out any with `dismissedOn` equal to today. On a desktop, the content column, from a pinned sidebar row. On a phone, a full-screen modal over the carousel. A **List | Cards** toggle (`SegmentedControl`), remembered on the device. **The opening rule:** on launch and after 30 minutes or more away, kept in `src/today-open.ts`, pure, with a last-active time from local storage; not from a notification or task link, not when empty, not after a brief switch. An overlay state, not a navigation; closing shows the list underneath. Settings > Preferences can change it.

**Accepts when:** `buildToday` and the opening rule are tested with no clock; a fresh open on a phone shows it; a link to a task does not; closing shows the list underneath at its address.

#### 📋 6.4 — Cards

**Goal:** go through tasks one at a time, by swipe or button.

**Design:** §14.2. **Depends on:** 5.5, 6.3.

**Technical:** `src/cards/TaskCards.tsx` over `SwipeStack` from `@sovereignfs/ui`, with `directions` labelled and buttons always shown. Up `completeTask`; Down `cancelTask` (5.5) with an Undo toast; Left `dismissTask`, setting `dismissedOn` to today, with an Undo toast, touching nothing else; Right `setStarred(true)`, due date untouched. Tapping a title opens the detail. A failed action says so and returns the card. Takes tasks and an `onSwipe` so that Review can use it, with its own Left. An end state, with a link back.

**Accepts when:** each gesture and each button does its action; a repeating task cancelled makes its next; right on a task leaves its date alone; Undo recovers a cancel and a dismiss; a dismissed task is gone from Today on every device for the rest of that local day, is back the next, and keeps its date, status and place in its list, and still shows in Starred and search, in tests with no clock; it works with a keyboard alone.

#### 📋 6.5 — Review

**Goal:** a resumable pass over all tasks, or a list's, to prioritise them.

**Design:** §14.4. **Depends on:** 6.4, 7.3.

**Technical:** `/review` and `/review/<listId>`. `src/review.ts`, pure: open top-level tasks, never-reviewed first, then least recently reviewed, then by position. `reviewedAt` as a field, set by any swipe as part of that mutation. Today's cards and swipes, with a count left, except that Left here only marks it reviewed and moves on, without hiding it from Today. Entry points: "Review all tasks" in the list switcher (7.3), a Review row in the desktop sidebar, "Review this list" in a list's menu. An end state, offering to start again.

**Accepts when:** stopping and returning continues with what hadn't been seen, on another device too; a left swipe here sets `reviewedAt` and not `dismissedOn`; the order is tested with no clock; each entry point is there at its width.
