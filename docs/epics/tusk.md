# Epic 15: The turn to Tusk

## Status

📋 Planned

## Overview

What was built as Tasks becomes the Desk of Tusk, before anything new is built on it: the name changes everywhere, and the Desk's tables take the shape
`DESIGN.md` §23.3 gives them. Nothing is released and no real data exists, so nothing is migrated: the old names and tables are simply gone, and a
developer's database is made again.

## Related

[`DESIGN.md`](../../DESIGN.md) §5.2, §10, §23.3, §27

## Tasks

#### 📋 15.1 — The name

**Goal:** the app is Tusk, in every name it has, and nothing says Tasks.

**Design:** §5.2. **Depends on:** nothing.

**Technical:**

- **Settings:** every `TASKS_` variable becomes `TUSK_` (and `TASKS_TEST_` becomes `TUSK_TEST_`), in `src/config/env.ts`, `.env.example`,
  `deploy/.env.example`, the Compose files, CI, the Dockerfile and the scripts. No alias for the old names: nothing has been released.
- **Stores:** sqld namespaces `tusk` and `tusk_auth`; files `tusk.db` and `tusk_auth.db`; PostgreSQL schemas `tusk` and `tusk_auth`; the dev containers'
  names. The cookie prefix `tusk`; the IndexedDB database `tusk-desk-<account id>`; the BroadcastChannel and Web Lock names.
- **Package and image:** `@sovereignfs/tusk`, `ghcr.io/sovereignfs/tusk`; the manifest's `prefix` `tusk`, `name` Tusk and a real description; the image's
  label from it (`pnpm manifest:check`).
- **Words:** `src/site.ts`, the landing page's content, the header, page titles, log prefixes (`[tusk]`), the seed's address and password, every
  document. The repository's own name on GitHub is the owner's to change; the docs say `sovereignfs/tusk`.
- **Comments** that cite `DESIGN.md` by section are brought to its current numbering (a section number in code is a pointer, and the design was
  renumbered on 2026-11-06).
- A test that fails if `TASKS_` or `tasks-` appears in `src/`, `app/`, `scripts/`, `deploy/` or `.github/` outside a comment explaining a history.

**Accepts when:** `verify` passes, the browser tests pass on all three forms, `deploy-check.sh` brings up each setup from nothing under the new names,
and a search of the tree finds Tasks only in the changelog's history and the plugins' names.

#### 📋 15.2 — The Desk's tables

**Goal:** the Desk's data is `desk_list`, `desk_card`, `desk_check` and `desk_series`, with description, start time and checklist items, behind the same
sync, and the app works as before on it.

**Design:** §5.2, §10.2, §10.3, §23.3. **Depends on:** 15.1.

**Technical:**

- **Migrations squashed:** `migrations/{sqlite,postgres}/` and `migrations/auth/*/` each regenerated as one `0000_init` from the schemas
  (`pnpm db:generate init`), the old ones removed. The parity test and CI's "would generate nothing" check hold.
- **Tables** as §23.3: `list` → `desk_list`; `task` → `desk_card`, without `parent_id`, with the mirrors; `series` → `desk_series`; a new `desk_check`
  (`card_id`, `position`, fields `title`, `completedAt`). `APP_TABLES` follows.
- **The change format:** table names `desk_list`, `desk_card`, `desk_check`, `desk_series`; `FIELD_NAMES` with `description` for `notes` and
  `startedAt`; the structure rule becomes "a checklist item's card is the account's", replacing the subtask rule. `PROTOCOL_VERSION` 2, so that a device
  holding version 1 is told to update and starts again. Validators, `applyMutation`, pull, purge (a card takes its items), and the local store's object
  stores follow.
- **Actions:** `src/actions/` renamed (`createCard`, `completeCard`, `deleteCard`, …), subtask actions becoming checklist actions over `desk_check`
  (`addItem`, `tickItem`, `moveItem`, `deleteItem`), completing a card ticking its open items as before.
- **First list:** _Backlog_, with the same derived id; `FIRST_LIST_TITLE` changes.
- **The screens** keep working with the new words (Notes becomes Description, Subtasks becomes Checklist), at their current addresses until 3.12.
- **The seed** makes the Desk of §24 Testing.

**Accepts when:** every existing unit, data-layer and browser test passes, rewritten for the new names, on all three forms; the convergence tests of
13.2 and 13.3 pass with checklist items; a mutation of version 1 is refused with `update_required`; nothing named `task` or `subtask` is left in the
data path.
