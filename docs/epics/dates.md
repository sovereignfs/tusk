# Epic 4: Dates

## Status

📋 Planned

## Overview

One idea of "today", replacing the plugin's three, then due dates on it. Recurrence, Today and reminders all stand on this.

## Related

[`DESIGN.md`](../../DESIGN.md) §10

## Tasks

#### 📋 4.1 — One idea of today

**Goal:** `todayFor(zone, now)`, and an account's zone kept current.

**Design:** §10. **Depends on:** 1.5, 2.1.

**Technical:** `src/time.ts`, pure: `todayFor`, `localNow(zone, epochMs)` (`Intl.DateTimeFormat`, `hourCycle: 'h23'`), `isValidZone`, `addDays`. Dates are `YYYY-MM-DD` strings throughout, with no `Date` crossing a boundary. `time_zone` on `account_settings`, default `UTC`. A small client component reports `resolvedOptions().timeZone` on load, and an action updates it when different. Invalid falls back to UTC.

**Accepts when:** tests over zones either side of midnight and across daylight saving, under `TZ=UTC`, `TZ=Pacific/Auckland` and `TZ=America/Los_Angeles`; a server-rendered "today" matches the browser's with no hydration warning; a person who changes zone is picked up on next load.

#### 📋 4.2 — Due date and time

**Goal:** give a task a date, and a time if wanted.

**Design:** §10. **Depends on:** 3.4, 4.1.

**Technical:** `due_date`, `due_time`, with `CHECK`s. `setDue` in the store is the **one** way to write them, and clears `reminder_sent_at`. Clearing the date clears the time. Picker: Today, Tomorrow, Next week, `Calendar` from `@sovereignfs/ui`, and a native time input once a date is set, in an adaptive surface (`Popover`, `Drawer` from 7.3). Display in `src/format-due.ts`: "Today", "Tomorrow", "Mar 5", with the locale's time form.

**Accepts when:** a date and time survive a reload; a time cannot exist without a date, whatever is sent; a test fails when anything but `setDue` writes these columns.

#### 📋 4.3 — Overdue, and pinning to the top

**Goal:** what needs attention is visible.

**Design:** §9.3, §9.4. **Depends on:** 3.6, 3.9, 4.2.

**Technical:** `isOverdue`, `isDueTodayOrOverdue`, pure, taking today. Overdue in the danger token, rendered correctly on the server. The Overdue filter. Under Custom, a stable partition of overdue and due today to the top. The drag computation of 3.6 is checked against this partition: a drag across it writes a valid position, and the row may stay in its group.

**Accepts when:** a task is overdue at the right moment in the account's zone, not the server's; pinning does not change any position; a drag among pinned rows reorders them.
