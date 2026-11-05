# Changelog

All notable changes to Tasks are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

Each release's section is also its GitHub release notes: the release workflow reads this file when a release is cut. Write the notes under
`## [Unreleased]` as you go; a release turns them into the version's section.

## [Unreleased]

### Added

- The repository's conventions: licence, contributing guide, pull request template and dependency updates.
- Formatting with Prettier, linting with ESLint, and tests with Vitest.
- Continuous integration, which runs only what a change can affect.
- Settings are read in one place and checked at start-up: the server stops, naming the setting and never its value, on a wrong address, a partial set of related settings, or an SMTP host with no sender. `.env.example` lists every setting.
- The database, in three forms: an sqld service (the default), a SQLite file and PostgreSQL, chosen by `TASKS_DB_DIALECT`. The server provisions and migrates it when it starts, waits for one that is still starting, and does not start if it cannot. `/api/health` answers only when the database does.
- Migrations generated from a schema per dialect with `pnpm db:generate`, and checked in CI.
- The frame of every page: a header with the app's mark and name, in light and dark and at a phone's width, with pages for a missing or failed route. Typeface and colours come from the design system, and a test refuses a literal colour, an undefined token or a typeface of the app's own.
- Every page is sent with a Content-Security-Policy that has a nonce of its own, with no inline script, handler or `eval` allowed and nothing third-party; every response has the hardening headers, and HSTS over https.
- A runner for background work inside the web process, safe when several processes share a database, switched off in all but one with `TASKS_WORKER=off`, and stopped on SIGTERM.
- Browser tests with Playwright, in Chromium and WebKit, on each database form.
- One image on Debian, not root, with the three ways to run it (an sqld service, a file, PostgreSQL) and a README, and a check that brings each up from nothing, restarts it, and stops it on SIGTERM. Published images carry provenance.

### Removed

- The scaffold's notes example, its sign-in and its database code.
