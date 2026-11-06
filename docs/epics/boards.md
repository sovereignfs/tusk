# Epic 17: Boards

## Status

✅ Done: 17.1, 17.2, 17.3 and 17.6.

## Overview

Trello-like boards in a workspace: lists as columns, a header with search, people, Share and a menu; public or private; archived or deleted; and
published at a read-only address for anyone. Online in phase 1, and still at once: a change shows before the server answers.

## Related

[`DESIGN.md`](../../DESIGN.md) §14, §15.6, §17.5, §17.7, §17.8 · the kanban plugin's `BoardView`, `ListColumn`, `BoardShareDialog`

## Tasks

#### ✅ 17.1 — A board and its lists

**Goal:** create a board with a _Backlog_ list, open it, and add, rename, reorder and delete its lists.

**Design:** §14.1, §14.2, §14.7, §17.5. **Depends on:** 16.2.

**Technical:**

- Operations `board.create` (name, colour; the creator its owner; a first list _Backlog_), `list.create`, `list.rename`, `list.move` (one row, a
  position between neighbours), `list.delete` (with its cards and everything on them, by `board_id` and `list_id`).
- `GET /api/boards/<id>`: the whole light board of §14.7 (lists, labels, people, open cards with what a tile shows), 404 unless `canSeeBoard`;
  `GET /api/boards/<id>/version`.
- `/b/<id>`: the board's header (name, and the rest as later tasks fill it), the columns side by side scrolling sideways, each list's header with name,
  open count and menu (Configure, Add card, Change position, Delete), "Add a list" at the end. Lists dragged by their header (`src/ui/dnd.ts`, with
  sideways auto-scroll on the board only).
- `src/boards/store.ts`: the board held in memory; operations applied at once, sent in order one at a time per board, the answer kept or the change
  undone with a toast; the version checked every 20 seconds while visible and on focus, reloading if it moved and keeping what is open and being typed.
  Offline: read-only, with a line saying it needs a connection.
- Workspace tiles on `/w/<id>` and the "Create board" tile with its dialog and `ColorPicker`.

**Accepts when:** a new board has _Backlog_; two people on one board see each other's list changes within 20 seconds and at once on focus; a refused
operation is undone on the screen; a list moved writes one row; deleting a list leaves no row of its cards; a viewer cannot change anything, through the
screen or `/api/ops`.

**Done as:** five operations through the door: `board.create` (any member of the workspace: the creator is the board's owner and its only member, it is public, and it is made with one list, _Backlog_ whose id the server chooses; 500 boards a workspace; an id another board has is `not_found`), `list.create` (the device chooses the position, after the last for a new list; 100 lists a board; an id in use is `not_found`), `list.rename`, `list.move` (one `UPDATE` of one row) and `list.delete`. **A list is named by its id alone,** the board is the row's, and the permission is the board's: `board_id IN boardsEditableBy` in the statement that changes the list, so only a member of a board that is not archived does any of it (the workspace's owners administer a board and do not edit it; a viewer and an archived board's owner are refused alike). Each operation then moves the board's `version` on and the workspace's `updated_at`, in a statement that carries the permission and takes the board's row (`touchBoard`), so two people changing one board wait for each other and the limits are counted fairly; the answer carries the version, so the board's own change is not mistaken for another's. Deleting a list takes its cards and everything on them (comments, checklist items, assignees, labels carried, activity of those cards) by `board_id` and the list's id, in the same transaction, and leaves the board's labels and every other list whole. Reads, each naming the asker in its statement: `readBoard` (the board whole and light: board, workspace, lists with their open-card counts, and what the asker may do: `edit` for a member of a board that is not archived, `admin` for a board's owner or the workspace's), `boardVersion`, and `boardsOfWorkspace` (the boards the asker can see, by name); `GET /api/boards/<id>`, `GET /api/boards/<id>/version` and `GET /api/workspaces/<id>/boards` answer the same 404 for a board that is private to them, never was, or is not an id. `/b/<id>` is read by the server before it is sent (one that is not theirs is the page for what is not here). **The board in memory** is `src/boards/store.ts` (`useBoard`): a change shows at once through the pure `showingBoard` (`board-optimistic.ts`), operations go out **in order, one at a time**, the server's row replaces the guess, a refusal or a lost connection puts the board back as the server last said it was (the operations queued behind a refused one are dropped, not sent) and says why in a toast, and the version is asked for every 20 seconds while the board is visible, and when the person comes back to it or the connection returns, reading the board again when it has moved and nothing of their own is waiting. Offline the board stays as it was read, a line says it needs a connection and nothing can be changed. The screen is a thin band of the board's colour, its header (the workspace as a link back, the name, _Archived_ or _Viewing_ for someone who cannot change it), and the lists side by side, scrolling sideways; a list's title is its drag handle (the menu beside it is its own button, so a key pressed on the menu is not a pick-up) with sideways auto-scroll on the board only, and its menu has Configure (rename), Move left and right, Move to position… (by number, which also serves a keyboard) and Delete, asking first and naming how many cards go with it; _Add a list_ is at the end and a new list goes there. A viewer has none of the controls. `/w/<id>` shows the boards as tiles (a band of the board's colour, the name, _Private_ where it is), archived ones behind a disclosure, and a _Create board_ tile that asks for a name and a colour (`ColorPicker`, any colour) and goes to the new board. Tests: the matrix has all five operations (who may and what everyone else is told); board and list tests (a board made with Backlog, its maker's three permissions and the others', the id taken, the 500 and 100 limits, the version moving on every operation, one row written for a move, a private board changed by its member only and nobody changes an archived one, the deletion of a list with a full card and the other list and board whole, the reads for every role, the tiles by role); the validators; the pure board rules; and in Chromium and WebKit: a board made from the tile with Backlog, lists added, renamed, moved by the menu and by number, deleted after asking and all of it after a reload; a list moved by the keyboard; a change made elsewhere shown on coming back; the offline board; and the page for what is not here with `404` for its routes and `401` without a session. Each condition was removed in turn (the editable permission on `list.create`, the archived condition, the clean-up of assignees, the scope of the card deletion to the list, the board limit) and the tests failed each time. **Not as the epic said:** the list menu has no _Add card_ (cards are 18.1) and the board's labels, people and cards are not in the read yet (they arrive with the tasks that make them); a deletion is not written to the board's activity (17.6); two people changing the same board are seen within 20 seconds or on coming back, and a test drives that through the version and a focus event, since the instance has one account.

#### ✅ 17.2 — A board's settings, archive and delete

**Goal:** an owner changes a board's name, colour, description and visibility, archives and restores it, and deletes it.

**Design:** §14.1, §14.4, §17.7. **Depends on:** 17.1.

**Technical:** operations `board.update` (name, colour, description), `board.archive`, `board.restore`, `board.delete` (asks for the name; deletes
every row with its `board_id`, its publication and its notices, in one transaction). All by `canAdminBoard`, so a workspace owner who is not a member can
do them. The settings dialog from the board's menu, with `ColorPicker`. Archived boards: read-only for everyone, a banner with Restore for whom it is
for, hidden behind _Archived_ in the index and sidebar. A board's colour as a band at the top of the board and a dot in lists, with text on it by
contrast (`src/ui/contrast.ts`, pure).

**Accepts when:** an archived board refuses every content operation from everyone, its owners included, and restoring allows them again; deleting
leaves no row of it in any table, by a test seeding one of each; contrast is tested for a light and a dark colour; a workspace owner who is not a member
can archive a board and cannot add a card to it.

**Done as:** four operations through the door: `board.update` (name, colour and description together; a blank description is stored as none), `board.archive`, `board.restore` and `board.delete` (the name as it is typed; another name is `invalid` and deletes nothing). **All are an administrator's:** `id IN boardsAdministeredBy` in the statement that changes the board, which is a board's owner or the owner of its workspace, who need not be on the board; and the state a board must be in is part of that statement (an archived board is read-only for everyone, its settings included, so `board.update` and `board.archive` need it open, and `board.restore` needs it archived). Each moves the board's `version` on and the workspace's `updated_at`. Deleting takes every row of every table with the board's `board_id` (activity, comments, checklist items, assignees, labels carried, labels, cards, lists, its publication, its people), the notices about it and the board, in one transaction; the workspace's deletion still does the same set-based, for all its boards at once, from the same list of tables. The board's menu in its header (a button, _Board menu_) has _Settings_ for an administrator while the board is open, _Archived cards_ for everyone who can see it, and _Archive board_ or _Restore board_ and _Delete board_ for an administrator; _Settings_ is a dialog with the name, a description and `ColorPicker` (any colour), and _Delete board_ asks for the name to be typed and goes back to the workspace. An archived board shows a banner saying it is read-only for everyone, with _Restore board_ for those who may; the store lets an administrator send administrative operations whether or not they can edit, and the board is read again after an archive or a restore, since only the server knows what the person may now do. Archived boards stay behind _Archived_ in the workspace page and the boards index. A board's colour is the band at the top of the board and the band of its tile, which carries the board's initial in black or white by contrast (`src/ui/contrast.ts`, pure: WCAG relative luminance). Tests: the matrix has the four (an administrator may, a member who is not one, a viewer and an outsider are told `not_found`, changing nothing); data-layer tests for the update (and a blank description), a workspace owner who is not on a board archiving it and being unable to add a card to it, **an archived board refusing every content operation from every role, its owners included, and its settings, until it is restored, after which the work is allowed again**, the deletion with a row of every table below the board and nothing of another board or the workspace, and the name typed; the validators; the contrast rules (black on a light colour, white on a dark one, 4.5 to 1 or better on every suggestion the picker offers); and in Chromium and WebKit: settings saved and kept after a reload, archiving that removes every control and is refused by the door, restoring that gives the work back, and a deletion by the typed name that leaves the workspace without the tile and the board's address as the page for what is not here. Each condition was removed in turn earlier in this milestone for the same shape of statement; the archived-state condition is held by the all-roles test above. **Not as the epic said:** visibility is not in the settings (it is 17.3's `board.setVisibility`, with the Share dialog), and the sidebar lists workspaces and not boards, so there is no _Archived_ there to hide a board behind.

#### ✅ 17.3 — Visibility, membership and joining

**Goal:** public and private boards, a Share dialog to add people from the workspace, and joining a public board with one click.

**Design:** §7.2, §14.3. **Depends on:** 16.3, 17.2.

**Technical:** `board.setVisibility`; `boardMember.add` (only a member of the workspace), `boardMember.setRole`, `boardMember.remove` (unassigning them
on the board), `board.join` (any workspace member, on a public board), `board.leave`. Each writes activity, and adding raises a notice (8.1). The Share
dialog: the board's people and roles, a picker over the workspace's people, Leave. The header's avatars, a few and "+N". A viewer sees "Join board"
in the header. A private board answers 404 to everyone else, in every read, including `GET /api/boards` and `/w/<id>`.

**Accepts when:** the role matrix of 16.1 covers every one of these; someone not in the workspace cannot be added; making a board private hides it from
a workspace member at once (on their next load) and not from its members or the workspace's owners; joining makes a viewer an editor.

**Done as:** six operations through the door: `board.setVisibility` (an administrator's, on an open board), `boardMember.add` (an administrator's; **only someone in the board's workspace**, else `invalid` with the reason `not_in_workspace`, and `already_in` for someone on it), `boardMember.setRole`, `boardMember.remove` (which unassigns the person on that board; their comments stay; `stale` for someone not on it), `board.join` (anyone in the workspace on a public board that is open, and a workspace owner on any: the statement that takes the workspace's row carries both conditions) and `board.leave` (the asker, whether or not the board is archived). Adding and joining take the workspace's row first, as removing a person from a workspace does, so the two wait for each other and no one is left on a board of a workspace they are not in. A refusal tells what the person is entitled to know and no more: a viewer or an outsider is `not_found` for every administrative operation, and someone already on the board is told so when they try to join. **A board made private is gone at once for a member of the workspace who is not on it,** from `GET /api/boards/<id>`, its version, its people, its cards (`GET /api/cards/<id>`), `GET /api/workspaces/<id>/boards`, the boards index and `/b/<id>`, and not for its members or the workspace's owners; the board open on their screen is a 404 at the next version check and says it is gone. `GET /api/boards/<id>/people` (`boardPeople`) lists a board's members owners first, by name, with addresses for an administrator only, and for an administrator the workspace's people who are not on it, which is the picker (never a search of the server); names are read from the accounts when shown. The board read says what the person may do: `can.join` is added to `edit` and `admin`. The header shows the board's people as avatars (four and a count), which open the **Share dialog**: who can see it (an administrator sets it), the people with their roles, _Remove_ and a picker to add, for an administrator while the board is open, and _Leave board_ (asking first) for anyone on it; a viewer sees _Join board_ in the header, and the board is read again after any operation that changes what the person may do. Tests: the matrix has the six (and its table says what someone who is already on the board is told); data-layer tests for a board made private and every read that hides it, adding only someone in the workspace (never an outsider or an id that is nothing, and not twice, and not to an archived board), a role given and `stale`, a removed and a leaving person taken off the board and its assignments with their comments left, joining by a viewer (editing from then on) and what may not be joined (a private board, an archived board, a board of another workspace), and the people list by role; the validators; and in Chromium and WebKit: the Share dialog (the maker as owner with their address), the visibility set and read back from the server, leaving that turns an editor into a viewer with _Join board_ and joining that turns them back. Three conditions were removed in turn (the workspace check on adding, the visibility condition on joining, the unassignment on leaving) and the tests failed each time. **Not as the epic said:** no activity is written and no notice is raised on adding (17.6 and 8.1 add them to these operations); the picker and removing other people are shown only to an administrator and are not exercised in a browser, since the instance has one account (the data layer holds them for every role); a private board is "404 in every read" by the same statements as before (`boardsVisibleTo`), and the matrix of 16.1 now covers the six.

#### 📋 17.4 — Search on a board

**Goal:** find a card on a board as you type.

**Design:** §14.5. **Depends on:** 17.1, 18.3, 18.4.

**Technical:** a field in the board's header, filtering the loaded cards by title, label name and assignee name, with Unicode case folding, in
`src/boards/filter.ts`, pure. A line says how many cards it hides; `Esc` clears it; `/` focuses it. Dragging is off while a filter is on.

**Accepts when:** the filter is tested with no screen; "É" finds "é"; clearing it shows every card in its place.

#### 📋 17.5 — Publishing

**Goal:** a board's owners give it a public, read-only address, and take it away.

**Design:** §14.6. **Depends on:** 17.3, 18.5.

**Technical:** operations `board.publish` (32 random bytes, base64url, into `publication`) and `board.unpublish` (deletes it). `/p/<token>`: a server
component, with no script beyond the shell's, rendering the board as it is now: name, colour, lists, cards with title, description, labels, due date and
checklist; no people, comments or activity, by a test over the HTML. A card opens to a read-only detail at `/p/<token>?card=`. `noindex`, a rate per
address, 404 for an unknown token. Listed in the Share dialog with Copy and Unpublish, and in Settings > Data.

**Accepts when:** a published board is readable signed out; no name, email or comment of anyone appears in its HTML; unpublishing makes the address
404 at once, and publishing again makes a different one; a deleted board's address is a 404.

#### ✅ 17.6 — Activity

**Goal:** see what happened on a board, and on a card.

**Design:** §15.6. **Depends on:** 17.1, 18.2.

**Technical:** `GET /api/boards/<id>/activity?before=` and `GET /api/cards/<id>/activity?before=`, newest first, pages of 50, by `canSeeBoard`. Each
row rendered from its kind and `details` by `src/workspaces/describe.ts`, pure ("Ana moved _Fix login_ from Backlog to Doing"), with the actor's name
from the auth store or "Deleted account". The board's Activity dialog from its menu; the card dialog's Activity tab. Settings > Activity (2.7) lists the
person's own, by `actor_id`, across the boards they can still see.

**Accepts when:** every kind of 16.1 has a sentence, tested with no screen; activity reads the same after its card is renamed or deleted; paging returns
each row once; an outsider cannot read a board's.

**Done as:** **activity is written by the server in the transaction of the change.** `src/workspaces/activity.ts` has `capture`, which reads the names a change is about to take away (a card's title and list before it is renamed or moved, a list's, a label's, who was assigned), and `record`, which after the operation has succeeded writes its row from that and from what it answered; both are called by `applyOp` inside the transaction, so a refused operation writes no row, and a change that changed nothing (the same title, a move within a list, an assignment that was already so) writes none either. The kinds are 29 (`ACTIVITY_KINDS`): a card created, renamed, moved between lists, archived, restored, deleted, its due date set or cleared, a label put on or taken off, a person assigned or unassigned, a checklist item added or ticked, a comment; a list created, renamed, moved or deleted; the board created, renamed, its visibility changed, archived, restored; a person joining, leaving, added, removed or made an owner (publishing joins with 17.5). **Each row keeps the names its sentence needs as they were,** as JSON in `details`, and the card's id, which may point at nothing: **deleting a card, or a list with its cards, no longer deletes its activity** (a list's deletion did, from 17.1; the deletion is now a row of it), and only the board's or the workspace's deletion takes it. `src/workspaces/describe.ts` is pure: one sentence for each kind from the kind and the names ("Ana moved Fix login from Backlog to Doing"), with a person named in a row read from the accounts when shown and "Deleted account" for one that is gone. `activity-reads.ts` has the three reads, each newest first in pages of 50 after a cursor of time and id (`src/access/cursor.ts`, shared with the Inbox) with every statement holding the rows to boards the asker can see: `GET /api/boards/<id>/activity` (the same 404 as the board for what is not theirs), `GET /api/cards/<id>/activity` (**true of a deleted card too**: what is asked is "this card's, on a board I can see"), and `GET /api/activity`, the person's own across the boards they can still see, each with its board's name. The board's menu has an **Activity** dialog, a card's dialog has Comments and **Activity** as two tabs of one control, and **Settings > Activity** lists the person's own. Tests: a sentence for every kind with no database and no screen (every kind's words, none of them undefined even when the row kept nothing, a person that is gone, markup in a name staying words); the data layer for a run of changes read back as sentences in order, nothing written for a refusal or for no change, a card renamed and then deleted reading the same with its own history still readable, the changes of due dates, labels, checklists, comments, lists and the board all written, paging each row once, an outsider and a private board's non-members reading nothing, a person's own across boards until they are taken off one, and "Deleted account"; and in Chromium and WebKit the card's tab, the board's dialog, the history of a deleted card read by its API, and Settings > Activity. The board's visibility, the person's, and the card's reads were each removed in turn and the tests failed. **Not as the epic said:** the reads return the sentence made by the server and not the row to be made one by the browser, so that the one `describe` serves them all; publishing and unpublishing are 17.5's to add.
