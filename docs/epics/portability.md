# Epic 9: Portability

## Status

📋 Planned

## Overview

One JSON file, out and in, made and read in the browser. A backup (epic 10) uses the same shape, so the format is settled first.

## Related

[`DESIGN.md`](../../DESIGN.md) §18

## Tasks

#### 📋 9.1 — Export

**Goal:** download everything as one file.

**Design:** §18. **Depends on:** 2.7, 3.7, 3.10, 4.2.

**Technical:**

- `src/portability/format.ts`: the types of version 1, and `buildExport(rows, now)`, pure: everything not deleted, without today's dismissals, deterministic: lists, tasks and series ordered by id, `exportedAt` the only thing that varies. Grows with later tasks' fields, its version unchanged until a release.
- In the browser, from the local store, after syncing if online; saved as `sovereign-tasks-<date>.json`.
- A section in Settings > Data. A warning on an encrypted account.

**Accepts when:** two exports of unchanged data differ only in `exportedAt`; deleted rows are absent; the file holds no key, credential, backup connection or dismissal; it works offline, from what is on the device.

#### 📋 9.2 — Import

**Goal:** bring a file in, adding to what is there, after seeing what it holds.

**Design:** §18. **Depends on:** 5.2, 9.1.

**Technical:**

- `src/portability/validate.ts`: a hand-written validator over the whole file, using §7's parsers, `parseRule`, and limits on counts, returning one precise error or a normalised value. Cross-references checked; a subtask's parent must be top-level, in the same list.
- In the browser, read and validated, showing the counts and asking. Then every id new through a per-import map, including series; positions normalised if needed; settings not overwritten; lists after the account's own.
- `POST /api/import`: one request, one transaction, `Origin` checked, a bounded stream of 50 MB, structure and limits checked again on the server, and stamped with `seq` so that other devices pull it.
- A failure changes nothing. Needs a network, and says so.

**Accepts when:** export then import into an empty account gives equal data, ignoring ids; importing twice doubles, after saying what it found; each malformed file in a fixture set is refused with nothing written, including a rule `parseRule` refuses, a 51 MB file, and a cycle in `parentId`.

#### 📋 9.3 — Reading the plugin's file

**Goal:** people on the plugin have a way across.

**Design:** §18. **Depends on:** 9.2.

**Technical:** `src/portability/plugin.ts`: recognises `{ pluginId: "fs.sovereign.tasks", schemaVersion: 1, data }`, and converts to version 1 before the ordinary validator, so nothing else knows. Epoch seconds to milliseconds; integer order to positions; integer booleans; a series per `seriesId`, its rule through `parseRule`, its anchor from its open occurrence. One with a rule the parser refuses, such as a plugin-written `BYDAY` on a monthly rule, is imported as a one-off, and counted in what the preview says. A series with two open rows keeps the earliest in the series, and the rest as one-offs. `views`, `userListPrefs.defaultViewId`, `assigneeId` and `reminderSentAt` ignored; `showCompleted` kept. Fixtures: an export from `scripts/seed.ts` in the plugin's repository.

**Accepts when:** the plugin's seed export imports and shows every list and task, with repeats working; nothing is lost silently: the preview names what was converted.
