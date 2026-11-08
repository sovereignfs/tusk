# Epic 6: Views of the Desk

## Status

⏳ In progress: 6.1 and 6.2 are done. 6.1 and 6.2 are phase 1; Today, its cards and Review (6.3 to 6.5) are the phone's, in phase 2.

## Overview

Ways through the Desk beyond a list: a filter for what is starred, search, and on the phone, Today's agenda and Review as swipe views from the Desk's
action button. Each is computed in the browser, from the local store, so each works offline and on an encrypted Desk.

## Related

[`DESIGN.md`](../../DESIGN.md) §10.5, §10.7, §18, §25.3

## Tasks

#### ✅ 6.1 — Starred

**Goal:** see a list's starred cards alone.

**Design:** §10.5. **Depends on:** 3.10, 3.12.

**Technical:** Starred as a value of the Desk list's filter (All, Active, Starred, and Overdue with 4.3), in `src/lists/filter.ts`, pure. Remembered
with the list's other view settings. The Completed section follows the filter. (Tasks planned a Starred view across lists; the Desk's list view has no
place for one, and the Planner and Today cover "what matters" across lists in phase 2.)

**Accepts when:** the filter shows only starred, open cards and survives a reload; dragging is still possible under Custom; un-starring a card under the
filter takes it out of view without moving it.

**Done as:** `src/lists/filter.ts`, pure: the four filters (_All_, _Active_, _Starred_, _Overdue_) with their labels, `filterOf(list)` (anything unknown, missing or ciphertext is All), `filterCards(open, filter, now)` and `showsCompleted`. **The filter is now a field of the list,** `filter`, beside `sort` and `showCompleted`: a name in `FIELD_NAMES`, a rule in the server's validator that takes exactly the four, `setFilter` as the action, and §23.3's table updated. It survives a reload and reaches the person's other devices (3.10 had left it unremembered, as its epic did not ask). _Starred_ shows the open starred cards in the order they already have, with the pinning and the sort of the list unchanged; the Completed section is part of _All_ alone, so it follows the filter by not being there for the others, as it already was for _Active_ and _Overdue_. A filter only chooses what is shown: a card that is un-starred under _Starred_ leaves the view and is back in its place under _All_, and dragging under Custom works against the cards shown, as 3.6 does for any filter. Tests: the filters and their labels, the server taking each and nothing else, reading the list's field (and All for a missing, unknown or sealed one), `setFilter` as one change to one field, each filter's choice of cards without changing the input or its order, a star that cannot be read counting as none; and in Chromium and WebKit: Starred showing only the open starred cards with no Completed section, kept after a reload, a card dragged with the keyboard under it, and an un-starred card going without moving (All shows the order the drag made, with it where it was). **Not as the epic said:** none.

#### ✅ 6.2 — Search

**Goal:** find a Desk card by what it says.

**Design:** §10.7. **Depends on:** 3.12.

**Technical:** a search field at the top of the Desk's lists column, and `/desk?q=` showing results in the content column. `src/local/search.ts` scans
titles, descriptions and checklist items in the browser, with Unicode case folding, across the Desk, opened fields included on an encrypted Desk.
Checklist matches show under their card. Newest change first.

**Accepts when:** a search for `%` matches only a literal `%`; "É" finds "é"; it works offline and on an encrypted Desk; 10,000 cards search without
visible delay.

**Done as:** `src/local/search.ts` (pure) and `src/fold.ts` (the folding of a board's search, moved to a file both use, so the two agree: case and accents do not decide, "É" finds "é" and "e", "straße" finds "STRASSE"). `searchDesk(cards, checks, query, open?)` wants every word typed, in any order, somewhere on the card: in its title, its description or one of its checklist items. The query is compared as text with `includes`, never as a pattern, so `%`, `_`, `*`, `.`, `(` and `[a-z]` match themselves only. A checklist item that has a word comes back with its card, to be shown under it; a long description comes back as a piece around the first word found, with marks where it was cut. **Newest change first** is by the latest server stamp of the card or of an item that matched, a row the server has not heard of counting as the newest of all, then by when the card was made, then id, so there is one order. **A sealed field is read through `open`,** which is what a Desk with personal keys (14.3) will supply; without it a sealed field is not searched. `searchable(db)` in the store reads the cards a screen may show and their live items, and the screen computes over that, so typing re-works the hits and asks IndexedDB for nothing. The search field is at the top of the lists column (`type="search"`, "Search the Desk"): from a list's page the first letter goes to `/desk?q=`, and after that the address is replaced as it is typed (the back button is not a step for each letter); `DeskScreen` shows `SearchResults` in place of the first list when `q` is not empty, with a count read out politely, each card linking to where it is, its list, "Done" if it is, and Escape empties the field. Tests: words in each of the three places; the pattern characters matching themselves; folding; every word in any order across the three; items shown under their card; the order, with a tie broken two ways; a sealed field; the snippet; **ten thousand cards with three-line descriptions and two items each searched in about 30 ms** (the test allows 600); and in Chromium and WebKit: finding by title, description and item, "É" finding "café" and an item with "CAFÉ", `%` finding only the literal one, `(` finding nothing, the query kept in the address and the field after a reload, **a search with the network switched off**, a hit opening its card, and Escape. **Not as the epic said:** "on an encrypted Desk" is supported by `open` and not yet exercised, since the keys are 14.3's; the results page is not paged, and ten thousand matches would be a long list (a search of one word in so many cards is not what this is for).

#### ✅ 6.3 — Today (phase 2)

**Goal:** what needs attention on the Desk, from the phone's action button.

**Design:** §18, §25.3. **Depends on:** 4.3, 7.3.

**Technical:** `src/today.ts`, pure: `buildToday(cards, today)`, classifying and ordering (overdue oldest first, due today by time, starred by title),
once per card, leaving out any with `dismissedOn` equal to today. A full-screen swipe view (6.4) from the action button, as an overlay and not a
navigation, with a list form beside it.

**Accepts when:** `buildToday` is tested with no clock; closing shows the Desk underneath at its address.

**Done as:** **`src/today.ts`** (`buildToday`, `reasonFor`) is pure and reads no clock: the day and, optionally, the time are given. A card is in Today once, for the first reason that fits (overdue, due today, starred), and not when it is done, deleted, or **dismissed for today** (`dismissedOn` equal to the day); the order is overdue oldest first, due today by time (no time after a time), then starred by title, with title and id to settle a tie, so every device shows the same. With a time, a card due today at an hour that has passed is overdue. **Two fields are new on a card, `dismissedOn` and `reviewedAt`** (`src/sync/format.ts`, `validate.ts`: a date and a time, nullable, held with the others by the test that keeps the format and the rules in step); nothing else of the server or the database changed, since a field is a key of the card's JSON. The overlay is **`StackOverlay`** (`src/screens/StackOverlay.tsx`), the design system's `Dialog` (the whole screen on a phone) opened from the footer's action button over whatever page is open, **not a navigation**: closing it leaves the Desk at its address (the test holds the address). It has the cards one at a time (6.4) and **a list form beside them**, which names why each card is there. Tests: `src/today.test.ts` (the order, the exclusions, the day after, the time, and the same answer in any input order), `e2e/phone.spec.ts`. **Left out:** a count of Today on the footer.

#### ✅ 6.4 — Cards to swipe (phase 2)

**Goal:** go through cards one at a time, by swipe or button.

**Design:** §25.3. **Depends on:** 5.5, 6.3.

**Technical:** `src/cards/SwipeCards.tsx` over `SwipeStack` from `@sovereignfs/ui`, with `directions` labelled and buttons always shown. Up
`completeCard`; Down `cancelCard` (deletes with Undo; on a repeating card makes the next, Undo removing it if untouched); Left `dismissCard`, setting
`dismissedOn` to today, touching nothing else; Right `setStarred(true)`, due date untouched. Tapping a title opens the detail. Takes cards and an
`onSwipe` so that Review can use it with its own Left.

**Accepts when:** each gesture and each button does its action; Undo recovers a cancel and a dismiss; a dismissed card is gone from Today on every
device for the rest of that local day and back the next; it works with a keyboard alone.

**Done as:** **`src/cards/SwipeCards.tsx`** is the design system's `SwipeStack` over Desk cards with the four directions labelled and **a button for each always shown** (so a keyboard reaches each); it takes the cards and an `onSwipe(direction, card)` and decides nothing about what a direction means, so that Today and Review give it their own. A card that has been swiped is not shown again in the pass, and **tapping its title opens it**. The actions are `src/actions/phone.ts`, pure and tested: **Up** `completeCard` (a repeat makes its next, as ticking does); **Down** `cancelCard` (deletes with its checklist; **on a repeating card it makes the next occurrence in the same mutation and names it**, so that Undo restores the card and takes the made one away again if it is still open); **Left** `dismissCard` (sets `dismissedOn` to today and nothing else, with Undo through `restoreDismissal`); **Right** `setStarred(true)`, the due date untouched. Undo is the existing bar, which had to move: **`UndoProvider` now lives in `AppShell`**, since the footer's views are outside `Frame`, and the bar stands above the footer. Tests: `src/actions/phone.test.ts`, and `e2e/phone.spec.ts` in Chromium and WebKit by the buttons (Done completes, Dismiss hides it for the day and Undo brings it back, Today shows the Desk at its address underneath). **Left out, and said so:** the swipe gesture itself was not exercised in the Simulator or a touch test (the buttons use the same path as the drag); Undo of a cancel of a repeating card is held by the unit tests and not by a browser test; and a dismissed card's return the next day is held by `buildToday`'s test and not by a clock in a browser.

#### 📋 6.5 — Review (phase 2)

**Goal:** a resumable pass over the Desk, or one list, to prioritise it.

**Design:** §25.3. **Depends on:** 6.4, 7.3.

**Technical:** `src/review.ts`, pure: open cards, never-reviewed first, then least recently reviewed, then by position. `reviewedAt` as a field, set by
any swipe as part of that mutation. Today's swipes, with a count left, except that Left only marks it reviewed and moves on. From the action button and
from a list's menu.

**Accepts when:** stopping and returning continues with what hadn't been seen, on another device too; a left swipe here sets `reviewedAt` and not
`dismissedOn`; the order is tested with no clock.
