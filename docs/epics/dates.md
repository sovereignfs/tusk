# Epic 4: Dates

## Status

✅ Done: 4.1.

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

#### 📋 4.2 — Due date and time

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

#### 📋 4.3 — Overdue, and pinning to the top

**Goal:** what needs attention on the Desk is visible.

**Design:** §10.4, §10.5. **Depends on:** 3.6, 3.9, 4.2.

**Technical:** `isOverdue`, `isDueTodayOrOverdue`, pure, taking today. The Overdue filter. Under Custom, a stable partition of overdue and due today to
the top. The drag computation of 3.6 is checked against this partition: a drag across it writes a valid position, and the card may stay in its group.

**Accepts when:** a card is overdue at the right moment in the browser's zone; pinning does not change any position; a drag among pinned cards reorders
them.
