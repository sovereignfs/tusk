# Epic 7: Interface

## Status

⏳ In progress: 7.1 and 7.8 are done. The phone's foundations (7.9), the keyboard (7.6) and the accessibility pass (7.7) are phase 1; the phone's own
screens (7.2 to 7.5) are phase 2.

## Overview

The frame and how it behaves. One set of routes and one set of data, and what differs by width is only what is rendered. `DESIGN.md` §17.10 lists
traps the plugins paid for, and every task here checks against it.

## Related

[`DESIGN.md`](../../DESIGN.md) §17, §18

## Tasks

#### ✅ 7.1 — Desktop layout, over the local store

**Goal:** two rows and three columns, reading only from the local store.

**Design:** §17.2, §17.4. **Depends on:** 1.8, 13.3.

**Technical:**

- `app/(app)/layout.tsx`: `AppShell` (from 1.8) above `ThreeColumnLayout`: sidebar 280px, content with about 24px of padding, and the right sidebar at 360px, present only when `?task=` is set, which gives the two columns at first.
- Check the dimensions against the Shopper screenshot in a browser, and against Shopper's source if it can be had.
- Signed-in screens are client components, using `useLocal` (13.3). Actions go through `commit`.
- Closing the detail uses `router.replace` (§15.8).

**Accepts when:** with the network slowed or off, add, tick and drag all show at once and never flicker back; the right sidebar is hidden until a task is opened; a layout screenshot compared with the reference matches on column widths.

**Done as:** `app/(app)/layout.tsx` finds the session (`requireSession`, which `requireAccount` now calls), mounts `SyncProvider` for that account (13.3, 13.4), puts `AppShell` above the columns, and gives the account menu its Sign out; `app/(app)/home/page.tsx` is the first page in it, an account page in `routes.ts`. `/` sends someone who is signed in to `/home` until the landing page (2.2) makes `/` the first list by a rewrite. `src/screens/Frame.tsx` is the design system's `ThreeColumnLayout` with its defaults of 280 and 360 and about 24px of padding in the content: the right column is rendered only while `?task=` is set, so it is two columns at first. `Sidebar` reads `listsOf` and the new `openCounts` from the working copy through `useLocal`, shows each list with its colour dot (a token for each of the six, never a colour of its own) and its count of open top-level tasks, says "Loading your lists…" only on a device that has never synced and "No lists yet." after, and has an empty `PINNED` array that Today, Starred and Review add themselves to, since a link to a page that is not there is worse than none. `TaskDetail` reads the task from the copy and closes with `router.replace`, which a browser test shows adds no step to go back through. **A phone** gets the same routes and the same data with the sidebar and detail left out (`useIsMobile`), and nothing to scroll sideways; the mobile shell is 7.2. Measured in Chromium and WebKit at 1280px: the sidebar's column is 280px and the detail's 360px, there is no right column until a task is open, and the content starts past the sidebar's 24px padding; two screenshots (two columns, then three) were looked at and match the design. The shell and the layout were checked against the design's own numbers and not against the Shopper screenshot, which is not in this repository, so "matches the reference on column widths" is as far as the design records them. Browser tests (`e2e/layout.spec.ts`) seed a list and a task on the server as another device would, and a reload, which is a device starting, shows them with the colour and the count. Tests: store counts (deleted, completed, subtasks and ciphertext), field reading (a field that is ciphertext reads as nothing and never as ciphertext, each colour is a token). Not done: the acceptance's "with the network slowed or off, add, tick and drag all show at once and never flicker back", which needs tasks to add and tick and is checked by 3.4 and 3.6 where they are made; the notification bell in the header (8.1); and a screenshot comparison against the reference, for the reason above.

#### ✅ 7.8 — The Tusk shell

**Goal:** the header with the avatar menu, and the sidebar with Boards, Planner and Inbox above the workspaces, full, a rail or hidden.

**Design:** §17.2. **Depends on:** 7.1, 15.1.

**Technical:**

- **Header** (`AppShell`): the logo and "Tusk", linking home; the avatar on the right opening `UserMenu`, with a header of name and email, Settings
  (2.7 fills it) and Sign out. The `panel-left` toggle.
- **Sidebar** (`src/screens/AppSidebar.tsx`): Boards (`square-kanban`), Inbox (`inbox`, its count from 8.1), and Planner (`calendar`) shown only when a
  flag the Planner sets is on; then _My workspaces_ with a +, and _Shared with me_ at the bottom, filled by 16.2. Active state by address.
- **Three states,** full, rail (icons with names as tooltips and accessible names) and hidden, kept on the device per kind of page (`src/ui/sidebar.ts`,
  pure: the default is full on index pages and rail on `/desk` and `/b/…`). The Desk's lists column (3.12) is the Desk's own, not the app's sidebar.
- `Frame` from 7.1 becomes the Desk's layout; the app layout is the shell around every signed-in page.

**Accepts when:** each state is reached by the toggle and remembered after a reload; the defaults hold on the Desk and the boards index; with the
sidebar as a rail every entry still has a name for a screen reader; nothing in the shell waits on the network to paint.

**Done as:** `src/ui/sidebar.ts` is the pure rule: a state is `full`, `rail` or `hidden`; an address is a _canvas_ (`/`, `/home`, `/desk`, `/lists/…`, `/b/…`) or an _index_ (everything else), and `/` is the Desk because only someone signed in sees the app's layout and the proxy shows them the Desk at the front address; the defaults are full for an index and rail for a canvas; what is kept per kind of page is how it was shown and how it was shown last when not hidden, so that the header's button brings it back as it was; anything stored that is not what was written is ignored. `src/ui/useSidebar.ts` keeps it in `localStorage` (`tusk.sidebar`) through `useSyncExternalStore`, so that the server and the first paint agree on the default and a change in another tab is followed; a storage that cannot be read leaves the default; on a phone there is no sidebar and no button for one, whatever a desktop chose. The header (`AppShell`) has a slot before the logo for `SidebarToggle` (`panel-left`, named _Hide the sidebar_ or _Show the sidebar_, with `aria-expanded`); the avatar menu was already a name and address with Sign out, and Settings joins it with 2.7. `AppSidebar` is a `nav` called Tusk with its entries, a rail of 56px that names each by `aria-label` and `title`, a full sidebar of 220px that says it in words, and its own button to widen or narrow it. `AppFrame` puts it beside the page in every signed-in layout; the Desk's own three columns (`Frame`) stay inside the page until 3.12 moves them to the Desk's pages. 9 unit tests of the rule and 6 browser tests (the rail by default, widening and narrowing remembered, hiding and showing remembered, the Desk's columns still there with nothing scrolling sideways, a nonsense storage, a phone), in Chromium and WebKit. **Not as the epic said:** the sidebar holds one entry today, the **Desk** (`/home`), since Boards (16.4), the Inbox (8.1) and the Planner (phase 2) are not pages yet and a link to a page that is not there is worse than none; the Desk's entry goes when Boards holds its tile (16.4). _My workspaces_, _Shared with me_ and their + wait for 16.2. The unread count on the Inbox waits for 8.1. Settings in the menu waits for 2.7.

#### 📋 7.9 — The phone's foundations

**Goal:** every phase 1 screen works at a phone's width, and the shell can take the phone's footer in phase 2 without a route changing.

**Design:** §17.1, §18. **Depends on:** 7.8, 17.1, 18.2.

**Technical:** at 768px and under, in the same layout: the sidebar becomes a `Drawer` from the header's toggle (the footer of five replaces it in
phase 2, 7.3); the Desk shows one column at a time (lists, a list, a card's detail as a full page); a board scrolls its columns sideways with snap; the
card dialog is full-screen. A slot in `AppShell` for a footer, empty in phase 1. No `matchMedia` branch decides data or routes; a test over `app/` and
`src/` refuses one. `MobileHeader` from the design system if it fits the header of §18.

**Accepts when:** every page of §17.11 is usable at 375px in Chromium and WebKit, by a browser test of each; the iOS Simulator by hand for the Desk and a
board, stated in the PR; no route differs by width.

#### ✅ 7.6 — Keyboard

**Goal:** the common actions without a mouse, on the Desk and on a board.

**Design:** §17.8. **Depends on:** 3.12, 18.1.

**Technical:** a listener on the page: `n` a new card (in the list on screen, or a board's first list), `/` search, `j`/`k` and arrows to move between
cards, `e` to complete a Desk card, `Enter` to open, `Esc` to close, `?` for a list of them. Ignored in `INPUT`, `TEXTAREA`, `SELECT` or
`contenteditable`, or with a modifier held. A visible focus ring moving between cards. Drag by keyboard is dnd-kit's (3.6, 18.1).

**Accepts when:** a Playwright test does the capture and complete journey on the Desk, and moves a card between lists on a board, with the keyboard
alone; typing an `n` in a title adds nothing.

**Done as:** `src/keys/rules.ts` (pure) decides what a key asks for, and `src/keys/Shortcuts.tsx`, mounted in the signed-in frame, does it. **The rules:** `n` a new card, `/` search, `j` and `k` the next and previous card (the down and up arrows too, but only once a card has the focus, so the page still scrolls), `e` completes the card in focus, `Esc` closes, `?` lists them, and Enter opens the card in focus, which the link or tile does itself. **Nothing counts while typing** (an input, a textarea, a select or an editable region), **or with ctrl, cmd or alt** held, or with shift but for `?`; a key something has already handled is not looked at again; and **a card lifted by the keyboard keeps the arrows, Space and Escape for its drag** (dnd-kit marks its handle as pressed). Escape in a field **leaves the field** and the next one closes; it closes the card's detail on the Desk (`?card=`) only when nothing else has an Escape of its own open (a dialog, a menu, a list of choices, a picker in the detail, the bar of chosen cards). **The page finds things by marks, so a screen takes part by carrying them:** `data-shortcut="new-card"` (the Desk's add field; a board's "Add a card" button, which `n` presses, so the first list's) and `data-shortcut="search"` (the lists column's field; the board's search, whose own `/` handler is gone), and `data-shortcut-card` on a Desk row's link and a board's tile, in the order they are in. `e` ticks the box of the card's row and moves the focus to the card that takes its place. The help (`?`) is a dialog listing the keys. Tests: the rules for every key, in and out of a field, with each modifier, on and off a card, during a drag, and the help listing; and in Chromium and WebKit, **with no mouse**: on the Desk, `n`, typing (an `n` and a title with several in it are only letters), Enter, a second card, `j`, `k` and the arrows, `e` completing with the focus going on, Enter opening the card, `e` and `n` typed in its title being letters, Escape leaving the field and then closing the card, `?` and Escape, `/` into the search and Escape; on a board, `n` adding a card to the first list ("banana"), `j` taking it, and Space, the right arrow and Space moving it to the next list, kept after a reload. **Not as the epic said:** "a visible focus ring moving between cards" is the browser's focus ring on the link or tile that takes the focus, and was looked for in the tests only as the focus moving; `e` is the Desk's and does nothing on a board.

#### 📋 7.7 — Accessibility pass

**Goal:** the check that each task's conditions added up.

**Design:** §17.8. **Depends on:** 3.11, 7.6, 7.9, 17.6, 18.7.

**Technical:** `@axe-core/playwright` on every page of §17.11, in light and dark, at both widths, in CI. Focus return from dialogs and menus. A drag's
result announced. Reduced motion honoured. VoiceOver through the main journeys, by hand. What is wrong in `@sovereignfs/ui` is fixed there.

**Accepts when:** axe reports no serious or critical violation; journeys 3 to 6 of `DESIGN.md` §3 are done with VoiceOver, and written up in the epic.

#### 📋 7.2 — The Desk carousel and the boards on a phone (phase 2)

**Goal:** the phone's own Desk and boards, at the same addresses.

**Design:** §18. **Depends on:** 7.9.

**Technical:** `SwipableMobileCarousel` with `useCarouselRouteSync`: the Desk as one slide per list; a board as one slide per column; a route that is not a
slide rendering itself. Neighbouring Desk slides are already in the local store, so a swipe never shows a spinner.

**Accepts when:** one swipe shows no spinner on the Desk; swiping changes the address and reload returns there; checked in the iOS Simulator, and the PR
says so.

#### 📋 7.3 — The footer and its action button (phase 2)

**Goal:** Desk | Boards | Action | Planner | Inbox, with an action that changes with the view.

**Design:** §18. **Depends on:** 7.2.

**Technical:** `MobileFooter` with five slots, the centre one the action button (with an accessible name for each of its forms; if the design system's
footer cannot take five or a changing centre, it is changed there). On the Desk it opens four: the list selector and a new list; a new card in a dialog,
its target the list on screen; Today (6.3); Review (6.5). On Boards: a new board, a new workspace. Inside a board: a new list, a new card. Elsewhere,
what fits.

**Accepts when:** a card added from a list's slide lands in it; each button and each form of the action has a name for a screen reader; the footer
publishes its height so sheets clear it.

#### 📋 7.4 — Sheets and adaptive surfaces (phase 2)

**Goal:** a card's detail, menus and pickers fit a phone.

**Design:** §18, §17.10. **Depends on:** 7.2.

**Technical:** a Desk card's detail and a board card full-screen, siblings of the carousel's scroller and never inside a slide; menus as bottom sheets;
pickers through `Popover` above and `Drawer` under. No `transform` on an ancestor of a `Drawer`; sticky headers opaque, and
`overscroll-behavior-y: none` on scrolling columns. Moving a board card between lists by its menu, never a drag.

**Accepts when:** in the iOS Simulator: a sheet opens, scrolls, closes and reaches its last control above the footer; a sticky header does not bounce
away; "Move to…" moves a card between columns.

#### 📋 7.5 — Touch gestures (phase 2)

**Goal:** reorder, select and reveal, with none fighting the carousel.

**Design:** §18. **Depends on:** 7.2.

**Technical:** on the Desk, reorder from a **visible** handle at the row's edge, by long press (`TouchSensor`, 300 ms); on a board, a card reordered in
its column by long press; `data-no-dnd` on controls; `autoScroll` vertical only. Long press on a Desk row's body starts selection. `useSwipeReveal` for
Done and Delete, from a zone clear of the star, with Delete offering Undo. A horizontal swipe moves the carousel.

**Accepts when:** in the iOS Simulator: each gesture does its own thing, and none starts another; a reorder does not move the carousel; a tap on a
checkbox or star is never a lift.
