# Epic 4: Dates

## Status

✅ Done: 4.1 and 4.2.

## Overview

One idea of "today", used everywhere, and due dates that are floating calendar dates, on Desk cards and board cards alike. Overdue cards are visible
on the Desk.

## Related

[`DESIGN.md`](../../DESIGN.md) §10.4, §10.5, §11

## Tasks

#### ✅ 4.1 — One idea of today

**Goal:** `todayFor(zone, now)`, used in the browser and by jobs, and an account's zone kept current.

**Design:** §11. **Depends on:** 1.5, 2.1.

**Technical:** `src/time.ts`, pure: `todayFor`, `localNow(zone, epochMs)` (`Intl.DateTimeFormat`, `hourCycle: 'h23'`), `isValidZone`, `addDays`. Dates
are `YYYY-MM-DD` strings throughout, with no `Date` crossing a boundary. In the browser, the zone is the browser's. `time_zone` on `account_settings`,
default `UTC`, for jobs: the browser reports `resolvedOptions().timeZone` on load, and it is updated when different. Invalid falls back to UTC.

**Accepts when:** tests over zones either side of midnight and across daylight saving, under `TZ=UTC`, `TZ=Pacific/Auckland` and
`TZ=America/Los_Angeles`; a person who changes zone is picked up on next load.

**Done as:** `src/time.ts` is pure and reads neither the clock nor the machine's zone: `todayFor(zone, now)`, `localNow(zone, epochMs)` (the date and the `HH:MM` there, through `Intl.DateTimeFormat` with `hourCycle: 'h23'`, so midnight is `00:00`), `isValidZone`, `zoneOrUtc`, `addDays(date, n)` (by the calendar, in UTC arithmetic, throwing on a date that is not one, 31 February included) and `browserZone()`, which is the only one that asks the browser. An invalid zone is UTC wherever it is used. **The account's zone** is `account_settings.time_zone` (the column was there, default `UTC`), written by the same closed record as the sort, `PATCH /api/settings` (`{ timeZone }`, at least one setting, a zone this runtime knows or 400); the writer keeps each setting without touching the other or the sync counter. `ZoneReporter`, in the signed-in layout, sends the browser's zone when it is not what this browser last reported for this account (kept in `localStorage` under the account's id) and tries again on the next load if it could not; a person who changes zone is picked up on the next load. The boards page's idea of today now comes from `todayFor`. Tests: the time module (the date either side of midnight in UTC, Auckland and Los Angeles, midnight as 00:00, the changes of daylight saving in Los Angeles and Auckland, a bad zone as UTC, the calendar's months, years and leap days, and what is not a date), run under `TZ=UTC`, `TZ=Pacific/Auckland` and `TZ=America/Los_Angeles` by `pnpm test:zones` (a step of CI, and the same answers each time); the settings record for a zone and a sort kept apart; and in Chromium and WebKit the browser (set to Auckland) reporting its zone once and not again while it is the same, and `400` for a zone that is not one and for an empty record. **Not as the epic said:** nothing on the server uses the account's zone yet; the first job that does is the reminders of phase 2.

#### ✅ 4.2 — Due date and time

**Goal:** give a card a date, and a time if wanted, on the Desk and on a board.

**Design:** §11. **Depends on:** 4.1, 15.2, 18.2.

**Technical:**

- **One picker** in `src/dates/DuePicker.tsx`: Today, Tomorrow, Next week, the design system's `DatePicker`, and a time input once a date is set, in a
  `Popover`. Display in `src/format-due.ts`: "Today", "Tomorrow", "Mar 5", with the locale's time form; overdue in the danger token.
- **The Desk:** `dueDate`, `dueTime` fields; `setDue` in `src/actions/` is the one action that writes them, and keeps the mirrors (`due_date`,
  `due_time`) that the server copies (13.2). Clearing the date clears the time; a validator holds "no time without a date".
- **A board:** `card.due_date`, `card.due_time`, through a `card.setDue` operation (16.1), writing the activity of §15.6. The tile's badge and the
  dialog's chip.

**Accepts when:** a date and time survive a reload on both; a time cannot exist without a date, on the Desk or through `/api/ops`; a test fails when
another Desk action writes these fields; a viewer of a board cannot set one.

**Done as:** **one picker,** `src/dates/DuePicker.tsx`, in a `Popover`: _Today_, _Tomorrow_ and _Next week_, the design system's `DatePicker` for any other day, a time input once there is a date, and _Clear_; it says only what was chosen (a date and a time together) and never makes a `Date` that a zone could move, since a calendar day is read as the year, month and day it shows. `src/format-due.ts` shows "Today", "Tomorrow", "Mar 5" (with the year when it is not this one) and the time in the locale's 12- or 24-hour form, and says whether a date is before today, which the screen draws in the danger token. **On the Desk,** `src/actions/due.ts` has `setDue` and `dueOf`: `setDue` writes `dueDate` and `dueTime` **in one change** (so the pair has one order and two devices cannot end with one's date and the other's time), clears the time with the date, and writes nothing if nothing changes; a test reads `src/actions/` and fails if any other file names the two fields. The server's validator now refuses a Desk card change that gives a time with no date (a date cleared with a time, or a time alone), and takes a sealed date to be there (`src/sync/validate.ts`); the mirrors `due_date` and `due_time` are the ones the server already copied. The card's detail has the picker, and a row shows its due text, in the danger colour when overdue. **On a board,** `card.setDue` is an operation like the others (a member of an open board, both fields together, a time with no date refused by the validator with `400` and ignored by the statement), the tile's badge and the dialog's chip show it, and someone who may not change the board sees the chip read-only. Tests: the formatter (Today, Tomorrow, the day with and without a year, a 24-hour and a 12-hour locale, overdue); the Desk action (both fields, the time cleared with the date, nothing written for no change, a sealed date taken for none) and the guard over the other actions; the validator (a time needs a date in the same change); the matrix row, the data layer (date and time together, a date alone, a time sent with no date not kept, the tile and the card read), the validator and the pure rules for the board; and in Chromium and WebKit, with the zone set: a Desk card given Tomorrow and a time, shown on its row, kept after a reload and cleared with its time; and a board card given Today and a time from its dialog, shown on its tile, kept after a reload, a past date shown with the overdue style, and a time with no date refused by `/api/ops`. **Not as the epic said:** the activity of §15.6 is not written (17.6 adds it to this operation); the calendar inside the picker is the design system's and is not driven by the browser tests, which use the quick choices and the time (it is the design system's own control and has its tests there).

#### 📋 4.3 — Overdue, and pinning to the top

**Goal:** what needs attention on the Desk is visible.

**Design:** §10.4, §10.5. **Depends on:** 3.6, 3.9, 4.2.

**Technical:** `isOverdue`, `isDueTodayOrOverdue`, pure, taking today. The Overdue filter. Under Custom, a stable partition of overdue and due today to
the top. The drag computation of 3.6 is checked against this partition: a drag across it writes a valid position, and the card may stay in its group.

**Accepts when:** a card is overdue at the right moment in the browser's zone; pinning does not change any position; a drag among pinned cards reorders
them.
