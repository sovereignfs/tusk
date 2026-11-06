# Tusk — design

**Status:** draft, rewritten on 2026-11-06 when Tasks became Tusk. It is drawn from the legacy tasks and kanban plugins, Fjord Web and the owner's
direction. Phase 1's foundation, sign-in and the first form of the Desk are built (as lists and tasks, under the name Tasks); everything else is
designed and not built. Where this file and a contract Sovereign publishes disagree, the contract wins (`AGENTS.md`, Source of truth). §26 holds what is
still waiting on a decision, and §27 what has been decided and why.

[`ROADMAP.md`](ROADMAP.md) puts the work in order, and [`docs/epics/`](docs/epics/) holds each task's detail.

---

## 1. Purpose

Tusk is one app for the work a person does alone and the work they do with others. **The Desk** is theirs: a private, offline-first list of things to
do, as plain as Google Tasks. **Workspaces** hold boards that people share: Trello-like kanban, with lists of cards that are assigned, labelled,
discussed and moved along. It is an app of the Sovereign suite exactly as Fjord is: a program of its own, which an instance can host, and which needs no
instance to run.

Tusk replaces two legacy plugins, `sovereign-plugin-tasks` and `sovereign-plugin-kanban`. They are the starting point for what Tusk does; none of their
code is carried over.

What it must not give up, whatever the convenience:

- **Simplicity is the feature.** Each addition has to reduce friction without adding something to think about. Only a title is ever required; every
  other field stays out of the way until someone reaches for it.
- **The Desk never makes you wait.** It works from what is on the device, online or not. Syncing and resolving conflicts happen in the background, and
  a person should not feel them (§8). Boards are online in phase 1, and still answer at once: the screen changes before the server replies (§14.7).
- **Private by default.** The Desk is visible to its owner alone, and anyone can hold their own key so that the operator cannot read it (§9). A board
  is seen by the people of its workspace, or only by its own members, and by the world only when someone publishes it (§14).
- **The data stays where its owner puts it.** On their server, on their devices, and in a repository of theirs if they connect one (§21). No
  telemetry, no third-party service, nothing loaded from another site.
- **A person can leave.** They can take their data with them in one file (§20), and deleting their account deletes what is held of them, without
  taking a shared board from the people still using it (§22).

What it is not: a project management suite with Gantt charts and time tracking, a team chat, or a place for assistants to write without being asked.

## 2. Phases

| Phase          | What it delivers                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1, the MVP** | On the web, with the foundations for a phone laid: accounts and settings; the Desk (lists, cards with status, checklist, due dates, recurrence, star, search, working offline); workspaces with members; boards with lists, cards, labels, assignees, checklists, comments and activity; private and public boards and publishing; the Inbox; export and import; backup to a git repository; opt-in encryption of the Desk; an installable PWA. Runs alone or hosted on an instance. |
| **2**          | The phone's own screens (the Desk and board carousels, the action button, Today and Review as swipe views), the Planner, reminders by Push and email, boards that work offline and update live, invitations by email, replies to comments, attachments, a board view of the Desk, and cards from boards and other services on the Desk. §25 outlines each.                                                                                                                           |
| **3**          | Candidates, none committed: Google Tasks and Trello import, "the last Friday of the month", a shared key held through core, board templates.                                                                                                                                                                                                                                                                                                                                         |

### 2.1 What is carried over

The plugins' requirement IDs are not used here: tasks get IDs of their own in the roadmap. These tables are how to check nothing was lost.

From the tasks plugin, into the Desk:

| Plugin                            | What                                                             | Here                                                                                          |
| --------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| TSK-01–05                         | Lists and tasks, colour, cascade, title and notes                | §10. Notes are now a card's description; colour is any colour (§17.7)                         |
| TSK-06, 07                        | Subtasks one level deep; completing a parent completes them      | §10.3, as a card's checklist                                                                  |
| TSK-08                            | Manual order by dragging                                         | §10.4, with a different way of storing order                                                  |
| TSK-09                            | Show or hide completed, per list                                 | §10.5                                                                                         |
| TSK-10–14                         | Sharing, roles, ownership, assignment                            | Replaced by workspaces and boards (§13–§15)                                                   |
| TSK-15, 16                        | Due date and time, overdue                                       | §11                                                                                           |
| TSK-17, 18                        | Filters, search                                                  | §10.5, §10.7                                                                                  |
| TSK-19–21                         | Keyboard shortcuts, bulk delete and move                         | §17.8, §10.6                                                                                  |
| TSK-22, 23, 25                    | Recurrence, the next occurrence on completion, the pattern shown | §12                                                                                           |
| TSK-24                            | "This / this and following / all" when editing a recurring task  | **Dropped:** an edit applies to this occurrence and every later one, with no question (§12.4) |
| TSK-26–28                         | Star, move to a list, the Starred view                           | §10.2, §10.5 (Starred is a filter of the Desk)                                                |
| TSK-29, 31                        | Export, import and deletion                                      | §20, §22                                                                                      |
| TSK-30                            | Today's Agenda                                                   | Phase 2, on the phone (§25.3)                                                                 |
| `tasks_views`, Kanban, Visualizer | Reserved, never built                                            | Kanban is now the boards (§14)                                                                |

From the kanban plugin, into workspaces and boards:

| Plugin                                                         | Here                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| Projects, boards, lists, cards                                 | Workspaces, boards, lists, cards (§13–§15)                     |
| Project owners (several) and members; board owners, members    | The same (§7.2)                                                |
| Board members drawn only from project members                  | The same: from the workspace's members (§13.2)                 |
| Project and board visibility                                   | Board visibility only; a workspace has none of its own (§27)   |
| Read-only viewing; owners administer without editing content   | The same (§7.2)                                                |
| Archive as the reversible half of delete, for cards and boards | The same (§14.4, §15.8)                                        |
| Labels, assignees, due date, checklist, comments with replies  | The same, with replies in phase 2 (§15, §25.6)                 |
| Activity that outlives the card it is about                    | The same (§15.6)                                               |
| Inbox: assignments and replies, one "last seen" per person     | The same idea, with its own kinds (§16)                        |
| Whole-card drag on the web; on a phone, cross-list by menu     | The same (§17.8, §18)                                          |
| Loading states gate every surface                              | The same (§17.1)                                               |
| Markdown descriptions                                          | **Dropped:** text is shown as text, with its line breaks (§24) |
| Tenants, `sdk.db`, the plugin manifest, the plugin footer      | Gone with the legacy runtime (§5)                              |

From Tasks, as it was built before the turn (`ROADMAP.md` Milestones A and B): the foundation, local sign-in, the access rules, the sync protocol and the
local store, positions, the frame of the signed-in area, lists and tasks with subtasks, order, undo, purge, sort and filter, moving and starring. All of
it carries into the Desk; §5.2 says what changes.

## 3. User journeys

1. **First visit, alone.** Someone runs the image with the short setup of §24. They register, are offered encryption for their Desk (§9), and land on
   the Desk: one list, _Backlog_, with the cursor in "Add a card". Sign-up is then closed unless the operator opened it (§6).
2. **First visit, on an instance.** A person opens Tusk from the launcher, signs in through core, and finds the same.
3. **Capture.** They type a title and press Enter. It appears at the top straight away, online or not. They add another without touching the mouse.
4. **Work the Desk.** They mark a card in progress, tick another off, drag them into order, and open one to write a description, set a date or a
   repeat, or add a checklist, in the right-hand column. Done cards gather at the end of the list, and can be cleared together.
5. **Start working with others.** From Boards they create a workspace, add two colleagues by their email, and create a board. It starts with a
   _Backlog_ list; they add _Doing_ and _Done_, and cards.
6. **Run a board.** They drag cards between lists, assign one to a colleague, who sees it in their Inbox, label it, set a due date, and talk about it in
   its comments. The board's Activity shows who did what.
7. **Keep something private.** A board for the hiring plan is made private: only the people added to it, and the workspace's owners, see it.
8. **Show the world.** A public roadmap board is published: anyone with its link sees it, read-only, with no names or comments on it.
9. **On a train.** They add and tick cards on the Desk with no signal. Nothing is different. It syncs when it can. Boards say they need a connection.
10. **Keep a copy.** In Settings they connect a private git repository and choose daily. Each day something changed, a new file appears under `tusk/`
    (§21).
11. **Leave or move.** They download one file holding their Desk and the workspaces they own and import it elsewhere, or delete their account: Tusk
    deletes what it holds of them, and a board they shared carries on for the others.

## 4. Terminology

| Term                   | Meaning                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account**            | Someone who can sign in to this Tusk. Known by its id, whichever way they sign in (§6). "Person" means the same, in prose                   |
| **Desk**               | A person's own board, private and offline-first. Every account has exactly one, and no one else can see it (§10)                            |
| **Workspace**          | A group of people and the boards they share. Has owners and members (§13)                                                                   |
| **Board**              | A set of lists in a workspace, shown as columns. Public to its workspace or private to its members (§14). The Desk is a board too, in prose |
| **List**               | A named column of cards, on a board or on the Desk. On the Desk, a list is a category                                                       |
| **Card**               | One thing to do, in a list. A Desk card and a board card have different fields (§10.2, §15.1)                                               |
| **Checklist**          | The small steps of a card: items with a title and a tick                                                                                    |
| **Status**             | On the Desk, Open, In progress or Done. On a board, Open or Archived; where a card is in its work is the list it is in                      |
| **Label**              | A named colour of a board, put on its cards                                                                                                 |
| **Assignee**           | A member of the board a card is assigned to                                                                                                 |
| **Activity**           | The record of what was done on a board, by whom and when (§15.6)                                                                            |
| **Inbox**              | What a person is told about: assignments, comments, being added (§16)                                                                       |
| **Publishing**         | Giving a board a public, read-only address (§14.6)                                                                                          |
| **Due date, due time** | When a card is due, as written on a calendar, in no time zone (§11)                                                                         |
| **Series**             | A repeating rule on the Desk, and the occurrences made from it (§12)                                                                        |
| **Change, mutation**   | One write to one row of the Desk, and a set of them made by one action (§8.2)                                                               |
| **Operation**          | One write to a workspace, as the browser sends it to the server (§7.3)                                                                      |
| **Personal key**       | An age key a person holds, which makes their Desk unreadable to the server (§9)                                                             |
| **Backup**             | One file committed to the connected repository (§21)                                                                                        |

User-facing text says "card", "list", "board" and "workspace", never "item" or "task" for a card; "app", never "client" or "plugin". The checklist's
entries are "items" only inside the checklist.

## 5. Architecture

```
       browser (a PWA)                                    server (one image, one process)
 ┌──────────────────────────────────┐              ┌────────────────────────────────────────────┐
 │ UI (React 19, @sovereignfs/ui)   │              │ Next.js: the shell, routes                  │
 │ ┌ the Desk ───────────────────┐  │  /api/sync   │ better-auth (§6)                            │
 │ │ reads and writes ▼          │  │ ◀──────────▶ │ sync: checks and stamps the Desk's changes  │
 │ │ local store (IndexedDB)     │  │   changes    │ ops: checks and applies workspace writes    │
 │ │ outbox, sync in background  │  │              │   in one statement each, writes activity    │
 │ │ keys, if encrypted (§9)     │  │  /api/ops    │ jobs: purge, backups, notifications          │
 │ └─────────────────────────────┘  │ ◀──────────▶ └───┬──────────┬────────────────┬────────────┘
 │ boards: in memory, optimistic    │  /api/boards     │          │                │
 │ service worker: the shell only   │              SQLite (sqld   GitHub REST    a Sovereign core,
 └──────────────────────────────────┘              or a file) or  API (§21)      if one is set
                                                   PostgreSQL (§23)
```

The stack, sign-in and database are Fjord Web's, on purpose, so that operating one is operating the other. **Tusk has two halves, with two data flows,
because they have different needs:**

- **The Desk is offline-first.** The browser holds a working copy and the UI reads only that. The server is the authority every device converges on,
  not something a screen waits for (§8). This is what Tasks built, and it carries over whole.
- **Workspaces are online, and the server decides.** Shared data is read from the server and written through one door, `POST /api/ops` (§7.3), in a
  statement that carries the permission. The screen applies a change before the server answers, and undoes it if the server refuses (§14.7). Their ids
  are made by the browser and their order is fractional, as the Desk's are, so that bringing them under sync later (§25.4) is not a rewrite.
- **Next.js with React 19**, a long-running server and not serverless, because the jobs are background work. Signed-in screens are client components.
  The server renders the shell, the landing page and a published board.
- **SQLite by default, in production too, and PostgreSQL if the operator prefers** (§23).
- **Jobs run in the web process**, on a timer started from `instrumentation.ts`, with `TUSK_WORKER=off` for all but one process if several share a
  database. Fjord decided against a separate worker (2026-10-31), for the same reason: a single container wants it. Every job claims its work in the
  database, so a second process running it is safe anyway.
- **The server talks to GitHub and to core.** The browser never does, and no credential reaches it.
- **What can be pure is pure:** the next occurrence, a position between two others, what "today" is, what a user action on the Desk changes, and
  what an operation on a board may do. They take the time as an argument, so they are tested with no clock and no database.

### 5.1 Where things go

As Fjord Web's. `app/` for routes, and `src/` for everything else, with tests beside the code.

| Path                                                  | What                                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `app/`                                                | Routes: the shell, the landing page, sign-in, a published board, and `/api/*`                                     |
| `src/db/`                                             | Configuration, the clients, the schemas per dialect, migrations at start-up (§23)                                 |
| `src/auth/`                                           | better-auth, its settings, the screens, the fake Sovereign for tests (§6)                                         |
| `src/access/`                                         | The list of every page and route with who may use it, the parsers, and the workspace roles (§7)                   |
| `src/sync/`                                           | The Desk's change format and validators (shared), the server's apply and pull, the browser's outbox and loop (§8) |
| `src/local/`                                          | The browser's store of the Desk over IndexedDB, and its queries (§8)                                              |
| `src/actions/`                                        | What each action on the Desk changes: pure, run in the browser, producing changes                                 |
| `src/workspaces/`                                     | The operations (shared format and validators), the server's apply and reads, activity and the Inbox's notices     |
| `src/boards/`                                         | The browser's board state: loading, optimistic operations, freshness (§14.7)                                      |
| `src/publish/`                                        | Published boards (§14.6)                                                                                          |
| `src/crypto/`                                         | Credentials at rest (§21.2) and the operator-key mode (§9.5), on the server                                       |
| `src/cipher/`                                         | Personal keys, list keys and the field cipher, in the browser (§9)                                                |
| `src/keys/`                                           | The page's keyboard (§17.8)                                                                                       |
| `src/recurrence.ts`, `src/time.ts`, `src/position.ts` | The pure rules                                                                                                    |
| `src/portability/`                                    | The file format, and reading the tasks plugin's (§20)                                                             |
| `src/backup/`, `src/providers/`                       | The connection and the job (§21); the git host interface, GitHub's implementation, an in-memory one               |
| `src/sovereign/`                                      | What an instance tells the app, and `People` (§22)                                                                |
| `src/mail/`                                           | The SMTP mailer (§6)                                                                                              |
| `src/screens/`                                        | The signed-in screens: the shell's sidebar, the Desk, the boards index, a board, the card modal, the Inbox        |
| `src/pwa/`, `src/sw/`                                 | The manifest's details, and the service worker's source (§17.9)                                                   |
| `src/ui/`                                             | The design system's client boundary, `AppShell`, and what every drag shares                                       |
| `migrations/`                                         | The generated SQL: `sqlite/`, `postgres/`, `auth/`                                                                |
| `deploy/`                                             | The Compose setups for sqld, a file and PostgreSQL, their README and `.env.example`                               |
| `sovereign.manifest.json`                             | What an instance reads to host the app (§24)                                                                      |

### 5.2 The turn from Tasks

What was built as Tasks becomes the Desk, and the app is renamed. The roadmap's Milestone C does this before anything new is built on it:

- **The name is Tusk everywhere** (§27): the package `@sovereignfs/tusk`, the `TUSK_` prefix of every setting, the databases `tusk` and `tusk_auth`
  (namespaces, files and schemas), the cookie prefix `tusk`, the IndexedDB database `tusk-desk-<account id>`, the manifest's `prefix` and `name`, the
  image `ghcr.io/sovereignfs/tusk`, the repository, and every document. Nothing is released, so nothing is migrated: the old names are simply gone.
- **The migrations are squashed** into one first migration per dialect and store, since no version has been tagged and no database outside a
  developer's machine holds data. A developer's database is recreated (`pnpm seed --reset` makes a new one worth looking at).
- **The Desk's tables replace `list`, `task` and `series`** (§23.3): `desk_list`, `desk_card`, `desk_check` and `desk_series`. Subtasks become
  checklist items, in a table of their own. A card gains a description (the notes, renamed) and a start time for In progress. The columns and fields
  that only phase 2 reads are not made yet: a card's reminder column, and the fields of Today and Review (`reviewedAt`, `dismissedOn`, §25.3); a new
  field needs no migration, and a new column gets one of its own. The sync protocol is version 2, so that a device holding the Tasks version is told
  to update, and the database in the browser is made again.
- **The first list is _Backlog_**, not _My tasks_, with the same derived id.
- **The routes move:** `/home` and `/lists/<id>` become `/desk` and `/desk/<listId>` (done by 3.12, which also made a list's colour any `#rrggbb`).
- **The shell is the new one** (§17.2), with the Desk inside it.

## 6. Authentication

**Identical to Fjord Web's §6, and read that for the detail.** The flows, the rules and the tests are the same; this section records what it means here,
with `TUSK_` for `FJORD_`.

Built on **better-auth 1.7**, in a store of its own (§23), with its own migrations. Which methods are offered is set by the environment, so an instance
can run either or both:

| Method        | Enabled by                                                                     | What                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Local**     | `TUSK_AUTH_LOCAL=1`                                                            | Email and password, passkeys, and an authenticator app with ten backup codes. Off means off: `/sign-in`, `/sign-up` and `/api/auth` answer 404                                                                                       |
| **Sovereign** | `TUSK_CORE_URL`, `TUSK_CORE_CLIENT_ID`, `TUSK_CORE_CLIENT_SECRET`, all or none | OIDC against a core, through `genericOAuth`: authorization code with PKCE S256, the ID token verified against the keys discovery points to. Redirect address `<TUSK_URL>/api/auth/callback/sovereign`; scopes `openid profile email` |

- **The server refuses to start on a setting that is wrong:** a short `TUSK_AUTH_SECRET`, a non-https `TUSK_URL` (localhost aside), a partial set of
  `TUSK_CORE_*`, an SMTP host with no sender.
- **Who may sign up** is `TUSK_AUTH_SIGNUP`: `closed` by default, where the first account is made and then sign-up is refused, by the server; or `open`.
  One policy for both methods, in the user-creation hook. An instance sets `open`, since there the instance decides who may sign in. With sign-up
  closed, the people a self-hoster wants in their workspaces are made by opening it for a while; invitations are phase 2 (§25.5).
- **Email is optional.** With `TUSK_SMTP_*`, an address must be verified before first sign-in and a forgotten password is reset by a single-use link.
  Without it, sign-up is immediate and no screen offers a reset.
- **A Sovereign account is identity, not authorization.** Identity is its `sub`, stored as the better-auth account id. `email` and `name` are copied
  when the account is made and not overwritten after.
- **No implicit linking.** A Sovereign login whose email is a local account's is refused, until the person links the two from a signed-in session, and
  only when the addresses match. Unlinking can never remove an account's last way to sign in.
- **Signing out is local.** Ending a Tusk session does not end the Sovereign one.
- **Two-factor is the password's.** A person with Tusk two-factor who links Sovereign is not asked for the Tusk code when signing in through it.
- **Tested the same way:** auth flows over real requests through `auth.handler` on all three databases, a strict fake Sovereign, a recording of a real
  instance's discovery document, and every security behaviour seen to fail with it switched off.

**The owner of everything is the better-auth user id** (`account_id`), not `sub`. It is in the other store, so it is not a foreign key, as in Fjord.
The `sub` is looked up only for what needs it: a notice from core (§22). **A workspace member is an account id too,** and the name, email and avatar
shown beside it are read from the auth store when a board is loaded, never copied into the app's tables (§23.3).

Signing in needs a network. Once signed in on a device, the Desk opens offline, and the next sync finds out if the session ended (§8.5).

## 7. Access

### 7.1 The rule

**Every write carries its permission in the statement that makes it.** Not a check first and a write after.

On the Desk, that is the owner:

```ts
db.update(deskCard)
  .set({ fields, seq })
  .where(and(eq(deskCard.id, id), eq(deskCard.ownerId, accountId)));
```

On a board, it is membership, as a condition of the same statement:

```sql
UPDATE card SET title = ?, updated_at = ?
 WHERE id = ?
   AND board_id IN (SELECT board_id FROM board_member WHERE account_id = ?)
   AND board_id IN (SELECT id FROM board WHERE archived_at IS NULL)
```

No row affected means the row is not there for this account, and the answer is the same whether it does not exist, belongs to someone else, or is on an
archived board: **a refusal reads as "not found"** (the page for what is not here; its status line is `200`, as for any page that streams behind the root loading state, and `404` for an API), since whether a board exists is itself something only its members may know.

This closes the tasks plugin's most serious flaw. There, an action took `(taskId, listId)`, checked the caller owned `listId`, and then updated by
`taskId` alone, so anyone who knew another person's task id could change it. The same shape was in eleven of its actions.

- **Who may call what is written down once:** `src/access/routes.ts` lists every page and route with who may use it, and `routes.test.ts` holds it to the
  files. Tests seed two accounts, and for the workspaces, a member, a viewer and an outsider, and send each kind of change and operation as each,
  asserting that only the allowed ones changed anything.
- **A route that changes something checks `Origin`** against `TUSK_URL`.
- **Input is parsed at the edge.** Shared validators run in the browser before a change is queued or an operation sent, and on the server for what it
  can read: a title is 1 to 500 characters, a description up to 20,000, a comment up to 10,000, a name up to 100, ids are UUIDs, a date is a real date,
  a time is `HH:MM`, a colour is `#rrggbb`, a rule passes §12.2. On a Desk with a personal key the server can check only structure and size (§9.4).
- **Anything an operation points at must be the board's or the workspace's too:** a list a card moves to, a label put on a card, an assignee (a member
  of the board), a board a card moves to.

### 7.2 Roles in a workspace

A workspace has **owners** (one or more) and **members**. A board has **owners** and **members**, drawn from the workspace's people. A person who can
see a board without being its member is a **viewer**: everything is shown, and nothing can be changed.

| What                                                        | Workspace owner | Workspace member | Board owner | Board member |
| ----------------------------------------------------------- | :-------------: | :--------------: | :---------: | :----------: |
| See the workspace, and its public boards                    |        ✓        |        ✓         |      —      |      —       |
| See a private board                                         |        ✓        |                  |      ✓      |      ✓       |
| Join a public board, as a member                            |        ✓        |        ✓         |      —      |      —       |
| Create a board (and become its owner)                       |        ✓        |        ✓         |      —      |      —       |
| Change a board's content: lists, cards, labels, comments    |                 |                  |      ✓      |      ✓       |
| A board's settings, members, publishing, archive, delete    |        ✓        |                  |      ✓      |              |
| Rename or delete the workspace; its members and their roles |        ✓        |                  |      —      |      —       |
| Leave                                                       |  ✓ (not last)   |        ✓         |      ✓      |      ✓       |

- **Only board membership grants editing.** A workspace owner who is not a member of a board can see and administer it, and not touch its cards; they
  can add themselves, which is recorded in its activity. This keeps "who is working on this" honest, and still means no board is ever left that nobody
  can manage when its owners leave (the lesson the kanban plugin paid for).
- **An archived board is read-only for everyone,** its owners included, until one restores it (§14.4).
- **A comment is edited or deleted by its author,** and deleted by a board owner.
- **A workspace keeps at least one owner.** The last owner cannot leave or step down; they make someone else owner first, or delete the workspace.
- **Removing someone from a workspace** removes them from each of its boards and unassigns them there, in one transaction. Their comments and activity
  stay, under their name.

### 7.3 The door for workspaces

Every write to a workspace is an **operation**, sent to `POST /api/ops`:

```json
{ "opId": "…", "op": "card.move", "cardId": "…", "listId": "…", "position": "a1" }
```

- **One door,** as the Desk has `/api/sync`, so that the permission rule is in one module and the wrong-account tests are a loop over the kinds of
  operation. The kinds are a closed set, each with a validator shared with the browser and a function on the server that applies it.
- **One short transaction each:** the change, the permission in its statement, the activity it writes (§15.6), any notices it raises (§16), the
  board's `version` and the workspace's `updated_at` moved on. Nothing in it calls out of the database.
- **An `opId` makes a retry harmless,** recorded as the Desk's mutations are (`applied_mutation`).
- **The answer** is the changed rows as the server now holds them, or a refusal: `not_found` (which covers "not yours"), `invalid`, `limit`, `stale`
  (it points at something that is gone). The browser keeps the first, and undoes its optimistic change on the second, with a toast for anything but
  `not_found`.
- **Reads are routes of their own,** each in `routes.ts`: the boards index, a board, a card, a board's or card's activity by page, the Inbox, a
  workspace's members, and a published board.

### 7.4 Limits

So that one account cannot fill the server: 200 Desk lists, 50,000 Desk cards and 200,000 Desk checklist items an account; 50 workspaces created by an account; 100 members in a
workspace; 500 boards in a workspace; 100 lists and 5,000 cards on a board; 50 labels on a board; 200 checklist items on a card; 1,000 comments on a
card. A size per field, and a rate per account on `/api/sync`, `/api/ops`, adding a member by email, and the published pages.

## 8. Sync and offline (the Desk)

The design goal is that **a person does not feel any of this.** The Desk never waits for the network to show or change a card, shows no conflict
dialogs, and needs no "saving" indicator. Settings shows when it last synced, for anyone who wants to know.

This section is what Tasks built, carried over with its tables renamed. **It covers the Desk only;** boards are online (§14.7) and come under sync in
phase 2 (§25.4).

### 8.1 The model

- **The UI reads and writes the local store,** IndexedDB through `idb`, one database per account (`tusk-desk-<account id>`). A write is applied there at
  once, and the screen updates from that.
- **Each write also goes in an outbox,** in the same IndexedDB transaction. The sync loop sends it.
- **The server is a referee:** it checks a change is allowed, stamps it with an order, stores it and hands it to the other devices. It does not need to
  understand a card beyond its structure, which is what lets it work on encrypted data (§9).

### 8.2 Changes

An action on the Desk is a pure function in `src/actions/`, run in the browser, that turns "complete this card" into changes to rows. Completing a card
with two open checklist items that repeats is one **mutation** holding several changes: the card, its items, and the next occurrence and its copied
checklist.

```json
{
  "mutationId": "…",
  "changes": [
    {
      "table": "desk_card",
      "id": "…",
      "listId": "…",
      "position": "a1",
      "fields": { "title": { "v": "Water the plants" }, "completedAt": { "v": 1793000000000 } }
    }
  ]
}
```

- **Ids are made by the client,** so a new card exists at once and everything can refer to it offline. A mutation's id makes replaying it harmless: the
  server records what it has applied.
- **Only what changed is sent:** a field, not a row. That is what makes conflicts mostly vanish (§8.4).
- **A field's value is plain or ciphertext** (`{ "v": … }` or `{ "c": "…" }`), and everything above that is the same either way.
- **Validators are one module,** used by the browser before it queues and by the server when it can read.
- **The structural part is checked by the server whatever the mode:** the list is the account's; a checklist item's card is the account's.

### 8.3 The endpoint

`POST /api/sync`, with the session cookie and `Origin` checked. A request carries the outbox and a cursor; an answer carries what was applied, what was
refused, and the changes since the cursor.

- **Order is a per-account counter.** Applying a mutation is one short transaction: increment `account_settings.seq`, stamp each changed field and row
  with it, record the mutation. It works alike on all three databases, and the increment serialises one account's writes without holding anyone else up.
- **Pull** returns rows whose `seq` is past the cursor, paged, each page ending at a `seq` boundary. A new device starts at zero, which is the snapshot
  (§8.5).
- **A device syncs** after a write (debounced), on load, when the tab regains focus, when it comes back online, every few minutes while open, and through
  the Background Sync API where there is one. One tab syncs at a time (Web Locks); others see the store change (BroadcastChannel).
- **Retrying is safe,** since a mutation applies once, and a lost answer is just a retry.
- **A protocol version** travels with each request. A device too old is told to update, and the service worker does so; its outbox is kept.

### 8.4 Conflicts

Resolved by rule, in the background, with nothing asked:

| What happened                                                   | What results                                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Two devices change different fields of a card                   | Both changes stand                                                                                               |
| Two devices change the same field                               | The one that reached the server later wins                                                                       |
| One device edits a card another deleted                         | The edit restores it: losing someone's words is worse than a deleted card coming back                            |
| Both delete                                                     | Deleted                                                                                                          |
| Two devices move a card to one position                         | Both keep the key; ties break by id, so every device shows one order                                             |
| One device marks a card in progress, another marks it done      | Done: a completion time wins over a start time, whichever arrived later (§10.2)                                  |
| Two devices complete a repeating card                           | They make the same next occurrence, since its id derives from the series and the date, and it arrives once       |
| Two devices complete it on different days, so next dates differ | Two open occurrences arrive. The device that sees it deletes the later one, by a rule every device applies alike |
| A card is added to a list another device deleted                | The list is restored                                                                                             |

A refusal the server gives (a limit, a change it cannot accept) is the only thing that reaches the person: the change is undone locally with a toast
saying why.

### 8.5 First load, sign-out, and an ended session

- **First load on a device** needs a network. It pulls the snapshot in pages, and shows what it has as it arrives, the first list first.
- **Later loads** paint from IndexedDB at once. There is no spinner to see a list you have already seen, on any network.
- **Signing out deletes the local database,** after trying to send the outbox, and warning if it cannot and there are unsent changes.
- **A session that ended elsewhere** (a password reset, core's logout) is found at the next sync: the app shows sign-in and displays no data, and keeps
  the outbox for the same account to send once it signs back in.
- **Persistent storage is requested** (`navigator.storage.persist()`), so that a browser is less likely to evict what is here.

### 8.6 What cannot be hidden

Stated plainly here and in the user's documentation:

- **Signing in, first load on a device, boards, the Inbox, and Settings actions** need a network. They say so when offline; the Desk is unaffected.
- **On iPhone, sync happens only while the app is open.** Safari has no Background Sync.
- **A browser can evict storage.** Unsynced edits could be lost if it does, in spite of asking it not to.
- **A shared computer** holds a signed-in person's Desk until they sign out.

### 8.7 Keeping the history small

Deleted rows are hard-deleted after seven days (§10.6), and leave a tombstone of id and `seq` so that devices learn of it. Tombstones and
applied-mutation records go after 90 days. A device whose cursor is older than that gets a fresh snapshot, sending its outbox first.

## 9. Encryption

Two modes, mutually exclusive. By default neither is on, and everything is stored as plain text.

|                  | Personal key                                                       | Operator key                                |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| Chosen by        | Each person, opt-in                                                | The operator, by `.env`                     |
| Covers           | **That person's Desk only**                                        | Everything: the Desk and every workspace    |
| Who can read it  | Only that person's devices                                         | The server, and so the operator             |
| Protects against | Reading the database, dumps and backups, including by the operator | A stolen database or dump, not the operator |
| When it is on    | Other people on the server are unaffected                          | Personal keys are not offered to anyone     |

**Shared data cannot be under one person's key.** A board is read by everyone on it, its activity and notices are written by the server, and a
published board is rendered by the server, so the server reads what is on boards. Settings and the sign-up offer say so in a sentence: "Your Desk can be
yours alone. Boards are shared, and the server can read them." Keys for a board, wrapped for each member, are a phase 3 candidate at most.

### 9.1 Choosing a personal key

After registering or first signing in, a person is offered it, and can skip. If they skip, their Desk is plain text, and Settings > Data can turn it on
later (§9.3). It is one way: to go back, they export and start a new account.

- **Create** makes an age identity in the browser, and makes them save it first: download the key file, and confirm they did. **Nobody can recover it.**
  Losing the key and every device loses the Desk.
- **Upload** takes an existing age identity, by file or by pasting. **The same key can be used across the suite:** a person's Fjord identity, for
  example, is the same format.

On a new device they give the key once, and it is remembered until sign-out. A person with no key to hand can still sign in, and sees boards and the
Inbox; the Desk asks for the key.

### 9.2 How it works

- **The age key wraps a data key per Desk list, and a list key encrypts fields** (the wrapped key is the list's own field `key`, plain because it is already sealed, so that it syncs, is purged and comes back with the list, §23.3) with AES-256-GCM, bound to the row and the field, so that the server
  cannot move a value to another row or field unnoticed. age itself is used only for wrapping, since its overhead is too much per field.
  `age-encryption` (BSD-3-Clause) does this in the browser.
- **Encrypted:** all content. Titles, descriptions, checklist items, list names and colours, rules, dates, stars, start and completion times, and sort
  settings.
- **Readable by the server:** ids, a card's list, a checklist item's card, positions, delete markers, sync counters, the size and timing of changes, and
  the account itself. So an operator can see how many cards someone has and when they change, and not what they say.
- **Unlocking is once per device.** Keys are kept in IndexedDB as non-extractable browser keys where the platform supports that, until sign-out.

### 9.3 Turning it on later

The browser re-encrypts everything on the Desk, in resumable batches through the ordinary sync path, with the account marked as moving. Once done, the
server refuses plain Desk fields for that account. **What was already written elsewhere stays readable:** older database backups, and files committed
to a backup repository before this. Settings says so at the time.

### 9.4 What changes for an encrypted Desk

| Thing                            | With a personal key                                                      |
| -------------------------------- | ------------------------------------------------------------------------ |
| Search, counts, recurrence       | Nothing: already in the browser                                          |
| Server validation                | Structure and size only                                                  |
| Moving a card to another list    | The browser re-encrypts its fields under that list's key                 |
| Export                           | Made in the browser, as plain JSON in the person's hands, with a warning |
| Import into the Desk             | Read and encrypted in the browser                                        |
| Auto backup                      | The Desk's part of the file holds ciphertext and wrapped keys (§21.3)    |
| The Planner, reminders (phase 2) | By times only (§25.2)                                                    |

### 9.5 The operator key

`TUSK_DB_ENCRYPTION=on`, with `TUSK_ENCRYPTION_KEY`.

- **It is server-side field encryption, not the database's own,** because PostgreSQL has no built-in equivalent and it must behave the same on all three
  forms. Each content field is sealed with the same AES-GCM binding as §9.2, through `src/crypto/`, with rotation by `TUSK_ENCRYPTION_KEY_PREVIOUS`. On
  the Desk that is each field of `fields`; on a workspace it is each content column: names, titles, descriptions, checklist items, comments, label names
  and the details of activity and notices.
- **What a query needs stays readable:** structure, positions, due dates (the Planner and reminders query them), archive and delete times, and colours.
- **Personal keys are not offered,** and the sign-up page and docs say that the operator manages encryption and can read data.
- **It never converts silently,** per Sovereign's rule. The server refuses to start if the setting conflicts with what is stored. Moving existing data
  takes an explicit command shipped in the image.
- **Backup files are plain** (§21.3), since the server decrypts to make them.

### 9.6 What this does not do

A personal key protects what is stored. It does not protect against an operator who serves altered JavaScript that takes the key, since the browser runs
what the server sends. This is true of every web app that encrypts in the browser, and the docs say so.

## 10. The Desk

The Desk is a person's own board: theirs alone, offline-first, and as plain as Google Tasks. It is virtual: there is no row for it, only its lists and
cards, and its settings in `account_settings`. In phase 1 it is shown as a list view (§17.4); a board view of it comes in phase 2 (§25.7).

### 10.1 Lists

- On the Desk a list is a category. The first visit makes _Backlog_, so there is always somewhere to type; it is an ordinary list, renamed or deleted
  like any other.
- Create with the + at the top of the Desk's lists; rename, recolour and delete from a list's menu; drag to reorder, which writes one row.
- Each list has a colour, any colour (§17.7), shown as its dot. A new list takes a neutral one.
- Deleting a list asks first (`ConfirmDialog`), naming how many open cards it holds, takes its cards with it, and can be undone (§10.6).
- The count of open cards is at the right of each list's row.

### 10.2 A card

| Field           | What                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| **Title**       | The one required field, 1 to 500 characters                                            |
| **Status**      | Open, In progress or Done                                                              |
| **Description** | Plain text, shown as written, with its line breaks; links are not made live in phase 1 |
| **Due date**    | A date, and optionally a time (§11)                                                    |
| **Recurring**   | A repeat (§12)                                                                         |
| **Checklist**   | Items with a title and a tick (§10.3)                                                  |
| **Starred**     | A star                                                                                 |

A new card goes at the top of its list, with only its title. Moving a card to another list takes its checklist with it, and it goes to the top there.

**Status is two fields, so that it converges** (§8.4): `startedAt` and `completedAt`. A card is **Done** if `completedAt` is set, **In progress** if
only `startedAt` is, and **Open** if neither. Marking it in progress sets `startedAt` and clears `completedAt`; done sets `completedAt`; reopening
clears both. Two devices that disagree end at the same status on both, and Done is never lost to a later "in progress" written offline.

**In progress is optional and quiet.** A card shows it as a small spinning-circle icon beside its title (`loader-circle` in Lucide's naming), never a
column or a colour. The checkbox ticks a card straight to Done from either state; In progress is set from the card's menu and its detail. The icon is
not in `@sovereignfs/ui` yet: it is added there, in `sovereign`, and the star with it, with a text stand-in until a release with them is pinned
(§17.1).

### 10.3 Checklist

A card's checklist is its small steps: items with a title and a tick, in an order of their own, one level deep. An item has no date, star or repeat,
which keeps dates about cards.

Completing a card ticks its open items, and leaves the completion time of those already done. Reopening it reopens nothing. Ticking the last item does
not complete the card: finishing the parts is often not finishing the thing. A card's row shows progress as a small ring.

Items are rows of their own (`desk_check`), not cards with a parent, so a card has no self-reference and an item cannot be given a date by mistake;
§27 says why.

### 10.4 Order

Order is a **position**: a string that sorts between its neighbours (fractional indexing, compared byte by byte: §23.2). Moving a card writes one row.
One row per move is what makes order survive two offline devices at all.

Under "Custom" order, cards that are overdue or due today float to the top of the list (a partition, not a change to their position). Dragging is
computed against what is on the screen, then translated to a position between the visible neighbours (§17.10). A drop is worked out among the cards of the dragged card's own group (pinned or not), since the positions of the two groups do not run on from one to the other.

### 10.5 Seeing a list

- **Filter:** All, Active, Starred, Overdue.
- **Done cards** gather at the end, in a collapsible _Completed_ section whose open or closed state is remembered for the list. _Delete completed_
  clears them in one action, with Undo.
- **Sort:** Custom, Date created, Due date, Title. **Remembered per list,** on every device. Dragging is available only under Custom.

### 10.6 Delete, undo and bulk

**Every delete offers Undo** in a toast, for about ten seconds. Deleting sets `deleted_at`, on a card or a list alike, and takes a card's checklist with
it; Undo clears it, bringing back exactly what went. A job removes rows deleted more than seven days ago (§8.7). There is no trash to browse.

Ctrl- or cmd-click starts selection, since a card's checkbox already means complete. A bar shows the count, with Complete, Move to list, Delete and
Cancel. Each is one mutation, in chunks if it is large.

### 10.7 Search

Titles, descriptions and checklist items, across the Desk, newest change first. **It runs in the browser, on the local store,** on any encryption mode,
offline as well. A board's search is its own (§14.5).

## 11. Dates and time

One function, `todayFor(zone, now)` in `src/time.ts`, is the idea of "today" everywhere, on the Desk and on boards:

- **A due date and time are floating:** "Saturday at 09:00" as written on a calendar, stored as `YYYY-MM-DD` and `HH:MM` text, in no zone. They compare
  as strings, which sort chronologically. Someone who flies somewhere still has it due Saturday at 09:00 where they are. On a board, every member sees the
  same date.
- **In the browser, the zone is the browser's,** so the screen always agrees with the person's own clock, online or not.
- **On the server, the zone is `account_settings.time_zone`,** for jobs. The browser reports it on load, and it is updated when it differs. An invalid
  one falls back to UTC.
- **Displayed in the browser's locale:** "Today", "Tomorrow", "Mar 5", and times in the locale's 12- or 24-hour form. Overdue is shown in the danger
  colour.

The due date picker offers Today, Tomorrow and Next week, then the design system's `DatePicker`, and a time once a date is set.

**As built (task 4.2):** the Desk's `setDue` writes `dueDate` and `dueTime` in one change and no other action names them; the validator refuses a time with no date; on a board `card.setDue`
does the same through the door.

## 12. Recurrence (the Desk)

A Desk card can repeat. A board card does not in phase 1: a card on a shared board is a piece of work, not a habit.

### 12.1 The model

A series is a rule and an anchor date. **One occurrence is open at a time**, as in Google Tasks: completing it makes the next. Occurrences are ordinary
cards, so they filter and sort with no special cases.

Completing is one mutation (§8.2), made once: a double-tap finds the card already complete and does nothing. **The next occurrence's id derives from the
series and its date** (a UUIDv5), so that two devices arrive at the same row (§8.4).

The next occurrence copies the title, description, star, due time and list, takes the same position, and has **its checklist copied, unticked**. If the
rule has ended (`UNTIL` or `COUNT`), there is none.

### 12.2 The rule

Stored as an RFC 5545 `RRULE` string with no `DTSTART`, computed with the `rrule` package, inside `src/recurrence.ts` alone, in the browser.

A validator parses a rule against an allow-list: `FREQ` (daily to yearly), `INTERVAL` (1 to 999), `BYDAY` (plain weekdays, weekly only), and one of
`UNTIL` or `COUNT`. Nothing else, 200 characters at most.

The picker offers: Daily, Weekdays, Weekly, Monthly, Yearly, and Custom (every N units, on chosen weekdays, ending on a date or after N). A card shows a
short form ("Weekly", "Every 2 weeks") and the detail the full one ("every week on Monday, Wednesday").

A monthly or yearly rule on a day that some months lack (the 31st, 29 February) takes only the months that have it, as RFC 5545 says. `rrule` works in UTC, so a date crossing into it must go through `Date.UTC` and come back through `getUTC*`. Doing otherwise moves `BYDAY` matches by a
day east of Greenwich, as the tasks plugin learned. Tests run under more than one `TZ`.

### 12.3 What the next date is

**A card done late does not leave a trail.** The next occurrence is the first one, counted from the anchor, after whichever is later: its due date, or
today. Setting a repeat on a card with no due date gives it one: the first date the rule matches from today.

### 12.4 Editing

**An edit to a recurring card updates it in place, applies to that occurrence and every later one, and duplicates nothing.** There is no prompt.

| Edit                                          | What happens                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Title, description, star, due time, checklist | The open occurrence changes, and the next is copied from it                                                                                    |
| The rule                                      | The series' rule is replaced, and the anchor set to this occurrence's date                                                                     |
| The due date                                  | This occurrence moves and the series moves with it: the anchor becomes the new date, and a weekly rule on one weekday moves to the new weekday |
| "Does not repeat", or clearing the due date   | The series ends, and this stays as a one-off                                                                                                   |

### 12.5 Reopening, moving, deleting

- **Reopening** a completed occurrence when the next is untouched removes that next occurrence, so Undo after a tick leaves things as they were. If the
  next has been changed, the reopened card leaves the series and becomes a one-off, and nothing is lost. The next is untouched if it is as completing made it: the same title, description, star, time, list and place, the date it was made for, not started, and the same checklist, unticked. The items the tick ticked are unticked with it.
- **Moving** an occurrence to another list moves the series with it.
- **Deleting** ends the series, and Undo brings it back. The purge removes a series that no card names, once it is a week old.

## 13. Workspaces

### 13.1 A workspace

A workspace is a name, its people and its boards. Anyone can create one, from the + beside the sidebar's workspaces or from Boards, and becomes its
first owner. A new account has none: Boards shows the Desk and a way to create the first.

Its owners rename it and delete it, from its settings (§17.3). Deleting asks for its name to be typed, and deletes every board in it, with its lists,
cards and everything on them, at once: a shared space is not deleted by accident, and is not half-deleted. There is no Undo; archiving its boards is the
reversible route.

### 13.2 Its people

- **People are added by their exact email,** by an owner, from the workspace's settings. Only an account that already exists on this Tusk can be added:
  "No account with that address here" otherwise. That tells an owner whether an address has an account, so it is limited per account and per hour.
  There is no directory search: a self-hosted server has no directory to offer, and an instance's is for phase 2 with invitations (§25.5).
- **Anyone added is a member,** and an owner can make them an owner too.
- **The people of a board come only from its workspace,** and the people a card is assigned to only from its board.
- **Being added** raises a notice in their Inbox (§16), and the workspace appears in their sidebar under _Shared with me_.
- **Leaving and removing** are §7.2's.
- **As built (task 16.3):** a refusal an owner or a leaver is entitled to understand carries a reason beside its code (`no_account`, `already_in`, `last_owner`); anyone who may not have asked is told `not_found` and
  nothing more, an unknown address included. Adding is limited to 30 an hour an account. Names are read from the accounts when the list is read (`src/auth/directory.ts`) and are never copied; the address is shown to an
  owner only; avatars are initials, since a picture would be a request to another address (§17.1). The notice to the person added arrives with the Inbox (§16).

### 13.3 What a workspace shows

Its boards, as tiles, the ones a person can see (§7.2): public boards to everyone in it, private boards to their members and its owners. Archived boards
are behind an _Archived_ disclosure. The workspace's `updated_at` moves with every operation in it, for "recently updated" (§17.3).

## 14. Boards

### 14.1 A board

A board has a name, a colour (any colour, §17.7), an optional description, a visibility, and lists. Creating one, from a workspace's "Create board"
tile, asks for a name and offers a colour, and makes it with one list, _Backlog_, which can be renamed or deleted like any other. Its creator is its
owner. Its settings (from the board's menu) change the name, colour, description and visibility.

### 14.2 Lists on a board

A list has a name, a position and its cards. Its header shows the name, the count of its open cards, and a menu:

| Entry           | What                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Configure       | A dialog to rename it                                                                            |
| Add card        | A card at the top of the list                                                                    |
| Change position | Move it left or right, or to a position by number, which also serves a keyboard                  |
| Delete          | Asks first, naming how many cards go with it; the cards are deleted, and the activity records it |

Lists are dragged by their header to reorder, which writes one row. A new list goes at the end.

### 14.3 Visibility and membership

- **Public** (the default): everyone in the workspace can see it, and join it from the board's header ("Join board"), becoming a member. Joining is
  recorded in its activity.
- **Private:** only its members and the workspace's owners see it. It is not listed, searched or counted for anyone else, and its address answers 404
  for them.
- **The Share dialog** lists the board's people and their roles. An owner adds people from the workspace's (a picker over its members, never a search of
  the server), makes them owners, removes them, and publishes the board (§14.6). Anyone can leave it.
- **The board's header shows its members' avatars,** a few and then "+N", which open the Share dialog.

**As built (task 17.3):** adding and joining take the workspace's row first, so that they and the removal of a person from a workspace wait for each other. A private board is hidden by the
same subquery in every read (`boardsVisibleTo`). The board's people are read from `GET /api/boards/<id>/people`, and the picker is the workspace's people who are not on the board.

### 14.4 Archive and delete

- **Archive** (from the board's menu) hides it from the workspace's tiles and the sidebar behind _Archived_, and makes it read-only for everyone. It
  keeps everything; restoring clears it. A published archived board stays published until it is unpublished.
- **Delete** asks for its name to be typed, and removes it with everything on it, at once. There is no Undo; archive is the reversible half.

**As built (task 17.2):** every operation of this section is an administrator's (a board's owner, or the owner of its workspace), and an archived board refuses all
of them but Restore and Delete. Its settings dialog changes the name, colour and description; visibility is §14.3's.

### 14.5 Search on a board

A search field in the board's header filters the cards shown, as you type, by title, label name and assignee name, in the browser over the board it has
loaded. A filter is not saved, and says how many cards it hides. Search across boards is phase 3.

**As built (task 17.4):** the filter is `src/boards/filter.ts`; `/` focuses it, Esc clears it, and dragging is off while it is on.

### 14.6 Publishing

A board's owners publish it from the Share dialog: it gets an address, `/p/<token>`, that anyone can open without signing in.

- **Read-only, and only the work:** its name and colour, its lists, and its cards with their titles, descriptions, labels, due dates and checklists.
  **No people:** no members, assignees, emails, comments or activity. A card opens to a read-only detail.
- **The token is 32 random bytes,** in base64url. Unpublishing deletes it, and that address is gone for good; publishing again makes a new one.
- **The page is rendered on the server,** with no script beyond the shell's, a strict policy, `noindex` by default, and a rate per address. It is always
  the board as it is now, archived or not; a deleted board's address answers 404.
- **Published boards are listed** in the board's Share dialog and in Settings > Data, so a person can see what of theirs is public.

**As built (task 17.5):** the page is a route handler making a whole HTML document (`app/p/[token]/route.ts`, `src/published/render.ts`), with a policy that allows no script and a real 404 for an address that is
nothing. `readPublished` selects no person.

### 14.7 Online, and still at once

In phase 1, boards are read from the server and held in memory, not on the device.

- **A board loads whole and light:** the board, its lists, its labels, its people (id, name, avatar), and every open card with what its tile shows
  (title, position, labels, due date, assignees, checklist progress, comment count, whether it has a description). Its archived cards are fetched when
  asked for. **A card's detail is fetched when it opens:** description, checklist, comments and activity, each paged where it can be long.
- **Every change shows at once.** The browser applies an operation to what it holds, sends it, and keeps the server's answer, or undoes it with a toast
  on a refusal (§7.3). Sending is in order, one at a time per board, so that a drag followed by an edit reach the server as they were made.
- **Freshness without live updates:** each operation moves the board's `version` on. While a board is open and visible, the browser asks for its
  version every 20 seconds and on focus, and reloads the board if it moved, keeping an open card and anything being typed. Live updates are phase 2
  (§25.4).
- **Offline, a board says it needs a connection,** and changes nothing. What it held stays on the screen, read-only, until the connection comes back.
- **As built (task 17.1):** a refusal puts the board back as the server last said it was and drops what was queued behind it; the answer to an operation carries the board's new `version`, so the board's own
  change is not read as someone else's; the version is also asked for when the connection returns. A list is named by its id alone in an operation, and the permission is the board's (`board_id IN boardsEditableBy`).

## 15. Cards on a board

### 15.1 A card

| Field           | What                                               |
| --------------- | -------------------------------------------------- |
| **Title**       | The one required field, 1 to 500 characters        |
| **Description** | Plain text, shown as written, with its line breaks |
| **Due date**    | A date, and optionally a time (§11)                |
| **Checklist**   | Items with a title and a tick, in order (§15.4)    |
| **Labels**      | The board's labels it carries (§15.2)              |
| **Assignees**   | Members of the board (§15.3)                       |
| **Status**      | Open or Archived (§15.8)                           |
| **Comments**    | §15.5                                              |
| **Activity**    | §15.6                                              |

A card is added at the top of its list, from the list's menu or the "Add a card" at the top of its column, with only its title. Clicking a card opens
its detail, as a dialog over the board, at its own address (`/b/<board>/c/<card>`), so it can be linked to and reloaded. The detail edits every field,
saving as you leave a field, with no Save; a viewer sees the same, read-only.

A card's tile on the board shows its labels as small bars of colour, its title, and badges for its due date, checklist progress, comment count and
description, and its assignees' avatars.

### 15.2 Labels

Each board has its own labels: a colour (any colour, §17.7) and an optional name. A new board has none. They are created, renamed, recoloured and
deleted from the card detail's label picker or the board's settings. Deleting a label takes it off every card. A label's text is shown in black or white,
whichever reads against its colour.

**As built (task 18.3):** a label is put on a card only if it is the card's board's; deleting one takes it off every card in the same operation. A tile shows a card's labels as bars, and the
dialog's chips and the picker's rows are drawn in the label's colour with black or white text by `src/ui/contrast.ts`.

### 15.3 Assignees

A card can be assigned to any of its board's members, from its detail. Assigning someone raises a notice in their Inbox (§16), unless they assigned
themselves. Someone removed from the board, or the workspace, is unassigned from its cards. A person's assigned cards across every board are in their
Inbox (§16).

**As built (task 18.4):** the `assigned` notice is a `notice` row written in the operation's transaction, once, for a new assignment by someone other than the person assigned. Its `details` hold the
card's title as it was. The Inbox that reads it is §16's, task 8.1.

### 15.4 Checklist

As the Desk's (§10.3), in a table of its own: items with a title, a tick and an order, added, renamed, ticked, dragged into order and deleted in the
detail. A tile shows progress as "2/5". Archiving a card does nothing to its checklist.

**As built (task 18.5):** the board holds only the count of a card's items; the dialog holds the items and tells the board the new count, so that the tile follows at once. The operations are
`item.add`, `item.rename`, `item.tick`, `item.untick`, `item.move` and `item.delete`.

### 15.5 Comments

At the foot of a card's detail, newest first, each with its author's avatar and name and when it was written ("edited" if it was). A member writes one;
its author edits or deletes it; a board owner deletes it. Plain text, with its line breaks. Writing one raises a notice for the card's assignees and the
person who created the card (§16), never for its author. Replies are phase 2 (§25.6).

**As built (task 18.6):** a comment is edited by its author alone and deleted by its author or a member of the board with the owner role. Comments are read a page at a time after a cursor of time and
id, and rendered as text nodes.

### 15.6 Activity

What happened on a board, by whom and when, written by the server in the same transaction as the change (§7.3), never by the browser.

- **Kinds:** a card created, renamed, moved between lists, archived, restored, deleted, its due date set or cleared, a label put on or taken off, a
  person assigned or unassigned, a checklist item added or ticked, a comment written; a list created, renamed, moved or deleted; the board created,
  renamed, its visibility changed, archived, restored, published or unpublished; a person joining, added, removed or made owner.
- **Each row keeps the names it needs** (the card's title, the lists') as they were, so that it reads the same after the card is renamed or deleted.
  It keeps the card's id, which may then point at nothing.
- **Shown** in the card's detail (its own), and in the board's Activity dialog (all of it), newest first, in pages of 50. A person's own, across
  boards, is in Settings > Activity (§19).
- **Kept** for as long as the board is. It is not edited, and not deleted except with its board or its workspace.

**As built (task 17.6):** activity is written by `capture` and `record` (`src/workspaces/activity.ts`) in `applyOp`'s transaction, shown in sentences made by `describe.ts`, and read a page at a time
after a cursor of time and id. Deleting a card or a list does not delete its activity.

### 15.7 Moving and cloning

Cards are dragged within a list and between lists (§17.8). A right-click on a card, or its detail's menu, offers:

- **Move:** to another list of this board, or to a board of the same workspace that the person is a member of, at the top of a list they choose. On
  another board, labels are matched by name and colour and created if missing, and assignees who are not members there are dropped, which the dialog
  says before it moves. Its comments and activity go with it, and both boards' activity records the move.
- **Clone:** a copy in the same list, below it, with its title, description, due date, checklist (unticked), labels and assignees; not its comments or
  activity. The copy's activity says what it was cloned from.
- **Archive**, and for an archived card, **Restore** and **Delete**.

**As built (task 18.7):** moving to another board is `card.moveToBoard` and cloning is `card.clone`; the two boards' history are `card.moved_out` and `card.moved_in`. A card's comments, checklist,
assignments, history and notices are rewritten to the new `board_id`.

### 15.8 Archive, and delete

A card's status is Open or Archived. **Archive** takes it off the board, keeping its list and position, so restoring puts it back where it was. The
board's menu lists archived cards, with Restore and Delete. **Delete** is only for an archived card, asks first, and is final; its activity stays,
under the title it had.

**As built (task 18.1):** a card is dragged by its whole tile (a press that does not move is a click), its position is computed against what is shown, and archived cards are behind
_Archived cards_ in the board's header until the board's menu exists (17.2).

## 16. Inbox

Basic notifications for phase 1: what a person needs to know about the boards they are on, in the app. Push and email are phase 2 (§25.2).

- **Notices are written when they happen,** in the operation's transaction (§7.3), one row per person told: being **assigned** a card; a **comment** on
  a card one is assigned to or created; being **added** to a workspace or a board. Never for what a person did themselves.
- **The Inbox** (`/inbox`) has two parts. **Notifications:** newest first, grouped by day ("Today", "Yesterday", a date), each saying who did what to
  which card or board, and opening it. **Assigned to me:** every open card assigned to the person, across their boards, by due date, undated last.
- **Unread is one time per person** (`account_settings.inbox_seen_at`), as the kanban plugin found enough: opening the Inbox moves it on, and the
  sidebar's Inbox entry shows how many notices are newer, up to "99+".
- **A notice the person can no longer see** (they left the board, it was deleted or made private to others) is not shown, and is removed with them or
  it.
- **Kept** 90 days, and at most the latest 500 a person.

**As built (task 8.1):** `raise` is the one way a notice is written (`src/workspaces/notices.ts`), and it honours the kinds a person has turned off (`account_settings.notices_off`). The Inbox holds every
notice to what the person can still see in the statement that reads it. `workspace_passed` joins with 2.8.

## 17. Interface (the web)

### 17.1 Principles

Everything comes from `@sovereignfs/ui` and its `--sv-*` tokens. What is reusable and missing is added there, in `sovereign`, not built here: in phase 1
that is the `loader-circle` and star icons (§10.2), and whatever the card dialog needs that `Dialog` lacks. The design system comes through `src/ui`. The
icons this design names are the package's own: `square-kanban` for Boards, `calendar` for the Planner, `inbox`, `settings` for a workspace's gear and
`panel-left` for the sidebar's toggle.

**One set of routes.** Sovereign's rule: **never fork a navigation decision by viewport; fork only what is rendered.** Addresses and data are the same at
every width. So the home is one address for everyone: **`/desk`** (§17.11).

**Loading states gate every surface,** as the kanban plugin decided: the Desk paints from the device, so it has none after the first load; a board, the
boards index and the Inbox show a skeleton until what they need is there, and never half a board.

### 17.2 The shell

Two rows: the header, and the main area of two columns, the sidebar and the content.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▣ Tusk                                                          (avatar) │  header
├───────────────────┬──────────────────────────────────────────────────────┤
│ ▦ Boards          │                                                      │
│ ▤ Planner         │                    content                           │
│ ▢ Inbox        3  │                                                      │
│                   │                                                      │
│ MY WORKSPACES   + │                                                      │
│  ● Acme           │                                                      │
│  ● Side project   │                                                      │
│ SHARED WITH ME    │                                                      │
│  ● Club           │                                                      │
│               ⇤   │                                                      │
└───────────────────┴──────────────────────────────────────────────────────┘
```

- **Header:** the logo and "Tusk" on the left, linking home; the avatar on the right. The avatar opens `UserMenu`: a header of the person's name and
  email, then Settings, and Sign out; and when a core is set, a way back to it.
- **Sidebar, first block:** Boards, Planner and Inbox, each with its icon; the Inbox with its unread count. The Planner entry appears when the Planner
  is built (phase 2), not before: there is no entry that leads nowhere. **An entry is there only when its page is,** so the sidebar holds the Desk alone until Boards (16.4) holds its tile, and the Inbox until 8.1.
- **Sidebar, second block:** the workspaces. The person's own (those they own) under _My workspaces_, with a + to create one; those they are a member
  of, under _Shared with me_, at the bottom. A workspace opens to its boards (`/w/<id>`), and expands in place to list them.
- **Three states:** full, a rail of icons, and hidden, toggled from the header (`panel-left`) and remembered on the device. **By default it is full on
  the index pages (Boards, a workspace, the Inbox) and a rail on the Desk and a board,** which need the width; a person's toggle changes the default
  for that kind of page on that device.

### 17.3 The boards index

`/boards`. The Desk first, as a tile of its own (its open count, and today's due), then each workspace as a section: its name, its people's avatars,
a gear for its settings, and its boards as tiles of their colour, ending with a "Create board" tile. _My workspaces_ come first and can be sorted by
name, date created or recently updated; the choice is saved with the account (§19), so it is the same on every device. _Shared with me_ follow, sorted
by name.

**A workspace's settings** are a dialog from its gear: its name; its people, their roles, adding by email, removing, leaving; and Delete. A member sees
the people and Leave.

**As built (task 16.4):** the index reads in one statement for each kind of thing (boards, a few people of each, how many there are, the sort), never one for each workspace. The sort is
`account_settings.workspace_sort` and is written by `PATCH /api/settings`. The Desk's entry in the sidebar is replaced by _Boards_, so the Desk is reached from its tile and the header's mark.

### 17.4 The Desk

`/desk`, and `/desk/<listId>` for a list. The look of the Sovereign Tasks screenshot: with the app's sidebar as a rail, three columns, the Desk's lists,
the list, and a card's detail on the right while `?card=<id>` is set.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▣ Tusk                                                          (avatar) │
├──┬──────────────┬───────────────────────────────┬────────────────────────┤
│▦ │ DESK       + │ Backlog                    ⋯  │ (a card's detail,      │
│▤ │ ● Backlog  4 │ Add a card…                   │  while ?card= is set)  │
│▢ │ ● Errands  2 │ ☐ Water the plants   Sat  ☆  │                        │
│  │ ● Home     1 │ ☐ ◌ Call the bank          ★  │                        │
│  │              │ ▾ Completed (1)                │                        │
└──┴──────────────┴───────────────────────────────┴────────────────────────┘
```

- **The lists column:** the Desk's lists, each with its dot and open count, a + to add one, dragged into order.
- **The list:** "Add a card" at the top, then its cards: checkbox, title, the in-progress icon, due date, repeat icon, checklist ring, star. The filter,
  sort and _Delete completed_ in its menu. Done cards in _Completed_ at the end.
- **A card's detail,** in the right column: status, title, description, due date and repeat, list, checklist, star, Delete. It saves as you leave a
  field. Closing it replaces the address, so Back does not step through every card looked at.

### 17.5 A board

`/b/<boardId>`. Three rows inside the content: the app's header, the board's header, and the columns.

- **The board's header:** its name (renamed in place by an editor), its search (§14.5), its members' avatars, Share, and a menu: Activity (a dialog of
  §15.6), Settings, Archived cards, Archive or Restore, Delete, each shown only to whom it is for (§7.2). A viewer of a public board sees "Join board".
- **The columns:** the lists side by side, scrolling sideways, each with its header (§14.2) and its cards, and "Add a list" at the end. The board's
  colour is a thin band at the top, not a wash behind the cards, so that text stays readable in both themes.

### 17.6 The card dialog

A `Dialog` over the board, at `/b/<board>/c/<card>` (an intercepting route, as Fjord's `/account`), and a page of its own when that address is opened
directly. Two columns at desktop widths: the title and the list it is in; labels, assignees and due date as a row of chips; the description; the
checklist; then Comments and Activity as two tabs. A side column holds the actions: Move, Clone, Archive, and the pickers. On a narrow screen it is one
column.

**As built (task 18.2):** the dialog is the page of its address, rendered inside the board's layout (`app/(app)/b/[id]/layout.tsx`), not an intercepting route: the board stays mounted
and is not read again, and an address opened directly shows the board with the dialog over it. Its fields save as they are left, through the board's store.

### 17.7 Colours

Boards, Desk lists and labels each have a colour, and **any colour can be picked**: `ColorPicker` from the design system, offering a row of suggested
colours and a free choice. Stored as `#rrggbb`. Everything drawn on a colour (a label's name, a tile's title) is black or white by contrast, and a board's
colour is a band or a dot, never a background for the page, so that light and dark both work.

### 17.8 Drag, keyboard and access

- **On a board, a whole card is dragged, with no handle** (the kanban plugin's decision): a press that moves a few pixels starts a drag, and one that
  does not is a click that opens the card. Cards move within a list and between lists; lists move by their header. Dropping writes one row.
- **On the Desk, the same:** a card is dragged by its row, and a click opens it. (Tasks used the title link as the handle; the row becomes the handle,
  with the checkbox and star keeping their own clicks.)
- **With a keyboard,** a focused card is lifted with Space, moved with the arrows (between lists with left and right), and put down with Space, through
  dnd-kit's `KeyboardSensor`; "Change position" and Move are in every menu too. Attached to the page and ignored while typing: `n` a new card, `/`
  search, `Esc` close, `?` to list them.
- **Accessibility is a condition of each task's being done:** WCAG 2.2 AA, labelled icon buttons, real focus handling in dialogs and menus, a drag's
  result announced, and reduced motion honoured.

### 17.9 PWA

Fully installable, on desktop and phone, modelled on Sovereign core (`apps/core/app/manifest.ts`, `src/sw/source.ts`).

- **`app/manifest.ts`:** name Tusk, icons (with a maskable one), `display: standalone`, theme colours.
- **The service worker** caches only **the app shell, by allow-list:** a versioned set of built files and icons, and the one shell page, which holds
  nothing of a person. **No data is ever in a cache:** the Desk is in IndexedDB, named per account and deleted at sign-out, and boards are in memory.
  A test evaluates the worker and fails if anything else gets in.
- **How the Desk opens with no network.** The page is `/shell` (`app/shell`), public and the same for everyone. With the network off, a Desk address (`/`,
  `/desk`, `/desk/<list>`) is answered with the kept copy of it, **headers and all**: a cache keeps a response's headers with its body, so the policy and
  the nonce on its scripts agree, and the page needs no fresh nonce. (The nonce is one that a person's browser has seen before; the page holds nothing
  to steal, and what people write is rendered as text, never as HTML.) The page finds who is signed in **on the device** (`src/identity.ts`, kept by every
  signed-in page and removed at sign-out), makes the same composition the server's layout makes (`SignedInArea`), and chooses the screen from the address,
  since its own tree is not the address's. The Desk's screens read the working copy, so they need nothing more.
- **Every other address with no network** is answered with a page the worker builds itself, saying that it needs a connection, with a link back to the
  Desk and a policy that allows no script. **Nothing else is kept:** not a board, the Inbox, Settings, an API's answer or a page with a person's data.
- **The worker keeps the build's own files** (the allow-list is `.next/static`, listed when `/sw.js` is served) as it installs, so that the shell can start
  with nothing fetched. The cache is named for the build, a new build is a new worker, and the old cache is removed when the new one activates; it does not
  take over the pages that are open.
- **It also handles** Background Sync for the Desk (§8.3), and Push in phase 2. A new version activates at the next load, keeping the outbox.

### 17.10 What the plugins paid to learn

Each of these cost a release there. They are written here so they are not paid for twice.

- **Drag indices are against what is rendered,** never the full array: filters, sort and the pin to the top all make the two differ.
- **dnd-kit's auto-scroll will scroll a container sideways** in the middle of a vertical reorder unless told to scroll only what it should
  (`canScroll`); on a board, sideways is wanted between lists and not within one. Each `DndContext` needs an explicit `id`, or SSR and hydration
  disagree.
- **`transform` on an ancestor makes it the containing block for `position: fixed`,** so a `Drawer` inside it renders squashed.
- **`overscroll-behavior: none`, not `contain`,** on scrolling columns: in WebKit `contain` keeps the element's own bounce.
- **`<Link replace>` to the same path with another search param does nothing** on a mounted route; closing a detail uses `router.replace`.
- **Sticky headers need an opaque background and a `z-index` above the rows'.**
- **Text written in a field keeps its line breaks** (`white-space: pre-wrap`) wherever it is shown: the kanban plugin collapsed them in two places.
- **A dialog's close button needs its clearance reserved,** or a long title runs under it.
- **A bug can live on PostgreSQL only.** The kanban plugin shipped one; every data-layer test here runs on all three forms (§23.1).
- **Touch behaviour is not testable in Chromium's tooling.** A change to gestures or scrolling is checked in the iOS Simulator, and says so in its PR.

### 17.11 Addresses

| Address                                   | What                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/`                                       | A landing page for someone not signed in, static. Signed in, `proxy.ts` sends it to `/desk` |
| `/sign-in`, `/sign-up`                    | §6                                                                                          |
| `/desk`, `/desk/<listId>`                 | The Desk: its first list, or a list. `?card=<id>` opens a card's detail                     |
| `/boards`                                 | The boards index (§17.3)                                                                    |
| `/w/<workspaceId>`                        | One workspace's boards                                                                      |
| `/b/<boardId>`, `/b/<boardId>/c/<cardId>` | A board, and a card on it                                                                   |
| `/inbox`                                  | §16                                                                                         |
| `/planner`                                | Phase 2 (§25.1)                                                                             |
| `/account?section=`                       | Settings (§19), a dialog over the page as Fjord's is                                        |
| `/p/<token>`                              | A published board (§14.6), for anyone                                                       |

Anything that is not there, or not there for this person, says so with a way back, and answers 404.

## 18. Mobile

The phone's own screens are phase 2. **Phase 1 lays their foundations:** every screen works at a phone's width as a single column, the routes are the
ones the phone will use, and the shell can swap its sidebar for the footer below at 768px and under. What phase 2 builds, as the owner set it out:

- **Three rows:** the header (logo and Tusk, avatar), the content, and a footer of five: **Desk | Boards | Action | Planner | Inbox**.
- **The Desk is the default,** as a carousel of its lists, one per slide (`SwipableMobileCarousel`). The action button opens four: the list selector
  (and a new list), a new card (a dialog, with the list on screen chosen), **Today's agenda** as a swipe view, and **Review** as a swipe view (§25.3).
- **Boards** shows the boards grouped by workspace; a board opens as a carousel of its columns. The action button offers a new board and a new workspace;
  inside a board, a new list and a new card.
- **The action button changes with the view.** The Planner is a feed of dates with blocks; the Inbox holds the notifications and assigned cards.
- **A card's detail is full-screen.** Cards are reordered in a list by a long press; **moving between lists is by a menu, never a drag** on a carousel
  that also swipes (the kanban plugin's decision). Reordering on the Desk starts from a visible handle.

## 19. Settings

One dialog, from the avatar menu, at `/account?section=`: over the page on a desktop and a full page on a phone, as Fjord's `/account` is
(`app/@modal`).

| Section           | What                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Profile**       | Name, email, avatar. The name and avatar are what workspaces see                                                                                                      |
| **Security**      | Password, two-factor, passkeys, linking Sovereign, signed-in devices, as Fjord's. An account that came through Sovereign has no password, two-factor or passkey parts |
| **Preferences**   | Theme, first day of the week, how My workspaces are sorted                                                                                                            |
| **Notifications** | Phase 1: what the Inbox tells you about, each on or off. Push and email are added in phase 2                                                                          |
| **Data**          | Export and import (§20); backup (§21); encryption of the Desk (§9); published boards (§14.6); last synced; delete account (§22)                                       |
| **Activity**      | What the person did across their boards, newest first, from §15.6, and when they last signed in on each device                                                        |

Settings shows only what can work here: no encryption choice in operator-key mode, no backup without `TUSK_ENCRYPTION_KEY`, each with a sentence saying
why. All of it needs a network.

**Preferences are saved with the account when they are about the data,** so they follow the person: the sort of My workspaces, a Desk list's sort and
whether its _Completed_ is open. **What is about the screen stays on the device:** the sidebar's state, the theme, which workspaces are expanded.

## 20. Export and import

One JSON file, from Settings > Data, or from a workspace's or board's menu, either way.

### 20.1 What can be exported

| Scope           | Holds                                                                  | Who may               |
| --------------- | ---------------------------------------------------------------------- | --------------------- |
| **Desk**        | Its lists, cards, checklists and series                                | Its owner             |
| **A board**     | Its lists, cards, labels, checklists, assignees, comments and activity | Anyone who can see it |
| **A workspace** | Its boards, as above, and its people                                   | Its owners            |
| **Everything**  | The Desk, and every workspace the person owns                          | The person            |

```json
{
  "format": "tusk",
  "version": 1,
  "exportedAt": "2026-11-06T09:00:00Z",
  "scope": "everything",
  "desk": {
    "lists": [{ "id": "…", "title": "Backlog", "color": "#6b7280", "position": "a0", "cards": [] }],
    "series": []
  },
  "workspaces": [
    {
      "id": "…",
      "name": "Acme",
      "people": [{ "name": "Ana", "email": "ana@example.com", "role": "owner" }],
      "boards": [
        {
          "id": "…",
          "name": "Roadmap",
          "color": "#2563eb",
          "visibility": "public",
          "lists": [],
          "labels": []
        }
      ]
    }
  ]
}
```

- **People are named by name and email,** never by id, so that a file means something on another server.
- **Everything of the scope,** done and archived included; not what was deleted, and no key, publication token, backup connection or credential.
- **Written deterministically:** ordered by position and id, so that two exports of the same data differ only in `exportedAt`.
- **The Desk is made and read in the browser,** from the local store and into it, so that it works the same on any encryption mode, with a warning if it
  is encrypted. **Boards and workspaces are made on the server,** since that is where they are.

### 20.2 Import

- **Import always creates.** It never replaces or merges: Desk lists are added to the Desk; a board is created in a workspace the person chooses (where
  they may create boards); a workspace is created with the person as its owner. Every id is made new. Importing twice makes two copies, so it says what
  it found ("1 workspace, 4 boards, 312 cards") and asks before writing.
- **People are matched by email** to accounts on this server: someone who is a member of the destination workspace is assigned and kept on the board;
  anyone else is dropped, and the summary says how many. Importing a workspace does not add people to it.
- **Comments and activity are not imported:** the file keeps them as a record, and a new board's history starts with its import (one row, "imported this board from a file"). An archived card stays archived; the board is made open.
- **A file that fails validation changes nothing.** 50 MB at most, and every field within its limits (§7.1). It goes to the server as one request and one
  transaction, the Desk's part encrypted first on an encrypted Desk.
- **It reads the tasks plugin's file too,** `{ pluginId: "fs.sovereign.tasks", schemaVersion: 1, data }`, into the Desk: lists become lists, tasks
  cards, subtasks checklist items, notes descriptions, and each series gets an anchor from its open occurrence. The kanban plugin had no export, so there
  is nothing of it to read.

## 21. Backup to git

A person can connect a git repository of theirs, and Tusk commits their data to it, as a new file each time.

### 21.1 What a person does

In Settings > Data: connect a repository (§21.2); choose `manual` (only on **Back up now**) or `auto` (every hour, 6 hours, day (the default) or week);
see the repository, the last backup with a link to the file, the next, and what went wrong if something did. Change the mode or disconnect at any time.

**The repository can be a Fjord repository or anything else.** In a Fjord repository, `tusk/` is an ordinary folder outside every vault, so nothing is
needed from Fjord. The first provider is GitHub; `Provider` leaves room for others.

### 21.2 Connecting, as Fjord does

The connection is Fjord Web's §7, for one repository per account:

- **Two ways in.** **The GitHub App** (`TUSK_GITHUB_APP_*`, preferred where the operator has set it up), with _Contents: read and write_ and _Metadata:
  read_ only and short-lived installation tokens. **A repository address and a fine-grained personal access token**, limited to that repository.
- **Checked before anything is kept,** in the order a person would fix things: GitHub accepts the token; it can see the repository; **the repository is
  private**; the default branch has something in it; the token can write (`canWrite`). Each refusal is a message of ours saying what to do, never
  GitHub's text, never the token.
- **Credentials at rest** are `src/crypto/`: envelope encryption under `TUSK_ENCRYPTION_KEY`, bound to the row and purpose, with rotation through
  `TUSK_ENCRYPTION_KEY_PREVIOUS`.
- **A git host is reached only through `Provider`** (`src/providers/`), tested over a fake whose storage is a real git repository, an in-memory one the app
  is tested against, and GitHub's real answers recorded. `TUSK_GITHUB_API_URL` covers an Enterprise Server. **Credentials never appear in an error, a log
  or a URL.**

### 21.3 What is committed

```
tusk/2026-11-06_14-30-00.json
```

- **The "everything" export of §20:** the Desk and every workspace the person owns. A board in someone else's workspace is theirs to back up.
- **On the default branch,** under `tusk/` at the repository's root, made by the first commit if it is not there. Other files are never touched.
- **The name is `YYYY-mm-dd_hh-mm-ss` in UTC,** so that names sort in order whatever the time zone is doing.
- **Made on the server,** so that auto backups need no device. **On a personal-key Desk, the Desk's part holds ciphertext and the wrapped list keys**
  (`"encrypted": true`), so the backup is as private as the database, and importing it needs the key.
- **To restore,** download it and import it (§20.2).
- **The commit** is one file (blobs, a tree on the head's, a commit, a fast-forward), **never forced**, with the message
  `Tusk backup 2026-11-06 14:30:00 UTC`. **Nothing is ever deleted or rewritten,** and Tusk does not prune.

### 21.4 Running it

- **Auto backups are a job.** A connection has `next_backup_at`; a process claims it by a conditional update, so that one process does it. The data is
  read in a short transaction and closed; GitHub is called outside it.
- **Nothing changed, nothing committed.** An auto backup compares a fingerprint of what it would write (the Desk's `seq` and each owned workspace's
  `updated_at`) with the last one's, and if they match it only records that it looked. **Back up now** always commits, at most once a minute.
- **A branch that moved** is read again and tried once more in the same run. **A write is never retried on a lost answer:** the next backup is a new
  file, so the worst case is one file too many.
- **Failures are kept and shown.** A network failure or rate limit tries again at the next due time. A token that stopped working, a repository gone,
  or one made public **stops auto backup**, says so in Settings, and adds a notice to the Inbox.
- **Size:** the 50 MB limit of §20 holds here too.

### 21.5 Privacy

Unless the Desk has a personal key, the file is **plain text** on GitHub's servers, and boards always are. So **only a private repository can be
connected,** each backup checks again, and Settings says plainly what is being sent and where. **It is each person's own choice and own repository.**
Disconnecting and deleting the account delete the connection and its credential; neither touches the repository.

## 22. Account deletion and signing out

**`People.deletePerson`** (`src/sovereign/people.ts`, as Fjord's) deletes everything of an account, and leaves shared work to the people still using it.
It is one routine, safe to run again: the row linking a `sub` to the account goes last, so a run that stopped can find the account.

- **The Desk:** every list, card, checklist item and series, including what was soft-deleted; list keys; Desk settings.
- **Workspaces:** they are removed from every workspace and board, and unassigned from every card, as removal does (§7.2). **A workspace where they were
  the only owner passes to its longest-standing member,** who is told in their Inbox; **one with nobody left is deleted** with its boards.
- **What stays:** their comments, and the activity and cards they made on boards that carry on, shown as by "Deleted account", since the account id no
  longer resolves to a name. Nothing is copied to keep their name.
- **The rest:** notices for them and about them, publications of boards that are deleted, the backup connection and its credential, rate counters,
  passkeys, two-factor, sessions and sign-ins, and the account.

A test seeds one row of every table, for the person and for a second person sharing a workspace with them, and finds nothing of the first after, and
the second's boards intact. A new table that holds something of a person fails it until it is included.

It is reached two ways:

- **From Settings > Data,** after the password or, for a Sovereign-only account, a fresh session. It says what will go, what will pass to others, and
  that a backup repository will not. This device's local database goes too; other devices find out at their next sync, and delete theirs.
- **From core's account-deleted notice,** when a Sovereign identity is linked: a signed token, `POST`ed to `/api/sovereign/account-deleted`, checked by
  the SDK (`verifyAccountDeletedToken`), and answered `200` only once done, as app manifest §4 requires.

**Back-channel logout** is `/api/sovereign/backchannel-logout`, checked the same way, and ends all of the person's sessions. Both routes read a bounded
form, count requests against one limit, refuse a replayed `jti`, and are 404 where Sovereign sign-in is not set up.

## 23. Data model and database

### 23.1 Database

**As Fjord Web's §14, and read that for the detail.** `TUSK_DB_DIALECT` is `sqld` (the default), `sqlite` or `postgres`, read in one place.

| Dialect              | Address                                                                     | For                                                                                                    |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `sqld` (**default**) | `TUSK_SQLD_URL`, with `TUSK_SQLD_ADMIN_URL`                                 | Most installs. Namespaces `tusk` and `tusk_auth`. sqld 0.24.33 or later                                |
| `sqlite`             | `TUSK_SQLITE_URL`, `file:/data/tusk.db`                                     | The smallest self-host: one container. Auth is `tusk_auth.db` beside it. Never on a network filesystem |
| `postgres`           | `TUSK_POSTGRES_URL` (or `_FILE`), `PGSSLROOTCERT`, `TUSK_POSTGRES_POOL_MAX` | An operator who prefers it, and what an instance gives. Schemas `tusk` and `tusk_auth`                 |

- **Drizzle, a schema and a migration set per dialect,** generated with `pnpm db:generate` and never written by hand or `push`ed, applied at start-up.
  CI fails if generating would write anything. A **parity test** checks that the two dialects declare the same tables, columns and indexes.
- **Portable by rule:** standard SQL only, values bound. **No `LISTEN/NOTIFY`, no trigger, no extension.** A permission is a subquery in the statement
  (§7.1), which all three run alike.
- **No foreign keys and no cascades,** as in Fjord: `account_id` is in the other store, and SQLite's enforcement depends on a per-connection setting.
  **Every deletion names what it deletes, in a transaction:** deleting a board deletes its lists, cards, labels, checklist items, comments, activity,
  members, publication and notices, by `board_id`, which every one of those tables carries for this reason.
- **At start-up,** in `instrumentation.ts`, before anything is served, and it does not start if it cannot.
- **Tested on every form.** A data-layer test runs on sqld, a `file:` database and PostgreSQL, and one that passes on only one is not done. Tests read
  `TUSK_TEST_*` and never the app's variables.
- **A file database serialises its statements in the process,** since libSQL waits for a lock synchronously; a transaction holds nothing across a call
  out of the database.

### 23.2 Representations

One per type, through the column vocabulary (`src/db/schema/*/columns.ts`):

| Value             | Stored as                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Id                | Text, a UUID made by the client                                                            |
| Time              | `epochMs`: a 64-bit integer, a `number` in JavaScript                                      |
| Boolean           | The vocabulary's word, `0/1` on SQLite and `boolean` on PostgreSQL                         |
| Date, time of day | Text, `YYYY-MM-DD` and `HH:MM` (§11)                                                       |
| Position          | Text compared byte by byte: `BINARY` on SQLite and `COLLATE "C"` on PostgreSQL             |
| Colour            | Text, `#rrggbb`                                                                            |
| Fields (the Desk) | JSON as text: a map of field name to `{ v }` or `{ c }`, plus the `seq` that last wrote it |
| Details           | JSON as text, for an activity's or a notice's names                                        |
| Sealed            | Under the operator key, a content column holds ciphertext as text (§9.5)                   |

### 23.3 Tables

Beyond better-auth's (`user`, `session`, `account`, `verification`, `two_factor`, `passkey`, `rate_limit`, in the auth store).

**The Desk** is synced, so each row has structural columns the server uses and a `fields` column it mostly does not:

| Table         | Structural columns                                                                                                             | Fields                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `desk_list`   | `id`, `owner_id`, `position`, `deleted_at`, `seq`, `created_at`                                                                | `title`, `color`, `sort`, `showCompleted`, `filter`, `key` (the wrapped list key, plain, §9.2)  |
| `desk_card`   | `id`, `owner_id`, `list_id`, `position`, `deleted_at`, `seq`, `created_at`, and mirrors `due_date`, `due_time`, `completed_at` | `title`, `description`, `starred`, `dueDate`, `dueTime`, `seriesId`, `startedAt`, `completedAt` |
| `desk_check`  | `id`, `owner_id`, `card_id`, `position`, `deleted_at`, `seq`, `created_at`                                                     | `title`, `completedAt`                                                                          |
| `desk_series` | `id`, `owner_id`, `list_id`, `deleted_at`, `seq`, `created_at`                                                                 | `rule`, `anchor`                                                                                |

The mirrors exist for the Planner and reminders (phase 2): the server copies them from `fields` when it can read them, and they are null on a
personal-key Desk.

**Workspaces** are ordinary rows, written only through `/api/ops`. Every row below a board carries `board_id`, for the permission and for deletion.

| Table              | Columns                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workspace`        | `id`, `name`, `created_by`, `created_at`, `updated_at`                                                                                                       |
| `workspace_member` | `workspace_id`, `account_id` (together the key), `role` (`owner`, `member`), `added_by`, `created_at`                                                        |
| `board`            | `id`, `workspace_id`, `name`, `color`, `description`, `visibility` (`public`, `private`), `archived_at`, `version`, `created_by`, `created_at`, `updated_at` |
| `board_member`     | `board_id`, `account_id` (the key), `workspace_id`, `role` (`owner`, `member`), `created_at`                                                                 |
| `board_list`       | `id`, `board_id`, `name`, `position`, `created_at`, `updated_at`                                                                                             |
| `card`             | `id`, `board_id`, `list_id`, `title`, `description`, `due_date`, `due_time`, `position`, `archived_at`, `created_by`, `created_at`, `updated_at`             |
| `label`            | `id`, `board_id`, `name`, `color`, `created_at`                                                                                                              |
| `card_label`       | `card_id`, `label_id` (the key), `board_id`                                                                                                                  |
| `card_assignee`    | `card_id`, `account_id` (the key), `board_id`, `assigned_by`, `created_at`                                                                                   |
| `checklist_item`   | `id`, `card_id`, `board_id`, `title`, `completed_at`, `position`, `created_at`                                                                               |
| `comment`          | `id`, `card_id`, `board_id`, `author_id`, `body`, `created_at`, `edited_at`                                                                                  |
| `activity`         | `id`, `board_id`, `card_id` (may point at nothing), `actor_id`, `kind`, `details`, `created_at`                                                              |
| `publication`      | `board_id` (the key), `token` (unique), `created_by`, `created_at`                                                                                           |
| `notice`           | `id`, `account_id`, `kind`, `actor_id`, `workspace_id`, `board_id`, `card_id`, `details`, `created_at`                                                       |

Indexes follow the queries: members by account (the sidebar, the index), cards by list and position, activity by board and time and by card and time,
notices by account and time, assignees by account (Assigned to me).

**The rest:**

| Table               | Holds                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account_settings`  | `account_id` (the key), `seq`, `pruned_through`, `time_zone`, `first_day_of_week`, `workspace_sort`, `inbox_seen_at`, `encryption` (`none`, `moving`, `personal`), `recipient` (the age public key)                                               |
| `applied_mutation`  | `account_id`, `id`, when: the Desk's mutations and the workspaces' operations alike (§8.7)                                                                                                                                                        |
| `tombstone`         | `table`, `id`, `account_id`, `seq`, when (§8.7)                                                                                                                                                                                                   |
| `backup_connection` | `account_id` (the key), `kind` (`token`, `app`), `repository`, `branch`, `credential_id`, `mode`, `frequency`, `next_backup_at`, `last_backup_at`, `last_backup_path`, `last_fingerprint`, `failure_kind`, `failures`, `stopped_at`, `created_at` |
| `credential`        | As Fjord's: `id`, `purpose`, `kek_id`, `wrapped_key`, `ciphertext`, `created_at`, `rewrapped_at`                                                                                                                                                  |
| `rate_bucket`       | A key, when the window began, a count                                                                                                                                                                                                             |

**The browser's store** holds the Desk's four tables, with their fields decrypted in memory only when read, plus the outbox, the cursor, keys if
encrypted, and what the app remembers on this device. It holds nothing of a workspace.

## 24. Security, deployment, testing

### Security

Beyond §7: a strict Content-Security-Policy with a per-request nonce and the usual hardening headers from `proxy.ts`, with `worker-src 'self'` and
`connect-src 'self'`; no `'unsafe-inline'` in `script-src`. A published board's page has the same policy and no script of its own. Nothing third-party
loads, and fonts are self-hosted at build. **Text people write is rendered as text, never as HTML,** everywhere, which matters more with keys in the
page and other people's words on a board. Logs hold no titles, descriptions, comments, tokens or file contents: an id and a kind of failure. A security
review of phase 1 is written up before its release, as Fjord's are, with the workspace roles of §7.2 as its centre.

### Licence

AGPL-3.0-or-later, since it bundles `@sovereignfs/ui`. A dependency's licence must be compatible.

### Deployment

One image, and three ways to run it, as Fjord:

```bash
# The smallest: one container, a file, no other service
docker run -v tusk:/data -e TUSK_DB_DIALECT=sqlite -e TUSK_SQLITE_URL=file:/data/tusk.db \
  -e TUSK_URL=https://tusk.example.com -e TUSK_AUTH_LOCAL=1 -e TUSK_AUTH_SECRET=… -e TUSK_ENCRYPTION_KEY=… ghcr.io/sovereignfs/tusk
```

- **`deploy/`** has Compose files for sqld (the default), a file and PostgreSQL, with a README and `.env.example`. `scripts/deploy-check.sh` brings each
  up from nothing in CI, and a fourth as an instance hosts it.
- **Hosted on an instance:** `sv app add`, from the manifest. Tusk remains a program of its own.
- **The manifest,** as Fjord's: `"database": true`; the redirect `/api/auth/callback/sovereign`; `backChannel` and `accountDeleted` as in §22; scopes
  `openid profile email`; an icon and a real description; `generate` of `TUSK_AUTH_SECRET` and `TUSK_ENCRYPTION_KEY`. `src/sovereign-manifest.test.ts`
  holds it to the schema and the code.
- **What an operator of an instance sets:** `TUSK_AUTH_SIGNUP=open`, SMTP, and the GitHub App if they want it. The README says so.
- **Releases:** a `vX.Y.Z` tag publishes the image for amd64 and arm64 to `ghcr.io`. A patch release carries no migration and no change to a setting. A
  change to the sync protocol raises its version, and devices update (§8.3).
- **The operator's backups are the database's:** a snapshot of the sqld volume, Litestream or `.backup` for a file, `pg_dump` for PostgreSQL. A person's
  backup (§21) is not a substitute, nor the reverse.

### Testing

- **Vitest,** with pure rules tested directly, the server's sync and operations on all three databases (§23.1), and the browser's store against
  `fake-indexeddb`. A rule that was hard to get right is seen to fail with it switched off.
- **The Desk's sync** with simulated devices: several local stores, one server, random orderings of offline edits, asserting that all converge.
- **The workspace roles** as a matrix: an owner, a member, a board member, a viewer and an outsider, each sending every kind of operation and read, with
  the expected answer for each written once and checked against all of them.
- **Encryption:** the server is checked to never hold a plain Desk field for a personal-key account, by reading its tables after a full journey.
- **Sign-in** against the fake Sovereign (§6). **Core's notices** against `createFakeCore` from `@sovereignfs/sdk/testing`.
- **Backups** against `MemoryProvider`. **Recurrence** with property tests under more than one `TZ`. **Time** by passing it in.
- **Playwright,** in Chromium and WebKit, including with the network off for the Desk, and two signed-in people on one board. **The iOS Simulator** for
  gestures and offline (§17.10).
- A dev **seed** (`pnpm seed`): a Desk covering overdue, due today, in progress, repeating, starred, checklists at each state, long titles and an empty
  list; and a workspace shared with a second seeded account, with public, private, archived and published boards.

## 25. Phase 2, in outline

After the MVP. Outlined here so phase 1 does not preclude any of it. Each gets its own design before it is built.

### 25.1 The Planner

A feed of dates, from today on, each day a block of what is due: Desk cards and board cards assigned to the person, overdue first. On a phone, the
screenshot's look: one day after another, scrolling. It reads due dates the server can see (§23.3's mirrors), so on a personal-key Desk the Desk's part
is computed in the browser.

### 25.2 Reminders, Push and email

As Tasks designed them: a daily brief ("3 cards due today · 2 overdue") and a reminder at a due time, through Web Push (`TUSK_VAPID_*`, per device),
email (`TUSK_SMTP_*`) and core's bell when hosted (`notifications:send`), each by its own switch, with the Inbox always there. **The database decides who
sends,** by a conditional update, so any process may run the job; the notice is written in the claim's transaction, and channels fan out after it. Zones
are worked out in JavaScript, one query per zone. **On a personal-key Desk the browser uploads times only** (`reminder_slot`), and Push wakes the device
to show the title. Inbox notices are also sent by Push and email, by the same switches.

### 25.3 Today and Review on the phone

From the Desk's action button. **Today** is every open Desk card that is overdue, due today, or starred; **Review** is every open card, least recently
reviewed first. Both go through cards one at a time as a `SwipeStack`, with buttons always shown, since a gesture is never the only way:

| Gesture | Button  | What it does                                                                                   |
| ------- | ------- | ---------------------------------------------------------------------------------------------- |
| Up      | Done    | Completes it (a repeat makes its next)                                                         |
| Down    | Cancel  | Deletes it, with Undo. On a repeating card, skips this occurrence and makes the next           |
| Left    | Dismiss | In Today, hides it until tomorrow (a `dismissedOn` field), with Undo. In Review, only moves on |
| Right   | Star    | Sets the star, and leaves the due date alone                                                   |

Any swipe in Review marks a card reviewed (`reviewedAt`), so a person can stop and carry on later. A date is not changed from a card.

### 25.4 Boards offline, and live

Boards come under sync: a cursor per board the person can see, the same server-stamped order per board (its `version` becomes that counter), and the
same operations queued in an outbox. Operations are already field-level with client ids and fractional positions (§5), which is what makes this a step
and not a rewrite. Live updates replace the 20-second check (§14.7) with server-sent events. What a device holds of a board it can no longer see is
removed at its next sync.

### 25.5 Invitations

Inviting by email someone who has no account yet, with a link that signs them up into the workspace, and on an instance, finding people through core's
directory (`directory.searchUsers`).

### 25.6 Replies to comments

One level, as the kanban plugin had, with a notice for the person replied to.

### 25.7 The Desk as a board, and cards from elsewhere

A board view of the Desk, its lists as columns. Then the Desk can show cards from boards (those assigned to the person, by a rule they choose) and from
other services, without moving them: a view, not a copy.

### 25.8 Attachments

Files on a card. Where they are stored (the database, a volume, an object store) is for its design.

## 26. Open questions

None at present. New ones go here, each with a recommendation, until they are decided and moved to §27.

## 27. Decision log

Decisions from the turn to Tusk (2026-11-06) come first; those carried over from Tasks follow.

| Decision                                                                                                                                        | Why                                                                                                                               | Rejected                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A list's wrapped key is a field of the list's own row (`key`), not a table of its own (2026-11-07)                                              | It rides the sync, purge, tombstone and convergence code unchanged; a table would have needed a second stream with its own cursor | A `list_key` table with its own `seq`, as §23.3 first said                              |
| Tasks becomes **Tusk**, one app for the Desk and shared kanban boards, replacing the tasks and kanban plugins (2026-11-06)                      | The owner's direction. One place for personal and shared work                                                                     | Two apps; kanban as a later phase of Tasks                                              |
| The name changes everywhere: package, `TUSK_` settings, databases, cookie, IndexedDB, manifest, image, repository (2026-11-06)                  | The owner's direction. Nothing is released, so nothing needs migrating                                                            | Keeping `tasks` inside and Tusk outside                                                 |
| Migrations squashed into a new first migration (2026-11-06)                                                                                     | No version is tagged and no real data exists; a history of names that never shipped helps no one                                  | Renaming tables through migrations                                                      |
| Workspaces → boards → lists → cards; the Desk a virtual board per account (2026-11-06)                                                          | The owner's direction                                                                                                             | Projects, as the kanban plugin named them                                               |
| The Desk offline-first on the existing sync; boards online, server-authoritative, optimistic, with client ids and fractional order (2026-11-06) | The owner's direction: the Desk offline; other parts may wait. Shaping boards for sync now keeps phase 2 a step                   | Boards offline in phase 1; boards on server actions with no shape for sync              |
| Separate tables for the Desk and for boards (2026-11-06)                                                                                        | Different fields, different owners, different flows; one table would carry two sets of nullable columns and two permission rules  | One `card` table for both                                                               |
| Desk status as `startedAt` and `completedAt`, derived; In progress optional, shown by a small icon (2026-11-06)                                 | The owner's direction for the icon. Two times converge field by field, and Done always wins over a stale "in progress"            | One `status` field (a stale write could undo Done); a column per status                 |
| Only the title is required, on every card (2026-11-06)                                                                                          | The owner's direction                                                                                                             | —                                                                                       |
| Desk checklist items in their own table (2026-11-06)                                                                                            | A card has no self-reference; an item cannot be given a date by mistake; the same shape as a board's checklist                    | Subtasks as cards with a parent, as Tasks built them                                    |
| _Backlog_ is the first list of the Desk and of every new board, renamable (2026-11-06)                                                          | The owner's direction                                                                                                             | _My tasks_                                                                              |
| Board cards are Open or Archived; archive is reversible and delete is only for an archived card (2026-11-06)                                    | The owner's direction, and the kanban plugin's lesson that archive is the safe half of delete                                     | Done on board cards; deleting straight away                                             |
| Workspace owners (several) and members; board owners and members; viewers see a public board read-only (2026-11-06)                             | The kanban plugin's model, proven there                                                                                           | One owner per workspace; every workspace member able to edit every public board         |
| A workspace member joins a public board with one click (2026-11-06)                                                                             | The owner's confirmation. Read-only until joined keeps "who works on this" honest, and joining costs nothing                      | Asking a board owner to be added                                                        |
| Workspace owners administer every board without editing its content (2026-11-06)                                                                | No board is left unmanageable when its owners leave, as happened in the kanban plugin                                             | Owners editing everything; owners with no power over boards                             |
| A private board is seen by its members and the workspace's owners; no workspace-level visibility (2026-11-06)                                   | The owner's direction. The kanban plugin's project visibility was a second flag that overrode the first; one is enough            | A visibility flag on the workspace too                                                  |
| People are added by exact email of an existing account, and boards draw only from the workspace (2026-11-06)                                    | The owner's direction: only within the workspace. A server running alone has no directory                                         | Directory search; invitations to new people (phase 2)                                   |
| Refusals read as "not found" (2026-11-06)                                                                                                       | Whether a board exists is itself membership-gated, as in the kanban plugin                                                        | `403` for a board one cannot see                                                        |
| One door for workspace writes, `POST /api/ops`, the permission a subquery in the statement (2026-11-06)                                         | The same reason as `/api/sync`: one module to get right, a matrix of tests that is a loop                                         | A route or server action per change; a check before the write                           |
| Activity written by the server in the operation's transaction, keeping names, outliving its card (2026-11-06)                                   | An audit trail cannot be skipped by a client and must read the same after a rename or delete                                      | Activity written by the browser; activity deleted with its card                         |
| Comments flat in phase 1, replies in phase 2 (2026-11-06)                                                                                       | Keeps phase 1 smaller; the notice for a reply needs the Inbox first                                                               | Replies now                                                                             |
| Publishing at `/p/<token>`, read-only, with no people on it, revocable (2026-11-06)                                                             | The owner's direction. A public page should not expose names, emails or discussion                                                | Showing assignees and comments; a permanent address                                     |
| A basic Inbox: assignments, comments, being added; unread as one time per person (2026-11-06)                                                   | The owner's direction: basic notifications are enough. One time is what the kanban plugin found sufficient                        | Push and email in phase 1; read state per notice                                        |
| The Planner in phase 2 (2026-11-06)                                                                                                             | The owner's direction                                                                                                             | —                                                                                       |
| Personal keys cover the Desk only; the operator key covers everything (2026-11-06)                                                              | Shared data is read by many and by the server (activity, notices, publishing)                                                     | Per-board keys wrapped for each member, now                                             |
| Export of the Desk, a board, a workspace or everything; import always creates, matching people by email (2026-11-06)                            | The owner's direction. Creating never destroys; ids in a file mean nothing on another server                                      | Import that merges or replaces; people by id                                            |
| Comments and activity exported, not imported (2026-11-06)                                                                                       | They are a record of what people said and did, which an import cannot honestly re-create under other accounts                     | Importing them under the importer's name                                                |
| Backup commits the Desk and the workspaces the person owns (2026-11-06)                                                                         | Each workspace is backed up by its owners; a member backing up someone else's board is the owner's call                           | Everything the person can see                                                           |
| Deleting a person passes a workspace they solely owned to its longest-standing member, and deletes one with nobody left (2026-11-06)            | The owner's confirmation. Shared work carries on; nothing is kept for no one                                                      | Deleting every workspace the person owned; leaving it with no owner                     |
| Any colour for boards, labels and Desk lists, through `ColorPicker`, text on it by contrast (2026-11-06)                                        | The owner's direction for boards and labels; Desk lists follow so there is one picker                                             | Tasks' six swatches                                                                     |
| The sidebar full on index pages and a rail on the Desk and boards, toggled to rail or hidden, remembered per device (2026-11-06)                | The owner's direction for the toggle; the Desk and a board need the width                                                         | Always full                                                                             |
| The Desk's list view (the Tasks look) in phase 1, its board view in phase 2 (2026-11-06)                                                        | The owner's direction                                                                                                             | Both now                                                                                |
| The home is `/desk` for everyone (2026-11-06)                                                                                                   | The phone opens on the Desk, and navigation may not fork by viewport, so the web does too                                         | `/boards` on the web and `/desk` on a phone                                             |
| The workspace sort is saved with the account; the sidebar's state with the device (2026-11-06)                                                  | What arranges the data follows the person to every device; what shapes the screen belongs to that screen                          | Everything per device                                                                   |
| Whole-card drag with no handle on the web; between lists by menu on a phone (2026-11-06)                                                        | The kanban plugin's settled interaction model                                                                                     | A handle on every card; drag on a carousel                                              |
| The web first, laying the phone's foundations; the phone's screens in phase 2 (2026-11-06)                                                      | The owner's direction                                                                                                             | Both together                                                                           |
| An app of the suite exactly like Fjord: runs alone or hosted (2026-11-05)                                                                       | The owner's direction                                                                                                             | Hosted only, as the scaffold makes it                                                   |
| Auth identical to Fjord: better-auth, local and Sovereign, linking by `sub` from a session                                                      | The owner's direction; one set of rules across the suite                                                                          | The SDK's `nextAuth`, which needs a core                                                |
| sqld, a file or PostgreSQL, through Drizzle, as Fjord (2026-11-05)                                                                              | The owner's direction; running alone wants SQLite                                                                                 | PostgreSQL only                                                                         |
| The Desk offline-first from the first screen (2026-11-05)                                                                                       | The owner's direction: sync and conflicts in the background with no effect on the experience                                      | Server actions and a client cache; offline as a later release                           |
| Browser actions produce field-level changes; the server checks structure and stamps order                                                       | It is the only form that also works on ciphertext, and it unifies the modes                                                       | The same operations run on both sides                                                   |
| Later arrival wins per field, an edit restores a delete, and nothing asks                                                                       | The owner's direction: no conflict UI                                                                                             | CRDTs for text; conflict dialogs                                                        |
| Our own small sync, not a library                                                                                                               | It has to work over sqld, a file and PostgreSQL, on ciphertext, with AGPL-compatible parts                                        | Replicache, PowerSync, ElectricSQL                                                      |
| Opt-in personal key, wrapping per-list keys that encrypt fields, one way, unlocked once per device (2026-11-05)                                 | The owner's direction: the operator cannot read it, with no felt difference                                                       | age per field; one key for everything; Fjord's passphrase and idle lock                 |
| An `.env` operator key, which disables personal keys (2026-11-05)                                                                               | The owner's direction. Built as field encryption, the only way alike on three forms                                               | Having both at once                                                                     |
| Recurring edits apply to that occurrence and later ones, with no prompt and no new row; the checklist copied unticked (2026-11-05)              | The owner's direction, and what the model can honestly do                                                                         | The plugin's three-way prompt; real future rows                                         |
| The cards of Today and Review, and Dismiss as a `dismissedOn` date (2026-11-05)                                                                 | The owner's direction, now for the phone in phase 2                                                                               | Snooze by moving the date                                                               |
| Backup is a person's own, opt-in, to their own private repository, as a new timestamped file, only when something changed (2026-11-05)          | The owner's direction; the file is the export, so needs no tool to read                                                           | Overwriting one file; allowing public repositories; a commit on every tick              |
| Fractional positions, through `fractional-indexing` (CC0)                                                                                       | One row per move; survives offline devices and concurrent editors                                                                 | Integers with rewrite; the kanban plugin's `REAL` positions, which run out of precision |
| `series` with an anchor; one function for today                                                                                                 | Lateness stops corrupting the schedule; removes the tasks plugin's three ideas of today                                           | The rule on every row; the server's clock                                               |
| Undo through `deleted_at` on the Desk, purged in seven days                                                                                     | A mistake is recoverable with no trash to design                                                                                  | Hard delete with confirmations                                                          |
| One route tree, forking only what is rendered                                                                                                   | Sovereign's rule; ends the double mount and two data paths                                                                        | Two trees by `matchMedia`                                                               |
| Data in IndexedDB or memory, never in the service worker's cache                                                                                | Sovereign's worker rule                                                                                                           | Caching pages that hold data                                                            |
| Jobs in the web process                                                                                                                         | As Fjord decided: one image, one entry point; claims make replicas safe                                                           | A separate worker image; an external cron                                               |
