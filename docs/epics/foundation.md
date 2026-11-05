# Epic 1: Foundation

## Status

📋 Planned

## Overview

Turns the scaffold into a repository that can hold Tasks as `DESIGN.md` designs it: an offline-first PWA that runs alone or hosted, on three forms of database. Nothing a person would notice, and everything else stands on it. Fjord Web (`clients/web` in `sovereignfs/fjord`) is the model throughout, and its code may be adapted where the licence allows, both being AGPL-3.0-or-later.

## Related

[`DESIGN.md`](../../DESIGN.md) §5, §22, §23 · Fjord's `clients/web/DESIGN.md` §14, §17

## Tasks

#### ✅ 1.1 — Repository conventions

**Goal:** the files a repository of the suite is expected to have, and dependencies on the terms `AGENTS.md` states.

**Design:** §23, `AGENTS.md`. **Depends on:** nothing.

**Technical:**

- Add `LICENSE` (AGPL-3.0-or-later), `CHANGELOG.md` (Keep a Changelog, with `[Unreleased]`), `CONTRIBUTING.md` (the people's version of `AGENTS.md`, as Fjord's), `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml`.
- `package.json`: `"license"`, `"type": "module"`, engines `>=24.15 <25`.
- Pin `@sovereignfs/ui` and `@sovereignfs/sdk` exactly (the scaffold has `^`), listed in `minimumReleaseAgeExclude` as needed.
- `.gitignore`: `tsconfig.tsbuildinfo`, `next-env.d.ts`, `test-results/`. Add a `.node-version`.
- `tsconfig.json`: `noUncheckedIndexedAccess`. TypeScript stays on 6.0.x until `typescript-eslint` supports 7, as `sovereign` does (Fjord's client is on 7 and has no ESLint).

**Accepts when:** a clean checkout installs with `pnpm install --frozen-lockfile`, `pnpm typecheck` passes, and `git status` is clean after it.

**Done as:** licence (copied from Fjord Web's AGPL text), contributing guide, pull request template, Dependabot, `.editorconfig` and `.node-version` (24.18.0); `package.json` gains `license`, `type` and `engines` of `>=24.15 <25`; `@sovereignfs/ui` is pinned at 0.91.0 and `@sovereignfs/sdk` at 2.1.0, both in `minimumReleaseAgeExclude`; `noUncheckedIndexedAccess` is on, and the scaffold already passed it. Dependabot holds TypeScript to 6.0.x and `@types/node` to the runtime's major. Left out: Prettier and ESLint, which are 1.2's.

#### ✅ 1.2 — Format, lint and test tooling

**Goal:** the checks every later task runs.

**Design:** §23 Testing, `AGENTS.md`. **Depends on:** 1.1.

**Technical:**

- Prettier and ESLint with `sovereign`'s configuration: single quotes, semicolons, trailing commas, width 100; flat config, `typescript-eslint` recommended and strict, `eslint-config-prettier`. Reformat the repository in one commit of its own.
- Vitest, with `src/**/*.test.{ts,tsx}`, `server.deps.inline` for `@sovereignfs/ui` (it imports CSS Modules), `fileParallelism: false` (data-layer tests share a database).
- Scripts: `format`, `format:check`, `lint`, `test`. `typecheck` becomes `next typegen && tsc --noEmit`.
- One real test, so a broken runner cannot pass silently.
- `AGENTS.md` Commands gains them.

**Accepts when:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, and each is seen to fail on a planted fault.

**Done as:** Prettier and ESLint with Sovereign's configuration (strict TypeScript rules and jsx-a11y; `eslint-plugin-jsx-a11y` is allowed on ESLint 10 by one named peer rule); Vitest, with the design system inlined for its CSS Modules and files run one after another; a smoke test that reads the manifest, so a runner that finds nothing cannot pass; `typecheck` runs `next typegen` first. The repository was reformatted in a commit of its own. Each of format, lint, typecheck and test was seen to fail on a planted fault. The scaffold's one lint error (an error thrown without its cause) is fixed. Left out: git hooks (`simple-git-hooks`, `lint-staged`), which can follow if wanted.

#### ✅ 1.3 — Continuous integration

**Goal:** CI that runs what a change can affect, and vouches for the commit that lands.

**Design:** §23; Fjord's `web-ci.yml`, `scripts/ci-changes.sh`. **Depends on:** 1.2; gains its test legs with 1.5.

**Technical:**

- `.github/workflows/ci.yml`, on pull requests and on pushes to `main` (a rebase-and-merge makes new SHAs). Skipped on a draft or with the `skip-ci` label.
- A first `changes` job classifies the paths with `scripts/ci-changes.sh`, which has its own tests: Markdown and `docs/` run nothing more.
- Jobs: `check` (format, lint, typecheck, build, and from 1.5 "committed migrations match the schemas"); `tests` as a matrix over `sqld`, `file` and `postgres`, with a service for each; from 1.9 `e2e`; from 1.10 `image`. Actions pinned by SHA.

**Accepts when:** a documentation-only PR runs only the first job; a code PR runs all, and a planted failure in one database's leg fails it.

**Done as:** `.github/workflows/ci.yml` runs on pull requests and on pushes to `main`, and weekly; skipped on a draft or with `skip-ci`. A `changes` job runs `scripts/ci-changes.sh` (29 tests in `scripts/test-ci-changes.sh`, one of which was seen to fail when the documents rule was removed) and sets `code` and `scripts`, so a change to documents alone runs nothing more. `check` runs format, lint, type-check, test, build and the manifest check; `scripts` runs shellcheck and the classifier's tests. Actions are pinned by SHA, and `actionlint` and `shellcheck` pass. Not here: the `tests` matrix over the three databases (1.5), `e2e` (1.9) and `image` (1.10), and the check that migrations match the schemas (1.5). It has not run on GitHub: nothing is pushed.

#### ✅ 1.4 — Configuration, start-up, and removing the scaffold

**Goal:** the app reads its settings in one place, refuses to start on a wrong one, and no longer holds the scaffold's sign-in or database code.

**Design:** §5.1, §5.2, §6. **Depends on:** 1.2.

**Technical:**

- Remove `lib/`, `app/auth/`, `app/actions.ts`, `app/page.tsx`'s notes, `app/ui.tsx`, `migrations/001_init.sql`, `instrumentation.ts`'s old body, and `pg` use as it stands. Move to `src/`.
- `src/config/env.ts`: reads a setting, and a secret in either form (`NAME`, or `NAME_FILE`, per `contracts/env.md`). `process.env` is read nowhere else.
- `.env.example` rewritten for every setting of §6, §19 and §22, with comments, as Fjord's `deploy/.env.example`.
- `instrumentation.ts` hands to `instrumentation-node.ts` (Next compiles the first for Edge too). It validates settings and exits on one that is wrong: the standalone server would otherwise stay up.
- `app/api/health/route.ts` answers 200; 1.5 makes it ask the database.
- Keep `sovereign.manifest.json` valid while it moves; `pnpm manifest:check` stays green.

**Accepts when:** the app builds and serves a placeholder with no database; a wrong `TASKS_URL` stops it with a message naming the setting and not its value; `grep -r process.env src app` finds only `src/config/`.

**Done as:** the scaffold's `lib/`, `app/auth/`, server actions, design-system re-export, SQL and `pg` are removed. `src/config/env.ts` is the one place `process.env` is read, and reads a secret as `NAME` or `NAME_FILE`, the file winning, never putting a path or value in an error; `loadConfig` checks `TASKS_URL` (https, except on localhost, no path), `TASKS_WORKER`, the settings that go together (Sovereign sign-in, Web Push, the GitHub App: all or none) and an SMTP host with no sender, reporting every problem at once and no value. `instrumentation-node.ts` stops the server on a wrong setting: a built server was seen to serve the placeholder and `/api/health` with nothing set, and to exit 1 on `http://tasks.example.com`. `.env.example` lists every setting of the design. Two tests hold the rules: nothing outside `src/config` touches `process.env`, and every `TASKS_` name in the code is declared in `.env.example`, each seen to fail on a planted fault. Not done: a required `TASKS_URL` or `TASKS_AUTH_SECRET`, which are 2.1's once sign-in uses them; the manifest still names the scaffold's sign-in paths, which 2.10 replaces; the Dockerfile no longer copies `migrations/`, which 1.5 puts back. README rewritten to say what is here.

#### ✅ 1.5 — The database layer

**Goal:** the three forms of §22, with two stores, migrations at start-up, and tests on each from here on.

**Design:** §22. Fjord's §14 and `src/db/`. **Depends on:** 1.4.

**Technical:**

- Dependencies: `drizzle-orm`, `drizzle-kit`, `@libsql/client`, `pg`.
- `src/db/config.ts` reads `TASKS_DB_DIALECT` (`sqld` default, `sqlite`, `postgres`), `TASKS_SQLD_URL`, `TASKS_SQLD_ADMIN_URL`, `TASKS_SQLITE_URL`, `TASKS_POSTGRES_URL`, `TASKS_POSTGRES_POOL_MAX`, `PGSSLROOTCERT`, `TASKS_DB_CONNECT_TIMEOUT_MS`, `TASKS_MIGRATIONS_DIR`. Nothing infers a dialect from a URL.
- Two clients: `@libsql/client/web` for sqld, so no native addon loads on the common path, with an `x-namespace` header per store; the native client only for `file:`, in WAL mode with a busy timeout. `pg` with `int8` parsed to a number, past 2^53 an error.
- Stores made if missing: sqld namespaces `tasks` and `tasks_auth`, the file's directory, PostgreSQL schema `tasks_auth` (and `tasks`).
- `src/db/schema/{sqlite,postgres}/columns.ts`: the vocabulary of §22.2. `id`, `epochMs`, `bool`, `isoDate`, `hhmm`, `fields`, and `position` (`COLLATE "C"` on PostgreSQL, through `customType`). A first table, `account_settings`, proves it.
- `pnpm db:generate <name>` for both dialects; `migrations/{sqlite,postgres,auth}`; applied at start-up, under an advisory lock on one pinned connection on PostgreSQL, with retry on SQLite.
- `src/db/exec.ts` for what raw SQL there is, and one `transaction(fn)` across dialects.
- `src/db/test-support.ts`: reads `TASKS_TEST_*` only, defaults to a temporary `file:`. `pnpm db:dev sqld|postgres` runs one in Docker. sqld pinned at v0.24.33.
- `/api/health` asks the database. CI: the `tests` matrix, and fails if `db:generate` would write anything.

**Accepts when:** an empty database boots on each of the three from documented variables; `pnpm test` passes on all three; a parity test fails when a column is added to one dialect; a test proves the two stores are separate on sqld; a concurrent-start test passes; a position column sorts `a0 < aA < aa` by bytes on each.

**Done as:** adapted from Fjord Web's database layer (both are AGPL, and the design is the same), with Tasks' names: `TASKS_DB_DIALECT` is `sqld` (the default), `sqlite` or `postgres`, never guessed from an address; `src/db/config.ts` reports a wrong setting by name, the PostgreSQL address as `NAME` or `NAME_FILE`, and `loadConfig` carries it so the server stops on it at start-up. Two stores: sqld namespaces `tasks` and `tasks_auth`, two SQLite files, two PostgreSQL schemas. The sqld client is `@libsql/client/web`, so only the `file:` form loads the native addon; the file runs in WAL mode with a busy timeout; PostgreSQL's `int8` is parsed to a number and refuses a value past 2^53. `instrumentation-node.ts` provisions, opens and migrates both stores, waits up to `TASKS_DB_CONNECT_TIMEOUT_MS`, and exits 1 saying why when it cannot; `/api/health` answers 200 only when the database does, and says the dialect. The vocabulary of §22.2 is `id`, `ref`, `epochMs`, `counter`, `bool`, `isoDate`, `hhmm`, `fields` and `position` (`COLLATE "C"` on PostgreSQL, through `customType`), proven by a test that makes a table out of every word with the SQL the generator writes. `transaction()` runs on all three. `pnpm db:generate <name>` writes both dialects' migrations, and CI fails if it would write more; the first is `account_settings`. Migrations are found beside the server or at `TASKS_MIGRATIONS_DIR`, and the Dockerfile copies them. The suite ran, passing, against sqld, a file and PostgreSQL 16 on Alpine, and again against PostgreSQL 18 on glibc; a fresh instance was booted on each form and again on an already-migrated one, and a built image booted on PostgreSQL. Seen to fail: a column on one dialect only, a plain `text` position on glibc PostgreSQL, the generated SQL without the collation, and a stray `process.env`. Two things the epic asked for are not as written: the auth store is provisioned and opened but has no migrations until 2.1, so the isolation test shows the app's table absent from it (the auth folder is skipped while it is optional and empty); and the CI `tests` matrix has run nowhere but here, since nothing is pushed. Not done: the `file:` form in the image, which is Alpine and so has no libSQL native build — 1.10 moves it to a glibc base, as Fjord's is.

#### ✅ 1.6 — The job runner

**Goal:** background work inside the web process, safe with several processes.

**Design:** §5, §17.3. **Depends on:** 1.5.

**Technical:**

- `src/jobs/runner.ts`: `register(name, intervalMs, fn)`; started from `instrumentation-node.ts` unless `TASKS_WORKER=off`; stopped on `SIGTERM`, waiting for what is in flight, within the stop grace period.
- A run of a job never overlaps itself in one process, and a failure is logged by job name and kind and does not stop the timer.
- The clock is passed into jobs, so that tests call them directly with a time.
- A `claim` helper: a conditional update whose affected rows say whether this process won. Documented as the only coordination, since SQLite has no lock.
- Next's standalone server handles `SIGTERM`; confirm in the image (1.10) that it exits in seconds.

**Accepts when:** two runners over one database do a claimed piece of work once; a job that throws runs again next tick; `TASKS_WORKER=off` runs nothing; `SIGTERM` during a slow job stops cleanly.

**Done as:** `src/jobs/runner.ts` is a `JobRunner`: a job has a name, an interval and a `run` that is given the runner's clock and an `AbortSignal`; the next run is scheduled when the last has ended, so a job never overlaps itself, and `runNow` joins a run in flight; a job that throws is logged as `[tasks] job <name> failed: <ErrorName> <code>` and never its message, and runs again, and one job's failure does not touch another; `stop()` clears the timers at once, aborts the signal, and waits for runs in flight up to 8 seconds (under Docker's ten), saying so if one outlasts it. The runner takes its timers, clock and log as parameters, so its 16 tests use no real time. `src/jobs/claim.ts` is the one coordination between processes: a conditional `UPDATE … RETURNING` whose returned rows say whether this process won, tested on sqld, a file and PostgreSQL with four connections racing ten times over one row and exactly one winning each time. `startJobs` runs none when `TASKS_WORKER=off`. `instrumentation-node.ts` starts them after the database and stops them on SIGTERM and SIGINT. The list of jobs is empty until a task adds its own (13.7, 8.5, 8.6, 10.5). Seen: the built server logs `jobs: running 0 jobs` or `off in this process`, and stops within a second of SIGTERM. Seen to fail: no join of a run in flight, timers not cleared on stop, and a claim whose update is not conditional. What is not as the epic said: Next's own SIGTERM handler closes the server and exits 143 without waiting for ours, so a job in flight when it finishes first is cut off rather than waited for; that is safe because every job claims its work, and the runner's wait is real for anything that stops the runner another way. Waiting for the epic's "`SIGTERM` during a slow job stops cleanly" at the process level needs a job that exists, so it is checked by 8.5 with the first real one.

#### ✅ 1.7 — Security headers

**Goal:** every response carries the hardening headers, and pages a strict Content-Security-Policy.

**Design:** §23 Security. **Depends on:** 1.4.

**Technical:** `proxy.ts` (Edge discipline: no Node built-ins, no database). A per-request nonce; `script-src 'nonce-…' 'strict-dynamic'`, never `'unsafe-inline'`; `default-src 'self'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; `connect-src 'self'`; `worker-src 'self'`. HSTS over https only; `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Applied on every return path. Pages that need the nonce are dynamic, and the cached shell (1.11) has to work with this: settle how here, since a cached page cannot carry a fresh nonce.

**Accepts when:** `proxy.test.ts` asserts the headers on each return path; a page loads in a browser with no CSP violation in its console; an inline script with no nonce is refused.

**Done as:** `proxy.ts` makes a nonce for every request (128 bits), puts it and the policy on the request, where Next reads it and puts it on its scripts and styles, and on the response; the layout puts it on the theme script; HSTS over https only; an API gets no page policy and no nonce. `src/security/csp.ts` is Fjord's policy without what Tasks has no use for (no frames, no raw documents, no WebAssembly), plus `worker-src` and `manifest-src` for task 1.11: `script-src` is `'self' 'nonce-…' 'strict-dynamic'` with `'unsafe-eval'` in development only, style elements carry the nonce and style attributes are allowed, everything else is this origin. `next.config.mjs` became `next.config.ts` to import the headers every response has (`nosniff`, `X-Frame-Options`, `no-referrer`, a `Permissions-Policy` that asks for nothing, `same-origin` opener). The proxy reads the two settings it needs through `src/config/edge.ts`, which has no Node import, so `process.env` is still read only in `src/config`. Pages are now rendered per request, as the design says. Seen: the built server sends the policy with a new nonce each request and the nonce is on its scripts; the app renders and hydrates under it with no violation; an inline event handler was blocked (`script-src-attr`) in a real browser. Seen to fail: `'unsafe-inline'` in `script-src`, and a page not given its nonce. Not settled here, and the reason task 1.11 now starts with proving it: a service worker cannot cache a page with a fresh nonce, so the offline shell is a page the worker builds itself, as core's is — whether Next's client can boot from that is not yet known. `strict-dynamic` lets a script that already runs add another, which is what it is for; an inline script in HTML the server sent without the nonce does not run.

#### ✅ 1.8 — Design system boundary and shell

**Goal:** the header every signed-in page sits under, and the pages for what goes wrong.

**Design:** §15.1, §15.2. Fjord's `src/ui`. **Depends on:** 1.2.

**Technical:**

- `src/ui/index.ts`: a `'use client'` re-export of `@sovereignfs/ui`; `@dnd-kit/*` installed, since it imports them unconditionally.
- `app/layout.tsx`: `@sovereignfs/ui/tokens.css`, Hanken Grotesk through `next/font/google` (self-hosted at build), the theme script that sets `data-theme` before first paint, with the CSP nonce.
- `src/ui/AppShell.tsx`: the header row: logo and app name on the left, the bell (8.1) and avatar on the right, with `UserMenu` (filled by 2.1). The design system's `Header` requires a launcher slot an app has no use for: use it if that can be made optional in `sovereign`, otherwise this; record the answer in the task's Done as.
- `app/not-found.tsx`, `app/error.tsx`, `app/loading.tsx`, each with a way back.

**Accepts when:** a placeholder page renders inside the shell on the server, in light and dark, and at 375px; a literal colour fails `sovereign`'s token check, adopted here as a test.

**Done as:** `src/ui/index.ts` is the `'use client'` re-export of `@sovereignfs/ui` (only what is used, and `@dnd-kit/*` is installed); `AppShell` is the header row, with the `BrandBadge` mark and the name at the left and the bell and the account menu as slots at the right, over a main area that does not scroll itself. The design system's `Header` was not used: it requires an app launcher, which an app has no use for, and its `MobileHeader` never stretches past 768px; both are noted in `AppShell`'s comment as worth offering to `@sovereignfs/ui`. The typeface is not loaded through `next/font/google` as the epic said: `@sovereignfs/ui` 0.91 ships Hanken Grotesk and its tokens load it from the app's own origin, which the build bundled into `.next/static/media`. `src/theme` sets `data-theme` before first paint from `tasks.theme` or the system's scheme, and follows the system; its script is run in a test against a stand-in page. `not-found.tsx`, `error.tsx` and `loading.tsx` each give a way back, and `error.tsx` never shows the error. `src/ui/design-tokens.ts` is Sovereign's token check as a test over the app's own CSS (an undefined token, a literal colour, a typeface of its own), seen to fail on a planted `#fff`. Looked at in a browser, from the built server: the shell and the 404 page, light at desktop width and dark at 375px, no horizontal overflow, a 56px header, Hanken Grotesk. Not seen: `error.tsx` and `loading.tsx`, which have no test beyond compiling. The theme script is inline without a nonce until 1.7 gives it one.

#### ✅ 1.9 — Browser tests

**Goal:** a way to test what only a browser can show.

**Design:** §23 Testing. **Depends on:** 1.5.

**Technical:** Playwright, Chromium and WebKit; `playwright.config.ts` runs a built server per database form; `e2e/` with one smoke test; `pnpm e2e`. WebKit runs what it can; the iOS Simulator remains the check for touch (§15.8), by hand, and says so in the PR. A CI job.

**Accepts when:** the smoke test passes on all three forms in CI, and fails when the page is broken.

**Done as:** `@playwright/test` 1.64.1 (the version whose Chromium Fjord Web's checkout had already downloaded), with Chromium and WebKit; WebKit 27.2 was downloaded for it. `playwright.config.ts` starts the built app on one port (3999), on the database form the environment names, and with none on a SQLite file of its own; names every other setting empty so a developer's `.env.local` cannot reach it. `scripts/serve-standalone.mjs` and `scripts/lib/standalone.mjs` run the standalone server as the image does (its static files and public folder copied beside it, the migrations named), and `boot-check` now uses the same helper. `e2e/smoke.spec.ts` has 7 tests, run in both browsers: the app is up and says its database; the shell's header, mark and name; an inline event handler is refused by the browser and raises a `script-src-attr` violation; a missing page is a 404 page with a link back that works; dark from the first paint; no horizontal overflow at 375px; the typeface is Hanken Grotesk and nothing is requested from another origin. All 14 passed on a file, on sqld and on PostgreSQL. Seen to fail: a changed heading, and a policy with `'unsafe-inline'` for scripts. The CI `tests` matrix now installs the browsers, runs `pnpm e2e` on its own database and keeps the report of a failure. WebKit here is a desktop build, so touch is still the iOS Simulator's, by hand. The CI job has not run, since nothing is pushed.

#### 📋 1.10 — The image and deployment setups

**Goal:** the three ways to run it, each brought up from nothing in CI.

**Design:** §22, §23 Deployment. **Depends on:** 1.5, 1.6.

**Technical:**

- `Dockerfile`: pnpm by corepack, `pnpm-workspace.yaml` copied, standalone output, not root, `ARG PORT`, migrations copied beside the server. **A glibc base for the `file:` form** (libSQL's native client has no musl build), or a check for the binary: the scaffold's Alpine is settled here, against Fjord's answer.
- `deploy/`: Compose files for sqld (the default), a file and PostgreSQL, a README and `.env.example`.
- `scripts/deploy-check.sh`: brings each up from an empty volume, asks `/api/health`, restarts it to prove migrations are safe twice, and sends `SIGTERM`, expecting a stop in seconds.
- `publish.yml` keeps its tag rule, and gains provenance. A CI `image` job runs the check.

**Accepts when:** `deploy-check.sh` passes on all three on amd64 and arm64 in CI, and the one `docker run` of `DESIGN.md` §23 works as written.

#### 📋 1.11 — The PWA

**Goal:** installable on desktop and phone, and opening with no network.

**Design:** §15.7. **Depends on:** 1.7, 1.8.

**Technical:** **First, prove the hard part,** which task 1.7 left open: every page now has a fresh nonce, so an HTML document the worker had cached would carry a stale one and its scripts would be blocked. The way out being tried is Sovereign core's: the worker builds the page itself, with a policy of its own, and a client that boots from it and the local store (task 13.3) with no document from the server. Whether Next's client can start that way is not known; if it cannot, the design's §15.7 and §23 change before anything else is built on it. Sovereign core is the model, since Fjord has neither (`apps/core/app/manifest.ts`, `src/pwa`, `src/sw/source.ts`, and its test). `app/manifest.ts`: name, icons with a maskable one, `display: standalone`, theme colours. `src/sw/source.ts`, served at `/sw.js`: an allow-list of built files, icons and the one shell page, in one versioned cache, with nothing else stored. Handlers for `push` and `notificationclick` arrive with 8.4, and `sync` with 13.6. A new version activates at the next load. An install line in Settings for iPhone.

**Accepts when:** Lighthouse's installable checks pass; the app installs in Chromium and on the iOS Simulator; with the network off, it opens to its shell; a test evaluates the worker and fails if a page with a person's data, or any API answer, is cached; a browser test lists every cache after a signed-in tour.
