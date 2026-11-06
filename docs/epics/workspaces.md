# Epic 16: Workspaces

## Status

📋 Planned

## Overview

The shared half of Tusk: workspaces, their people, and the door every write to them comes through. The permission is a condition of each statement and
a refusal reads as "not found", as on the Desk. This epic builds the door and the roles first, with the test matrix that holds them, so that no board is
written without them.

## Related

[`DESIGN.md`](../../DESIGN.md) §7, §13, §17.2, §17.3, §23.3 · the kanban plugin's `app/_lib/authz.ts`, `CONCEPT.md` (Phase 2)

## Tasks

#### ✅ 16.1 — Operations, and who may do them

**Goal:** one door for workspace writes, with the permission in the statement, activity and notices in the same transaction, and a matrix of roles that
tests every kind.

**Design:** §7.1–§7.4, §15.6. **Depends on:** 3.1, 15.2.

**Technical:**

- **Tables** of §23.3 for workspaces, boards and below, in one generated migration per dialect, with the indexes it names. `board_id` on every row
  below a board.
- `src/workspaces/format.ts`: the operations as a closed union (`{ opId, op, … }`), and `validate.ts`, shared with the browser, built on
  `src/access/parse.ts` (adding `color` for `#rrggbb`).
- `src/workspaces/apply.ts`: `applyOp(db, accountId, op, now)` in one transaction: replay answered from `applied_mutation`; the change with its
  permission as a subquery (`src/workspaces/can.ts` holds the subqueries: `isWorkspaceOwner`, `isWorkspaceMember`, `canSeeBoard`, `canEditBoard`,
  `canAdminBoard`, each a SQL fragment over bound values, never a read first); the board's `version` and the workspace's `updated_at` moved on; the
  activity row (`src/workspaces/activity.ts`, its kinds and `details`); the notices (8.1 adds them). Returns the changed rows or a refusal: `not_found`,
  `invalid`, `limit`, `stale`.
- `POST /api/ops`: session, `Origin`, a bounded body, a rate, `applyOp`; listed in `routes.ts`.
- `src/workspaces/testing/roles.ts`: seeds a workspace with an owner, a member, a board owner, a board member, a viewer of a public board and an
  outsider (`two-accounts.ts` grown to six), and **a table of every operation and read with who may**. The test runs each as each, on all three
  databases, and checks the answer and that nothing changed when refused. A new operation without a row fails it.
- The operations themselves arrive with the tasks that need them; this task carries `workspace.create` and `workspace.rename`, to prove the path.

**Accepts when:** the matrix runs on all three forms; a refusal of every kind writes nothing, not even activity; a replayed `opId` answers the same and
applies once; each permission subquery's test is seen to fail with that condition removed; no route in `app/api/` writes a workspace row except
`/api/ops`, by a test over the files.

**Done as:** the fourteen tables of `DESIGN.md` §23.3 for workspaces and below are `src/db/schema/{sqlite,postgres}/workspaces.ts`, in one generated migration per dialect (`0001_workspaces`; drizzle-kit reads both schema files of a dialect now), with no foreign keys and a `board_id` on every row below a board. `src/workspaces/format.ts` is the closed set of operations (`workspace.create` and `workspace.rename` so far, each carrying its `opId`, with no account in it) and the refusals (`not_found`, `invalid`, `limit`, `stale`); `validate.ts` is the one parser, run in the browser and on the server, and refuses any key an operation does not take, including a hostile `__proto__`. `can.ts` holds the permissions as subqueries a statement carries: `workspacesOwnedBy`, `workspacesOf`, `boardsVisibleTo` (a public board of a workspace one is in, a board one is a member of, every board of a workspace one owns), `boardsEditableBy` (membership only, and not archived) and `boardsAdministeredBy` (a board one owns, and every board of a workspace one owns). `apply.ts` is one transaction: the `opId` is recorded first in `applied_mutation` (so a repeat is answered as applied and done no more, and a refusal rolls the record back with everything else), then the work with the permission in its statement (`UPDATE … WHERE id = ? AND id IN (owned)`), and the answer is the row as it now is. Creating a workspace makes its owner a member in the same transaction, is limited to 50 an account, and an id another account already uses is refused as `not_found`. `POST /api/ops` (`app/api/ops/route.ts`, in the access table) is `accountRoute` over `opsResponse`: a body read to 64 KB, a rate of 240 a minute, `400` for what is not an operation, `200` with the refusal for one that is refused. **The role matrix** (`roles.test.ts`, on the world of `testing/roles.ts`: one workspace, six people in six roles, a public, a private and an archived board) is a table of every operation with who may do it and what everyone else is told, run for each role and checking that nothing changed, plus a table of which boards each role reaches by each of the three permissions; a last test fails for an operation with no row. Each permission condition was removed in turn (the owner role, the archived condition, the public-board condition) and the matrix failed each time. `endpoint.test.ts` also scans the files: nothing under `app/` or `src/` outside `src/workspaces/` and `src/db/` imports the workspace tables, and no route writes a workspace but `/api/ops`. Browser tests, in Chromium and WebKit, show a signed-in browser making and renaming a workspace, one answer for what is not its own, `401` without a session and `403` for a hostile or missing `Origin`. **Not as the epic said:** `applyOp` writes no activity and raises no notice yet, since the first two operations have none (activity is a board's, 17.6, and notices come with 8.1); the matrix has the two operations of this task, and each task that adds an operation adds its rows.

#### ✅ 16.2 — Workspaces

**Goal:** create, rename and delete a workspace, and see one's workspaces in the sidebar.

**Design:** §13.1, §17.2, §17.11. **Depends on:** 7.8, 16.1.

**Technical:** `workspace.create` (the creator its first owner, in the same transaction), `workspace.rename`, `workspace.delete` (owners only; deletes
every row with its `workspace_id` or a `board_id` of its boards, in one transaction, by name; asks for the name to be typed). `GET /api/workspaces`: the
person's, with role, for the sidebar's _My workspaces_ (owned) and _Shared with me_. The + in the sidebar and a dialog. `/w/<id>`: the workspace's
boards (tiles arrive with 17.1), 404 for an outsider. `src/boards/` gains the in-memory store with optimistic operations and rollback (§14.7), used
first here.

**Accepts when:** a created workspace appears in the sidebar at once and survives a reload; a member sees it under _Shared with me_; deleting one
leaves no row of it in any table, by a test that seeds one of each; an outsider's `/w/<id>` is a 404.

**Done as:** `workspace.delete` is an operation like the others: an owner's, with the workspace's name as it is typed (another name is `invalid` and deletes nothing), and it removes every row of the workspace by name in one transaction, children before parents (the rows below its boards by `board_id`, the boards, the people, the notices about it, then the workspace), with a test that seeds one row of every table below a board and finds exactly one workspace's worth gone and a second workspace whole. `src/workspaces/reads.ts` has the two reads, both naming the account in the statement: `listWorkspaces` (by name, each with the asker's own role) and `workspaceOf`; `GET /api/workspaces` and the page `/w/[id]` use them, and the page asks the server before it is sent, so a workspace that never was, one that is someone else's and an id that is not an id are the same page for what is not here. `src/boards/workspaces.tsx` is the in-memory store of §14.7: `WorkspacesProvider` reads the list when the page opens and when the person comes back to it, and `perform` applies the change at once (`optimistic.ts`, pure and tested), sends it through `POST /api/ops`, keeps the server's row, and on a refusal or a lost connection puts the list back (it reads the truth if it can, the list as it was if not) and says why in words. The sidebar has _My workspaces_ with a + and _Shared with me_, a rail shows each by its first letter named for a screen reader, nothing is drawn until the list is read, and the create dialog takes a name and goes to the new workspace once the server has said it is theirs. `/w/<id>` shows the name, the person's role and, for an owner, a rename and _Delete workspace_, which asks for the name to be typed and says it cannot be undone. Tests: the optimistic rule; the matrix has `workspace.delete` (every role in a world of its own, since an allowed one changes it), the deletion, the typed name and the repeat; the reads; and 5 browser tests in Chromium and WebKit (made from the sidebar and kept after a reload, renamed with the sidebar following, deleted by the typed name and gone from the server, the page for what is not here for an id that never was or is not an id, a rail). **Not as the epic said:** the status line of that page is 200 and not 404, as it is for every page that streams behind the root loading state; the proxy answers 404 where it can see enough (the sign-in pages), and cannot ask the database. `DESIGN.md` §7.1 and §17.11 now say so. A member sees no settings; the people of a workspace and Leave are 16.3. The boards are 17.1: the page says there are none yet.

#### ✅ 16.3 — A workspace's people

**Goal:** owners add people by email, set roles and remove them; anyone can leave; a workspace always has an owner.

**Design:** §7.2, §13.2. **Depends on:** 16.2.

**Technical:** operations `member.add` (by exact email, case aside, looked up in the auth store; "No account with that address here" otherwise; a
rate per account and hour), `member.setRole`, `member.remove`, `member.leave`. Removing or leaving takes the person off every board of the workspace
and unassigns them there, in the same transaction. The last owner cannot leave or step down (`invalid`, with a reason the dialog shows). The
workspace's settings dialog (from its gear): name, people with avatars and roles, add, remove, leave, delete; a member sees the people and Leave. Names
and avatars come from the auth store at read time, never copied.

**Accepts when:** adding an unknown address says so and adds nothing; the limit holds; a removed member's assignments on the workspace's boards are

**Done as:** four operations through the same door: `member.add` (an owner's, by the exact address of an account, case aside), `member.setRole` (an owner's), `member.remove` (an owner's) and `member.leave` (anyone in it, and nobody's but the asker's, so it names no account). Each starts by moving the workspace's `updated_at` on in a statement that carries the permission, which also **takes the workspace's row, so two owners changing the people at once wait for each other**; the last-owner rule is a condition of the statement that would take the last owner away (`role = 'member' OR owners > 1`), so a race cannot get past it (a test sends two owners' stepping down together and exactly one succeeds). Removing and leaving are one function: off the workspace, off every board of it (by `board_member.workspace_id`) and unassigned there (`card_assignee` by the workspace's boards), in the same transaction; comments and activity are left. A refusal that the asker is entitled to understand carries a `reason` beside its code: `invalid` with `no_account`, `already_in` or `last_owner`; anyone who may not have asked is told `not_found` and nothing more, an unknown address included (the lookup is made before the transaction, and `no_account` is only said after the permission has held). `member.add` also refuses at 100 people (`limit`) and a person already in (`already_in`). **The accounts are asked through `src/auth/directory.ts`** (`idOfEmail`, `profiles`), over the auth store, which may be a database of its own: it is called before the transaction, never inside it, and names are read when the list is read and never copied. The adds are rated on their own, 30 an hour an account (`member-add:<account>`, `429`), since they tell an owner whether an address has an account. `GET /api/workspaces/[id]/members` (`peopleOf`) lists the people owners first, then by name, naming the asker in the statement; a workspace that is not theirs, never was, or is not an id is the same 404. The address is shown to an owner only. The sidebar's list follows: `showing` guesses nothing about people (leaving is **not** shown at once as a delete is, since it can be refused and the screen showing the workspace would have gone with it), the list is read again after any operation on people, and a leave takes the workspace out when the server has said yes. The gear on `/w/<id>` opens the workspace settings dialog (`WorkspaceSettings`): the name and _Save name_ for an owner, the people with initials avatars, roles (a select for an owner, text for a member), _Remove_, _Add a person by email_, _Leave workspace_ (confirmed) and, for an owner, _Delete workspace_, which closes the dialog and opens the typed-name one, so two dialogs are never open together; the inline settings section of 16.2 is gone. Tests: the role matrix has the four operations (who may, what everyone else is told, and that a refusal changes nothing), the people tests (adding and its moving the workspace on and the account seeing it, `no_account` to an owner and the same answer to an outsider for a known and an unknown address, a repeat, the limit of 100, setting roles and `stale`, the last owner for step down, leave and remove, the simultaneous step down, a removed and a leaving person taken off the boards and unassigned with their comments left, the list of people and who sees addresses), the validators, the rate in the endpoint, the directory over a real auth store, the optimistic rule, and in Chromium and WebKit the dialog (the owner listed with their address, an unknown address and one's own refused in words, the only owner unable to step down or leave) and the route (`401` without a session, `404` for what is not theirs). Each new condition was removed in turn (the last-owner guard, the owner permission of `member.add`, the limit of people, the clean-up of boards) and the tests failed each time. **Not as the epic said:** no notice is raised to the person added (the Inbox is 8.1, which adds it to `member.add`), and no activity is written (a board's, 17.6); avatars are initials, since a picture would have to come from another address and the browser makes no third-party requests; the dialog's _Remove_ does not ask to confirm, since adding the person again undoes it (a board's assignments are not restored).
gone and their comments stay; the last owner cannot leave; an added person sees the workspace on their next load.

#### ✅ 16.4 — The boards index

**Goal:** `/boards`: the Desk, then every workspace with its boards, sorted as the person chose.

**Design:** §17.3. **Depends on:** 16.3, 17.1.

**Technical:** `GET /api/boards`: for each workspace the person is in, its name, people's avatars, and the boards they can see (by `canSeeBoard`), with
name, colour and whether archived; light, one query per kind. The Desk tile from the local store (open count, due today). _My workspaces_ sorted by
name, created or recently updated (`account_settings.workspace_sort`, a setting saved with the account through a small `PATCH /api/settings`);
_Shared with me_ by name. The Desk's entry in the app's sidebar (7.8) is removed here, since the Desk now has its tile. Each section's gear opens the settings of 16.3; each ends with "Create board". A skeleton until loaded.

**Accepts when:** a private board appears only for its members and the workspace's owners; the sort survives a reload and holds on a second device;
archived boards are behind _Archived_; the Desk tile works offline while the rest says it needs a connection.

**Done as:** `/boards` is the Desk's tile (a link to `/desk` with its open count and how many are due today, read from the working copy by `deskSummary`, so it is there offline), then _My workspaces_ (those the person owns, with a sort) and _Shared with me_ (by name), each workspace a section with its name as a link, up to five avatars of its people and a count of the rest, a gear that opens the workspace's settings of 16.3 on this page, its boards as tiles, a _Create board_ tile that is the dialog of 17.1, and its archived boards behind _Archived_. `GET /api/boards` (`boardsIndex`) is **one statement for each kind of thing**, whatever the number of workspaces: the boards the asker can see (`workspace_id IN workspacesOf` and `id IN boardsVisibleTo`), a few people of each (`ROW_NUMBER() OVER (PARTITION BY workspace_id …)`, owners first), how many people there are, and the sort; names come from the accounts when read, and no address is sent. The sort is `account_settings.workspace_sort` (`name`, `created` newest first, or `updated` most recent first; a migration, `0002_workspace_sort`, for both dialects), written by `PATCH /api/settings`, which takes a closed record, limits itself to 60 a minute and makes the account's row if it is the first thing the account keeps without touching the sync counter; the screen changes it at once and puts it back with a toast if it is refused or the connection is lost. The rules of the order are the pure `sortWorkspaces` and `sections`. A skeleton is shown until the list of workspaces and the index are read; if they cannot be had a line says workspaces and boards need a connection and the Desk tile stays. **The Desk's entry in the sidebar is gone**: the entry is _Boards_ (current on `/boards`, a board and a workspace) and the Desk is reached from its tile and the mark in the header. A person with no workspace is offered to create one. Tests: the index by role (a private board only for its members and the workspace's owners, an archived board marked, a workspace with no boards still there, only the workspaces the asker is in, a few people with owners first and all of them counted, nothing but a name for a person), the sort kept, replaced and not touching the sync counter, the closed settings record, the order rules, the Desk summary on a real IndexedDB, and in Chromium and WebKit: the Desk tile and the sidebar's entry, a section with a board made from its own tile and the gear's dialog, the sort kept after a reload and read from the server, the Desk tile with the connection lost, and `401`, `403`, `400` and `200` for the settings route. **Not as the epic said:** the archived disclosure is shown but cannot be seen in a browser test yet, since archiving a board is 17.2 (the data layer holds the archived flag); the sort holds on a second device by being read from the server, which a test shows through the API since the instance has one account.
