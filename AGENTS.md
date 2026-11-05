# AGENTS.md

Guidance for every AI agent working in this repository (Codex reads this file directly; Claude Code loads it through `CLAUDE.md`). It is
the one copy of the conventions. Do not duplicate them elsewhere, and do not add task history or release narrative to it: those belong
in `ROADMAP.md`, the task's epic and the PR body.

This repository follows the conventions of [`sovereignfs/sovereign`](https://github.com/sovereignfs/sovereign) (its `AGENTS.md`, and
`docs/development-workflow.md` for the planning workflow) and of `sovereignfs/fjord` (its `CLAUDE.md` and `clients/web/CLAUDE.md`, the
closest model: a Sovereign app built from a roadmap). Where this file is silent, do what they do; where they differ, this file says
which.

## What this is

**Tasks**, an app of the Sovereign suite exactly as Fjord is: a private task manager that a Sovereign instance can host and that also runs fully
self-hosted, needing no instance. It is a rewrite of the Sovereign tasks plugin (`sovereignfs/sovereign-plugin-tasks`, the legacy plugin
system). It is an offline-first PWA on Next.js, with its own database (sqld, a SQLite file or PostgreSQL), signing people in locally, through a Sovereign core, or
both, from one image. **`clients/web` in `sovereignfs/fjord` is the model:** its `DESIGN.md` §6 for authentication and §14 for the database, and its
`CLAUDE.md` for how it is built. The repository still holds the scaffold of `npm create @sovereignfs app`, which `DESIGN.md` §5.2 says what happens to.

The plugin's behaviour is the starting point, not a specification, and none of its code is carried over. `DESIGN.md` says what is kept, what
changes and why; it is a draft, and nothing in it is built yet.

## Source of truth

Read the relevant document before a task. Where two disagree, the earlier one wins and the later one is stale and should be fixed:

1. **The contracts Sovereign publishes**, in the `sovereign` repository: `contracts/app-manifest.md` (what an app provides and what the
   instance gives it), `contracts/env.md`, `docs/using-the-sdk.md` and `docs/specs/sdk.md` (`@sovereignfs/sdk`),
   `docs/specs/design-system.md` and `docs/design-system.md` (`@sovereignfs/ui`), `docs/connecting-an-app.md`. When hosted, or signing in through a
   core, this app conforms to them; it never works around one. A gap is raised in `sovereign`, not patched here.
2. **`DESIGN.md`**: what Tasks is and how it is built, with numbered sections that tasks cite.
3. **`ROADMAP.md`**: the order of work, one row per task, canonical for status.
4. **`docs/epics/`**: each task's detail (goal, "Accepts when", and once done, how it was done and what was left out).

Directories are created when they are needed, not before. The proposal layers are Sovereign's and Fjord's, and are used the same way:
**research** (`docs/research/`) for an open question with no design, an **RFC** (`docs/rfcs/`) for a design that needs review before it
is built, an **ADR** (`docs/adrs/`) for a settled decision, and a **workstream** (`docs/workstreams/`) for a feature that crosses several
epics, as an ordered run of legs with its decisions locked. A documented "not now" is a valid outcome.

## Planning workflow

Three layers, each with one job: this file says how to work, `ROADMAP.md` says which tasks exist and their status, and
`docs/epics/<file>.md` says what a task is.

- **The developer assigns the task** at the start of a session. There is no "next task" pointer in any file; read `ROADMAP.md` for the
  queue and ask which to pick up.
- **Task IDs are permanent** (`3.4`): use them in cross-references and dependency lists, never in branch names, commit messages or PR
  titles. A roadmap's order is volatile; look it up.
- **A finished task is marked done in its roadmap row and written up in its epic** (what, where, what was left out), in the same change
  as the work.
- Sovereign's task skills (`sv-task-start`, `sv-verify`, `sv-create-pr`, …) are not installed here. Do by hand what they do: read the
  task's epic, branch, build it, verify it, update the row and the epic, open a draft PR.

## Working conventions

- **One task, one branch, one draft PR.** Branch from an up-to-date `main` (`git switch main && git pull`), named by the kind of change:
  `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`. Do not start a second task on a branch whose PR is not merged.
- **Nothing goes to `main` directly:** not a typo, not a docs fix, not a release. The one standing exception is the owner's bypass, which
  is theirs to use and not something to reach for. The bootstrap commits were made that way, on the owner's instruction.
- **Never commit or push without being asked.** Prepare changes in the working tree and stop.
- **Commits explain why, not just what.** `type(scope): summary` (`feat`, `fix`, `docs`, `chore`), subject under 72 characters, body
  wrapped at 100, a `Verified:` line naming what was run, one logical change per commit (never a rename mixed with a behaviour change).
  Every commit an agent makes ends with `Co-Authored-By: Claude Code <noreply@anthropic.com>`: model-agnostic, never a specific model
  name, even if your harness suggests one.
- **PRs target `main`, are opened as drafts** (`gh pr create --draft --base main`), and are marked ready only on instruction. The body
  says what changed and why, cites the `DESIGN.md` section, carries no task numbers, and ends with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. CI is skipped while a PR is a draft or carries `skip-ci`.
- **Merge with rebase and merge**, never squash and never a merge commit, so each reviewed commit lands verbatim. Fix commit messages
  before merging; never rewrite `main`. **Never merge a PR automatically.**
- **Verify before claiming done.** Run the commands under Commands and show the output. A regression test is trusted only after it has
  been seen to fail against the code it guards.
- **Docs are part of the change.** A statement in `README.md`, `DESIGN.md`, `ROADMAP.md` or an epic that a change makes false is fixed in
  the same PR. A change to behaviour adds a line under `## [Unreleased]` in `CHANGELOG.md` (Keep a Changelog; it is also the release
  notes).
- **Releases are their own PR**, as Fjord's are: version bumps do not ride in feature PRs. Changes accumulate under `[Unreleased]`; a
  release PR promotes them, bumps `package.json`'s `version`, and after it merges the merged commit is tagged `vX.Y.Z`, which is what
  `.github/workflows/publish.yml` builds (the tag must equal the version). Semver by change type: `fix/` patch, `feat/` minor, breaking
  major with a note in the changelog. Fjord's `RELEASING.md` and `scripts/release.sh` are the model when this needs a script.
- **Flag Docker-config impact immediately.** A new or renamed environment variable, port, on-disk path, native dependency, or anything
  that changes `next build`'s standalone output updates the `Dockerfile` and `.dockerignore` in the same change.

## Rules of an app

The ones most likely to be broken by accident. Each comes from `sovereign`'s contracts or from how Fjord Web is built. They describe the app as
`DESIGN.md` designs it, not the scaffold.

- **An account is known by its better-auth user id (`account_id`).** A Sovereign identity is its `sub`, looked up only for what needs it, and never
  matched to an account by email at sign-in: it is linked only from a signed-in session, and only when the address is the account's own.
- **Everything of a person is deleted by `People.deletePerson`** (`src/sovereign/people.ts`), which must be safe to run twice. **A new table that holds
  something of a person is deleted there in the same change**, with a test that seeds one of each.
- **The UI reads and writes only the local store** (`DESIGN.md` §8). No screen waits on the network or calls the server for task data, and no server action changes one. A user action is a pure
  function in `src/actions/` producing changes, which `commit` writes to IndexedDB and the outbox together. Nothing in the UI may depend on a sync having happened, and no conflict is ever shown to a person.
- **The server trusts nothing a device says about ownership.** `POST /api/sync` is the door nearly every write comes through. A row of a person is written with the owner in the same statement
  (`eq(task.id, id), eq(task.ownerId, accountId)`), never checked beforehand and then touched, and anything a change points at must be the account's too. A route finds the session first, and one that
  changes something checks `Origin`. A new route is listed in `src/access/routes.ts` and has a test of who may call it, or it is not done.
- **The server cannot assume it can read a field.** On a personal-key account all content is ciphertext, so server logic uses structural columns only, or says what it does when it can't read (`DESIGN.md` §9). Content rules
  are validators shared with the browser. **A plain field never reaches the server for such an account, and a title never reaches a log for any.** Personal keys and the operator key are mutually exclusive.
- **Task data is never in the service worker's cache.** The worker caches only the shell, by allow-list. Data is in IndexedDB, per account, deleted at sign-out.
- **A new kind of change passes the convergence suite** (`src/sync/simulate.test.ts`), with several offline devices ending in one state.
- **The database has three forms and two dialects** (`DESIGN.md` §22): a schema and migrations per dialect, generated with `pnpm db:generate` and never written
  by hand or `push`ed; one representation per type, through the column vocabulary; standard SQL, values bound and never interpolated; no `LISTEN/NOTIFY`, trigger,
  extension or foreign key; short transactions, nothing held across a call to GitHub or core. A data-layer test runs on sqld, a `file:` database and PostgreSQL, so
  one that passes on only one is not done. **Tests read `TASKS_TEST_*` and never the app's variables,** so `pnpm test` can never wipe a developer's data.
- **A released migration is never edited:** a fix is a new migration, and a patch release has none.
- **A credential is stored only through `src/crypto/`** (envelope encryption under `TASKS_ENCRYPTION_KEY`), never as text in a column. Tokens and secrets never appear
  in an error, a log, a URL or the browser.
- **A git host is reached only through `Provider`** (`src/providers/`), and the app is tested against `MemoryProvider`, not GitHub. A commit is never forced, and a write is
  never retried on a lost answer.
- **The manifest is the one copy** (`sovereign.manifest.json`) of what an instance reads: the port, the scopes and the paths. `pnpm manifest:check` passes, and the image is built
  with the arguments `pnpm exec sovereign-manifest docker-args` prints from it.
- **Environment variables carry the app's prefix, `TASKS_`,** named as `contracts/env.md` says. Every `process.env` read is declared in `.env.example`. The server refuses to start on a setting
  that is wrong; no secret has a default. `NEXT_PUBLIC_*` is never used for a value that varies at run time (it is inlined at build time).
- **The design system comes through `src/ui`.** `@sovereignfs/ui` is one bundle that uses React context, so a Server Component imports its parts from there (a `'use client'` re-export, which
  still renders on the server). Style with the `--sv-*` tokens, never a literal colour, so dark mode and theming keep working. The typeface is Hanken Grotesk, never fetched from another site by the
  browser. Reusable UI belongs in `@sovereignfs/ui` in `sovereign`, not forked here. Take icon names and props from the package's types, not its README.
- **Never fork a navigation decision by viewport;** fork only what is rendered.
- **`@sovereignfs/ui` is pre-1.0 and is pinned exactly;** upgrade it on purpose. Dependencies are chosen, not accumulated. A dependency's licence must be compatible with AGPL-3.0-or-later,
  which is what bundling `@sovereignfs/ui` makes this app.
- **No third-party loads and no third-party requests from the browser.** Task text is rendered as text, never as HTML.
- **Next.js tracks the latest stable release,** never a canary. Read the guide bundled with the installed version (`node_modules/next/dist/docs/`) before writing Next code: it is not the Next.js of
  anyone's memory. `next dev` writes its own block into this file; commit it with your work.
- **TypeScript is strict.** No `any` without a comment saying why it cannot be avoided. Prefix an intentionally unused identifier with `_`; never disable a lint rule inline without a comment.

## pnpm

pnpm is the package manager (the version is `packageManager` in `package.json`; Node 24.15+).

- `pnpm install --frozen-lockfile` for every routine install and in CI; unexpected lockfile churn means something is unpinned. A change
  to a dependency commits `pnpm-lock.yaml` with it.
- **`pnpm-workspace.yaml` carries pnpm's settings,** and the Dockerfile copies it: never drop that `COPY`. Its `supportedArchitectures`
  keeps the Alpine image installable from a lockfile made on a Mac; leave it.
- **pnpm refuses a release less than a day old** (`minimumReleaseAge`) and an install script nobody decided on (`allowBuilds`). A
  range whose floor is a brand-new release fails to install: name a release at least a day old. An exception is listed in
  `minimumReleaseAgeExclude` only for a package of ours, exact-pinned, in the commit that bumps it; argue any other. Never accept pnpm's
  offer to add one.

## Commands

```bash
pnpm install --frozen-lockfile   # routine install
pnpm dev                         # next dev
pnpm format / format:check       # Prettier
pnpm lint / lint:fix             # ESLint
pnpm typecheck                   # next typegen && tsc --noEmit
pnpm db:generate <name>          # migrations for both dialects, from the schemas
pnpm db:dev sqld | postgres      # a local database in Docker (not needed: a file: URL works)
pnpm boot-check                  # after pnpm build: a fresh instance boots on the database in the environment
pnpm e2e                         # after pnpm build: browser tests (pnpm exec playwright install chromium webkit once)
scripts/deploy-check.sh          # every setup of deploy/, from nothing (needs the image: see deploy/README.md)
pnpm test                        # Vitest
pnpm manifest:check              # sovereign.manifest.json is a valid manifest
pnpm build                       # next build (standalone)
eval "docker build $(pnpm exec sovereign-manifest docker-args) -t tasks:ci ."   # the image, with its port and label from the manifest
```

once they exist, this list is where they are written, and `verify` means all of it.

## Layout

`DESIGN.md` §5.1 is where things go as the app is built; this is what is here now.

| Path                                                         | What                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`                                                       | Routes and layouts (App Router): a placeholder page inside the shell, `/api/health`, and the pages for a missing or failed route                                                                                                                                                                                                                                                             |
| `src/db/`                                                    | The database layer (`DESIGN.md` §22): `config.ts` (which form), `client.ts`, `provision.ts`, `migrate.ts`, `boot.ts` (brings it up at start), `exec.ts` (`dbGet`, `dbAll`, `dbRun`, `transaction`), `schema/{sqlite,postgres}/` with the column vocabulary in `columns.ts`, `test-support.ts` (reads `TASKS_TEST_*` only)                                                                    |
| `proxy.ts`, `src/security/`                                  | The Content-Security-Policy with a nonce per request, and the headers every response has. `next.config.ts` adds the static ones. The proxy keeps the Edge discipline: no Node built-ins, no database (`src/config/edge.ts` is what it reads of the settings)                                                                                                                                 |
| `src/jobs/`                                                  | Background work in the web process: `runner.ts` (timers, no overlap, a failure logged by name and kind, stopped on SIGTERM), `claim.ts` (the one coordination between processes: a conditional update that says who won), `index.ts` (the list of jobs, which each task that has one adds to)                                                                                                |
| `src/ui/`                                                    | The design system's client boundary (`index.ts`), `AppShell` (the header row and the main area), the app's own CSS check (`design-tokens.ts`); `src/theme/` sets `data-theme` before first paint; `src/site.ts` is the app's name                                                                                                                                                            |
| `src/access/`                                                | Who may call what (`DESIGN.md` §7): `routes.ts` (every page and route with who may use it, held to `app/` by `routes.test.ts`), `route.ts` (`accountRoute`: session, `Origin` on a write, the account id), `parse.ts` (the input parsers, shared with the browser), `two-accounts.ts` (two real accounts to call as the wrong one)                                                           |
| `src/local/`                                                 | The browser's working copy over IndexedDB, one database per account (`DESIGN.md` §8.1): the schema (`db.ts`), the pure row rules (`rows.ts`) and the store (`store.ts`: commit, settle, queries). `src/sync/client.ts`, `loop.ts`, `transport.ts`, `signout.ts` and `react.tsx` are the client side of sync                                                                                  |
| `src/limits/`                                                | Rate limits counted in the database, so that they hold across processes (`rate.ts`)                                                                                                                                                                                                                                                                                                          |
| `src/sync/`                                                  | The change format (`format.ts`) and its validators (`validate.ts`), pure and shared by the browser and the server (`DESIGN.md` §8.2). `apply.ts` (a mutation in one transaction), `pull.ts` (a cursor that never skips) and `endpoint.ts` (`POST /api/sync`) are the server's; the browser's outbox joins them as it is built                                                                |
| `src/auth/`, `app/api/auth/`, `app/sign-in/`, `app/sign-up/` | Local sign-in on better-auth (`DESIGN.md` §6): `config.ts` (its settings, checked with the others), `auth.ts` (`createAuth`, from settings and a database), `server.ts` (the one the server serves), `session.ts` (`getSession`, `requireAccount`), the screens, and `test-support.ts` (real requests through `auth.handler`). The proxy answers 404 for the pages when local sign-in is off |
| `src/config/`                                                | Settings: `env.ts` is the only place `process.env` is read, `index.ts` checks them, `current.ts` keeps them                                                                                                                                                                                                                                                                                  |
| `instrumentation.ts`, `instrumentation-node.ts`              | Run once at start-up: check the settings, bring the database up, and stop on either being wrong. The first only hands over to the second, which Next must not compile for the Edge                                                                                                                                                                                                           |
| `e2e/`, `playwright.config.ts`                               | Browser tests: the built app in Chromium and WebKit, on the database form the environment names (`pnpm build && pnpm e2e`). Touch is checked by hand in the iOS Simulator                                                                                                                                                                                                                    |
| `migrations/`                                                | The generated SQL, `sqlite/`, `postgres/` and `auth/` (better-auth's, per dialect), committed and reviewed. Never written by hand                                                                                                                                                                                                                                                            |
| `scripts/`                                                   | The CI classifier and its tests, `db-generate.mjs`, `dev-db.mjs`, `boot-check.mjs`, `serve-standalone.mjs` (the built server as the image runs it), and `deploy-check.sh` (every setup, from nothing)                                                                                                                                                                                        |
| `sovereign.manifest.json`                                    | What an instance reads to host the app. It still names the scaffold's sign-in paths, which task 2.10 replaces                                                                                                                                                                                                                                                                                |
| `Dockerfile`, `deploy/`                                      | One image on Debian (libSQL has no musl build), not root, on the manifest's port; the Compose setups for sqld, a file and PostgreSQL, their README and `.env.example`                                                                                                                                                                                                                        |
| `.github/workflows/`                                         | `ci.yml` and `publish.yml` (a `vX.Y.Z` tag publishes the image to `ghcr.io`, with provenance)                                                                                                                                                                                                                                                                                                |

## Not in place yet

Each is a task in `ROADMAP.md`, not a thing to assume exists: everything in `src/` beyond the settings, the database, the jobs, the shell, the
security headers, local sign-in and the access rules, and the tests of the design (sign-in is tested against a fake Sovereign, never a real instance, as Fjord Web does). Add them in their
own `chore/` or `feat/` branches, and move the line out of this section as each lands. Nothing of the product is built.
