# Epic 17: Boards

## Status

📋 Planned

## Overview

Trello-like boards in a workspace: lists as columns, a header with search, people, Share and a menu; public or private; archived or deleted; and
published at a read-only address for anyone. Online in phase 1, and still at once: a change shows before the server answers.

## Related

[`DESIGN.md`](../../DESIGN.md) §14, §15.6, §17.5, §17.7, §17.8 · the kanban plugin's `BoardView`, `ListColumn`, `BoardShareDialog`

## Tasks

#### 📋 17.1 — A board and its lists

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

#### 📋 17.2 — A board's settings, archive and delete

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

#### 📋 17.3 — Visibility, membership and joining

**Goal:** public and private boards, a Share dialog to add people from the workspace, and joining a public board with one click.

**Design:** §7.2, §14.3. **Depends on:** 16.3, 17.2.

**Technical:** `board.setVisibility`; `boardMember.add` (only a member of the workspace), `boardMember.setRole`, `boardMember.remove` (unassigning them
on the board), `board.join` (any workspace member, on a public board), `board.leave`. Each writes activity, and adding raises a notice (8.1). The Share
dialog: the board's people and roles, a picker over the workspace's people, Leave. The header's avatars, a few and "+N". A viewer sees "Join board"
in the header. A private board answers 404 to everyone else, in every read, including `GET /api/boards` and `/w/<id>`.

**Accepts when:** the role matrix of 16.1 covers every one of these; someone not in the workspace cannot be added; making a board private hides it from
a workspace member at once (on their next load) and not from its members or the workspace's owners; joining makes a viewer an editor.

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

#### 📋 17.6 — Activity

**Goal:** see what happened on a board, and on a card.

**Design:** §15.6. **Depends on:** 17.1, 18.2.

**Technical:** `GET /api/boards/<id>/activity?before=` and `GET /api/cards/<id>/activity?before=`, newest first, pages of 50, by `canSeeBoard`. Each
row rendered from its kind and `details` by `src/workspaces/describe.ts`, pure ("Ana moved _Fix login_ from Backlog to Doing"), with the actor's name
from the auth store or "Deleted account". The board's Activity dialog from its menu; the card dialog's Activity tab. Settings > Activity (2.7) lists the
person's own, by `actor_id`, across the boards they can still see.

**Accepts when:** every kind of 16.1 has a sentence, tested with no screen; activity reads the same after its card is renamed or deleted; paging returns
each row once; an outsider cannot read a board's.
