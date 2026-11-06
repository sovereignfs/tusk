# Epic 9: Portability

## Status

⏳ In progress: 9.1 is done.

## Overview

One JSON file, out and in, of the Desk, a board, a workspace or everything. The Desk's part is made and read in the browser, so that it works on an
encrypted Desk; boards and workspaces are made on the server, where they are. A backup (epic 10) is the "everything" file, so the format is settled
first.

## Related

[`DESIGN.md`](../../DESIGN.md) §20

## Tasks

#### ✅ 9.1 — Export

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

**Done as:** **`src/portability/format.ts`** (pure) is version 1 of the file (`"format": "tusk"`, `"version": 1`, `exportedAt`, `scope`) with its types, `envelope`, `fileNameOf` (`tusk-<scope>-<date>.json`), `serialise` (indented, one trailing newline) and **`buildDesk(rows, open?)`**: lists in order, each with its cards and each card its checklist, and the series; what was deleted is left out, and so is what hangs on it (a deleted list's cards, a deleted card's items, a series of a deleted list), and a card's pointer to a series that is not in the file is written as none. A card carries its text, star, date and time, series, start and completion; a list its title, colour, sort and position. Everything is in order by position, then id, so the same rows in any order are the same file; a field that is ciphertext is written empty unless `open` reads it (14.3's), as search does. **`src/workspaces/export.ts`** is the server's (in `src/workspaces/` with the other reads, since only that directory touches the workspace tables): `exportBoard` (the board; its lists, cards **archived ones included and marked**, labels, checklist, assignees, comments and activity), `exportWorkspace` (its people and every board, private and archived ones too) and `exportOwned` (every workspace the person owns, the server's half of "everything"). **Every statement names the asker** as every read does: a board only if `boardsVisibleTo` them, a workspace only if `workspacesOwnedBy` them, and anything else is `undefined`, the same answer as for what is not there. People are named by name and address and **never by id**; one whose account is gone is "Deleted account" with no address; **an activity row's details are stripped of any key that is `id` or ends in `Id`** at any depth (it keeps the names its sentence needs, and may keep ids), and no publication token, key, connection or credential is read at all. `GET /api/export?scope=board|workspace&id=` and `?scope=owned` (an account route, in `routes.ts`) answer `404` for what is not theirs or an id that is not one, `400` for no scope or one it does not know, and name the download in `Content-Disposition`; `no-store`. **The Desk is made in the browser** (`src/portability/client.ts`): synced first when the browser says it is online, then read from the working copy, so it works with the network off; **everything** joins that to `owned` and **throws if the server cannot be reached**, since a file that said "everything" and was not would lie. Entry points: Settings > Data (_Export my Desk_, _Export everything_, with what is in it said), a board's menu (_Export_) and an owner's workspace settings (_Export workspace_). Tests: the builder (order, everything of a card, deletions and what hangs on them, the same file from rows in any order and two files differing only in `exportedAt`, a sealed field, the envelope and the name); the server on the real database in the role world (who may export a board: a member, a viewer, a workspace owner and not an outsider or a board that is not theirs, a private board for its members and the workspace's owners; who may export a workspace: its owners and no one else; what is in a board; no id of a person and no publication token anywhere; a missing account named as such; ids taken out of activity; the same text twice); and in Chromium and WebKit the route over HTTP (the owner's downloads and their names, no id in the files, the refusals) and Settings downloading the Desk **with the network off** (a done card, a card with a description and a checklist item, and no deleted card) and refusing everything offline with a line saying so. **Breaking the board's visibility check, the id stripping or the workspace's ownership check fails the tests.** **Not as the epic said:** who may export what is held by the role matrix on the real database and not over HTTP, since sign-up is closed on the browser-test server (one account), so a second person cannot be made there; the warning on an encrypted Desk is 14.3's, since there is no encrypted Desk yet.

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
