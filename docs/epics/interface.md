# Epic 7: Interface

## Status

📋 Planned

## Overview

The frame and how it behaves. One set of routes and one set of data, and what differs by width is only what is rendered. `DESIGN.md` §15.8 lists traps the plugin paid for, and every task here checks against it.

## Related

[`DESIGN.md`](../../DESIGN.md) §15

## Tasks

#### 📋 7.1 — Desktop layout, over the local store

**Goal:** two rows and three columns, reading only from the local store.

**Design:** §15.2. **Depends on:** 1.8, 13.3.

**Technical:**

- `app/(app)/layout.tsx`: `AppShell` (from 1.8) above `ThreeColumnLayout`: sidebar 280px, content with about 24px of padding, and the right sidebar at 360px, present only when `?task=` is set, which gives the two columns at first.
- Check the dimensions against the Shopper screenshot in a browser, and against Shopper's source if it can be had.
- Signed-in screens are client components, using `useLocal` (13.3). Actions go through `commit`.
- Closing the detail uses `router.replace` (§15.8).

**Accepts when:** with the network slowed or off, add, tick and drag all show at once and never flicker back; the right sidebar is hidden until a task is opened; a layout screenshot compared with the reference matches on column widths.

#### 📋 7.2 — The mobile shell and carousel

**Goal:** header, carousel of lists, footer, at the same addresses.

**Design:** §15.1, §15.3. **Depends on:** 3.3, 3.4.

**Technical:** at 768px and under, in the same layout, forking only what is rendered. `MobileHeader`: logo and name, bell and avatar. `SwipableMobileCarousel` with `useCarouselRouteSync`, one slide per list, with a route that is not a slide rendering itself. No `matchMedia` branch deciding data or routes. `MobileFooter`'s three slots, wired in 7.3.

**Accepts when:** one swipe shows no spinner; swiping changes the address and reload returns there; `/search` and `/today` work at phone width. Checked in the iOS Simulator, and the PR says so.

#### 📋 7.3 — The footer: switcher, add, Today

**Goal:** the three footer buttons.

**Design:** §15.3. **Depends on:** 7.2.

**Technical:** `MobileFooter` needs `onOpenApps` and `launcherIcon` for its centre slot; use them for Add, with a + icon and an accessible name, and if its label can't say "Add", change it in `@sovereignfs/ui`. **Left:** a `Sheet` for switching lists: "Review all tasks", Starred, then lists with dot and count. **Middle:** a `Sheet` with a title and a list picker, its target the list on screen, or the one used last from a view with none, staying open for another. **Right:** opens Today.

**Accepts when:** a task added from a list's slide lands in it; the target can be changed; each button has a name for a screen reader; the switcher jumps to the right slide.

#### 📋 7.4 — Sheets and adaptive surfaces

**Goal:** detail, list actions and pickers fit a phone.

**Design:** §15.3. **Depends on:** 7.2.

**Technical:** task detail in a `Sheet`, a sibling of the carousel's scroller and never inside a slide, opened by the same `?task=`. Swiping to another list closes it. Date and repeat pickers through `Popover` above and `Drawer` under. No `transform` on an ancestor of a `Drawer` (§15.8); sticky headers opaque, and `overscroll-behavior-y: none` on scrolling columns.

**Accepts when:** in the iOS Simulator: a sheet opens, scrolls, closes and reaches its last control above the footer; a menu is a proper bottom sheet; a sticky header does not bounce away.

#### 📋 7.5 — Touch gestures

**Goal:** reorder, select and reveal, with none fighting the carousel.

**Design:** §15.5. **Depends on:** 3.6, 7.2.

**Technical:** reorder from a **visible** handle at the row's edge, by long press (`TouchSensor`, 300 ms); `data-no-dnd` on controls; `autoScroll` vertical only. Long press on the row body starts selection (`useLongPress`). `useSwipeReveal` for Done and Delete, from a zone clear of the star, with Delete offering Undo. A horizontal swipe on a row body moves the carousel.

**Accepts when:** in the iOS Simulator: each gesture does its own thing, and none starts another; a reorder does not move the carousel; a tap on a checkbox or star is never a lift.

#### 📋 7.6 — Keyboard

**Goal:** the common actions without a mouse.

**Design:** §15.5. **Depends on:** 3.4, 3.9.

**Technical:** a listener on the page: `n`, `j`/`k` and arrows, `e`, `Enter`, `[` and `]`, `Esc`, `?` for a list of them. Ignored in `INPUT`, `TEXTAREA`, `SELECT` or `contenteditable`, or with a modifier held. A visible focus ring moving between rows.

**Accepts when:** a Playwright test does the capture and complete journey with the keyboard alone; typing an `n` in a title adds nothing.

#### 📋 7.7 — Accessibility pass

**Goal:** the check that each task's conditions added up.

**Design:** §15.5. **Depends on:** 3.11, 6.5, 7.4, 7.5, 7.6.

**Technical:** `@axe-core/playwright` on every page, in light and dark, at both widths, in CI. Move up and Move down in a row's menu. Focus return from sheets and dialogs. Reduced motion honoured. VoiceOver through the main journey, by hand. What is wrong in `@sovereignfs/ui` is fixed there.

**Accepts when:** axe reports no serious or critical violation; the journey of `DESIGN.md` §3 is done with VoiceOver, and written up in the epic.
