# Epic 19: The Planner

## Status

⏳ In progress (2026-11-08): five tasks, in phase 2; 19.1 is done. 19.1 to 19.4 make the Planner usable; 19.5, start and end times, makes it a place to box time, and can follow.

## Overview

One feed of days, before and after today, holding every card with a date that is the person's: the Desk's, and the board cards assigned to them. It serves two
habits at once, **seeing what is coming** and **giving a day its shape**: a day with nothing in it is still there to put something in, and a gap between two
timed cards is a place to add one. Tapping a card opens it; tapping an empty place adds one there.

The Desk's part is read from the working copy on the device, as every Desk screen is, so a Desk with a key of its own is in the Planner as any other. The boards'
part is a read of the server's, and needs the network: **the Planner is not offline in this epic,** and says so when the boards' part cannot be had, still
showing the Desk's.

## Related

[`DESIGN.md`](../../DESIGN.md) §11, §12, §17.2, §25.1; the shell's entry and the phone's footer slot (7.8, 7.3) already lead to `/planner`.

## Decisions

Settled with the developer on 2026-11-08, before any task was started:

- **The feed only,** on a phone and a computer alike (a centred column on a wide screen); no week or month grid in this epic.
- **No overdue block.** A card is on its own day, before or after today; an overdue one is on its day, in the danger colour.
- **Both directions, without end,** loaded a few weeks at a time as either end comes near, keeping the reader's place when days are added above.
- **What is in it:** cards with a due date, nothing undated. The Desk's from every list; on boards, **only the cards assigned to the person**, which keeps the
  Planner personal.
- **Repeats:** the occurrences after the current one are shown as previews (below, 19.4); nothing is made ahead of time.
- **Height:** every card one fixed height until a card can have an end (19.5), when a card's height follows its length.

## Tasks

#### ✅ 19.1 — The feed

**Priority:** P1. **Goal:** `/planner` is a feed of days, before and after today, that a person can scroll through without end.

**Design:** §25.1. **Depends on:** 4.2, 7.8, 18.4.

**Technical:**

- **The read** `GET /api/planner?from=YYYY-MM-DD&to=YYYY-MM-DD` (in `src/access/routes.ts`, a row in the role matrix): the open (not archived) cards with a
  due date in the range that are **assigned to the signed-in account** on a board they can still see, with each card's board (name, colour), list name, date
  and time. The membership is in the statement (§7.1), a range is at most 62 days and both ends are dates `src/time.ts` accepts, else 400. Under
  `TUSK_DB_ENCRYPTION=on` the title is opened through `src/workspaces/content.ts`. Nothing is written.
- **The Desk's part** is a query of the working copy (`src/local/store.ts`): open and completed cards with a `dueDate` in the range, with their list's name and
  colour; opened by `DeskCipher` on a sealed Desk, as every query is. A card whose date cannot be read is left out, never placed on a guess.
- **The feed** (`src/planner/`, pure where it can be): `days(from, to)` makes the days of a range in the browser's zone (§11), `window` says which range to ask
  for next as the reader nears an end, and the screen (`src/screens/PlannerScreen.tsx`) holds the loaded ranges, asks for the next one before the end is
  reached (an `IntersectionObserver` at each end), and when days are added above keeps the day at the top where it was. It opens on today.
- **Empty days:** a day with nothing is a thin row. A run of three or more empty days folds into one row ("Mar 10 – 21 · nothing planned") that unfolds when
  tapped; today and the days beside it never fold.
- **Offline or refused:** the boards' part says it could not be loaded, with a way to try again; the Desk's part is still shown. The page is never blank.

**Accepts when:** the feed opens on today and scrolls up and down through months, loading as it goes without moving what the reader is looking at; a Desk card
and an assigned board card with dates appear on their days, and a board card not assigned to the person does not; leaving a board takes its cards out at the
next load; the route answers 401 without a session and returns another person's assigned cards to nobody (role matrix); runs of empty days fold and unfold;
with the network off the Desk's part is there and the boards' part says so; at a phone's width nothing scrolls sideways.

**Done as:** **`GET /api/planner?from=&to=`** (`src/planner/endpoint.ts`, `app/api/planner/route.ts`, in `src/access/routes.ts`): the open cards assigned to the signed-in account whose date is in the range, on boards `boardsVisibleTo` them, with the board's name and colour and the list's name (`src/workspaces/planned.ts`, titles and names opened through `content.ts`); the range is two real dates in order of at most 62 days (`src/planner/range.ts`, else 400). **`src/planner/feed.ts` is the pure part:** chunks of four weeks on a fixed grid (`chunkOf`, `chunkRange`) that the boards are read in and the window grows by; `deskEntries` and `boardEntries` make one kind of `Entry` of both halves (a Desk card whose date is ciphertext or not a date is left out, never placed on a guess); `groupByDate` and the order of a day (no time first, then by time, the Desk before a board, then by title: a total order); `layout`, which folds a run of three or more empty days into one row, never today or the day either side of it, and keeps a run open as the window makes it longer; `dayParts` and `gapLabel` for the words. **`PlannerScreen`** reads the Desk's cards and lists from the working copy (`visibleCards`, `listsOf`) and the boards' by chunk, opens on today, and **adds a chunk when the reader goes near an end by scrolling, wheel or touch, once for each move**: the chunk is read before the window grows, so what is added above arrives whole, and the reader's place is kept by the height that came. A scroll the feed made itself is recognised by its position and asks for nothing. If the boards cannot be had the Desk is still shown, with a way to try again. `/planner` is flush in `Frame` and its feed is its own scroller. Tests: the range, the six roles (the one assigned, and no other, whatever the role sees of the board), a range, an archived card, a card of a board the person left, 401 and 400 (on every database form, with `TUSK_TEST_OPERATOR` on and off), the feed's pure rules (each was seen to fail when broken), and in Chromium and WebKit a Desk card on tomorrow and an assigned board card on today with an unassigned one nowhere, the feed opening on today, a card opening where it is, a folded run opening, days arriving at both ends with the reader's place kept to the pixel, and nothing scrolling sideways at 390px. **Not as the epic said:** the epic had an `IntersectionObserver` at each end; a run of empty days is one short folded row, so the end stays in view and it asked for more for ever, which is why it is the reader's move that asks. A card in the feed is a link to where it is (a Desk card at `/desk/<list>?card=`, a board card at its own page); 19.2 makes it open over the Planner.

#### 📋 19.2 — A day's block

**Priority:** P1. **Goal:** a day looks like the screenshot the developer gave: its date at the side, then its cards in the order of the day.

**Design:** §25.1, §17.7. **Depends on:** 19.1.

**Technical:**

- **A day's head** at its left: the weekday and the date, today drawn as a filled circle in the accent token.
- **Order:** the cards with no time first, under "Any time", by their place in their list; then the timed cards by time ("1 PM", in the locale's 12- or 24-hour
  form). Every card is one fixed height.
- **A card** is a surface with a band of its list's or board's colour (a colour a person chose is data, drawn as a band, never a background with text on it,
  per `AGENTS.md`), its title, its time, and where it is from (the list or the board, small). A completed Desk card is ticked and muted; an overdue open one is
  in the danger colour.
- **Now:** on today, a line at the place in the timed cards where the current time falls, moving on the minute.
- **Tapping a card opens it,** over the Planner: a Desk card in `CardDetail` in the adaptive surface (a dialog, a sheet on a phone) at `/planner?card=<id>`; a
  board card in its card dialog. If the card dialog cannot stand outside its board, a board card opens at `/b/<board>/c/<card>` and Back returns to the
  Planner at the same day; the task says which it did. A change made there is in the feed when it closes.
- **Keyboard:** each card is a link or button in reading order; the shortcuts of §17.8 that name a card work on a focused one.

**Accepts when:** a day shows its untimed cards before its timed ones and those in time order; today's head and the line for now are drawn; colours come from
the tokens and a card's band, in light and dark; tapping a Desk card and a board card opens each, and an edit to its date moves it to its new day when closed;
it is the same in Chromium and WebKit, and at a phone's width.

#### 📋 19.3 — Adding from the feed

**Priority:** P1. **Goal:** tap an empty place and add a card there.

**Design:** §25.1. **Depends on:** 19.2.

**Technical:**

- **Where:** an empty day's row, the space after a day's last card, and the gap between two timed cards an hour or more apart, drawn as a dashed slot with a
  `+` ("Add at 2 PM"), as the screenshot's suggested slot is. A slot is a button, reachable by keyboard.
- **The quick add** is the footer's new-card form (7.3) with the date, and the time where the slot has one, filled in: a title, the list (the last list the
  person added to from the Planner, kept on the device; else the first), and Add. It writes to the working copy with the Desk's actions (`createCard`, then
  `setDue`), as every Desk card is made, so it is offline-safe and sealed on a sealed Desk; the card is in the feed at once.
- **Board cards are not made here** in this epic: a person adds those on the board.
- On a phone the footer's action button on the Planner opens the same quick add for today.

**Accepts when:** a card added from an empty day, from the end of a day and from a gap lands on that day (and at that time for a gap) in the chosen list, and
is in the Desk; the list chosen last is offered next time on that device; it works on a sealed Desk; the slots are reachable and usable by keyboard alone.

#### 📋 19.4 — Repeating cards as previews

**Priority:** P2. **Goal:** a repeating Desk card is seen on every day it will come, as far as the reader scrolls.

**Design:** §12, §25.1. **Depends on:** 19.2, 5.2.

**Technical:**

- **Previews are computed, never stored:** for each series whose current card has a date, the occurrences after it in the range shown, from
  `src/recurrence.ts` (`nextOccurrence` from the current one, stopping at the series' end, its count, or the range's end), with a cap per series per range.
- **A preview** is drawn like a card, lighter, with the repeat icon and no tick. Tapping it opens the series' current card; it cannot be completed or edited
  itself, since it is not a card. Completing the current card makes the next one, as §12.3 says, and the previews move with it.
- Board cards do not repeat (§12 is the Desk's), so there is nothing of theirs to preview.

**Accepts when:** a daily, a weekly and a monthly card each show on their next days in the range, and not before the current card; a series with an end or a
count stops there; completing the current card turns the first preview into the card; under three zones (`pnpm test:zones`) the days are the same.

#### 📋 19.5 — Start and end times, and a card's length

**Priority:** P3. **Goal:** a card can run from one time to another, and the Planner draws it as long as it is.

**Design:** §11, §15.1, §23.3, §25.1. **Depends on:** 19.2.

**Technical:**

- **The field:** an optional end, `dueEnd` (`HH:MM`, after the time on the same day; a span across days is a later question), beside `dueDate` and `dueTime`
  on a Desk card and a board card. The card's time becomes its start. On the Desk it is a new field of `desk_card` (`FIELD_NAMES`, the shared validator, sealed
  like the others on a sealed Desk, the convergence suite); on a board a column `due_end` of `card`, written only by `card.setDue` through `POST /api/ops`,
  decided in `content.ts` as structure; the migrations for both dialects by `pnpm db:generate`. `setDue` writes the three together, and refuses an end with no
  time or not after it.
- **The pickers** on the Desk's card and the board's card dialog gain "until" once a time is set. Export, import and backup carry the field.
- **In the Planner** a card with an end is as tall as its length on a scale of the day, never shorter than the fixed height; a card with only a start keeps the
  fixed height; the gaps of 19.3 are then the real free time between ends and starts.

**Accepts when:** an end can be set and cleared on both halves, and is refused when it is not after the start; it syncs between offline devices (convergence)
and is sealed on a sealed Desk; it is in an export and comes back in an import; in the Planner a card of two hours is twice the height of one of one hour, a
card with no end is the fixed height, and the free slots are the gaps between them; the migrations pass on sqld, a file and PostgreSQL.
