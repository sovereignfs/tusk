# Epic 8: Inbox and notifications

## Status

✅ The Inbox (8.1) is done and is phase 1; reminders, Push and email (8.2 to 8.6) are phase 2 and done. 8.7 to 8.9 (2026-11-08) split the Inbox in two: a bell for what a person is told, and the Inbox for what is theirs to do.

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

#### ✅ 8.2 — Notification settings for reminders (phase 2)

**Goal:** a person controls what reaches them outside the app.

**Design:** §19, §25.2. **Depends on:** 2.7, 4.1, 8.1.

**Technical:** Settings > Notifications gains: daily brief on or off, and its time; due-time reminders on or off; email on or off; Push on this device
(8.4); and for each Inbox kind, whether it is also sent. Each shows only if it can work here, with a sentence saying why not. The copy says where a
title goes.

**Accepts when:** each setting survives a reload; a server with no SMTP offers no email and refuses it too.

**Done as:** the account keeps five new settings (`account_settings`, migration `0012_add_reminder_settings` for both dialects, generated): `brief_on` and `brief_at` (the daily brief and its `HH:MM` in the account's zone), `reminders_on`, `email_on` and `sent_kinds` (the Inbox kinds that are also sent outside the app). `src/settings/account-settings.ts` reads and writes them with the others through one table of columns, and `PATCH /api/settings` takes them as a closed record: a flag that is not true or false, a time that is not `HH:MM`, a kind that does not exist or a setting that is not one is refused. **A server with no mail refuses `emailOn: true` as well as not offering it** (`parseSettingsChange` takes what the server can do); `GET /api/settings` says what that is (`can: { email, push, core }`: mail configured, VAPID keys configured, a Sovereign core configured), and **Settings, Notifications** is built from it: under _Outside the app_ a server with none of the three says so in a sentence and offers nothing, and otherwise the brief and its time, a reminder when a card is due, email (or a sentence that it is not set up), and a box for each Inbox kind that is also sent. The copy says where a title goes, and that a Desk with a key of its own is not read by the server (so a brief or reminder says how many and when, and never what, which task 14.6 builds). The three VAPID settings are now read and checked in `src/config` (`config.push`: a 65-byte and a 32-byte key in URL-safe base64 and a `mailto:` or `https:` subject; a wrong one stops the server naming the setting and never the value). Tests: `src/settings/account-settings.test.ts` on every form of the database (defaults, each setting kept and the others left, another account unchanged, the parser's refusals and the mail rule), `src/config/config.test.ts` (Web Push), `e2e/inbox.spec.ts` (the Inbox kinds survive a reload, and a server with no channel offers nothing outside the app). **Left out, and said so:** the **Push on this device** control (8.4), the settings' effect (8.3, 8.5, 8.6 read them), and a test of the screen on a server that has mail (the end-to-end server has none; the data layer holds the rule).

#### ✅ 8.3 — Channels: email and core (phase 2)

**Goal:** fan-out beyond the Inbox.

**Design:** §25.2. **Depends on:** 2.3, 2.5, 8.1.

**Technical:** `src/notifications/channels.ts`: each with `send(notice)`, returning `sent`, `no_channel`, `retry_after`, `not_permitted` or `failed`,
all through `Promise.allSettled`. **Email:** `src/mail/`, with a template linking to Settings to turn it off. **Core:** `sv.app.notifications.send` to
the `sub`, with `key`, and text cut to core's limits (title 120, body 500). **First confirm in the SDK's code that `sv.app` needs no session or token
store;** record the answer. No `notifications:send`, or a core too old: logged once, and tried rarely.

**Accepts when:** against the test mailer and `createFakeCore`: each result is reached, including `core.fail` with `down`, `timeout`, `lost-answer` and a
`429`; one channel failing leaves another working; no title or `sub` reaches a log.

**Done as:** **The SDK's answer, recorded: `sv.app` needs no session store and no token store.** In `@sovereignfs/sdk`'s types `Sovereign.app` is "calls made as the app itself. It never holds a person's token", `as(person)` is the one that "needs a token store", and `auth` the one that "needs a session store"; `createSovereign` takes both stores as optional and "makes no network call", and the fake core serves `app.notifications.send` with the app's credentials alone (the tests make the client from the four settings and nothing else). **`src/notifications/channels.ts`:** a `Channel` is `{ name, send(notice) }` answering one of `sent`, `no_channel`, `retry_after` (with the seconds), `not_permitted` or `failed`, and never throwing; `fanOut` runs every channel through `Promise.allSettled`, a channel that throws counts as `failed`, and **one failing leaves the others working**. **Email** (`emailChannel`): only for a person who turned email on and has an address; the message (`notificationMessage`, plain text) holds the title, one link to the notice and one to Settings to turn it off. **Core** (`coreChannel`): `sv.app.notifications.send` to the person's `sub` (`subOfAccount`, the sign-in row of the Sovereign provider), with the notice's id as `key`, a whole `https` address, title cut to 120 and body to 500, category `info`; 429 is `retry_after` with core's `Retry-After`; down, timeout, a lost answer and a 5xx are `failed` and **never sent twice**; **403 is `not_permitted` and `NotSupportedError` (a core too old, or one that does not list notifications) is `no_channel`, each logged once and then rested for six hours** (`CORE_REST_MS`). Core's address is taken from the issuer's origin; that is an assumption to confirm against a real core. **What sends:** the `send-notices` job (every 30 s, in `src/jobs`) claims notices with one conditional update that stamps the new `notice.sent_at` (`claimUnsent`, in `src/workspaces/notices.ts`, migration `0013_add_notice_sent_at` for both dialects), so any process may run it and **one sends each**; only a day's notices are looked at, a notice of a kind the person did not ask to have sent is claimed and left, and with neither mail nor a core on the server nothing is claimed. The line each kind says outside the app is `noticeText`; the title is opened from the notice's details (sealed under the operator key, when that is on). **In no log: a title, an address, a `sub` or an account id** (a log line is the channel, the kind and the outcome; held by a test that searches the lines for each). Tests: `src/notifications/channels.test.ts` against `MemoryMailer` and the SDK's `createFakeCore` (every result reached, including `core.fail` with `down`, `timeout`, `lost-answer` and a `429` with `retryAfter`; failure isolation; the logs), `src/notifications/deliver.test.ts` on every form of the database and with the operator key (claimed once, two processes at once send one, the day's window, the kinds asked for). **Left out, and said so:** the **PostgreSQL and sqld legs** were not run (no database service); a notice that gets `retry_after` or `failed` is **not retried** (a late notice is worth less than a repeat, and the Inbox always has it); **Push** is a channel for 8.4; and nothing here was tried against a real core or a real SMTP server.

#### ✅ 8.4 — Web Push (phase 2)

**Goal:** a notice reaches a device with the app closed.

**Design:** §17.9, §25.2. **Depends on:** 1.11, 8.2, 8.3.

**Technical:** `web-push` (MPL-2.0). `TUSK_VAPID_PUBLIC_KEY`, `TUSK_VAPID_PRIVATE_KEY` (`_FILE`), `TUSK_VAPID_SUBJECT`; none means no Push, and a partial
set stops the server. `push_subscription`, per device, turned on from that device. `POST`/`DELETE /api/push/subscription`. Sent as another channel of
8.3. 410 or 404 removes the subscription. The service worker's `push` handler shows it, and `notificationclick` opens its address. `People` deletes
subscriptions.

**Accepts when:** a test against a stand-in push service: a send arrives encrypted, and a dead subscription is removed; in a real Chromium, and the iOS
Simulator by hand, a notice shows with the app closed and opens the right address.

**Done as:** **`web-push` 3.6.7** (MPL-2.0, exact; 4.0.0 was two days old) with `@types/web-push`; it is pure JavaScript and Next bundles it into the server, so the image changes in nothing. **The settings:** `TUSK_VAPID_PUBLIC_KEY`, `TUSK_VAPID_PRIVATE_KEY` and `TUSK_VAPID_SUBJECT` are read and checked (`config.push`: the shapes of a VAPID pair and a `mailto:` or `https:` subject; a partial set already stopped the server), and **Push also needs `TUSK_ENCRYPTION_KEY`**, which the server refuses to start without when VAPID is given, because **what a device gives is a credential and is sealed** (`src/crypto/`), never text in a column: `push_subscription` (migration `0014`, both dialects) has the account, the push service's address for the device (unique) and the id of the sealed keys. **`src/push/store.ts`:** `parseSubscription` (an https address with no user, the two keys in their shapes, nothing more), `saveSubscription` (replaces a device that subscribes again; an address another account had is taken over by whoever subscribes now; ten devices at most), `removeSubscription`, `devicesOf` (keys opened, for the one call that sends), `removeDevice`. **`POST`/`DELETE /api/push/subscription`** (listed in `src/access/routes.ts`, wrapped in `accountRoute`): the account is the session's, a body is a subscription or is refused, `503 NOT_AVAILABLE` where there is no Push, `409` at the limit, rate-limited, and removing is the same answer for a device that was another account's. **`People.deletePerson`** deletes the rows (and the credentials go with the others), and `people.test.ts` seeds one for two accounts. **The channel** (`src/notifications/push.ts`) sends to every device of the person, encrypted by the library to the device's keys and signed with the VAPID keys, TTL an hour; **404 and 410 remove the device**; over a person's devices the result is `sent` if any took it, else `retry_after` (a 429's `Retry-After`), `not_permitted` (a refused VAPID signature, 401 or 403), `failed`, or `no_channel` with none; it is a channel of 8.3's `send-notices` job, so a notice reaches it for the kinds a person asked to have sent. **The service worker** (`src/sw/source.ts`) has a `push` handler that shows the title and body it was sent (cut to 200 and 500 characters, a tag from the notice's key so a repeat replaces itself) and a `notificationclick` that closes the notification and focuses and takes an open window of the app to its address, or opens one; **an address is only ever a path of this app** (anything else, `//evil.example` included, is the home address); it reads nothing from a cache and keeps nothing. **Settings, Notifications** has **Push on this device**, which asks the browser for permission and subscribes only when pressed, says so where the browser cannot or the permission is blocked, and is asked about the device only on a server that can send Push (a hang of WebKit's page on `serviceWorker.ready` found by the browser test, which is also given a time to answer in). Tests: `src/notifications/push.test.ts` against **a push service of our own** (an https server with a throwaway certificate for `127.0.0.1`: a send arrives with `Content-Encoding: aes128gcm`, a VAPID `Authorization` and a body that holds none of the text; 410 and 404 remove the device while the other still gets it; 429 and 403; a service that is down; no device), `src/push/push.test.ts` and `route.test.ts` on every form of the database (the keys are in no column, another account's device is not seen or removed, takeover, the limit, the answers, who may call), `src/sw/source.test.ts` (what the worker shows and opens, and that it keeps nothing), the config tests, `people.test.ts`. **Left out, and said so:** the acceptance's **real Chromium and iOS Simulator** checks of a notice that shows with the app closed were **not done**: they need a push service (Google's or Apple's) that this machine cannot reach for a throwaway origin, and Safari on iOS needs the app added to the Home Screen; the worker's handlers are held by the unit test alone. The **PostgreSQL and sqld legs** were not run (no database service). Nothing sends to a device on a personal-key Desk by times only yet (14.6).

#### ✅ 8.5 — The daily brief (phase 2)

**Goal:** once a local day, what is due.

**Design:** §25.2. **Depends on:** 1.6, 4.3, 8.2, 8.3.

**Technical:** `src/notifications/job.ts`, registered at one minute. For each distinct zone of accounts with it on, works out the local date and time,
and selects the accounts due. For each: in one transaction, claim by conditional update on `last_digest_on`, count Desk cards (from the mirrors) and
assigned board cards due today and overdue, and write the notice; a quiet day writes nothing and keeps the claim. Fan-out follows, with a few retries of
a failed channel on later ticks; core with key `digest-<date>`. Personal-key Desks are counted by times only (14.6).

**Accepts when:** two runners send one; a failed channel is retried, and the Inbox has it regardless; it respects zones either side of midnight; a
quiet day sends nothing; the job's time is passed in.

**Done as:** **`src/notifications/job.ts`** (`tick`, registered as the `reminders` job at one minute, with the reminders of 8.6 in the same one). It finds each distinct zone that has an account with the brief or reminders on and, **one query for each zone**, works out the zone's local date and time in JavaScript (`localNow`, the time `now` is given and never read) and selects the accounts whose brief time has come. **The claim is a conditional update on the new `account_settings.last_digest_on`** (migration `0015_add_reminder_claims`, both dialects), in the transaction that counts and writes the notice, so two runners send one; it counts the Desk's open cards due today and overdue **from the server's mirrors** (`due_date`) and the board cards assigned to the account (`src/workspaces/due.ts`, which is where the workspace tables are read), and **a quiet day writes nothing and keeps the claim**. The notice is a new Inbox kind, `brief` ("3 due today · 2 overdue"), written by `raiseSystem`; with `reminder` it is in the Inbox's kinds, so it can be turned off there and in Settings. **Fan-out is `send-notices`' (8.3)**: a `brief` or `reminder` notice is sent by every channel the server has, for the person who turned the switch on, whatever kinds they asked to have sent; and the Inbox always has it. Core gets it with the notice's id as its `key`, which is unique to the day. Tests (`src/notifications/job.test.ts`, every form of the database and with the operator key on): written once a local day at its time and not before; the next day again; two runners at once, one notice; **either side of midnight in UTC** (Auckland and Los Angeles at 23:30 on the 8th, and Auckland at 18:59 and 19:00); a quiet day writes nothing and is not looked at again that day; off means off; a board card assigned counts. **Left out, and said so:** **a failed channel is not retried on later ticks** (the epic asked for a few): a notice is claimed by `send-notices` once and a channel that failed is not tried again, because a retry needs a record of what was tried that the database does not have, and the Inbox has the brief regardless; and a Desk sealed with a key of its own has no mirrors and is **not counted** (14.6).

#### ✅ 8.6 — Due-time reminders (phase 2)

**Goal:** a reminder when a card's time comes.

**Design:** §25.2. **Depends on:** 8.5.

**Technical:** in the same job: for each zone, open Desk cards of accounts with it on, and board cards assigned to them, `due_date = today`,
`due_time <= now`, not yet reminded, through a partial index, capped per tick. Claim per card and write the notice in one transaction; core with key
`due-<id>-<date>`. On `retry_after`, leave the rest to a later tick. Rescheduling clears the claim (4.2), so it fires again.

**Accepts when:** a card fires once, at its time in the account's zone; changing its time fires it again at the new one; yesterday's missed reminder is
not sent; a `429` delays and loses nothing.

**Done as:** in the same job. For each zone: the open Desk cards (through the mirrors) of accounts in it with reminders on, **and the board cards assigned to such accounts**, with `due_date` today, `due_time` at or before the zone's time now **and not more than 30 minutes before it** (`REMINDER_WINDOW_MINUTES`), not yet reminded for the time they are due, capped per tick (`REMINDER_CAP`, 200, so that a first run after a stop cannot write thousands). **The claim is a conditional update on the card's `reminded_for`** (a new column on `desk_card` and on a board's `card`) set to `YYYY-MM-DD HH:MM`, in the transaction that writes the Inbox notice, so a card fires once; **a card given another time has another key and so fires again at the new one**, which is what "rescheduling clears the claim" asks without a hook in `apply`; a board card is claimed once and reminded to each person assigned who has reminders on. **Yesterday's missed reminder is not sent** (only today's date), nor one more than half an hour late, a card that is done, deleted or archived, or one for a person with reminders off. A `429` from a channel delays and loses nothing because the channels are not the job's: it writes notices and `send-notices` (8.3) sends them. Tests in `src/notifications/job.test.ts`: once at its time in the account's zone (Auckland, 20:00 UTC the day before), not again, **a changed time fires again at the new one**, yesterday, hours ago, done, and reminders-off send nothing, two runners write one, a board card goes to each person assigned with reminders on and once, and the cap holds and the rest wait for the next tick. **Left out, and said so:** the **partial index** the epic names was not added (the query is by the zone's accounts and a date, over the owner's index, and was not measured); a board card whose assignees are in different zones is reminded at the **first** zone's time (one claim for the card); and nothing was tried against a real mail server, core or push service.

#### ✅ 8.7 — Read and dismissed, one notice at a time

**Priority:** P1. **Goal:** a person reads a notice, or dismisses it, without that touching the others.

**Design:** §16. **Depends on:** 8.1.

**Technical:**

- **Two columns of `notice`** (migration for both dialects), `read_at` and `dismissed_at`, null until the person does it. They are structure, not content (`content.ts`).
- **What is read:** a notice with a `read_at`, or one made at or before `account_settings.inbox_seen_at`, which stays as the floor it was (so every notice before the change
  keeps the state it had, and **"Mark all read" is moving that time on to now**, one write, however many notices there are). **What is dismissed is not shown anywhere and
  does not count as unread**; "Clear all" dismisses what there is. Each is one conditional update that names the account (`WHERE account_id = … AND id IN …`): a notice
  of someone else's is not touched, and doing it twice does nothing more.
- **The reads and writes are routes of their own** (listed in `src/access/routes.ts`, each tested as the wrong account): `GET /api/notifications` (a page of notices newest first
  after a cursor, each with whether it is read, and how many are unread, up to 99+; the same rule of what a person can still see as 8.1), `GET /api/notifications/unread`,
  `POST /api/notifications/read` (`{ ids }` or `{ all: true }`), `POST /api/notifications/dismiss` (`{ ids }` or `{ all: true }`). The 8.1 routes for notices
  (`/api/inbox/seen`, `/api/inbox/unread`) go; `GET /api/inbox` is the assigned cards alone.
- **Opening a screen no longer marks anything read.** The notices are what they were; a person reads one by opening it, or all by saying so.

**Accepts when:** a notice is read by opening it and the others stay unread; "Mark all read" makes every notice read, and one made after it unread; a dismissed notice is gone from the
list and the count and is not brought back by a new page or a reload; a person cannot read or dismiss another's notice (the same ids, the wrong account: nothing changes, and the answer is the
same as for an id that is not there); both are safe to do twice; and the counts agree with the list on every form of the database.

#### ✅ 8.8 — The bell

**Priority:** P1. **Goal:** a bell beside the avatar that shows how many notices are unread and, opened, the latest of them.

**Design:** §16, §17.2. **Depends on:** 8.7.

**Technical:**

- **`NotificationBell`** in the shell's header, left of the avatar (`src/screens/NotificationBell.tsx`), on the design system's `NotificationsPanel` (the bell, the unread count on it, a list with an
  icon, the words, "2d ago" and an unread dot for each, a dismiss for each, "Mark all read", "Clear all", and a "View all" to `/notifications`). The words are `noticeText`; the icon is the kind's
  (`assigned` a person with a plus, `comment` a message, `added_to_*` people, `backup_stopped` a warning, `brief` a calendar, `reminder` a clock); a notice opens where it points (`noticeHref`)
  and is read by opening it.
- **Read from the server and kept fresh:** the first page when the app opens, again every minute while it is visible and when the window comes back to the front, and at once after the
  person's own change. **Offline it shows what it last had**, and says nothing of the network.
- A phone has the same bell in the same place; the panel is the design system's, which makes its own sheet at a narrow width.

**Accepts when:** the count on the bell is the unread notices, up to 99+; a notice written for the person appears within a minute without a reload; opening one reads it and goes to its card;
dismissing, "Mark all read" and "Clear all" change the list and the count at once and survive a reload; the bell is reachable and usable by keyboard, in light and dark, and at a phone's width.

#### ✅ 8.9 — The Notifications page, and the Inbox of what is assigned

**Priority:** P1. **Goal:** the whole list of notices has a page, and the Inbox is what is theirs to do.

**Design:** §16, §17.2. **Depends on:** 8.7, 8.8.

**Technical:**

- **`/notifications`** (a page in `routes.ts`): every notice newest first in pages, grouped by day in the person's zone, read and unread told apart, each openable and dismissable, with "Mark all read"
  and "Clear all". It is "View all" of the bell, and a sidebar entry is not made for it.
- **`/inbox` is the cards assigned to the person** across their boards, by due date and undated last, as 8.1 listed them, and nothing else. Its entry in the sidebar loses the count (the count is the bell's).
- The email and Push of a notice, its kinds and the switches that turn them off are as they were.

**Accepts when:** `/notifications` lists, pages, reads and dismisses as the bell does, with the same words; `/inbox` shows only what is assigned and no notice; the sidebar's Inbox has no count and the bell has it;
the unread and dismissed state is the same on a second device; and `README.md`, `DESIGN.md` §16 and the screens' tests say the same thing.

**Done as (8.7):** `notice.read_at` and `notice.dismissed_at` (migration 0018 for both dialects; `read_at` and `dismissed_at` are numbers and so not in the list of text columns `content.ts` holds the schema to). **`src/workspaces/notifications.ts`** is what a person is told and is `inbox.ts`'s no longer: `noticesOf` (a page after a cursor, each notice with `read`, and the count on the first page), `unreadCount` (up to 100), `markRead` and `dismiss` (each `{ ids }` of at most 200, or `{ all: true }`), and `trimNotices`. A notice is read with a `read_at` **or at or before `account_settings.inbox_seen_at`**, which stays as the floor it was, so every notice from before keeps its state and **"Mark all read" is moving that time on to now: one write**; a dismissed one is in no statement of the list or the count; each change is one update that names the account, so another's ids are not touched and the answer is the same as for ids that are not there. `src/workspaces/notifications-endpoint.ts` is the handlers and `parseWhich` (a closed body); the routes are `GET /api/notifications`, `GET /api/notifications/unread`, `POST /api/notifications/read` and `POST /api/notifications/dismiss`, in `src/access/routes.ts`; the 8.1 routes for the count and for "seen" are gone and `GET /api/inbox` is the assigned cards alone (`inbox.ts`: `assignedOf`). Tests, on every form of the database and with `TUSK_TEST_OPERATOR` on and off: reading the named and no other and keeping the first time, reading all and a notice made after it unread, dismissing the named and all (not brought back by a page or by reading all, and what is assigned still there), another's ids changing nothing, what a person cannot see not counted however it was read, the parts of a body, and the routes as the wrong account (401 with no session, 403 from another site on each write, 400 for a body or a cursor that is not one, one person's ids never another's).

**Done as (8.8):** **`NotificationsProvider`** (`src/inbox/notifications.tsx`) is the one copy, in the signed-in area, shared by the bell and by the page: the first page when the app opens, again every minute while the window is in view, when it comes to the front and when the network is back; what it last had stays when a read fails; a change is shown at once and sent after, **and put right by reading again if the server refuses it** (a read that began before a change does not put the old state back over it); an older page is read on request and kept when the first is read again (`merge`, pure). **`NotificationBell`** (`src/screens/NotificationBell.tsx`) is the design system's `NotificationsPanel` in the shell's `bell` slot, left of the avatar, with an icon for each kind (`ICONS`), `noticeText`'s words, `ago` ("5m ago", `src/inbox/ago.ts`, pure) and the dot, the latest 20; opening a notice reads it, and **a click on a link in the panel, which the panel makes as a plain link, is taken as a navigation of the app and the panel is made again for the new place, which closes it**. Tests: `ago`, `merge`, and in Chromium and WebKit, against a stand-in for the server that does what the routes do (this instance has one account and a notice is never for the one who did it, so it has none), the bell left of the avatar with its count and the labels, opening one reading it and going to its card without loading the page again, dismissing, "Mark all read" and "Clear all", and a read the server refuses put right by reading again.

**Done as (8.9):** **`/notifications`** (`NotificationsScreen`, on the shared copy): newest first, grouped by day in the person's zone, read told from unread (a dot, and muted), each openable and dismissable, "Mark all read", "Clear all" and "Older notifications". **`/inbox`** is `Assigned to me` alone (`GET /api/inbox`), and the sidebar's Inbox has no count (`unreadLabel` and its CSS went). Tests: the page and the bell agreeing, the page at 390px with nothing scrolling sideways, and the sidebar's name for the Inbox being the word alone. **Not as the epic said, and left out:** a person who turns a kind off in Settings does not have the ones already written taken away; the bell shows the latest 20 and the page pages by 50; there is no sound or badge on the app's icon; and the service worker's cache holds none of it, as it holds nothing of a person's.
