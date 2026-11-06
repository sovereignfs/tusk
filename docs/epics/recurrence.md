# Epic 5: Recurrence

## Status

⏳ In progress: 5.1 is done.

## Overview

A Desk card can repeat. One occurrence is open at a time, completing it makes the next, and an edit applies from that occurrence on with no prompt and
no new row. Board cards do not repeat in phase 1.

## Related

[`DESIGN.md`](../../DESIGN.md) §12, §8.4

## Tasks

#### ✅ 5.1 — The rule module

**Goal:** everything about a rule, in one tested file.

**Design:** §12.2, §12.3. **Depends on:** 4.1.

**Technical:** `src/recurrence.ts`, the only importer of `rrule` (2.8.1, BSD-3-Clause; wrapped so it can be replaced). Pure:

- `parseRule(text)`: the allow-list of §12.2, returning a structured rule or a refusal.
- `formatRule`, `summary` ("Every 2 weeks"), `describe` ("every week on Monday, Wednesday").
- `nextOccurrence({ rule, anchor, dueDate, today })`: the first occurrence, counted from the anchor, after the later of `dueDate` and `today`, or null
  when ended.
- `firstOnOrAfter(rule, today)`: for a repeat set on a card with no date.
- `reanchor(rule, newDate)`: a weekly rule on one weekday moves to the new date's weekday.

Dates cross into `rrule` only through `Date.UTC` and back through `getUTC*`.

**Accepts when:** property tests under the three `TZ`s of 4.1: results land on the rule's weekday; never on or before the input; monthly from the 31st;
`COUNT` and `UNTIL` end it; a planted local-`Date` conversion fails them. `parseRule` refuses `BYHOUR`, `DTSTART`, `BYDAY` on a monthly rule and a
201-character string.

**Done as:** `src/recurrence.ts`, the only file that imports `rrule` (2.8.1, exact; a test reads `src/`, `app/` and `scripts/` and fails if another does). A rule is a structured `Rule` (`freq`, `interval`, `byDay`, `end`), and `parseRule` reads the allow-list of §12.2 or refuses with a reason (`empty`, `too_long`, `syntax`, `unknown_key`, `duplicate_key`, `freq`, `interval`, `byday`, `byday_not_weekly`, `end_both`, `count`, `until`): capitals only, no `RRULE:` prefix, `INTERVAL` and `COUNT` 1 to 999 with no leading zero, `UNTIL` as `YYYYMMDD` and a real date, `BYDAY` plain and weekly only, and what is refused is refused whole. `formatRule` writes the one canonical text (`INTERVAL=1` left out, days Monday first), so two devices that mean one rule store one string; `isRule` is the single predicate the browser's and the server's validators will share. `summary` ("Daily", "Weekdays", "Every 2 weeks") and `describe` ("every week on Monday, Wednesday", "every 3 months, until Dec 31, 2027", "every day, 5 times") are English and take no locale. `nextOccurrence`, `firstOnOrAfter` and `reanchor` are as the epic says; a date or a rule that cannot be used gives null, not a guess. **Decisions the epic left open:** the anchor is the series' first occurrence and counts toward `COUNT`; `UNTIL` is inclusive; **a monthly or yearly rule on a day some months lack (the 31st, 29 February) takes only the months that have it,** as RFC 5545 says, rather than moving to the month's last day (the design's §12.2 is silent; a person who wants the last day is not offered it by the picker, and `BYMONTHDAY` is not on the allow-list). Tests: the allow-list and what it refuses; canonical round trips; both forms of words; the next date done on time, late and early, from no due date, every N, from an anchor three decades back; monthly from the 31st and yearly from 29 February; both ends; 400 generated rules (a fixed seed) checked for landing on the rule's weekday or day of month, never on or before the later of the due date and today, and being the first such one; and a weekly run of 60 Mondays. They run under `TZ=UTC`, `Pacific/Auckland` and `America/Los_Angeles` (`pnpm test:zones` now runs this file too). **The planted fault was tried:** with the conversion changed to a local `Date`, 9 tests fail under Auckland and 5 under Los Angeles, and none under UTC, which is why the zones matter.

#### 📋 5.2 — Series and completing

**Goal:** completing an occurrence makes exactly one next.

**Design:** §12.1, §12.3. **Depends on:** 4.2, 5.1, 15.2.

**Technical:**

- `desk_series` rows; `seriesId` on a card.
- `setRepeat(cardId, rule)`: creates or replaces the series; with no due date, sets one from `firstOnOrAfter`.
- `completeCard` extended: one mutation holding the completion (and its open checklist items), and if a series and a next date, the next occurrence,
  copying title, description, star, due time and list, taking the same position, with its checklist copied, unticked, and neither start time nor
  completion. **The next occurrence's id is a UUIDv5 of the series and its date,** and its items' ids derive from that and the original's.
- A rule for when two open occurrences arrive (§8.4): the later is deleted, by whichever device sees it, identically on all.
- A repeat icon on the card's row, and the description in the detail.

**Accepts when:** two devices completing offline on one day make one next; on different days, they settle on one, in the convergence suite (13.5); a
daily card ticked a week late makes one due after today; checklist items arrive unticked; an in-progress card's next starts Open; the last of a
`COUNT` makes none.

#### 📋 5.3 — The repeat picker

**Goal:** set a rule without knowing what one is.

**Design:** §12.2. **Depends on:** 5.2.

**Technical:** `src/recurrence/RepeatPicker.tsx`: Does not repeat, Daily, Weekdays, Weekly (on the date's weekday), Monthly, Yearly, Custom (every N
units, on chosen weekdays, ending on a date or after N). Switching away from weekly clears the weekdays (the plugin kept them, narrowing a monthly rule
to days away). In a `Popover`.

**Accepts when:** every preset produces a rule `parseRule` accepts, and shows the right description; weekdays are not carried over to another
frequency; the picker is usable by keyboard.

#### 📋 5.4 — Editing a recurring card

**Goal:** an edit applies from that occurrence on, with no prompt and no new row.

**Design:** §12.4. **Depends on:** 5.2, 5.3.

**Technical:** the table of §12.4, in `src/actions/`:

- Title, description, star, time, checklist: the ordinary update. No code path for series, since the next copies from it.
- `setDue` on an occurrence: moves `dueDate`, and sets the anchor to it, with `reanchor`.
- Rule change: replaces the rule, anchors at this date.
- Does not repeat, or clearing the date: detaches this card, and the series ends.

Completed occurrences are never written by any of these.

**Accepts when:** renaming a card then completing it gives a next with the new name, and earlier completed cards keep theirs; the row count is unchanged
by any edit; moving a date to a Tuesday makes later occurrences follow; no edit touches a completed card.

#### 📋 5.5 — Reopening, moving and deleting occurrences

**Goal:** the rest of an occurrence's life, losing nothing.

**Design:** §12.5. **Depends on:** 3.7, 3.8, 5.4.

**Technical:** reopen: if the next is untouched (no field written since it was made, no item ticked), delete it and reopen; otherwise the reopened card
leaves the series. Undo of a tick is this path. Moving moves the series. Deleting in the detail leaves the series with nothing open; Undo restores it;
the purge job removes a series with no rows. `cancelCard`, for Today and Review's Cancel (deleting with Undo, and on a repeating card making the next),
is built with them in phase 2 (6.4).

**Accepts when:** complete then Undo leaves exactly the starting rows; complete, edit the next, reopen the first: two open cards, one a one-off; delete
then Undo keeps repeating.
