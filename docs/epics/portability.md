# Epic 9: Portability

## Status

📋 Planned

## Overview

One JSON file, out and in. It is also what a backup is (epic 10), so its format is settled first.

## Related

[`DESIGN.md`](../../DESIGN.md) §15

## Tasks

#### 📋 9.1 — Export

**Goal:** download everything as one file, and make the page where that lives.

**Design:** §15. **Depends on:** 3.7, 3.10, 4.2.

**Technical:**
- `src/portability/format.ts`: the types of version 1, and `buildExport(accountId, now)`: everything not deleted, deterministic: lists, tasks and series ordered by id, `exportedAt` the only thing that varies. Grows the fields of later tasks as they land, with its version unchanged until a release.
- `contentHash(file)`: SHA-256 of the file without `exportedAt`, for 10.5.
- `GET /api/export`, session required, streaming JSON as an attachment, named `sovereign-tasks-<date>.json`.
- `/settings`, with a Data section. Later tasks add sections to it.

**Accepts when:** two exports of unchanged data have the same hash; a change changes it; deleted rows are absent; no other account's data can be reached; the file holds no credential or backup connection.

#### 📋 9.2 — Import

**Goal:** bring a file in, adding to what is there, after seeing what it holds.

**Design:** §15. **Depends on:** 5.2, 9.1.

**Technical:**
- `src/portability/validate.ts`: a hand-written validator over the whole file, using §7's parsers, `parseRule`, and limits on counts, returning one precise error or a normalised value. Cross-references checked; a subtask's parent must be top-level, in the same list.
- `POST /api/import`: `Origin` checked, a bounded stream of 50 MB, since a server action's limit is far lower. Two steps, with no state kept between: `?dry=1` returns the counts; without it, it writes.
- One transaction. Every id new through a per-import map, including series. Positions normalised if needed. Settings not overwritten. Lists go after the account's own. `reminder_sent_at` not set.
- A failure changes nothing. Limits of §7 apply to the total after import.

**Accepts when:** export then import into an empty account gives equal data, ignoring ids; importing twice doubles, after saying what it found; each malformed file in a fixture set is refused with nothing written, including a rule `parseRule` refuses, a 51 MB file, and a cycle in `parentId`.

#### 📋 9.3 — Reading the plugin's file

**Goal:** people on the plugin have a way across.

**Design:** §15. **Depends on:** 9.2.

**Technical:** `src/portability/plugin.ts`: recognises `{ pluginId: "fs.sovereign.tasks", schemaVersion: 1, data }`, and converts to version 1 before the ordinary validator, so nothing else knows. Epoch seconds to milliseconds; integer order to positions; integer booleans; a series per `seriesId`, its rule through `parseRule`, its anchor and `occurs_on` from its open occurrence (one with a rule the parser refuses, such as a plugin-written `BYDAY` on a monthly rule, is imported as a one-off, and counted in what the dry run says); `views`, `userListPrefs.defaultViewId`, `assigneeId` and `reminderSentAt` ignored; `showCompleted` kept. Two series with an open row each become one-offs but one. Fixtures: an export from `scripts/seed.ts` in the plugin's repository.

**Accepts when:** the plugin's seed export imports and shows every list and task, with repeats working; a series with two open rows does not break the unique index; nothing is lost silently: the dry run names what was converted.
