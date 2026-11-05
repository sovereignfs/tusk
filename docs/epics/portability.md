# Epic 9: Portability

## Status

📋 Planned

## Overview

One JSON file, out and in, of the Desk, a board, a workspace or everything. The Desk's part is made and read in the browser, so that it works on an
encrypted Desk; boards and workspaces are made on the server, where they are. A backup (epic 10) is the "everything" file, so the format is settled
first.

## Related

[`DESIGN.md`](../../DESIGN.md) §20

## Tasks

#### 📋 9.1 — Export

**Goal:** download the Desk, a board, a workspace or everything as one file.

**Design:** §20.1. **Depends on:** 2.7, 3.13, 4.2, 17.1, 18.6.

**Technical:**

- `src/portability/format.ts`: the types of version 1 (`"format": "tusk"`), and pure builders: `buildDesk(rows)` and `buildBoard(rows, people)`,
  deterministic (ordered by position and id), everything not deleted, archived included, people named by name and email, no key, token, connection or
  credential. `exportedAt` is the only thing that varies. Grows with later tasks' fields, its version unchanged until a release.
- **The Desk** is exported in the browser, from the local store, after syncing if online, with a warning on an encrypted Desk.
- **A board, a workspace,** by `GET /api/export?scope=board&id=` and `scope=workspace`, as the permission says (§20.1): a board for anyone who can see
  it, a workspace for its owners. **Everything** is the browser's Desk part joined to the server's part for the workspaces the person owns.
- Entry points: Settings > Data (Desk, everything), a board's menu, a workspace's settings. Saved as `tusk-<scope>-<date>.json`.

**Accepts when:** two exports of unchanged data differ only in `exportedAt`; deleted rows are absent, archived ones present; the file holds no id of a
person, key, publication token or credential; a viewer can export a public board and an outsider cannot; the Desk's export works offline.

#### 📋 9.2 — Import

**Goal:** bring a file in, creating what it holds, after seeing what that is.

**Design:** §20.2. **Depends on:** 5.2, 9.1.

**Technical:**

- `src/portability/validate.ts`: a hand-written validator over the whole file, using §7's parsers, `parseRule`, and limits on counts, returning one
  precise error or a normalised value. Cross-references checked: a card's list, a label on a card is the board's, a checklist item's card.
- In the browser, read and validated, showing what it found ("1 workspace, 4 boards, 312 cards; 3 people not on this server will not be assigned")
  and asking where: Desk lists to the Desk; a board to a workspace the person may create boards in; a workspace as a new one they own.
- The Desk's part is committed through sync in chunked mutations, every id new, sealed first on an encrypted Desk. The rest goes to `POST /api/import`:
  one request, one transaction, `Origin` checked, a bounded stream of 50 MB, checked again on the server, every id new, people matched by email to
  members of the destination workspace, comments and activity left out, and one activity row per board saying it was imported.
- A failure changes nothing. Needs a network, and says so.

**Accepts when:** export then import into an empty account gives equal data, ignoring ids, comments and activity; importing twice makes two copies,
after saying what it found; each malformed file in a fixture set is refused with nothing written, including a rule `parseRule` refuses, a 51 MB file,
and a label from another board; an assignee who is not a member is dropped and counted.

#### 📋 9.3 — Reading the tasks plugin's file

**Goal:** people on the tasks plugin have a way across.

**Design:** §20.2. **Depends on:** 9.2.

**Technical:** `src/portability/plugin.ts`: recognises `{ pluginId: "fs.sovereign.tasks", schemaVersion: 1, data }`, and converts it to a Desk export of
version 1 before the ordinary validator, so nothing else knows. Epoch seconds to milliseconds; integer order to positions; subtasks to checklist items;
notes to descriptions; a series per `seriesId`, its rule through `parseRule`, its anchor from its open occurrence. One with a rule the parser refuses is
imported as a one-off, and counted in what the preview says. `views`, `userListPrefs.defaultViewId`, `assigneeId` and `reminderSentAt` ignored. The
kanban plugin had no export, so there is nothing of it to read.

**Accepts when:** the plugin's seed export imports and shows every list and task as Desk lists and cards, with repeats working; nothing is lost
silently: the preview names what was converted.
