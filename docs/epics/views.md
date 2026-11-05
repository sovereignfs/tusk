# Epic 6: Views of the Desk

## Status

📋 Planned. 6.1 and 6.2 are phase 1; Today, its cards and Review (6.3 to 6.5) are the phone's, in phase 2.

## Overview

Ways through the Desk beyond a list: a filter for what is starred, search, and on the phone, Today's agenda and Review as swipe views from the Desk's
action button. Each is computed in the browser, from the local store, so each works offline and on an encrypted Desk.

## Related

[`DESIGN.md`](../../DESIGN.md) §10.5, §10.7, §18, §25.3

## Tasks

#### 📋 6.1 — Starred

**Goal:** see a list's starred cards alone.

**Design:** §10.5. **Depends on:** 3.10, 3.12.

**Technical:** Starred as a value of the Desk list's filter (All, Active, Starred, and Overdue with 4.3), in `src/lists/filter.ts`, pure. Remembered
with the list's other view settings. The Completed section follows the filter. (Tasks planned a Starred view across lists; the Desk's list view has no
place for one, and the Planner and Today cover "what matters" across lists in phase 2.)

**Accepts when:** the filter shows only starred, open cards and survives a reload; dragging is still possible under Custom; un-starring a card under the
filter takes it out of view without moving it.

#### 📋 6.2 — Search

**Goal:** find a Desk card by what it says.

**Design:** §10.7. **Depends on:** 3.12.

**Technical:** a search field at the top of the Desk's lists column, and `/desk?q=` showing results in the content column. `src/local/search.ts` scans
titles, descriptions and checklist items in the browser, with Unicode case folding, across the Desk, opened fields included on an encrypted Desk.
Checklist matches show under their card. Newest change first.

**Accepts when:** a search for `%` matches only a literal `%`; "É" finds "é"; it works offline and on an encrypted Desk; 10,000 cards search without
visible delay.

#### 📋 6.3 — Today (phase 2)

**Goal:** what needs attention on the Desk, from the phone's action button.

**Design:** §18, §25.3. **Depends on:** 4.3, 7.3.

**Technical:** `src/today.ts`, pure: `buildToday(cards, today)`, classifying and ordering (overdue oldest first, due today by time, starred by title),
once per card, leaving out any with `dismissedOn` equal to today. A full-screen swipe view (6.4) from the action button, as an overlay and not a
navigation, with a list form beside it.

**Accepts when:** `buildToday` is tested with no clock; closing shows the Desk underneath at its address.

#### 📋 6.4 — Cards to swipe (phase 2)

**Goal:** go through cards one at a time, by swipe or button.

**Design:** §25.3. **Depends on:** 5.5, 6.3.

**Technical:** `src/cards/SwipeCards.tsx` over `SwipeStack` from `@sovereignfs/ui`, with `directions` labelled and buttons always shown. Up
`completeCard`; Down `cancelCard` (deletes with Undo; on a repeating card makes the next, Undo removing it if untouched); Left `dismissCard`, setting
`dismissedOn` to today, touching nothing else; Right `setStarred(true)`, due date untouched. Tapping a title opens the detail. Takes cards and an
`onSwipe` so that Review can use it with its own Left.

**Accepts when:** each gesture and each button does its action; Undo recovers a cancel and a dismiss; a dismissed card is gone from Today on every
device for the rest of that local day and back the next; it works with a keyboard alone.

#### 📋 6.5 — Review (phase 2)

**Goal:** a resumable pass over the Desk, or one list, to prioritise it.

**Design:** §25.3. **Depends on:** 6.4, 7.3.

**Technical:** `src/review.ts`, pure: open cards, never-reviewed first, then least recently reviewed, then by position. `reviewedAt` as a field, set by
any swipe as part of that mutation. Today's swipes, with a count left, except that Left only marks it reviewed and moves on. From the action button and
from a list's menu.

**Accepts when:** stopping and returning continues with what hadn't been seen, on another device too; a left swipe here sets `reviewedAt` and not
`dismissedOn`; the order is tested with no clock.
