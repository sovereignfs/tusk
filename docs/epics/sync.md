# Epic 13: Sync and offline

## Status

📋 Planned

## Overview

The data path every screen stands on: the UI reads and writes a local store, and changes sync in the background, with conflicts resolved by rule and nothing asked of the person. It comes before Lists, because retrofitting it would be close to a rewrite. The field envelope that encryption needs (epic 14) is part of it from the first task, so that the data model never needs migrating for it.

## Related

[`DESIGN.md`](../../DESIGN.md) §8, §22.3

## Tasks

#### 📋 13.1 — The change format and validators

**Goal:** one definition of what a device may send, shared by browser and server.

**Design:** §8.2, §22.3. **Depends on:** 3.1.

**Technical:**
- `src/sync/format.ts`: a mutation (`mutationId`, `changes`); a change (`table`, `id`, structural columns, `fields`); a field value, `{ v }` or `{ c }`. A protocol version.
- `src/sync/validate.ts`: pure, in both places. `parseStructure` for what the server always checks; `parseField(table, name, value)` for content, used before queueing and by the server when it can read.
- `list`, `task` and `series` tables with `fields` as JSON text; the vocabulary's `fields` word; `account_settings.seq`.
- Size limits per field and per mutation, which also hold for ciphertext.

**Accepts when:** a round trip through the format is lossless, with plain and ciphertext alike; each malformed shape is refused; the parity test covers the new tables.

#### 📋 13.2 — The sync endpoint

**Goal:** `POST /api/sync` applies changes safely, and returns what changed.

**Design:** §7, §8.3, §8.4. **Depends on:** 13.1.

**Technical:**
- `src/sync/apply.ts`: one short transaction per mutation: increment `seq`, check each change, write only the fields sent, stamp each with `seq`, and record `applied_mutation`. A repeated `mutationId` answers as before and writes nothing.
- Checked always: the row and anything it points at are the account's; a client-made id already used by another account is refused; a parent is top-level and in the same list; limits (200 lists, 50,000 tasks). Checked when readable: `parseField`.
- A field write to a deleted row clears `deleted_at`, per §8.4. Mirrors `due_date`, `due_time`, `completed_at` copied from readable fields, and `reminder_sent_at` cleared when a due field changes.
- `src/sync/pull.ts`: rows and tombstones past a cursor, paged.
- Session and `Origin` checked; a rate limit through `rate_bucket`, a table added here. Listed in `routes.ts`.

**Accepts when:** on all three databases: a change as the wrong account changes nothing for each table and each way of pointing at another's row; replaying a mutation changes nothing; two fields merge; the same field goes to the later arrival; concurrent mutations for one account serialise; `seq` never repeats for an account.

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
