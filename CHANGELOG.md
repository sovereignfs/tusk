# Changelog

All notable changes to Tusk are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

Each release's section is also its GitHub release notes: the release workflow reads this file when a release is cut. Write the notes under
`## [Unreleased]` as you go; a release turns them into the version's section.

## [Unreleased]

### Added

- The repository's conventions: licence, contributing guide, pull request template and dependency updates.
- Formatting with Prettier, linting with ESLint, and tests with Vitest.
- Continuous integration, which runs only what a change can affect.
- Settings are read in one place and checked at start-up: the server stops, naming the setting and never its value, on a wrong address, a partial set of related settings, or an SMTP host with no sender. `.env.example` lists every setting.
- The database, in three forms: an sqld service (the default), a SQLite file and PostgreSQL, chosen by `TUSK_DB_DIALECT`. The server provisions and migrates it when it starts, waits for one that is still starting, and does not start if it cannot. `/api/health` answers only when the database does.
- Migrations generated from a schema per dialect with `pnpm db:generate`, and checked in CI.
- The frame of every page: a header with the app's mark and name, in light and dark and at a phone's width, with pages for a missing or failed route. Typeface and colours come from the design system, and a test refuses a literal colour, an undefined token or a typeface of the app's own.
- Every page is sent with a Content-Security-Policy that has a nonce of its own, with no inline script, handler or `eval` allowed and nothing third-party; every response has the hardening headers, and HSTS over https.
- A runner for background work inside the web process, safe when several processes share a database, switched off in all but one with `TUSK_WORKER=off`, and stopped on SIGTERM.
- Browser tests with Playwright, in Chromium and WebKit, on each database form.
- One image on Debian, not root, with the three ways to run it (an sqld service, a file, PostgreSQL) and a README, and a check that brings each up from nothing, restarts it, and stops it on SIGTERM. Published images carry provenance.
- Local sign-in: the first account is made with an email and password and signs the person in, and later sign-ups are refused by the server unless `TUSK_AUTH_SIGNUP=open`. Sign-in is limited per address, a request from another site is refused, and a wrong password reads the same as an address with no account. With `TUSK_AUTH_LOCAL` off, `/sign-in`, `/sign-up` and `/api/auth` answer 404. The header has a menu with Sign out.
- The sync endpoint, `POST /api/sync`, which a device sends its changes to and pulls what changed from: a change is applied once however often it is sent, only to the signed-in person's own rows, in an order every device agrees on. Nothing in the app uses it yet.
- Signing out removes that person's Desk from the device, after sending what it can and asking before it throws away what it cannot; it needs a connection, so that no one else can use the session. A session that ends elsewhere shows sign-in and no data at the next sync, and keeps what was changed on the device for when the same person signs back in.
- The app for someone signed in: a header, a sidebar of lists with their colour and count of open cards, and a right-hand column that opens for a card and closes without adding a step to go back through. It reads from the device, so it shows at once with or without a network. On a phone the sidebar is left out until the mobile layout.
- Lists: the first visit makes _Backlog_, a + in the sidebar adds a list (also with no network, and it is sent when the connection comes back), and lists are dragged into order, which changes one row. A list that is not there says so and leads back.
- The front address is a page that says what Tusk is, with a way to sign in, for someone who is not signed in, and their first list for someone who is.
- Cards: add one by typing and pressing Enter (it goes to the top and the cursor stays), tick it off, open it in the right-hand column to change its title and description (saved as you leave the field), and delete it with ten seconds to undo. All of it works with no network and is sent when the connection comes back.
- Checklists: items in a card's detail, each with a tick and a title, with a ring on the card's row showing how far through it is. Ticking a card ticks its open items, and leaves the time of those already done; ticking the last item does not tick the card.
- Cards and checklist items are dragged into order, which changes one row, and by keyboard: Space lifts a row, the arrows move it, Space puts it down.
- Deleting a card takes its checklist with it, and Undo brings back exactly those, not one that was deleted before.
- Deleted cards, items and lists are removed for good after seven days, and a device that was away learns of it the next time it connects; one that was away for more than ninety days starts again from what the server holds, after sending what it had changed.
- A list can be sorted by the order you made, date created, due date or title, and the choice is remembered for that list on every device; under any sort but your own order a card cannot be dragged. The Completed section opens and closes as you left it, can be hidden with _Active_, and has _Delete completed_, with Undo.
- A card can be moved to another list from its detail (its checklist stays with it), and starred with a star on its row or in the detail.

### Changed

- Workspaces: made from the + in the sidebar, listed under _My workspaces_ (and _Shared with me_, for those a person is in), renamed by an owner, and deleted by typing the name, which takes every board and card in it. A workspace that is not yours is the page for what is not here.
- The server has the tables of workspaces, boards and cards, and one door for writing to them, `POST /api/ops`: an operation with its permission in the statement that does the work, answered the same whether the thing is not there or is not yours. Nothing in the app uses it yet.
- A workspace's people: owners add a person by the exact email of an account that exists here, make others owners, and remove them; anyone can leave; a workspace always keeps an owner. Removing or leaving takes the person off the workspace's boards and unassigns them, and their comments stay. Adding by address is limited to 30 an hour for each account. All of it is in the workspace's settings, from the gear on its page.
- Boards: a workspace shows its boards as tiles and has a tile to create one, with a name and any colour. A board is made with a _Backlog_ list; its members add lists, rename them, drag them by their header or move them from the menu, and delete them after being told how many cards go with them. A change shows at once and is undone if it is refused. The board reads again when it was changed from elsewhere, within 20 seconds or when you come back to it, and says it needs a connection when offline.
- The boards page: the Desk as a tile with its open and due-today counts (there offline), then each workspace with its people, a gear for its settings, its boards and a tile to create one; archived boards are behind _Archived_. The order of your own workspaces (name, date created, recently updated) is saved with your account and is the same on every device. The sidebar's entry is _Boards_.
- Cards on a board: add a card at the top of a list (from the column or the list's menu), drag it by its whole tile within a list or to another, move it with the keyboard (Space, arrows, Space), archive it from its menu, and restore it to its place or delete it for good from _Archived cards_.
- The card dialog: a click or Enter on a card opens it over its board, at its own address, so it can be linked to and reloaded. The title and the description save as you leave them and the card behind follows at once; a title emptied goes back to the one it had; the card can be archived from it. Closing it replaces the address.

- The app is called **Tusk**, not Tasks. Every setting is `TUSK_…` (it was `TASKS_…`), the databases are `tusk` and `tusk_auth` (files `tusk.db` and `tusk_auth.db`), the session cookie is `tusk.session_token`, the database kept in the browser is `tusk-desk-<account>`, and the image is `ghcr.io/sovereignfs/tusk`. Nothing was released under the old names, so there is no alias: set the new ones, and a database made under the old names starts again.
- The Desk's data is four tables of its own, `desk_list`, `desk_card`, `desk_check` and `desk_series`: a card has a description (what were notes), and a checklist item is a row of its own and no longer a task with a parent. The sync protocol is version 2, so a device that speaks version 1 is told to update, and the database kept in the browser starts again. The database migrations are squashed into one; a development database made before this is made again (`pnpm seed` makes an account worth looking at).
- A card is opened by `?card=` (it was `?task=`). The Desk is at `/desk` and `/desk/<list>` (it was `/home` and `/lists/<id>`).
- A card can be marked In progress as well as Open and Done, from the Status control in its detail; a small turning mark by its title shows it. Done is never lost to a later In progress from a device that had not heard of it.
- Settings, from the avatar menu: a dialog over the page, and a page of its own at `/account`. Profile (the name), Security (the password, which ends every other session, and the devices signed in, each of which can be signed out), Preferences (the theme) and Data (when this device last synced).
- A list can be any colour, picked from the dot beside its name: a suggestion, or a colour of one's own. A card can be dragged from anywhere on its row, and a click on the row's free space opens it.
- The app has a sidebar at the left of every signed-in page, which is full, a rail of icons, or hidden, from a button in the header and one on the sidebar itself, and is remembered on that device for the Desk and for the other pages. The Desk opens it as a rail. On a phone there is none yet.

### Removed

- The scaffold's notes example, its sign-in and its database code.
