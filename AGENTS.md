# AGENTS.md

Guidance for every AI agent working in this repository (Codex reads this file directly; Claude Code loads it through `CLAUDE.md`). It is
the one copy of the conventions. Do not duplicate them elsewhere, and do not add task history or release narrative to it: those belong
in `ROADMAP.md`, the task's epic and the PR body.

This repository follows the conventions of [`sovereignfs/sovereign`](https://github.com/sovereignfs/sovereign) (its `AGENTS.md`, and
`docs/development-workflow.md` for the planning workflow) and of `sovereignfs/fjord` (its `CLAUDE.md` and `clients/web/CLAUDE.md`, the
closest model: a Sovereign app built from a roadmap). Where this file is silent, do what they do; where they differ, this file says
which.

## What this is

**Tasks**, an app for a Sovereign instance: a rewrite of the Sovereign tasks plugin (`sovereignfs/sovereign-plugin-tasks`, the legacy
plugin system) as an app, the way Fjord Web is one. It is a Next.js app that signs people in through the instance's core, keeps its data in
its own PostgreSQL database, and is hosted by the instance's toolkit (`sv app add`) from one image whose label is its manifest. It was
made with `npm create @sovereignfs app tasks` and still carries the scaffold's notes example, which the rewrite replaces.

Nothing about what Tasks does is decided yet. The plugin's behaviour is the starting point, not a specification: what is carried over is
written down in the design and the roadmap first (below), then built.

## Source of truth

Read the relevant document before a task. Where two disagree, the earlier one wins and the later one is stale and should be fixed:

1. **The contracts Sovereign publishes**, in the `sovereign` repository: `contracts/app-manifest.md` (what an app provides and what the
   instance gives it), `contracts/env.md`, `docs/using-the-sdk.md` and `docs/specs/sdk.md` (`@sovereignfs/sdk`),
   `docs/specs/design-system.md` and `docs/design-system.md` (`@sovereignfs/ui`), `docs/connecting-an-app.md`. This app conforms to them;
   it never works around one. A gap is raised in `sovereign`, not patched here.
2. **`DESIGN.md`**: what Tasks is and how it is built, with numbered sections that tasks cite.
3. **`ROADMAP.md`**: the order of work, one row per task, canonical for status.
4. **`docs/epics/`**: each task's detail (goal, "Accepts when", and once done, how it was done and what was left out).

`DESIGN.md`, `ROADMAP.md`, `docs/epics/` and `CHANGELOG.md` do not exist yet: writing the design and the roadmap is the first task.
Directories are created when they are needed, not before. The proposal layers are Sovereign's and Fjord's, and are used the same way:
**research** (`docs/research/`) for an open question with no design, an **RFC** (`docs/rfcs/`) for a design that needs review before it
is built, an **ADR** (`docs/adrs/`) for a settled decision, and a **workstream** (`docs/workstreams/`) for a feature that crosses several
epics, as an ordered run of legs with its decisions locked. A documented "not now" is a valid outcome.

## Planning workflow

Three layers, each with one job: this file says how to work, `ROADMAP.md` says which tasks exist and their status, and
`docs/epics/<file>.md` says what a task is.

- **The developer assigns the task** at the start of a session. There is no "next task" pointer in any file; read `ROADMAP.md` for the
  queue and ask which to pick up.
- **Task IDs are permanent** (`1a.3`): use them in cross-references and dependency lists, never in branch names, commit messages or PR
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

The ones most likely to be broken by accident. Each comes from `sovereign`'s contracts or from how Fjord Web is built.

- **A person is identified by `session.sub` and by nothing else.** Never by email, never matched to an account by address.
- **Everything of a person is deleted in `onAccountDeleted`** (`lib/auth.ts`, which core calls until it gets a 200, so it must be safe to
  run twice). **A new table that holds something of a person is deleted there in the same change**, with a test that seeds one of each.
- **Server actions and routes authorize inside.** A `'use server'` function is a public POST endpoint whatever the page's guard says:
  each asks `auth().requireSession(...)` first, and a row of a person is read and written with the owner in the same statement
  (`WHERE id = $1 AND owner = $2`), never checked beforehand and then touched. Another person's row is a 404, not a 403. A route that
  changes something checks the request's `Origin`. A new endpoint without a test of who may call it is not done.
- **The manifest is the one copy** (`sovereign.manifest.json`): the port, the scopes, the redirect paths and the variables the instance
  gives. Nothing else repeats them. `pnpm manifest:check` passes, and the image is built with the arguments
  `pnpm exec sovereign-manifest docker-args` prints from it.
- **Environment variables carry the app's prefix, `TASKS_`.** Every `process.env` read is declared in `.env.example`. A required secret
  with no value throws at start-up; no secret has a default. `NEXT_PUBLIC_*` is never used for a value that varies at run time (it is
  inlined at build time).
- **Migrations are forward-only SQL in `migrations/`**, applied by `lib/migrate.ts` once each, under one advisory lock, on the direct
  connection. **A released migration is never edited:** a fix is a new migration, and a patch release has none. Raw SQL binds its values
  and never interpolates one. PostgreSQL's `bigint` and `COUNT(*)` come back as strings: coerce.
- **The design system comes through `app/ui.tsx`.** `@sovereignfs/ui` is one bundle that uses React context, so a Server Component
  imports its parts from there (a `'use client'` re-export, which still renders on the server). Style with the `--sv-*` tokens, never a
  literal colour, so dark mode and theming keep working. The typeface is the one `@sovereignfs/ui` ships (Hanken Grotesk), never fetched
  from another site. Reusable UI belongs in `@sovereignfs/ui` in `sovereign`, not forked here. Take icon names and props from the
  package's types, not its README.
- **`@sovereignfs/ui` is pre-1.0 and is pinned exactly;** upgrade it on purpose. Dependencies are chosen, not accumulated. A dependency's
  licence must be compatible with AGPL-3.0-or-later, which is what bundling `@sovereignfs/ui` makes this app.
- **No third-party loads and no third-party requests from the browser.** Pages that render untrusted text escape it; Markdown, if there
  ever is any, is sanitised.
- **Tokens and secrets never appear in an error, a log, a URL or the browser.** The SDK stores the refresh token sealed; keep it so.
- **Next.js tracks the latest stable release,** never a canary. Read the guide bundled with the installed version
  (`node_modules/next/dist/docs/`) before writing Next code: it is not the Next.js of anyone's memory. `next dev` writes its own block
  into this file; commit it with your work.
- **TypeScript is strict.** No `any` without a comment saying why it cannot be avoided. Prefix an intentionally unused identifier with
  `_`; never disable a lint rule inline without a comment.

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
pnpm dev                         # next dev (needs a .env: copy .env.example and point it at a core and a PostgreSQL)
pnpm typecheck                   # tsc --noEmit
pnpm manifest:check              # sovereign.manifest.json is a valid manifest
pnpm build                       # next build (standalone)
eval "docker build $(pnpm exec sovereign-manifest docker-args) -t tasks:ci ."   # the image, with its port and label from the manifest
```

Format, lint and test commands are added with their tooling (below); once they exist, this list is where they are written, and
`verify` means all of it.

## Layout

| Path | What |
| --- | --- |
| `app/` | Routes and layouts (App Router). `app/auth/[action]/route.ts` is sign-in, sign-out and core's back-channel and account-deleted calls; `app/api/health/route.ts` answers 200 when the database does |
| `app/ui.tsx` | The design system's client boundary |
| `lib/` | Everything that is not a route: `auth.ts` (the SDK's sign-in), `stores.ts` (its sessions and tokens, in the database), `db.ts`, `migrate.ts`, `crypto.ts`, `config.ts`, `sovereign.ts` |
| `migrations/` | Forward-only SQL |
| `sovereign.manifest.json` | What an instance reads to host the app |
| `Dockerfile`, `.github/workflows/publish.yml` | One image, not root, on the manifest's port; built and published to `ghcr.io` on a `vX.Y.Z` tag |

## Not in place yet

Each is a task to plan, not a thing to assume exists: `DESIGN.md`, `ROADMAP.md`, `docs/epics/`, `CHANGELOG.md`, `CONTRIBUTING.md`, a
`LICENSE` (AGPL-3.0-or-later, as Fjord Web's), formatting and lint (Sovereign's Prettier and ESLint configuration), a test runner and
tests (Vitest; sign-in is tested against a fake core, never a real instance, as Fjord Web does), a CI workflow with a
changes-classifier job, a pull request template, and Dependabot. Add them in their own `chore/` PRs, and move the line out of this
section as each lands.
