# Epic 7: Interface

## Status

📋 Planned

## Overview

The frame and how it behaves. One set of routes, one set of data, and what differs by width is only what is rendered. 7.1 comes before the screens that use it; the rest follows them. `DESIGN.md` §13.7 lists traps the plugin paid for, and every task here checks against it.

## Related

[`DESIGN.md`](../../DESIGN.md) §13

## Tasks

#### 📋 7.1 — Three columns and the client store

**Goal:** the desktop layout, and the data flow that ends the plugin's timing bugs.

**Design:** §13.2, §13.3. **Depends on:** 1.8, 2.1.

**Technical:**
- `app/(app)/layout.tsx`: `ThreeColumnLayout` inside `AppShell`: sidebar, pane, and detail when `?task=` is set.
- `src/ui/store.tsx`: a client store seeded from server props, by list. `apply(optimistic, action)`: changes at once, calls the action, takes the rows it returns as the truth, rolls back with a toast on failure. **Nothing depends on `router.refresh()`.** New server props reseed what is not in flight.
- Closing the detail uses `router.replace` (§13.7). `loading.tsx` per route, with the header kept.

**Accepts when:** with an artificial delay on actions, add, tick and drag each show at once and never flicker back; a failed action rolls back and says so; a test with two rapid edits to one task ends on the later one.

#### 📋 7.2 — The mobile carousel

**Goal:** swipe between lists, at the same addresses.

**Design:** §13.2, §13.3. **Depends on:** 3.3, 3.4, 6.1.

**Technical:** at 768px and under, `SwipableMobileCarousel` with `useCarouselRouteSync`, in the same layout, forking only what is rendered: Lists index, Starred, one slide per list; landing on the first list. No `matchMedia` branch deciding data or routes, and server output is the first paint at every width (no double mount). Neighbouring slides fetched ahead through the store, and refreshed on focus if over a minute old. `MobileFooter`: Lists, Today, search, with `--sv-shell-footer-height` measured and set. A route that is not a slide renders itself.

**Accepts when:** one swipe shows no spinner; swiping changes the address and reload returns there; a cold load fires each fetch once; `/search` and `/today` work at phone width. Checked in the iOS Simulator, and the PR says so.

#### 📋 7.3 — Sheets and adaptive surfaces

**Goal:** detail, list editing and pickers fit a phone.

**Design:** §13.2. **Depends on:** 7.2.

**Technical:** task detail in a `Sheet`, a sibling of the carousel's scroller and never inside a slide, opened by the same `?task=`. Swiping to another list closes it. List editing in a `Sheet`. Date and repeat pickers through `Popover` above and `Drawer` under. No `transform` on an ancestor of a `Drawer` (§13.7); sticky headers opaque, and `overscroll-behavior-y: none` on scrolling columns.

**Accepts when:** in the iOS Simulator: a sheet opens, scrolls, closes and reaches its last control above the footer; a menu is a proper bottom sheet; a sticky header does not bounce away.

#### 📋 7.4 — Touch gestures

**Goal:** reorder, select and reveal, with none fighting the carousel.

**Design:** §13.5. **Depends on:** 3.6, 7.2.

**Technical:** reorder from a **visible** handle at the row's edge, by long press (`TouchSensor`, 300 ms); `data-no-dnd` on controls; `autoScroll` vertical only. Long press on the row body starts selection (`useLongPress`). `useSwipeReveal` for Done and Delete, from a zone clear of the star, with Delete offering Undo. A horizontal swipe on a row body moves the carousel.

**Accepts when:** in the iOS Simulator: each gesture does its own thing, and none starts another; a reorder does not move the carousel; a tap on a checkbox or star is never a lift.

#### 📋 7.5 — Keyboard

**Goal:** the common actions without a mouse.

**Design:** §13.5. **Depends on:** 3.4, 3.9.

**Technical:** a listener on the page: `n`, `j`/`k` and arrows, `e`, `Enter`, `[` and `]`, `Esc`, `?` for a list of them. Ignored in `INPUT`, `TEXTAREA`, `SELECT` or `contenteditable`, or with a modifier held. A visible focus ring moving between rows.

**Accepts when:** a Playwright test does the capture and complete journey with the keyboard alone; typing an `n` in a title adds nothing.

#### 📋 7.6 — Accessibility pass

**Goal:** the check that each task's conditions added up.

**Design:** §13.5. **Depends on:** 3.11, 6.3, 7.3, 7.4, 7.5.

**Technical:** `@axe-core/playwright` on every page, in light and dark, at both widths, in CI. Move up and Move down in a row's menu. Focus return from sheets and dialogs. Reduced motion honoured. VoiceOver through the main journey, by hand. What is wrong in `@sovereignfs/ui` is fixed there.

**Accepts when:** axe reports no serious or critical violation; the journey of `DESIGN.md` §3 is done with VoiceOver, and written up in the epic.
