# Epic 8: Inbox and notifications

## Status

✅ The Inbox (8.1) is done and is phase 1; reminders, Push and email (8.2 to 8.6) are phase 2.

## Overview

In phase 1, a person is told in the app what happens on their boards: the Inbox, with notices written by the server as things happen, and the cards
assigned to them. In phase 2, a daily brief and due-time reminders, and the Inbox's notices, also reach them by Web Push and email, each switchable,
and by core's bell when hosted.

## Related

[`DESIGN.md`](../../DESIGN.md) §16, §19, §25.2 · `contracts/core-api`, `docs/specs/core-app.md` §4.1 and `docs/using-the-sdk.md` in `sovereign` ·
legacy's `runtime/src/push.ts` · the kanban plugin's `app/_lib/inbox.ts`

## Tasks

#### ✅ 8.1 — The Inbox

**Goal:** a person sees what they were assigned, what was said on their cards, and where they were added, and what is assigned to them.

**Design:** §16. **Depends on:** 16.3, 18.4, 18.6.

**Technical:**

- `notice` table; `src/workspaces/notices.ts`: `raise(tx, …)`, the one way an operation tells a person something, called inside the operation's
  transaction (16.1), never for the actor. Kinds: `assigned`, `comment`, `added_to_workspace`, `added_to_board`, and `workspace_passed` (2.8).
- `GET /api/inbox?before=`: notices newest first, in pages of 50, **leaving out any about a board the person can no longer see**, by the same
  membership subquery as everything else; and the open cards assigned to them across boards they can see, by due date, undated last.
- `/inbox`: Notifications grouped by day (`groupByDay`, pure, taking now), each naming who did what to which card or board and opening it; and
  Assigned to me. Loading gated by a skeleton.
- Unread: `account_settings.inbox_seen_at`, moved on by `POST /api/inbox/seen` when the Inbox is opened; the sidebar's Inbox entry shows the count of
  newer notices, up to "99+", fetched with the shell and on focus.
- Settings > Notifications: each kind on or off, saved with the account; a kind turned off is not written.
- The purge job trims notices older than 90 days and beyond the latest 500 a person.

**Accepts when:** assigning someone shows a notice in their Inbox and not the actor's; a comment notifies the assignees and the creator and not the
author; a notice about a board the person was removed from is not shown; the unread count goes to nothing on opening the Inbox, on every device; the
wrong account cannot read or mark one; day grouping is tested with no clock.

**Done as:** `src/workspaces/notices.ts` has `raise(tx, notice, now)`, **the one way an operation tells a person something,** called inside the operation's transaction: it writes nothing for the one who did it and nothing for a kind the person has turned off, and its `details` hold the name of what it is about as it was then (a card's title, a board's or a workspace's name). `assigned` and `comment` now go through it, and `member.add` and `boardMember.add` raise `added_to_workspace` and `added_to_board`. `GET /api/inbox` (`inboxOf`) reads a page of 50 newest first after a cursor of time and id (so a page never skips or repeats), **holding every notice to what the person can still see** in its statement (`board_id IN boardsVisibleTo` and `workspace_id IN workspacesOf`: a notice about a board they were taken off, that was made private to them, or that was deleted, or about a workspace they have left, is not shown, and comes back if they can see it again), with the actors' names read from the accounts; the first page also carries the open cards assigned to them on boards they can see, by due date with undated last, and the count unread. **Unread** is one time per person, `account_settings.inbox_seen_at` (migration `0003_inbox`), moved on by `POST /api/inbox/seen` (never back, the app's own address required) and counted up to 100 by `GET /api/inbox/unread`, so it is the same on every device. `/inbox` shows a skeleton until read, then Notifications grouped by day (`groupByDay`, pure: Today, Yesterday or the date in the person's own zone, given the time and the zone and reading no clock), each saying who did what and opening the card, board or workspace, with _Older notifications_ for the next page, and Assigned to me; opening it marks everything before now read and the sidebar's count goes to nothing at once. The sidebar has an **Inbox** entry whose count ("99+" at a hundred) is fetched with the shell and when the person comes back. **Settings > Notifications** (a section of the Settings dialog and page) turns each kind on or off, saved with the account through `PATCH /api/settings` (`noticesOff`, a list of the four kinds; `GET /api/settings` reads it); a kind turned off is not written at all, and those already in the Inbox stay. A job, `trim-notices` (hourly, from the start), removes notices older than 90 days and keeps each person's latest 500. Tests: the data layer on every leg (an assignment shown to the one assigned and not to the maker, who is told of a comment and not its author, being added to a board and to a workspace, **a notice hidden when the board is made private to the person and they are taken off it, or when they leave the workspace, and back when they can see it again**, a kind turned off not written, unread counted from the last opening, never back, to 100 and for one account only, the assigned cards by due date without archived ones or those of a board they were taken off, paging with no skip or repeat, and the trim of age and of count); the pure grouping under several zones, the notice text and links, and the "99+" label; the settings record; and in Chromium and WebKit the Inbox with an assigned card and the sidebar's entry, Settings > Notifications kept on the account and after a reload, and `401`, `400`, `403` and `204` for the routes. The visibility of notices, the actor, the turned-off kinds, and the trim were each removed in turn and the tests failed. **Not as the epic said:** `workspace_passed` is 2.8's and is not a kind yet; the instance has one account, and a notice is never for the one who did it, so who is told what is shown by the data layer and not by a browser.

#### 📋 8.2 — Notification settings for reminders (phase 2)

**Goal:** a person controls what reaches them outside the app.

**Design:** §19, §25.2. **Depends on:** 2.7, 4.1, 8.1.

**Technical:** Settings > Notifications gains: daily brief on or off, and its time; due-time reminders on or off; email on or off; Push on this device
(8.4); and for each Inbox kind, whether it is also sent. Each shows only if it can work here, with a sentence saying why not. The copy says where a
title goes.

**Accepts when:** each setting survives a reload; a server with no SMTP offers no email and refuses it too.

#### 📋 8.3 — Channels: email and core (phase 2)

**Goal:** fan-out beyond the Inbox.

**Design:** §25.2. **Depends on:** 2.3, 2.5, 8.1.

**Technical:** `src/notifications/channels.ts`: each with `send(notice)`, returning `sent`, `no_channel`, `retry_after`, `not_permitted` or `failed`,
all through `Promise.allSettled`. **Email:** `src/mail/`, with a template linking to Settings to turn it off. **Core:** `sv.app.notifications.send` to
the `sub`, with `key`, and text cut to core's limits (title 120, body 500). **First confirm in the SDK's code that `sv.app` needs no session or token
store;** record the answer. No `notifications:send`, or a core too old: logged once, and tried rarely.

**Accepts when:** against the test mailer and `createFakeCore`: each result is reached, including `core.fail` with `down`, `timeout`, `lost-answer` and a
`429`; one channel failing leaves another working; no title or `sub` reaches a log.

#### 📋 8.4 — Web Push (phase 2)

**Goal:** a notice reaches a device with the app closed.

**Design:** §17.9, §25.2. **Depends on:** 1.11, 8.2, 8.3.

**Technical:** `web-push` (MPL-2.0). `TUSK_VAPID_PUBLIC_KEY`, `TUSK_VAPID_PRIVATE_KEY` (`_FILE`), `TUSK_VAPID_SUBJECT`; none means no Push, and a partial
set stops the server. `push_subscription`, per device, turned on from that device. `POST`/`DELETE /api/push/subscription`. Sent as another channel of
8.3. 410 or 404 removes the subscription. The service worker's `push` handler shows it, and `notificationclick` opens its address. `People` deletes
subscriptions.

**Accepts when:** a test against a stand-in push service: a send arrives encrypted, and a dead subscription is removed; in a real Chromium, and the iOS
Simulator by hand, a notice shows with the app closed and opens the right address.

#### 📋 8.5 — The daily brief (phase 2)

**Goal:** once a local day, what is due.

**Design:** §25.2. **Depends on:** 1.6, 4.3, 8.2, 8.3.

**Technical:** `src/notifications/job.ts`, registered at one minute. For each distinct zone of accounts with it on, works out the local date and time,
and selects the accounts due. For each: in one transaction, claim by conditional update on `last_digest_on`, count Desk cards (from the mirrors) and
assigned board cards due today and overdue, and write the notice; a quiet day writes nothing and keeps the claim. Fan-out follows, with a few retries of
a failed channel on later ticks; core with key `digest-<date>`. Personal-key Desks are counted by times only (14.6).

**Accepts when:** two runners send one; a failed channel is retried, and the Inbox has it regardless; it respects zones either side of midnight; a
quiet day sends nothing; the job's time is passed in.

#### 📋 8.6 — Due-time reminders (phase 2)

**Goal:** a reminder when a card's time comes.

**Design:** §25.2. **Depends on:** 8.5.

**Technical:** in the same job: for each zone, open Desk cards of accounts with it on, and board cards assigned to them, `due_date = today`,
`due_time <= now`, not yet reminded, through a partial index, capped per tick. Claim per card and write the notice in one transaction; core with key
`due-<id>-<date>`. On `retry_after`, leave the rest to a later tick. Rescheduling clears the claim (4.2), so it fires again.

**Accepts when:** a card fires once, at its time in the account's zone; changing its time fires it again at the new one; yesterday's missed reminder is
not sent; a `429` delays and loses nothing.
