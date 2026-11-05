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
- Local sign-in: the first account is made with an email and password and signs the person in, and later sign-ups are refused by the server unless `TASKS_AUTH_SIGNUP=open`. Sign-in is limited per address, a request from another site is refused, and a wrong password reads the same as an address with no account. With `TASKS_AUTH_LOCAL` off, `/sign-in`, `/sign-up` and `/api/auth` answer 404. The header has a menu with Sign out.
- The sync endpoint, `POST /api/sync`, which a device sends its changes to and pulls what changed from: a change is applied once however often it is sent, only to the signed-in person's own rows, in an order every device agrees on. Nothing in the app uses it yet.
- Signing out removes that person's tasks from the device, after sending what it can and asking before it throws away what it cannot; it needs a connection, so that no one else can use the session. A session that ends elsewhere shows sign-in and no data at the next sync, and keeps what was changed on the device for when the same person signs back in.
- The app for someone signed in: a header, a sidebar of lists with their colour and count of open tasks, and a right-hand column that opens for a task and closes without adding a step to go back through. It reads from the device, so it shows at once with or without a network. On a phone the sidebar is left out until the mobile layout.
- Lists: the first visit makes _My tasks_, a + in the sidebar adds a list (also with no network, and it is sent when the connection comes back), and lists are dragged into order, which changes one row. A list that is not there says so and leads back.
- The front address is a page that says what Tasks is, with a way to sign in, for someone who is not signed in, and their first list for someone who is.

### Removed

- The scaffold's notes example, its sign-in and its database code.
