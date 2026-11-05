# Epic 1: Foundation

## Status

📋 Planned

## Overview

Turns the scaffold into a repository that can hold Tasks as `DESIGN.md` designs it: an app that runs alone or hosted, on three forms of database. Nothing a person would notice, and everything else stands on it. Fjord Web (`clients/web` in `sovereignfs/fjord`) is the model throughout, and its code may be adapted where the licence allows, both being AGPL-3.0-or-later.

## Related

[`DESIGN.md`](../../DESIGN.md) §5, §19, §20 · Fjord's `clients/web/DESIGN.md` §14, §17

## Tasks

#### 📋 1.1 — Repository conventions

**Goal:** the files a repository of the suite is expected to have, and dependencies on the terms `AGENTS.md` states.

**Design:** §20, `AGENTS.md`. **Depends on:** nothing.

**Technical:**
- Add `LICENSE` (AGPL-3.0-or-later), `CHANGELOG.md` (Keep a Changelog, with `[Unreleased]`), `CONTRIBUTING.md` (the people's version of `AGENTS.md`, as Fjord's), `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml`.
- `package.json`: `"license"`, `"type": "module"`, engines `>=24.15 <25`.
- Pin `@sovereignfs/ui` and `@sovereignfs/sdk` exactly (the scaffold has `^`), listed in `minimumReleaseAgeExclude` as needed.
- `.gitignore`: `tsconfig.tsbuildinfo`, `next-env.d.ts`, `test-results/`. Add a `.node-version`.
- `tsconfig.json`: `noUncheckedIndexedAccess`. TypeScript stays on 6.0.x until `typescript-eslint` supports 7, as `sovereign` does (Fjord's client is on 7 and has no ESLint).

**Accepts when:** a clean checkout installs with `pnpm install --frozen-lockfile`, `pnpm typecheck` passes, and `git status` is clean after it.

#### 📋 1.2 — Format, lint and test tooling

**Goal:** the checks every later task runs.

**Design:** §20 Testing, `AGENTS.md`. **Depends on:** 1.1.

**Technical:**
- Prettier and ESLint with `sovereign`'s configuration: single quotes, semicolons, trailing commas, width 100; flat config, `typescript-eslint` recommended and strict, `eslint-config-prettier`. Reformat the repository in one commit of its own.
- Vitest, with `src/**/*.test.{ts,tsx}`, `server.deps.inline` for `@sovereignfs/ui` (it imports CSS Modules), `fileParallelism: false` (data-layer tests share a database).
- Scripts: `format`, `format:check`, `lint`, `test`. `typecheck` becomes `next typegen && tsc --noEmit`.
- One real test, so a broken runner cannot pass silently.
- `AGENTS.md` Commands gains them.

**Accepts when:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, and each is seen to fail on a planted fault.

#### 📋 1.3 — Continuous integration

**Goal:** CI that runs what a change can affect, and vouches for the commit that lands.

**Design:** §20; Fjord's `web-ci.yml`, `scripts/ci-changes.sh`. **Depends on:** 1.2; gains its test legs with 1.5.

**Technical:**
- `.github/workflows/ci.yml`, on pull requests and on pushes to `main` (a rebase-and-merge makes new SHAs). Skipped on a draft or with the `skip-ci` label.
- A first `changes` job classifies the paths with `scripts/ci-changes.sh`, which has its own tests: Markdown and `docs/` run nothing more.
- Jobs: `check` (format, lint, typecheck, build, and from 1.5 "committed migrations match the schemas"); `tests` as a matrix over `sqld`, `file` and `postgres`, with a service for each; from 1.9 `e2e`; from 1.10 `image`. Actions pinned by SHA.

**Accepts when:** a documentation-only PR runs only the first job; a code PR runs all, and a planted failure in one database's leg fails it.

#### 📋 1.4 — Configuration, start-up, and removing the scaffold

**Goal:** the app reads its settings in one place, refuses to start on a wrong one, and no longer holds the scaffold's sign-in or database code.

**Design:** §5.1, §5.2, §6. **Depends on:** 1.2.

**Technical:**
- Remove `lib/`, `app/auth/`, `app/actions.ts`, `app/page.tsx`'s notes, `app/ui.tsx`, `migrations/001_init.sql`, `instrumentation.ts`'s old body, and `pg` use as it stands. Move to `src/`.
- `src/config/env.ts`: reads a setting, and a secret in either form (`NAME`, or `NAME_FILE`, per `contracts/env.md`). `process.env` is read nowhere else.
- `.env.example` rewritten for every setting of §6, §16 and §19, with comments, as Fjord's `deploy/.env.example`.
- `instrumentation.ts` hands to `instrumentation-node.ts` (Next compiles the first for Edge too). It validates settings and exits on one that is wrong: the standalone server would otherwise stay up.
- `app/api/health/route.ts` answers 200; 1.5 makes it ask the database.
- Keep `sovereign.manifest.json` valid while it moves; `pnpm manifest:check` stays green.

**Accepts when:** the app builds and serves a placeholder with no database; a wrong `TASKS_URL` stops it with a message naming the setting and not its value; `grep -r process.env src app` finds only `src/config/`.

#### 📋 1.5 — The database layer

**Goal:** the three forms of §19, with two stores, migrations at start-up, and tests on each from here on.

**Design:** §19. Fjord's §14 and `src/db/`. **Depends on:** 1.4.

**Technical:**
- Dependencies: `drizzle-orm`, `drizzle-kit`, `@libsql/client`, `pg`.
- `src/db/config.ts` reads `TASKS_DB_DIALECT` (`sqld` default, `sqlite`, `postgres`), `TASKS_SQLD_URL`, `TASKS_SQLD_ADMIN_URL`, `TASKS_SQLITE_URL`, `TASKS_POSTGRES_URL`, `TASKS_POSTGRES_POOL_MAX`, `PGSSLROOTCERT`, `TASKS_DB_CONNECT_TIMEOUT_MS`, `TASKS_MIGRATIONS_DIR`. Nothing infers a dialect from a URL.
- Two clients: `@libsql/client/web` for sqld, so no native addon loads on the common path, with an `x-namespace` header per store; the native client only for `file:`, in WAL mode with a busy timeout. `pg` with `int8` parsed to a number, past 2^53 an error.
- Stores made if missing: sqld namespaces `tasks` and `tasks_auth`, the file's directory, PostgreSQL schema `tasks_auth` (and `tasks`).
- `src/db/schema/{sqlite,postgres}/columns.ts`: the vocabulary of §19.2. `id`, `epochMs`, `bool`, `isoDate`, `hhmm`, and `position` (`COLLATE "C"` on PostgreSQL, through `customType`). A first table, `account_settings`, proves it.
- `pnpm db:generate <name>` for both dialects; `migrations/{sqlite,postgres,auth}`; applied at start-up, under an advisory lock on one pinned connection on PostgreSQL, with retry on SQLite.
- `src/db/exec.ts` for what raw SQL there is, and one `transaction(fn)` across dialects.
- `src/db/test-support.ts`: reads `TASKS_TEST_*` only, defaults to a temporary `file:`. `pnpm db:dev sqld|postgres` runs one in Docker. sqld pinned at v0.24.33.
- `/api/health` asks the database. CI: the `tests` matrix, and fails if `db:generate` would write anything.

**Accepts when:** an empty database boots on each of the three from documented variables; `pnpm test` passes on all three; a parity test fails when a column is added to one dialect; a test proves the two stores are separate on sqld; a concurrent-start test passes; a position column sorts `a0 < aA < aa` by bytes on each.

#### 📋 1.6 — The job runner

**Goal:** background work inside the web process, safe with several processes.

**Design:** §5, §14.3. **Depends on:** 1.5.

**Technical:**
- `src/jobs/runner.ts`: `register(name, intervalMs, fn)`; started from `instrumentation-node.ts` unless `TASKS_WORKER=off`; stopped on `SIGTERM`, waiting for what is in flight, within the stop grace period.
- A run of a job never overlaps itself in one process, and a failure is logged by job name and kind and does not stop the timer.
- The clock is passed into jobs, so that tests call them directly with a time.
- A `claim` helper: a conditional update whose affected rows say whether this process won. Documented as the only coordination, since SQLite has no lock.
- Next's standalone server handles `SIGTERM`; confirm in the image (1.10) that it exits in seconds.

**Accepts when:** two runners over one database do a claimed piece of work once; a job that throws runs again next tick; `TASKS_WORKER=off` runs nothing; `SIGTERM` during a slow job stops cleanly.

#### 📋 1.7 — Security headers

**Goal:** every response carries the hardening headers, and pages a strict Content-Security-Policy.

**Design:** §20 Security. **Depends on:** 1.4.

**Technical:** `proxy.ts` (Edge discipline: no Node built-ins, no database). A per-request nonce; `script-src 'nonce-…' 'strict-dynamic'`, never `'unsafe-inline'`; `default-src 'self'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`. HSTS over https only; `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Applied on every return path. Pages that need the nonce are dynamic.

**Accepts when:** `proxy.test.ts` asserts the headers on each return path; a page loads in a browser with no CSP violation in its console; an inline script with no nonce is refused.

#### 📋 1.8 — Design system boundary and shell

**Goal:** the frame every signed-in page sits in, and the pages for what goes wrong.

**Design:** §13.1, §13.2. Fjord's `src/ui`. **Depends on:** 1.2.

**Technical:**
- `src/ui/index.ts`: a `'use client'` re-export of `@sovereignfs/ui`; `@dnd-kit/*` installed, since it imports them unconditionally.
- `app/layout.tsx`: `@sovereignfs/ui/tokens.css`, Hanken Grotesk through `next/font/google` (self-hosted at build), the theme script that sets `data-theme` before first paint, with the CSP nonce.
- `src/ui/AppShell.tsx`: the app's name, and the account's menu (filled by 2.1). A candidate for `@sovereignfs/ui`; check whether `Header` serves first and record the answer in the task's Done as.
- `app/not-found.tsx`, `app/error.tsx`, `app/loading.tsx`, each with a way back.

**Accepts when:** a placeholder page renders inside the shell on the server, in light and dark, and at 375px; a literal colour fails `sovereign`'s token check, adopted here as a test.

#### 📋 1.9 — Browser tests

**Goal:** a way to test what only a browser can show.

**Design:** §20 Testing. **Depends on:** 1.5.

**Technical:** Playwright, Chromium and WebKit; `playwright.config.ts` runs a built server per database form; `e2e/` with one smoke test; `pnpm e2e`. WebKit runs what it can; the iOS Simulator remains the check for touch (§13.7), by hand, and says so in the PR. A CI job.

**Accepts when:** the smoke test passes on all three forms in CI, and fails when the page is broken.

#### 📋 1.10 — The image and deployment setups

**Goal:** the three ways to run it, each brought up from nothing in CI.

**Design:** §19, §20 Deployment. **Depends on:** 1.5, 1.6.

**Technical:**
- `Dockerfile`: pnpm by corepack, `pnpm-workspace.yaml` copied, standalone output, not root, `ARG PORT`, migrations copied beside the server. **A glibc base for the `file:` form** (libSQL's native client has no musl build), or a check for the binary: the scaffold's Alpine is settled here, against Fjord's answer.
- `deploy/`: Compose files for sqld (the default), a file and PostgreSQL, a README and `.env.example`.
- `scripts/deploy-check.sh`: brings each up from an empty volume, asks `/api/health`, restarts it to prove migrations are safe twice, and sends `SIGTERM`, expecting a stop in seconds.
- `publish.yml` keeps its tag rule, and gains provenance. A CI `image` job runs the check.

**Accepts when:** `deploy-check.sh` passes on all three on amd64 and arm64 in CI, and the one `docker run` of `DESIGN.md` §20 works as written.
