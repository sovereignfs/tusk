# Epic 5: Recurrence

## Status

📋 Planned

## Overview

A task that repeats: completing it makes the next, editing it changes it and every later one and makes nothing new, snoozing does not disturb the schedule, and a double-tap cannot make two.

## Related

[`DESIGN.md`](../../DESIGN.md) §11

## Tasks

#### 📋 5.1 — The rule module

**Goal:** everything about a rule, in one tested file.

**Design:** §11.2, §11.3. **Depends on:** 4.1.

**Technical:** `src/recurrence.ts`, the only importer of `rrule` (2.8.1, BSD-3-Clause; wrapped so it can be replaced). Pure:
- `parseRule(text)`: the allow-list of §11.2, returning a structured rule or a refusal.
- `formatRule`, `summary` ("Every 2 weeks"), `describe` ("every week on Monday, Wednesday").
- `nextOccurrence({ rule, anchor, occursOn, today })`: the first occurrence after the later of `occursOn` and `today`, or null when ended.
- `firstOnOrAfter(rule, today)`: for a repeat set on a task with no date.
- `reanchor(rule, newDate)`: a weekly rule on one weekday moves to the new date's weekday.
Dates cross into `rrule` only through `Date.UTC` and back through `getUTC*`.

**Accepts when:** property tests under the three `TZ`s of 4.1: results land on the rule's weekday; never on or before the input; monthly from the 31st; `COUNT` and `UNTIL` end it; a planted local-`Date` conversion fails them. `parseRule` refuses `BYHOUR`, `DTSTART`, `BYDAY` on a monthly rule and a 201-character string.

#### 📋 5.2 — Series and completing

**Goal:** completing an occurrence makes exactly one next.

**Design:** §11.1, §11.3, §19.3. **Depends on:** 3.5, 4.2, 5.1.

**Technical:**
- `series` table; `series_id` and `occurs_on` on `task`; the partial unique index for one open occurrence.
- `setRepeat(accountId, taskId, rule)`: creates or replaces the series; with no due date, sets one from `firstOnOrAfter`.
- `completeTask` extended, in one transaction: guarded update; if a series and a next date, insert the next, copying title, notes, star, due time, list and position, with `due_date` and `occurs_on` the next date, and its subtasks copied, unticked. Today comes from the account's zone.
- A repeat icon on the row, and the description in the detail.

**Accepts when:** complete twice at once makes one next, on all three databases; a daily task ticked a week late makes one due after today; a snoozed monthly task's next is on the rule's date; subtasks arrive unticked; the last of a `COUNT` makes none.

#### 📋 5.3 — The repeat picker

**Goal:** set a rule without knowing what one is.

**Design:** §11.2. **Depends on:** 5.2.

**Technical:** `src/recurrence/RepeatPicker.tsx`: Does not repeat, Daily, Weekdays, Weekly (on the date's weekday), Monthly, Yearly, Custom (every N units, on chosen weekdays, ending on a date or after N). Switching away from weekly clears the weekdays (the plugin kept them, narrowing a monthly rule to days away). Adaptive surface from 7.3. Sends text; the server parses.

**Accepts when:** every preset produces a rule `parseRule` accepts, and shows the right description; weekdays are not carried over to another frequency; the picker is usable by keyboard.

#### 📋 5.4 — Editing a recurring task

**Goal:** an edit applies from that occurrence on, with no prompt and no new row.

**Design:** §11.4. **Depends on:** 5.2, 5.3.

**Technical:** the table of §11.4, in the store:
- Title, notes, star, time, subtasks: the ordinary update. No code path for series, since the next copies from it.
- `setDue` from the detail, on an occurrence: moves `due_date`, and sets `occurs_on` and the anchor to it, with `reanchor`.
- `snooze(accountId, id, date)`: `due_date` only, used by Today.
- Rule change: replaces the rule, anchors at this date.
- Does not repeat, or clearing the date: detaches this task, and the series ends.
Completed occurrences are never written by any of these.

**Accepts when:** renaming a task then completing it gives a next with the new name, and earlier completed rows keep theirs; the row count is unchanged by any edit; moving a date to a Tuesday makes later occurrences follow; snoozing does not; no edit touches a completed row.

#### 📋 5.5 — Reopening, moving and deleting occurrences

**Goal:** the rest of an occurrence's life, losing nothing.

**Design:** §11.5. **Depends on:** 3.7, 3.8, 5.4.

**Technical:** reopen: if the next is untouched (`updated_at = created_at`, no subtask ticked), delete it and reopen; otherwise the reopened task leaves the series. Undo of a tick is this path. Moving keeps the series. Deleting the open occurrence leaves the series with nothing open; Undo restores it; the purge job removes a series with no rows.

**Accepts when:** complete then Undo leaves exactly the starting rows; complete, edit the next, reopen the first: two open tasks, one a one-off, and the index holds; delete then Undo keeps repeating.
