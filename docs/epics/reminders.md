# Epic 8: Reminders

## Status

📋 Planned

## Overview

A morning digest and due-time reminders, through core's notifications. No email in phase 1, so an account with no Sovereign identity has none, and is told so.

## Related

[`DESIGN.md`](../../DESIGN.md) §14 · `contracts/core-api`, `docs/specs/core-app.md` §4.1 and `docs/using-the-sdk.md` in `sovereign`

## Tasks

#### 📋 8.1 — Reminder settings

**Goal:** a person can turn reminders on, and knows when they cannot.

**Design:** §14.1, §14.2. **Depends on:** 2.5, 4.1, 9.1.

**Technical:** `reminders`, `morning_time` on `account_settings`. A section in `/settings`. Available only with a linked Sovereign identity and `TASKS_CORE_*`; otherwise the switch is replaced by a sentence saying why. The copy says it goes to the bell in core, does not reach a closed browser, and that a task's title is stored in core.

**Accepts when:** a Sovereign-linked account can turn it on; a local-only one cannot, and the server refuses it too.

#### 📋 8.2 — Sending through core

**Goal:** one place that tells someone something.

**Design:** §14.2, §14.3. **Depends on:** 2.5.

**Technical:** `src/reminders/channel.ts`: `send(accountId, { title, body, url, key, expiresAt })`, looks up the `sub`, and calls `sv.app.notifications.send`. `src/sovereign/client.ts` makes the SDK's client for `sv.app` from `TASKS_*`. **First confirm in the SDK's code that `sv.app` needs no session or token store** (`DESIGN.md` assumes so); record the answer. Results: `sent`, `no_channel`, `retry_after`, `not_permitted` (no `notifications:send`: logged once, and asked again rarely, with Settings saying so), `failed`. Addresses from `TASKS_URL`. Task text cut to core's limits (title 120, body 500). A core too old raises `NotSupportedError`, handled as `not_permitted`.

**Accepts when:** against `createFakeCore`: each result is reached, including `core.fail` with `down`, `timeout`, `lost-answer` and a `429`; no title or `sub` reaches a log.

#### 📋 8.3 — The morning digest

**Goal:** once a local day, what is due.

**Design:** §14.1, §14.3, §14.4. **Depends on:** 1.6, 4.3, 8.1, 8.2.

**Technical:** `src/reminders/job.ts`, registered at one minute. For each distinct zone of accounts with reminders on, works out the local date and time, and selects the accounts due. For each: claim by conditional update on `last_digest_on`; count due today and overdue, top-level and open, in one statement; send with key `digest-<date>` and an expiry of a day, linking to `/today`; on nothing to say, send nothing and keep the claim; on failure, release the claim, restoring the old value. `digestSummary` is pure.

**Accepts when:** two runners send one; a failed send is sent on the next tick and not doubled, with `lost-answer` included; it respects zones either side of midnight; a quiet day sends nothing; the job's time is passed in.

#### 📋 8.4 — Due-time reminders

**Goal:** a reminder when a task's time comes.

**Design:** §14.1, §14.3, §14.4. **Depends on:** 8.3.

**Technical:** in the same job: for each zone, open top-level tasks of accounts with reminders on, `due_date = today`, `due_time <= now`, `reminder_sent_at IS NULL`, through a partial index, capped per tick. Claim per task, send with key `due-<id>-<date>`, linking to the task, and release on failure. On `retry_after`, leave the rest to a later tick. One account's failure does not stop the next. Limits of 600 a minute and 60 an hour per person respected with small concurrency. Rescheduling clears the claim (`setDue`, 4.2), so it fires again.

**Accepts when:** a task fires once, at its time in the account's zone; changing its time fires it again at the new one; yesterday's missed reminder is not sent; a `429` delays and loses nothing.
