# Epic 18: Cards on a board

## Status

✅ Done: 18.1.

## Overview

Cards on a shared board: added and dragged within and between lists, opened in a dialog that edits everything, labelled, assigned, ticked through
their checklist, discussed, moved and cloned, archived and restored.

## Related

[`DESIGN.md`](../../DESIGN.md) §15, §17.6, §17.8 · the kanban plugin's `CardDetailOverlay`, `MoveCardDialog`, `dndSensors.ts`

## Tasks

#### ✅ 18.1 — Cards in lists

**Goal:** add cards, see them as tiles, drag them within and between lists, archive and restore them.

**Design:** §15.1, §15.8, §17.8. **Depends on:** 17.1.

**Technical:** operations `card.create` (title only, at the top of a list), `card.move` (a list of the board and a position; one row), `card.archive`,
`card.restore` (back to its list and position), `card.delete` (only an archived card; its labels, assignees, items and comments with it, its activity
kept). "Add a card" at the top of each column and in the list's menu. The tile of §15.1 (labels, title, badges, avatars), its badges filled as later
tasks add them. Whole-card drag with no handle: a pointer sensor with a small activation distance, so a press that does not move is a click; the
keyboard sensor on a focused card (Space, arrows, Space); positions computed against what is rendered (`neighboursAfterMove`). The board's menu lists
archived cards, with Restore and Delete.

**Accepts when:** a drag between lists writes one row and shows at once; a click opens the card and a drag does not; a card moved by keyboard alone
lands where announced; an archived card restored returns to its place; a deleted card's activity remains.

**Done as:** five operations through the door: `card.create` (a title and a position the device chose, at the top of a list; 5,000 cards a board; an id in use is `not_found`), `card.move` (a list and a position: **one `UPDATE` of one row**, and the list must be of the card's own board and its card not archived), `card.archive`, `card.restore` (the list and position archiving did not touch) and `card.delete` (**only an archived card**, with its comments, checklist, assignees and labels carried; its activity stays). The list is taken first in a statement that carries the board's permission (`board_id IN boardsEditableBy`), then the board's version is moved on (`touchBoard`), so a card can only be put in, or moved to, a list of a board its maker may change; each card statement also names the state it must be in (open to archive, archived to restore or delete). The board read now carries every open card as a tile (`CardTile`: title, list, position, due date and time, whether it has a description), and `GET /api/boards/<id>/archived` lists the archived ones, with the same 404 as the board for what is not theirs. On the screen a list's header has _Add a card_ at the top of its column and in its menu (the field stays open, so a run of cards can be typed; a new card goes to the top), a tile shows its title and the badges it has, and **a tile is dragged by its whole surface**: a press that does not move is a click, a focused card is picked up with Space, moved with the arrows and put down with Space, and the position is computed against what is rendered (`cardPositionFor`, the cards of the target list without the one moving). One drag context holds lists and cards, each with its own collisions (lists among lists; a card among cards and the empty part of every list), a drag overlay follows the pointer, and a card dropped on the empty part of a list goes to its end. A tile's menu archives it, and _Archived cards_ in the board's header opens the archived ones with Restore and Delete for someone who may change the board. Deleting a list takes its cards from the screen at once. Tests: the matrix has the five operations; data-layer tests for the create (with its tile and version), the id taken, a list of a board one cannot change and the 5,000 limit, a move that writes one row and none to another board's list or of an archived card, archive and restore to the same list and position and the states they refuse, a delete that takes what is on the card and leaves its activity, and the archived read by role; the validators; the pure rules (a new card at the top, a move to another list, the position among what is shown, what the server's answer keeps); and in Chromium and WebKit cards added to the top, moved one step by the keyboard alone and to another list by the pointer, all of it after a reload, and a card archived from its menu, listed, restored to its place and deleted for good. The delete and move conditions and the card limit were each removed in turn and the tests failed. **Not as the epic said:** a click on a tile opens nothing yet (the card dialog is 18.2); the archived cards are behind a link in the board's header and not its menu, since the menu is 17.2; a card moved to another list by the keyboard alone is not tested in a browser (the pointer and the within-list keyboard are), and no activity is written (17.6).

#### 📋 18.2 — The card dialog

**Goal:** open a card at its own address and edit its title and description, saving as you leave a field.

**Design:** §15.1, §17.6. **Depends on:** 18.1.

**Technical:** `GET /api/cards/<id>`: the card with its description, checklist, first page of comments and activity, by `canSeeBoard`. `/b/<id>/c/<cardId>`
as an intercepting route (`@modal`), a `Dialog` over the board, and a page of its own when opened directly; closing replaces the address. Operations
`card.rename`, `card.describe`. The layout of §17.6, with places for the chips, checklist and tabs that later tasks fill. A viewer sees everything,
read-only. Text with its line breaks; the close button's clearance reserved for a long title.

**Accepts when:** a card's address opens it over its board, and reloads to it; an edit saved on blur shows on the tile at once and survives a reload; a
title emptied goes back to the one it had; a card on a board one cannot see is a 404.

#### 📋 18.3 — Labels

**Goal:** a board's labels, of any colour, put on cards.

**Design:** §15.2, §17.7. **Depends on:** 18.2.

**Technical:** operations `label.create`, `label.update`, `label.delete` (taking it off every card), `card.addLabel`, `card.removeLabel` (the label must
be the card's board's). A picker in the dialog: the board's labels with a tick, create and edit with `ColorPicker`; the same list in the board's
settings. Tiles show labels as small bars; the dialog as chips with their name in black or white by contrast.

**Accepts when:** a label from another board is refused; deleting a label takes it off every card in one operation; names read on every colour of a
sample set, by the contrast function's test.

#### 📋 18.4 — Assignees

**Goal:** assign a card to members of its board.

**Design:** §15.3. **Depends on:** 17.3, 18.2.

**Technical:** operations `card.assign`, `card.unassign` (the person must be a member of the board), raising the `assigned` notice for anyone but the
actor (8.1). A picker over the board's people in the dialog; avatars on the tile. Removal from a board or workspace unassigns (17.3, 16.3).

**Accepts when:** someone who is not a board member cannot be assigned; assigning someone else raises one notice and assigning oneself none; a removed
member is unassigned from the board's cards.

#### 📋 18.5 — Checklist

**Goal:** a card's checklist, added to, ticked, ordered and deleted in its dialog.

**Design:** §15.4. **Depends on:** 18.2.

**Technical:** operations `item.add`, `item.rename`, `item.tick`, `item.untick`, `item.move` (one row), `item.delete`, on `checklist_item`. The
checklist in the dialog, with a progress bar, items dragged into order, and "Add an item" keeping the cursor; "2/5" on the tile. Ticking writes
activity.

**Accepts when:** items keep their order across a reload and between two people; a viewer cannot tick one; the tile's count follows at once.

#### 📋 18.6 — Comments

**Goal:** talk about a card.

**Design:** §15.5. **Depends on:** 18.2.

**Technical:** operations `comment.add`, `comment.edit` (its author), `comment.delete` (its author or a board owner), raising the `comment` notice for the
card's assignees and its creator, never the author (8.1). The Comments tab, newest first, paged, with avatar, name, time and "edited"; text with its
line breaks, never HTML; a count on the tile.

**Accepts when:** only the author can edit, and the author or a board owner can delete; a comment with `<script>` shows as text; notices go to the right
people and not the author.

#### 📋 18.7 — Moving and cloning

**Goal:** move a card to another list or board, and clone it.

**Design:** §15.7. **Depends on:** 18.3, 18.4, 18.5.

**Technical:** the card's right-click menu (`ContextMenu`) and the dialog's menu: Move, Clone, Archive. `card.moveToBoard` (a board of the same
workspace that the person is a member of; labels matched by name and colour and created if missing; assignees who are not members there dropped, which
the dialog says first; comments and activity rewritten to the new `board_id`; activity on both boards). `card.clone` (below it, with title, description,
due date, checklist unticked, labels and assignees; activity naming the original).

**Accepts when:** a card moved to another board keeps its comments, gains labels it needs, and drops an assignee who is not a member there, as the
dialog said; a board one is not a member of is not offered and is refused; a clone has no comments.
