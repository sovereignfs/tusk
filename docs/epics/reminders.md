# Epic 8: Reminders and notifications

## Status

📋 Planned

## Overview

A daily brief and due-time reminders, reaching a person by the header's bell, Web Push and email, each switchable, and core's bell when hosted. Works on a server running alone.

## Related

[`DESIGN.md`](../../DESIGN.md) §17 · `contracts/core-api`, `docs/specs/core-app.md` §4.1 and `docs/using-the-sdk.md` in `sovereign` · legacy's `runtime/src/push.ts`

## Tasks

#### 📋 8.1 — The notification list and bell

**Goal:** the app's own notifications, in the header, on any server.

**Design:** §17.2. **Depends on:** 7.1, 13.2.

**Technical:** `notification` table, brought down by sync so that the bell works offline. The bell in `AppShell` and `MobileHeader`, showing an unread count, with `NotificationsPanel` from `@sovereignfs/ui`. Choosing one marks it read and goes to its address. Mark all read, dismiss. Latest 200 per account, 30 days, trimmed by the purge job. `src/notifications/notify.ts`: writes a row, the one way anything tells a person something.

**Accepts when:** a notification written on the server shows on the device, and read state reaches other devices; the bell works offline; the wrong account cannot read or change one.

#### 📋 8.2 — Notification settings

**Goal:** a person controls what reaches them.

**Design:** §16, §17.2. **Depends on:** 2.7, 4.1.

**Technical:** Settings > Notifications: daily brief on or off, and its time; due-time reminders on or off; email on or off; Push on this device (8.4). Each shows only if it can work here, with a sentence saying why not. The copy says where a title goes (§17.2).

**Accepts when:** each setting survives a reload; a server with no SMTP offers no email and refuses it too.

#### 📋 8.3 — Channels: email and core

**Goal:** fan-out beyond the bell.

**Design:** §17.2, §17.3. **Depends on:** 2.3, 2.5, 8.1.

**Technical:** `src/notifications/channels.ts`: each with `send(notification)`, returning `sent`, `no_channel`, `retry_after`, `not_permitted` or `failed`, all through `Promise.allSettled`. **Email:** `src/mail/`, with a template linking to Settings to turn it off. **Core:** `sv.app.notifications.send` to the `sub`, from `src/sovereign/client.ts`, with `key`, and text cut to core's limits (title 120, body 500). **First confirm in the SDK's code that `sv.app` needs no session or token store** (`DESIGN.md` assumes so); record the answer. No `notifications:send`, or a core too old (`NotSupportedError`): logged once, and tried rarely.

**Accepts when:** against the test mailer and `createFakeCore`: each result is reached, including `core.fail` with `down`, `timeout`, `lost-answer` and a `429`; one channel failing leaves another working; no title or `sub` reaches a log.

#### 📋 8.4 — Web Push

**Goal:** a notification reaches a device with the app closed.

**Design:** §15.7, §17.2. **Depends on:** 1.11, 8.2, 8.3.

**Technical:** `web-push` (MPL-2.0). `TASKS_VAPID_PUBLIC_KEY`, `TASKS_VAPID_PRIVATE_KEY` (`_FILE`), `TASKS_VAPID_SUBJECT`; none means no Push, and a partial set stops the server. `push_subscription`, per device; turned on from that device, after the browser's permission prompt, through `pushManager.subscribe`. `POST`/`DELETE /api/push/subscription`. Sent as another channel of 8.3; payload encrypted to the device, per the standard. 410 or 404 removes the subscription. The service worker's `push` handler shows it, and `notificationclick` opens its address. Settings says Push on iPhone needs the app installed, and how.

**Accepts when:** a test against a stand-in push service: a send arrives encrypted, and a dead subscription is removed; in a real Chromium, and the iOS Simulator by hand, a notification shows with the app closed and opens the right address.

#### 📋 8.5 — The daily brief

**Goal:** once a local day, what is due.

**Design:** §17.1, §17.3, §17.4. **Depends on:** 1.6, 4.3, 8.2, 8.3.

**Technical:** `src/notifications/job.ts`, registered at one minute. For each distinct zone of accounts with it on, works out the local date and time, and selects the accounts due. For each: in one transaction, claim by conditional update on `last_digest_on`, count due today and overdue from the mirrors, and write the `notification` row with `url` `/today`; a quiet day writes nothing and keeps the claim. Fan-out follows, with a few retries of a failed channel on later ticks, then given up; core with key `digest-<date>`. `digestSummary` is pure. Personal-key accounts are skipped here (14.6).

**Accepts when:** two runners send one; a failed channel is retried, and the bell has it regardless; it respects zones either side of midnight; a quiet day sends nothing; a task dismissed from Today is still counted; the job's time is passed in.

#### 📋 8.6 — Due-time reminders

**Goal:** a reminder when a task's time comes.

**Design:** §17.1, §17.3, §17.4. **Depends on:** 8.5.

**Technical:** in the same job: for each zone, open top-level tasks of accounts with it on, `due_date = today`, `due_time <= now`, `reminder_sent_at IS NULL`, through a partial index, capped per tick. Claim per task and write the row in one transaction, linking to the task; core with key `due-<id>-<date>`. On `retry_after`, leave the rest to a later tick. One account's failure does not stop the next. Core's limits of 600 a minute and 60 an hour per person respected, with small concurrency. Rescheduling clears the claim (4.2), so it fires again.

**Accepts when:** a task fires once, at its time in the account's zone; changing its time fires it again at the new one; yesterday's missed reminder is not sent; a task dismissed from Today still fires; a `429` delays and loses nothing.
