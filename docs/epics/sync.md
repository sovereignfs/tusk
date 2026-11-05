# Epic 13: Sync and offline

## Status

📋 Planned

## Overview

The data path every screen stands on: the UI reads and writes a local store, and changes sync in the background, with conflicts resolved by rule and nothing asked of the person. It comes before Lists, because retrofitting it would be close to a rewrite. The field envelope that encryption needs (epic 14) is part of it from the first task, so that the data model never needs migrating for it.

## Related

[`DESIGN.md`](../../DESIGN.md) §8, §22.3

## Tasks

#### ✅ 13.1 — The change format and validators

**Goal:** one definition of what a device may send, shared by browser and server.

**Design:** §8.2, §22.3. **Depends on:** 3.1.

**Technical:**

- `src/sync/format.ts`: a mutation (`mutationId`, `changes`); a change (`table`, `id`, structural columns, `fields`); a field value, `{ v }` or `{ c }`. A protocol version.
- `src/sync/validate.ts`: pure, in both places. `parseStructure` for what the server always checks; `parseField(table, name, value)` for content, used before queueing and by the server when it can read.
- `list`, `task` and `series` tables with `fields` as JSON text; the vocabulary's `fields` word; `account_settings.seq`.
- Size limits per field and per mutation, which also hold for ciphertext.

**Accepts when:** a round trip through the format is lossless, with plain and ciphertext alike; each malformed shape is refused; the parity test covers the new tables.

**Done as:** `src/sync/format.ts` is the one definition: `PROTOCOL_VERSION` (1), the three tables, a field value (`{ v }` or `{ c }`, exactly one) with a plain value limited to a scalar since every field there is one, a change per table with its structural keys (`listId`, `parentId`, `position`) and `deleted`, a mutation, the limits, and the stored form of a `fields` column (each field's value and the `s` that wrote it) with `encodeFields`. `src/sync/validate.ts` is pure and has no server import, so the browser and the server run the same code: `parseField(table, name, value)` for one field, `parseStructure(change, { creating, plain })` for a change, `parseMutation(value, { plain })` for a mutation, and `decodeFields` for a stored column. Content is held to §10–§13: a title of 1 to 500 characters, notes up to 20,000, a list colour of the six and a sort of the four, a date that exists, `HH:MM`, ids, times as whole milliseconds within a JavaScript date, a rule of 1 to 200 characters (task 5.1 holds it to the allow-list). Ciphertext is checked for its form (the base64 and base64url alphabets) and for size by the field it is for, which is the text's longest in UTF-8, plus the cipher's header and tag, in base64. A mutation is 1 to 500 changes saying at most a million characters; one bad change refuses the whole of it. **A change that names `ownerId`, `seq`, `createdAt`, `deletedAt`, a mirror column or anything else it was not offered is refused and not ignored**, including an own `__proto__` key from JSON, and what comes back is rebuilt from what was allowed. `creating` requires a position and list as the table needs and a title (a series: its rule and anchor); `plain: 'refuse'` turns every plain field away for an account with a key of its own, and was seen not to read what it refused. A reason never contains the input: a test found one that echoed a field name a device had chosen, and it was fixed. The tables `list`, `task` and `series` are in both dialects' schemas with `owner_id`, `seq`, `deleted_at`, `created_at` and a `fields` column (`'{}'` by default), `task` with the three mirrors and `reminder_sent_at`, no foreign keys, an index on `(owner_id, seq)` for pull each, and the position collated `C` on PostgreSQL; the migration is `0001_lists_tasks_series`. The parity test needed one change: the PostgreSQL position word is a custom type, which it now reads as text when its SQL type is. Two decisions the epic did not state: a device says `deleted: true` or `false` and the server stamps the time, so a device's clock decides nothing about when a row goes; and the partial index for the reminder job is left to the task that writes the job (17.4). 28 tests in `src/sync`, passing on a file database, sqld and PostgreSQL 16. Seen to fail: the unknown-key check removed, the count of changes, the size of a mutation, the size of ciphertext, and the refusal of plain content, each failing its own test. Not done: the account deletion of these tables, which task 2.8's test finds by asking the schema for every table.

#### ✅ 13.2 — The sync endpoint

**Goal:** `POST /api/sync` applies changes safely, and returns what changed.

**Design:** §7, §8.3, §8.4. **Depends on:** 13.1.

**Technical:**

- `src/sync/apply.ts`: one short transaction per mutation: increment `seq`, check each change, write only the fields sent, stamp each with `seq`, and record `applied_mutation`. A repeated `mutationId` answers as before and writes nothing.
- Checked always: the row and anything it points at are the account's; a client-made id already used by another account is refused; a parent is top-level and in the same list; limits (200 lists, 50,000 tasks). Checked when readable: `parseField`.
- A field write to a deleted row clears `deleted_at`, per §8.4. Mirrors `due_date`, `due_time`, `completed_at` copied from readable fields, and `reminder_sent_at` cleared when a due field changes.
- `src/sync/pull.ts`: rows and tombstones past a cursor, paged.
- Session and `Origin` checked; a rate limit through `rate_bucket`, a table added here. Listed in `routes.ts`.

**Accepts when:** on all three databases: a change as the wrong account changes nothing for each table and each way of pointing at another's row; replaying a mutation changes nothing; two fields merge; the same field goes to the later arrival; concurrent mutations for one account serialise; `seq` never repeats for an account.

**Done as:** `POST /api/sync` (`app/api/sync/route.ts`, `accountRoute`, listed in `routes.ts`) reads its body to 8 MiB counting as it arrives, and `src/sync/endpoint.ts` answers it: 429 with `Retry-After` past 120 requests a minute for an account (`rate_bucket`, counted in one statement and so across processes), 400 for anything that is not a request, 426 with the protocol the server speaks for any other (nothing is applied, so a device keeps its outbox), and otherwise 200 with one result per mutation, in order, and a pull. A mutation that is refused does not refuse the request: the rest are applied and the device is told which and why (`invalid`, `unavailable`, `structure`, `limit`). `src/sync/apply.ts` applies a mutation in one transaction whose first statement is `INSERT … ON CONFLICT DO UPDATE SET seq = seq + 1 RETURNING seq` on `account_settings`: it creates the row for a new account, takes the account's lock, and gives the mutation the next `seq`, so one account's mutations apply in turn on all three databases and another account's are not held up; after taking the lock it looks for the mutation id again, so a repeat that raced is answered from the record, with the increment rolled back. Rows are found and written with the owner in the statement; a client-made id that another account uses is a conflict that writes nothing; what a change points at (list, parent, series) is checked after all of the mutation's changes are written, so a mutation may do things in any order. Subtasks are one level deep and in their parent's list, a task moved without its subtasks is refused, an edit restores a deleted row, a task or series in a deleted list restores the list (unless the mutation deletes it), an edited subtask restores its deleted parent, mirrors are copied from readable fields (null for ciphertext) and `reminder_sent_at` is cleared when a due field changes. Limits are 200 lists and 50,000 tasks (and series) counted over every row of the account. `src/sync/pull.ts` pages by `seq`: it finds the `seq` of the limit-th pending row across the four tables and returns everything up to it from each, so a page ends at a `seq` and one mutation is never split, and the bound is one number found first, so that a cursor cannot skip a row that commits while the tables are read one after another; this holds because an account's mutations commit in `seq` order. Tables added: `applied_mutation` (by account and id, so that one account's mutation ids are nothing to another's), `tombstone` (read here, written by 13.7) and `rate_bucket`. 93 tests in `src/sync`, 6 in `src/limits`, passing on a file database, sqld and PostgreSQL 16, and a browser-level test in Chromium and WebKit. Seen to fail: the owner removed from the lookup and the write (3 tests, the wrong-account ones), the replay check, merging of fields (replaced instead), the structure checks (12), and the counter not incremented (10). **A real fault found on the way:** libSQL's driver waits for a lock synchronously on the one thread, so two overlapping write transactions on a `file:` database deadlocked until the busy timeout and then failed, since the first could not finish while the second waited. `transaction()` now runs a file's write transactions one at a time in JavaScript (an sqld service and PostgreSQL take their writers in turn themselves), and the file client is given the busy timeout as an option and not a PRAGMA, since the client keeps a pool of connections and a PRAGMA is per connection; a test of overlapping transactions hangs without it. Not as the epic said: the account's encryption mode does not exist yet, so every account is `plain: 'check'` until 14.2 (the parameter is there and tested), and a replay is answered `applied` with its original `seq` and no more. Not done: the job that removes deleted rows and writes tombstones (13.7), and what a device does with any of this (13.3).

#### 📋 13.3 — The local store and outbox

**Goal:** the browser's working copy, and a queue that survives closing the tab.

**Design:** §8.1, §8.3. **Depends on:** 13.1.

**Technical:**

- `src/local/`: `idb` (ISC) over one database per account, `tasks-<accountId>`, with `list`, `task`, `series`, `outbox`, `meta`. Versioned upgrades. Queries by list and position.
- `src/sync/client.ts`: `commit(mutation)` writes rows and outbox in one IndexedDB transaction, then notifies subscribers. A React hook `useLocal(query)` reads and re-renders.
- `src/sync/loop.ts`: triggers of §8.3: debounced after a write, on load, on focus, on `online`, on a timer. One tab at a time (Web Locks); `BroadcastChannel` tells the others. Backs off on failure, silently.
- Applying a pull: per field, higher `seq` wins, and a pending outbox write to the same field stays on top until it is acknowledged.
- A refused change: undoes locally and raises a toast. Nothing else reaches the UI.
- Tested with `fake-indexeddb`.

**Accepts when:** closing the tab mid-write loses nothing; a pending edit is not overwritten by a pull; ten tabs produce one sync loop; a refused change undoes with a toast; a screen never shows a spinner for what is already local.

#### 📋 13.4 — First load, sign-out and ended sessions

**Goal:** a new device fills up, and a departing one empties.

**Design:** §8.5. **Depends on:** 13.2, 13.3.

**Technical:** first load pulls pages from cursor zero, showing what arrives, first list first. `navigator.storage.persist()`. Sign-out tries the outbox, warns if changes can't be sent, then deletes the database; better-auth's sign-out follows. A `401` from sync shows sign-in with no data displayed, and keeps the outbox for the same account. An account-deleted answer deletes the local database. A different account signing in uses its own database. Too-old protocol: update, keeping the outbox.

**Accepts when:** after sign-out no IndexedDB database for that account remains, in a browser test; a session ended elsewhere stops data being shown at next sync; a second account on the device sees nothing of the first.

#### 📋 13.5 — Convergence tests

**Goal:** proof that devices end up the same, whatever happens.

**Design:** §8.4, §23 Testing. **Depends on:** 13.3, 13.2, 3.5, 5.2.

**Technical:** `src/sync/simulate.test.ts`: several simulated devices against one real server per database, each making random offline actions from `src/actions/`, syncing in random orders, with lost answers and duplicate sends. After everyone syncs, all states are identical. The table of §8.4 has one named case per row. Failing seeds are printed and pinned as fixtures. Run with more seeds nightly.

**Accepts when:** thousands of random runs converge on all three databases; each row of §8.4's table has a test seen to fail with its rule removed.

#### 📋 13.6 — Working offline

**Goal:** the whole task experience with the network off.

**Design:** §8.6. **Depends on:** 1.11, 13.4.

**Technical:** Playwright with the context offline, Chromium and WebKit: load, read, add, edit, complete, reorder, go online, and find it on a second browser context. Settings actions say they need a network, and nothing else does. Background Sync registered where available. The iOS Simulator by hand, stated in the PR. User documentation of §8.6.

**Accepts when:** a browser offline from the start of the page load does every task action; on reconnecting, a second device sees them; no action shows an error for being offline.

#### 📋 13.7 — Keeping the history small

**Goal:** purges that don't strand a device.

**Design:** §8.7, §11.5. **Depends on:** 1.6, 13.2.

**Technical:** a `purge` job: rows deleted over seven days ago become `tombstone`s, with their subtasks and any series with no occurrence left; tombstones and `applied_mutation` over 90 days old go. A cursor older than the oldest tombstone gets `410`: the device sends its outbox and takes a fresh snapshot.

**Accepts when:** a device offline for 8 days learns of a purge; one offline for 91 days recovers through a snapshot, sending its edits first; the job purges at seven days and not before.
