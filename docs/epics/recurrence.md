# Epic 5: Recurrence

## Status

📋 Planned

## Overview

A task that repeats: completing it makes the next, editing it changes it and every later one and makes nothing new, and a double-tap or a second device cannot make two. All of it runs in the browser, so it works offline and on encrypted accounts.

## Related

[`DESIGN.md`](../../DESIGN.md) §13

## Tasks

#### 📋 5.1 — The rule module

**Goal:** everything about a rule, in one tested file.

**Design:** §13.2, §13.3. **Depends on:** 4.1.

**Technical:** `src/recurrence.ts`, the only importer of `rrule` (2.8.1, BSD-3-Clause; wrapped so it can be replaced). Pure:

- `parseRule(text)`: the allow-list of §13.2, returning a structured rule or a refusal.
- `formatRule`, `summary` ("Every 2 weeks"), `describe` ("every week on Monday, Wednesday").
- `nextOccurrence({ rule, anchor, dueDate, today })`: the first occurrence, counted from the anchor, after the later of `dueDate` and `today`, or null when ended.
- `firstOnOrAfter(rule, today)`: for a repeat set on a task with no date.
- `reanchor(rule, newDate)`: a weekly rule on one weekday moves to the new date's weekday.
  Dates cross into `rrule` only through `Date.UTC` and back through `getUTC*`.

**Accepts when:** property tests under the three `TZ`s of 4.1: results land on the rule's weekday; never on or before the input; monthly from the 31st; `COUNT` and `UNTIL` end it; a planted local-`Date` conversion fails them. `parseRule` refuses `BYHOUR`, `DTSTART`, `BYDAY` on a monthly rule and a 201-character string.

#### 📋 5.2 — Series and completing

**Goal:** completing an occurrence makes exactly one next.

**Design:** §13.1, §13.3. **Depends on:** 3.5, 4.2, 5.1.

**Technical:**

- `series` rows; `seriesId` on a task.
- `setRepeat(taskId, rule)`: creates or replaces the series; with no due date, sets one from `firstOnOrAfter`.
- `completeTask` extended: one mutation holding the completion, and if a series and a next date, the next occurrence, copying title, notes, star, due time and list, not `dismissedOn` or `reviewedAt`, taking the same position, with its subtasks copied, unticked. **The next occurrence's id is a UUIDv5 of the series and its date,** and its subtasks' ids derive from that and the original's.
- A rule for when two open occurrences arrive (§8.4): the later is deleted, by whichever device sees it, identically on all.
- A repeat icon on the row, and the description in the detail.

**Accepts when:** two devices completing offline on one day make one next; on different days, they settle on one, in the convergence suite (13.5); a daily task ticked a week late makes one due after today; subtasks arrive unticked; a dismissal does not carry to the next; the last of a `COUNT` makes none.

#### 📋 5.3 — The repeat picker

**Goal:** set a rule without knowing what one is.

**Design:** §13.2. **Depends on:** 5.2.

**Technical:** `src/recurrence/RepeatPicker.tsx`: Does not repeat, Daily, Weekdays, Weekly (on the date's weekday), Monthly, Yearly, Custom (every N units, on chosen weekdays, ending on a date or after N). Switching away from weekly clears the weekdays (the plugin kept them, narrowing a monthly rule to days away). Adaptive surface from 7.4.

**Accepts when:** every preset produces a rule `parseRule` accepts, and shows the right description; weekdays are not carried over to another frequency; the picker is usable by keyboard.

#### 📋 5.4 — Editing a recurring task

**Goal:** an edit applies from that occurrence on, with no prompt and no new row.

**Design:** §13.4. **Depends on:** 5.2, 5.3.

**Technical:** the table of §13.4, in `src/actions/`:

- Title, notes, star, time, subtasks: the ordinary update. No code path for series, since the next copies from it.
- `setDue` on an occurrence: moves `dueDate`, and sets the anchor to it, with `reanchor`.
- Rule change: replaces the rule, anchors at this date.
- Does not repeat, or clearing the date: detaches this task, and the series ends.
  Completed occurrences are never written by any of these.

**Accepts when:** renaming a task then completing it gives a next with the new name, and earlier completed rows keep theirs; the row count is unchanged by any edit; moving a date to a Tuesday makes later occurrences follow; no edit touches a completed row.

#### 📋 5.5 — Reopening, moving, cancelling and deleting occurrences

**Goal:** the rest of an occurrence's life, losing nothing.

**Design:** §13.5. **Depends on:** 3.7, 3.8, 5.4.

**Technical:** reopen: if the next is untouched (no field written since it was made, no subtask ticked), delete it and reopen; otherwise the reopened task leaves the series. Undo of a tick is this path. Moving moves the series. `cancelTask`, for the cards: deletes with Undo, and on a repeating task makes the next, as completing would, Undo removing it if untouched. Deleting in the detail leaves the series with nothing open; Undo restores it; the purge job removes a series with no rows.

**Accepts when:** complete then Undo leaves exactly the starting rows; complete, edit the next, reopen the first: two open tasks, one a one-off; cancel makes the next, and Undo reverses both; delete then Undo keeps repeating.
