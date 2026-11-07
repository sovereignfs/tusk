# Epic 15: The turn to Tusk

## Status

✅ Done: 15.1 and 15.2.

## Overview

What was built as Tasks becomes the Desk of Tusk, before anything new is built on it: the name changes everywhere, and the Desk's tables take the shape
`DESIGN.md` §23.3 gives them. Nothing is released and no real data exists, so nothing is migrated: the old names and tables are simply gone, and a
developer's database is made again.

## Related

[`DESIGN.md`](../../DESIGN.md) §5.2, §10, §23.3, §27

## Tasks

#### ✅ 15.1 — The name

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

**Done as:** a scripted pass over every file that is not a document of the design, then by hand for the words. Every `TASKS_` setting is `TUSK_` (and `TASKS_TEST_`, `TUSK_TEST_`), in the code, `.env.example`, the Compose files, CI and the scripts; the stores are `tusk` and `tusk_auth` (sqld namespaces, PostgreSQL schemas, the `tusk.db` and `tusk_auth.db` files); the cookie prefix is `tusk` (so a session cookie is `tusk.session_token`); the IndexedDB database is `tusk-desk-<account id>`, the BroadcastChannel `tusk-<account id>` and the sync lock `tusk-sync-<account id>`; the theme key is `tusk.theme`; log lines say `[tusk]`; the package is `@sovereignfs/tusk`, the image `ghcr.io/sovereignfs/tusk` (`tusk:ci` in CI), the volumes and containers `tusk-…`, the development PostgreSQL user and database `tusk`; the manifest's `prefix` is `tusk`, its `name` Tusk and its description the product's; the header, page titles, the landing page, the error pages and the mark ("Tu") say Tusk. `src/name.test.ts` fails on an old name anywhere in `src/`, `app/`, `scripts/`, `deploy/`, `e2e/`, `.github/` and the root files, and was seen to fail on a planted one. The existing PostgreSQL migrations had the schema names changed in place (they are unreleased, and 15.2 squashes them) so that `pnpm db:generate` still writes nothing. The suite passed on a file database, sqld and PostgreSQL 16 (532 tests, 4 skipped as before), the manifest check passed, a built instance booted, and the browser tests ran on each form. **Not as the epic said:** the old `TASKS_` names are not read at all, with no alias, since nothing was released; the repository's own name on GitHub was still `sovereignfs/tasks` then; it was renamed to `sovereignfs/tusk` on 2026-11-07, which GitHub forwards from the old address. **Found, not caused by this:** the landing page's "with no script at all" test (`e2e/landing.spec.ts`) fails on sqld and PostgreSQL, and passes on a file database; it fails the same way at the commit before the rename. Reading the sign-up policy waits on the database, so the page streams in behind the root loading state, and with scripts off the browser never swaps it in. It is a promise of 2.2 that is kept only where the database answers at once, and wants its own fix. Not done, by design: "task", "list" and "My tasks" in the code and screens are the Desk's words until 15.2 and 3.12; the migrations' file names (`0001_lists_tasks_series`) go with the squash.

#### ✅ 15.2 — The Desk's tables

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

**Done as:** the four tables are `desk_list`, `desk_card`, `desk_check` and `desk_series` in both dialects (`src/db/schema/*/app.ts`), with the mirrors `due_date`, `due_time` and `completed_at` on a card only. `migrations/sqlite/` and `migrations/postgres/` are each one `0000_init`, regenerated with `pnpm db:generate init` (CI's "would generate nothing" and the parity test hold); the auth store already was one migration and is unchanged. `src/sync/format.ts`: `TABLES`, `FIELD_NAMES` (a card has `description` and `startedAt`; an item has `title` and `completedAt`), `STRUCTURE` (`cardId` for an item, no `parentId` anywhere), the limits (`cardsPerAccount`, `checksPerAccount` of 200,000, `descriptionChars`), and `PROTOCOL_VERSION` 2. `src/sync/tables.ts` is the one place a name that syncs becomes the schema's table. `apply.ts` checks that an item's card is the account's, and that an item edited brings back its deleted card and that card's list; a card moving takes nothing with it, since an item has no list. `pull.ts` and `purge.ts` cover four tables, and a purged card takes its items. The local store is IndexedDB version 2 (`desk_list`, `desk_card` with `byListPosition`, `desk_check` with `byCard`, `desk_series`); an older database is emptied by its upgrade. Actions: `src/actions/cards.ts` (`createCard`, `updateCard`, `completeCard`, `reopenCard`, `deleteCard`, `restoreCard`, `moveCard`, `moveToList`, `setStarred`, `deleteMany`, `restoreMany`) and the new `src/actions/checks.ts` (`addItem`, `renameItem`, `tickItem`, `untickItem`, `moveItem`, `deleteItem`, `restoreItem`); the first list is _Backlog_ with its old derived id. The screens read the new data and say Description, Checklist and Item, with `?card=` for the open card; their files are `CardRow`, `CardDetail`, `Checklist`, `AddCard`. The seed makes 6 lists, 50 cards and 8 checklist items. Tests were rewritten, not loosened: 536 pass on a file database, sqld and PostgreSQL 16 (4 skipped, as before), including four new device cases for a checklist (it arrives with its card, two ticks while apart both stand, an edited item brings back a card another device deleted, an item added to a card another device moved stays with it), and protocol 1 is refused with `UPDATE_REQUIRED`. The browser tests passed on all three forms apart from the landing no-script test named under 15.1, and two that failed once and passed on rerun (a star on sqld, a checklist drag on PostgreSQL). `deploy-check.sh` passed for every setup. **Not as the epic said:** `reviewedAt`, `dismissedOn` and the card's `reminder_sent_at` are not made (phase 2 adds them: a field needs no migration, a column gets its own); the auth migrations were not regenerated, since nothing about them changed; the URL parameter is `?card=` now, not at 3.12, because the two names could not both be right in one screen. **Left for the tasks they belong to:** the routes (`/home`, `/lists/<id>`) and the shell are 3.12 and 7.8; list colours are still the six swatches (3.12); _In progress_ is 3.13.
