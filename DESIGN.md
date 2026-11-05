# Tasks — design

**Status:** draft, written from a review of the legacy plugin and of Fjord Web (2026-11-05). Nothing here is implemented; the repository is
still the scaffold (§5.2). Where this file and a contract Sovereign publishes disagree, the contract wins (`AGENTS.md`, Source of truth).
§21 lists what is still waiting on a decision, and §22 what has been decided and why.

[`ROADMAP.md`](ROADMAP.md) puts the work in order, and [`docs/epics/`](docs/epics/) holds each task's detail.

---

## 1. Purpose

Tasks is a private task manager for the people of a Sovereign instance or as a fully self-hosted app: a cleaner Google Tasks that you
run yourself, not a Todoist and not a project management tool. It is an app of the Sovereign suite exactly as Fjord is: a program of its own, which an
instance can host, and which needs no instance to run. It is a rewrite, from scratch, of `sovereign-plugin-tasks`. The plugin is the
starting point for what Tasks does; none of its code is carried over.

What it must not give up, whatever the convenience:

- **Simplicity is the feature.** Each addition has to reduce friction without adding something to think about. Features stay out of the
  way until someone reaches for them.
- **Private by default.** A person's lists are visible to that person alone. Sharing is something they choose, one list at a time, and
  arrives in phase 2.
- **The data stays where its owner puts it.** On their server, and in a repository of theirs if they connect one (§16). No telemetry, no
  third-party service, nothing loaded from another site.
- **A person can leave.** They can take everything with them in one file (§15), and deleting their account deletes what is held of them
  (§17).

What it is not: a project management tool, a team inbox, a Kanban board, or a place for assistants to write without being asked.

## 2. Phases

| Phase | What it delivers |
| --- | --- |
| **1** | Everything one person needs: accounts, lists, tasks and subtasks, due dates, recurrence, Today, Starred, search, bulk actions, keyboard, reminders, one-file export and import, and backup to a GitHub repository. Runs alone or hosted on an instance. This is the plugin's shipped scope with its flaws designed out, plus what running alone needs. |
| **2** | Sharing a list with other accounts, and assigning tasks. The plugin specified this and never built it. |
| **3** | Candidates, none committed: Google Tasks import, "the last Friday of the month", encrypted backups (§16.6). |

### What is carried over from the plugin

The plugin's requirement IDs are not used here: tasks get IDs of their own in the roadmap. This table is how to check nothing was lost.

| Plugin | What | Here |
| --- | --- | --- |
| TSK-01–05 | Lists and tasks, colour, cascade, title and notes | §8, §9. Colour stays a fixed set of swatches |
| TSK-06, 07 | Subtasks one level deep; completing a parent completes them | §9.2 |
| TSK-08 | Manual order by dragging | §9.3, with a different way of storing order |
| TSK-09 | Show or hide completed, per list | §9.4 |
| TSK-10–14 | Sharing, roles, ownership, assignment | §18 (phase 2) |
| TSK-15, 16 | Due date and time, overdue | §10 |
| TSK-17, 18 | Filters, search | §9.4, §12.4 |
| TSK-19–21 | Keyboard shortcuts, bulk delete and move | §13.5, §13.6 |
| TSK-22, 23, 25 | Recurrence, the next occurrence on completion, the pattern shown | §11 |
| TSK-24 | "This / this and following / all" when editing a recurring task | **Dropped:** an edit applies to this occurrence and every later one, with no question (§11.4) |
| TSK-26–28 | Star, move to a list, the Starred view | §9, §12.3 |
| TSK-29 | Account-level export, import and deletion | Deletion: §17. The rest is §15's one file |
| TSK-30 | Today's Agenda | §12.2, with its one unconfirmed delete made safe |
| TSK-31 | One-file export and import in Settings | §15 |
| — | Reminders and the morning digest | §14 |
| — | The mobile carousel, sheets and reorder | §13 |
| `tasks_views`, Kanban, Visualizer | Reserved, never built | **Dropped.** `fs.sovereign.kanban` is a product of its own |
| Offline cache in IndexedDB | Tasks persisted on the device | **Dropped** (§13.3) |
| Tenants, `sdk.db`, the plugin manifest, the scheduler, the Apps drawer | The legacy runtime's | Gone with it (§5) |

## 3. User journeys

1. **First visit, alone.** Someone runs the image with the three-line setup of §20. They make the first account, and find one list, *My
   tasks*, with the cursor in "Add a task". Sign-up is then closed unless the operator opened it (§6).
2. **First visit, on an instance.** A person opens Tasks from the launcher, signs in through core, and finds the same.
3. **Capture.** They type a title and press Enter. It appears at the top straight away. They add another without touching the mouse.
4. **Work a list.** They tick things off, drag them into order, open one to add notes, a date or subtasks.
5. **Start the day.** They are told "3 tasks due today · 2 overdue" (§14). It opens Today, where they go through each: done, keep for today,
   snooze to tomorrow, or delete, with Undo.
6. **Something that repeats.** "Water the plants" repeats every Saturday. Ticking it off makes next Saturday's. Renaming it renames this one and
   every later one, and makes nothing new.
7. **On a phone.** They swipe between lists, and a task's detail opens as a sheet. It is the same app at the same addresses.
8. **Keep a copy.** In Settings they connect a private GitHub repository and choose daily. Each day something changed, a new file
   appears under `sovereign-tasks/` (§16).
9. **Leave or move.** They download one file holding everything and import it elsewhere, or delete their account and Tasks deletes what it holds.

## 4. Terminology

| Term | Meaning |
| --- | --- |
| **Account** | Someone who can sign in to this Tasks. Known by its id, whichever way they sign in (§6). "Person" means the same, in prose |
| **List** | A named, coloured group of tasks. Belongs to one account in phase 1 |
| **Task** | A row in a list. A top-level task can have subtasks |
| **Subtask** | A task with a parent: a title, notes and a tick, and nothing else (§9.2) |
| **Due date, due time** | When a task is due, as written on a calendar, in no time zone (§10) |
| **Today** | The account's own calendar day (§10) and also the view of what needs attention (§12.2); the context says which |
| **Series** | A repeating rule, and the occurrences made from it (§11) |
| **Occurrence** | One task in a series. At most one is open at a time |
| **Backup** | One file committed to the connected repository (§16) |

User-facing text says "list" and "task", never "item"; "app", never "client" or "plugin".

## 5. Architecture

```
            browser                              server (one image, one process)
 ┌───────────────────────────┐             ┌──────────────────────────────────────────┐
 │ Next.js pages (React 19)  │    HTTPS    │ Next.js routes, server actions            │
 │ @sovereignfs/ui           │ ──────────▶ │ better-auth (§6)                          │
 └───────────────────────────┘             │ jobs: reminders, backups, purge           │
                                           └───┬──────────┬───────────────┬───────────┘
                                               │          │               │
                                 SQLite (sqld or file)  GitHub REST    a Sovereign core,
                                 or PostgreSQL (§19)    API (§16)      if one is set
```

The stack and the shape are Fjord Web's, on purpose, so that operating either is operating both:

- **Next.js with React 19**, a long-running server and not serverless, because the jobs are background work.
- **SQLite by default, in production too, and PostgreSQL if the operator prefers** (§19).
- **Jobs run in the web process**, on a timer started from `instrumentation.ts`, with `TASKS_WORKER=off` for all but one process if several
  share a database. Fjord decided against a separate worker (2026-10-31), for the same reason: a single container wants it, and a second entry
  point is a second bundle for no behaviour. Every job claims its work in the database (§14.3), so a second process running it is safe anyway.
- **The server talks to GitHub and to core.** The browser never does, and no credential reaches it.
- **One layer knows who owns what** (§7). Server actions parse their input and call it; they hold no SQL. Rules that need no database (the
  next occurrence, what Today shows, a position between two others, what "today" is) are pure functions taking the time as an argument, so they
  are tested with no clock and no database.
- **A transaction per action** of more than one statement, short, and never held across a call to GitHub or core. The plugin ran none, so a
  failure part way through a list deletion or a move left half of it done.

### 5.1 Where things go

As Fjord Web's. `app/` for routes, and `src/` for everything else, with tests beside the code.

| Path | What |
| --- | --- |
| `app/` | Routes and server actions: parse, call `src/`, return |
| `src/db/` | Configuration, the clients, the schemas per dialect, migrations at start-up (§19) |
| `src/auth/` | better-auth, its settings, the screens, the fake Sovereign for tests (§6) |
| `src/tasks/` | The store: every statement about lists and tasks, each scoped to an account (§7) |
| `src/access/` | The list of every page, route and action with who may use it (§7) |
| `src/recurrence.ts`, `src/time.ts`, `src/position.ts`, `src/today.ts` | The pure rules |
| `src/reminders/` | The job, and how a reminder reaches someone (§14) |
| `src/portability/` | The file format, and reading the plugin's (§15) |
| `src/backup/` | The connection and the job (§16) |
| `src/providers/` | The git host interface, GitHub's implementation, an in-memory one (§16.2) |
| `src/crypto/` | Credentials at rest (§16.2) |
| `src/sovereign/` | What an instance tells the app, and `People` (§17) |
| `src/mail/` | The SMTP mailer (§6) |
| `src/ui/` | The design system's client boundary, and `AppShell` |
| `migrations/` | The generated SQL: `sqlite/`, `postgres/`, `auth/` |
| `deploy/` | The Compose setups for sqld, a file and PostgreSQL, their README and `.env.example` |
| `sovereign.manifest.json` | What an instance reads to host the app (§20) |

### 5.2 What happens to the scaffold

`npm create @sovereignfs app` made an app that is hosted or nothing: sign-in through the SDK, PostgreSQL through `pg`, `lib/`. Its `lib/auth.ts`,
`lib/stores.ts`, `lib/sovereign.ts`, `lib/db.ts`, `lib/migrate.ts`, `lib/crypto.ts`, `lib/config.ts`, `app/auth/`, its notes example and `migrations/001_init.sql` are
replaced. Its manifest, Dockerfile and publish workflow are kept and changed as §20 says. This is the first task of the roadmap.

## 6. Authentication

**Identical to Fjord Web's §6, and read that for the detail.** The flows, the rules and the tests are the same; this section records what it means
here, with `TASKS_` for `FJORD_`.

Built on **better-auth 1.7**, in a store of its own (§19), with its own migrations. Which methods are offered is set by the environment, so an
instance can run either or both:

| Method | Enabled by | What |
| --- | --- | --- |
| **Local** | `TASKS_AUTH_LOCAL=1` | Email and password, passkeys, and an authenticator app with ten backup codes. Off means off: `/sign-in`, `/sign-up` and `/api/auth` answer 404 |
| **Sovereign** | `TASKS_CORE_URL`, `TASKS_CORE_CLIENT_ID`, `TASKS_CORE_CLIENT_SECRET`, all or none | OIDC against a core, through `genericOAuth`: authorization code with PKCE S256, the ID token verified against the keys discovery points to. Redirect address `<TASKS_URL>/api/auth/callback/sovereign`; scopes `openid profile email` |

- **The server refuses to start on a setting that is wrong:** a short `TASKS_AUTH_SECRET`, a non-https `TASKS_URL` (localhost aside), a partial set
  of `TASKS_CORE_*`, an SMTP host with no sender.
- **Who may sign up** is `TASKS_AUTH_SIGNUP`: `closed` by default, where the first account is made and then sign-up is refused, by the server;
  or `open`. One policy for both methods, in the user-creation hook. A self-hoster who forgets is not an open registration; an instance sets `open`,
  since there the instance decides who may sign in.
- **Email is optional.** With `TASKS_SMTP_*`, an address must be verified before first sign-in and a forgotten password is reset by a single-use link. Without it, sign-up
  is immediate and no screen offers a reset.
- **A Sovereign account is identity, not authorization.** Identity is its `sub`, stored as the better-auth account id. `email` and `name` are copied when the account is
  made and not overwritten after.
- **No implicit linking.** A Sovereign login whose email is a local account's is refused, until the person links the two from a signed-in session, and only
  when the addresses match. Unlinking can never remove an account's last way to sign in.
- **Signing out is local.** Ending a Tasks session does not end the Sovereign one.
- **Two-factor is the password's.** A person with Tasks two-factor who links Sovereign is not asked for the Tasks code when signing in through it.
- **Tested the same way:** auth flows over real requests through `auth.handler` on all three databases, a strict fake Sovereign, a recording of a real instance's discovery document, and
  every security behaviour seen to fail with it switched off. Auth pages are `force-dynamic`.

**Owner of everything is the better-auth user id** (`account_id`), not `sub`. It is in the other store, so it is not a foreign key, as in Fjord. The `sub` is looked up only for what
needs it: a notification (§14.2) and a notice from core (§17).

`/account` holds name, password, two-factor, passkeys, linking Sovereign and deleting the account, as Fjord's does. Fjord lists deleting a local account as not yet built; here it is in phase 1 (§17).

## 7. Access

**The rule: a statement that touches an account's data names the account, in that statement.** Not a check first and a write after.

```ts
db.update(task).set({ title, updatedAt: now })
  .where(and(eq(task.id, id), eq(task.ownerId, accountId), isNull(task.deletedAt)));
```

Tasks carry `owner_id` directly, so no statement needs a join to be safe. No row affected means the task is not there for this account, and the answer is the same whether it does not exist or
belongs to someone else: a 404, or an action result of `not_found`.

This closes the plugin's most serious flaw. There, an action took `(taskId, listId)`, checked the caller owned `listId`, and then updated by `taskId` alone. Anyone who knew another
person's task id could change or delete it by passing a list of their own. The same shape was in `updateTask`, `toggleComplete`, `toggleFavorite`, `setDueDate`, `setRecurrenceRule`, `deleteTask`,
`moveTask`, `bulkDeleteTasks`, `bulkMoveTasks`, `reorderTasks` and `getSubtasks`. UUIDs made it hard to exploit, not impossible. Actions here take no `listId` for authorization at all.

- **Every action and route finds the session first,** and passes the account id to the store. The store has no way to run a statement without an account; the jobs and `People` (§17) have their own narrowly named entry points.
- **Who may call what is written down once:** `src/access/routes.ts` lists every page, route and action with who may use it, and `routes.test.ts` holds it to the files, as in Fjord Web. For every action, a test seeds two accounts, calls it as the wrong one, and asserts nothing changed. A new action with no such test fails the suite.
- **A route that changes something checks `Origin`** against `TASKS_URL`.
- **Input is parsed at the edge,** whatever the types say: an action is a public POST endpoint. A title is 1 to 500 characters, notes up to 20,000, ids are UUIDs, a date is a real date, a time is `HH:MM`, a rule passes §11.2. Arrays are capped at 500. The database repeats the ones it can as `CHECK`s.
- **Limits exist so one account cannot fill the server:** 200 lists an account, 5,000 open tasks a list.

## 8. Lists

- Create, rename, delete, recolour, drag into order. A first visit makes *My tasks*, so there is always somewhere to type.
- Colour is one of the six swatches (`black`, `grey`, `green`, `blue`, `amber`, `red`), mapped to `--sv-*` tokens. New lists are `black`. It is the one splash of colour in a monochrome interface, and appears only as the small dot.
- Deleting a list asks first (`ConfirmDialog`), naming how many open tasks it holds, and takes its tasks with it. It can be undone (§9.5).
- Deleting a list's completed tasks is one action, from the list's menu.
- Counts of open top-level tasks come from one `GROUP BY` over the account's own lists. The plugin read every open task of the whole tenant to count them in JavaScript.

## 9. Tasks

### 9.1 A task

A title, optional notes (plain text; shown as written, with links not made live in phase 1), a star, a due date and optional due time, optionally a series, and subtasks. A new task goes at the top of its list.

Moving a task to another list takes its subtasks with it, in one transaction, and the task goes to the top of the destination.

### 9.2 Subtasks

One level deep. The plugin's spec said "at the app layer", and `createTask` did not actually check. Here the insert is conditional on the parent, in one statement: `INSERT ... SELECT` from a parent row that belongs to this account, is top-level and is not deleted, taking its list. No row means refused. A subtask has a title, notes and a tick. It has no due date, star or series, so a `CHECK` refuses those. That is what the plugin's interface offered too, and it keeps Today and reminders about top-level tasks.

Completing a parent completes its open subtasks, and leaves the completion time of those already done (the plugin overwrote them). Reopening a parent reopens nothing. Ticking the last subtask does not complete the parent: finishing the parts is often not finishing the thing. A row shows progress as a small ring.

### 9.3 Order

Order is a **position**: a string that sorts between its neighbours (fractional indexing, compared byte by byte: §19 says how, on each dialect). Moving a task writes one row. The plugin stored integers, and every drag rewrote every row in the list, in parallel, with no transaction. One row per move is simpler, and it is what makes two people reordering a shared list in phase 2 survivable.

Under "Custom" order, tasks that are overdue or due today float to the top of the list (a partition, not a change to their position), and are in position order among themselves. Dragging is computed against what is on the screen, then translated to a position between the visible neighbours; that is the bug the plugin carried for months (§13.7).

### 9.4 Seeing a list

- **Filter:** All, Active, Overdue. Completed tasks are a collapsible section at the bottom, whose open or closed state is remembered per list.
- **Sort:** Custom, Date created, Due date, Title. **Remembered per list,** unlike the plugin, which reset it on every navigation. Dragging is available only under Custom.

### 9.5 Delete, and undo

The plugin's deletes were final, including its swipe-down in Today, which deleted at once with no confirmation, because the card's animation had already committed. Here **every delete offers Undo** in a toast, for about ten seconds.

Deleting sets `deleted_at`, on a task or a list alike. Everything reads the rows where it is null, through the store (§7). Undo clears it. A job removes rows deleted more than seven days ago, so nothing lingers. There is no trash to browse: this is the smallest thing that makes a mistake recoverable. Account deletion and that job are the only hard deletes.

## 10. Dates and time

The plugin had three ideas of "today": the server's local date in some paths, the browser's in others, and a stored zone in the reminder job. So overdue styling had to be rendered only on the client to avoid mismatches, and a recurring date passed through its own UTC helpers. Here there is one:

- **A due date and time are floating:** "Saturday at 09:00" as written on a calendar, stored as `YYYY-MM-DD` and `HH:MM` text, in no zone. Compared as strings, which sort chronologically, on both dialects. Someone who flies somewhere still has it due Saturday at 09:00 where they are. Google Tasks behaves this way, and so did the plugin.
- **An account's time zone is `account_settings.time_zone`.** The browser reports `Intl.DateTimeFormat().resolvedOptions().timeZone` when a page loads, and the stored value is updated when it differs. It is validated, and an invalid one falls back to UTC. (The plugin captured it only when notification settings were saved, so a person who moved kept getting their digest in the old zone.)
- **`todayFor(zone, now)` in `src/time.ts` is the one way to know what day it is,** on the server as much as in the jobs. Server-rendered pages can therefore say "Overdue" correctly, with no hydration mismatch. The very first page, before the browser has reported, may be a day off for a moment and corrects itself.
- **Displayed in the browser's locale:** "Today", "Tomorrow", "Mar 5", and times in the locale's 12- or 24-hour form.

The due date picker offers Today, Tomorrow and Next week, then `Calendar` from `@sovereignfs/ui` (the plugin's own month grid predates it), and a time once a date is set. Time zone is not something anyone is asked about.

## 11. Recurrence

### 11.1 The model

A series is a rule and an anchor date. **One occurrence is open at a time**, as in the plugin and in Google Tasks: completing it makes the next. Occurrences are ordinary tasks, so they filter, sort and show up in Today with no special cases.

Completing an occurrence is one transaction, guarded with `WHERE completed_at IS NULL`, so a double-tap does one thing. The plugin had no guard: complete, reopen and complete again made two next occurrences. A partial unique index (§19) refuses it at the bottom as well.

The next occurrence copies the title, notes, star, due time and list, takes the same position, and has **its subtasks copied, unticked**. If the rule has ended (`UNTIL` or `COUNT`), there is none.

### 11.2 The rule

Stored as an RFC 5545 `RRULE` string with no `DTSTART`, computed with the `rrule` package, inside `src/recurrence.ts` alone.

The plugin passed whatever string the browser sent to the database, where a bad one failed only at the moment someone completed the task. Here the server parses a rule against an allow-list before storing it: `FREQ` (daily to yearly), `INTERVAL` (1 to 999), `BYDAY` (plain weekdays, weekly only), and one of `UNTIL` or `COUNT`. Nothing else, 200 characters at most.

The picker offers: Daily, Weekdays, Weekly, Monthly, Yearly, and Custom (every N units, on chosen weekdays, ending on a date or after N). The task row shows a short form ("Weekly", "Every 2 weeks") and the detail the full one ("every week on Monday, Wednesday").

`rrule` works in UTC, so a date crossing into it must go through `Date.UTC` and come back through `getUTC*`. Doing otherwise moves `BYDAY` matches by a day on a server east of Greenwich, as the plugin learned. Tests run under more than one `TZ`.

### 11.3 What the next date is

Two flaws of the plugin's are designed out, by keeping the date the rule gave separately (`occurs_on`) from the date it is due (`due_date`):

- **Snoozing does not move the series.** The plugin computed the next date from the current due date, so snoozing a monthly task from the 1st to the 3rd moved it to the 3rd for good. Snooze, in Today (§12.2), changes `due_date` only, and the next date comes from `occurs_on` and the anchor.
- **A task done late does not leave a trail.** The plugin's daily task, ticked a week late, made one due yesterday. Ticked again, the day before, and so on. The next occurrence is the first one after whichever is later: `occurs_on`, or today for that account.

Setting a repeat on a task with no due date gives it one: the first date the rule matches from today. The plugin silently never made a next occurrence for such a task, and its interface did not say so.

### 11.4 Editing

**An edit to a recurring task updates it in place, applies to that occurrence and every later one from that moment, and duplicates nothing.** There is no prompt. No row is added by editing, and completed occurrences are history and are never changed.

| Edit | What happens |
| --- | --- |
| Title, notes, star, due time, subtasks | The open occurrence changes, and the next is copied from it |
| The rule | The series' rule is replaced, and the anchor set to this occurrence's date |
| The due date, in the detail | This occurrence moves and the series moves with it: the anchor and `occurs_on` become the new date, and a weekly rule on one weekday moves to the new weekday. Every later occurrence follows |
| "Does not repeat", or clearing the due date | The series ends, and this stays as a one-off |
| Snooze, in Today | This occurrence only (§11.3), since snoozing is not an edit to the task |

The plugin's prompt looked like a choice, but with one open occurrence there were no future rows to choose between. "This task only" was not true, since the next occurrence copied the edit anyway. "This and following" was in effect the same one row. "All" went back and rewrote completed rows' titles.

### 11.5 Reopening, moving, deleting

Reopening a completed occurrence when the next is untouched removes that next occurrence, so Undo after a tick leaves things as they were. If the next has been changed, the reopened task leaves the series and becomes a one-off, and nothing is lost.

Moving an occurrence to another list moves the series with it, since the next is copied from it. Deleting the open occurrence ends the series, because nothing is left to make the next from, and Undo brings it back. A job removes a series with no occurrence left.

## 12. Views

### 12.1 Addresses

| Address | What |
| --- | --- |
| `/` | A landing page for someone not signed in, static, as in Fjord. Signed in, the first list, by a rewrite in `proxy.ts` |
| `/sign-in`, `/sign-up` | §6 |
| `/lists/<id>` | A list. `?task=<id>` opens a task's detail, so it can be linked to and reloaded |
| `/today` | §12.2 |
| `/starred` | §12.3 |
| `/search?q=` | §12.4 |
| `/settings` | Reminders, backup, export and import |
| `/account` | §6 |

A list that is not there for this account is the app's `not-found.tsx`, with a way back. Every page has an `error.tsx` and `loading.tsx` above it. No route depends on an id being unable to collide with a word, which the plugin's `/tasks/[listId]` relied on for `starred`.

### 12.2 Today

Every open top-level task that is overdue, due today, or starred, across the account's lists: overdue first (oldest first), then due today (by time, no time last), then starred (by title). A task in more than one of those shows once. **Which tasks and in what order is decided on the server,** by `todayFor` and a pure function.

On a phone and with a pointer it is a `SwipeStack`, one card at a time:

| Gesture | Also a button | What it does |
| --- | --- | --- |
| Up | Done | Completes it (a repeat makes its next) |
| Right | Today | Due today. Takes an overdue task off overdue |
| Left | Tomorrow | Due tomorrow |
| Down | Delete | Deletes it, with Undo (§9.5) |

The buttons are always there: a gesture is never the only way (§13.5). A failed action says so and offers the card again. The stack ending says so, with a link back to the lists.

### 12.3 Starred

A view over starred top-level tasks, by due date with undated last, each showing its list. It owns no row and takes no new tasks, drags or bulk actions; everything else about a row works as in a list. One component, not a fork.

### 12.4 Search

Titles and notes, across the account's lists, including subtasks shown under their parent's name, newest change first, 50 at most. `lower(title) LIKE lower(?) ESCAPE '\'`, with `%`, `_` and `\` escaped, and scoped in the statement. The plugin escaped nothing, so `%` matched everything, and it took 50 rows of the whole tenant before filtering to the person's own, so other people's tasks could push theirs out of the results. SQLite's `lower` folds ASCII only, so a search for "É" matches case exactly there; stated, and accepted, since neither dialect's full-text search is portable.

## 13. Interface

### 13.1 Principles

Everything comes from `@sovereignfs/ui` and its `--sv-*` tokens: monochrome, with colour only on a list's dot. What is reusable and missing is added there, in `sovereign`, not built here (the plugin's `CalendarGrid` and its own overlays were this mistake). The design system comes through `src/ui`, as in Fjord Web.

### 13.2 One set of routes

The plugin rendered two different component trees depending on `matchMedia`, each with its own data, and both mounted briefly on every cold load. Sovereign's rule is the fix: **never fork a navigation decision by viewport; fork only what is rendered.** Addresses, data and actions are the same at every width.

- **Above 768px:** `ThreeColumnLayout`: lists, tasks, and the detail column when a task is open.
- **At 768px and under:** `SwipableMobileCarousel`, with `useCarouselRouteSync` mapping a slide to an address: the Lists index, Starred, then one slide per list. Opening the app lands on the first list, and the footer reaches Today and search. Swiping changes the address. Task detail and list editing are `Sheet`s, and the date and repeat pickers use the design system's adaptive surface (`Popover` above, `Drawer` under).
- **The shell:** `AppShell`, as in Fjord Web: the app's name, and the account's avatar and menu. When a core is set, a way back to it. The plugin's own Apps drawer is gone, since an app does not list the others.

### 13.3 Data in the browser

Pages render on the server. A client store holds what the current view shows, seeded from the server's props, and every action **returns the rows it changed**, which the store takes as the truth. So:

- An action applies at once on screen, then reconciles with its answer, and rolls back with a toast on failure.
- It does not depend on `router.refresh()` arriving in time. The plugin's optimistic state was discarded when the transition settled and before the refresh landed, which caused "add task does nothing", the snap-back after a drag, and much of its later patching.
- On a phone the neighbouring slides' tasks are fetched ahead, so one swipe shows no spinner, and refreshed when the tab regains focus if over a minute old.

**Nothing of a person is stored on the device** beyond the current page's memory. The plugin persisted task lists in IndexedDB to make cold starts instant; Sovereign's service worker rule is that nothing per-person is stored, and a shared computer is the reason. If cold starts prove slow, that is an RFC.

### 13.4 A row

A checkbox, the title, the list dot where lists are mixed, the due date (in the danger colour when overdue), a repeat icon, subtask progress and a star. Clicking the row opens the detail; the controls in it keep their own click. The detail edits title and notes, saving as you leave the field, and shows the date, repeat, list, subtasks and Delete.

### 13.5 Gestures, keyboard, and access

**A gesture is always a shortcut for something visible.** On a touch screen:

- Swiping horizontally moves between lists. It belongs to the carousel.
- **Reordering starts from a visible handle** at the row's edge, with a long press. The plugin tried a long press anywhere on the row, which fought the carousel, then an invisible handle, then a toast explaining the invisible handle.
- Long-pressing the row body enters selection.
- Row swipe-to-reveal (Done, Delete) uses `useSwipeReveal`, from a zone that does not fight the star.

With a keyboard, attached to the page and ignored while typing or with a modifier held: `n` new task, `j` and `k` or arrows to move, `e` to complete, `Enter` to open, `[` and `]` for the previous and next list, `Esc` to clear a selection, `?` to list them.

Accessibility is a condition of each task's being done, not a later pass (the plugin left it to a v1.0 that never came): WCAG 2.2 AA, keyboard reordering through dnd-kit's `KeyboardSensor` plus Move up and Move down in a row's menu, labelled icon buttons, real focus handling in sheets and dialogs, and honouring reduced motion.

### 13.6 Bulk

Ctrl- or cmd-click, or a long press, starts selection, since the row's checkbox already means complete. A bar shows the count, with Complete, Move to list, Delete and Cancel (Complete is new). Each is one action on all the ids, in one transaction, scoped to the account (§7).

### 13.7 What the plugin paid to learn

Each of these cost a release there. They are written here so they are not paid for twice.

- **Drag indices are against what is rendered,** never the full array: filters, sort and the pin to the top all make the two differ.
- **dnd-kit's auto-scroll will scroll the carousel sideways** in the middle of a reorder unless told to scroll only vertical containers (`canScroll`). Each `DndContext` needs an explicit `id`, or SSR and hydration disagree.
- **`transform` on an ancestor makes it the containing block for `position: fixed`,** so a `Drawer` inside it renders squashed. Use `backface-visibility` if a sticky element needs its own layer.
- **`overscroll-behavior-y: none`, not `contain`,** on scrolling columns: in WebKit `contain` keeps the element's own bounce, and a sticky header rides down with it. Chromium does not show this; test on real WebKit.
- **`<Link replace>` to the same path with another search param does nothing** on a mounted route. Closing the detail uses `router.replace`.
- **Sticky headers need an opaque background and a `z-index` above the rows',** which set their own on mobile for swiping.
- **A one-time hint needs its claim set synchronously** if several instances of a component can mount at once.
- **A self-rendered mobile footer must set `--sv-shell-footer-height`,** or `Sheet` and `Drawer` slide beneath it.
- **Touch behaviour is not testable in Chromium's tooling.** A change to gestures or scrolling is checked in the iOS Simulator, and says so in its PR.

## 14. Reminders

### 14.1 What is sent

Off until a person turns it on in Settings, where they also choose the morning time. Then:

- **A morning digest,** once per local day at or after their time: "3 tasks due today · 2 overdue", linking to `/today`. Nothing on a day with nothing to say.
- **A reminder at a task's due time,** one per task, linking to the task.

A due time passed while the app was down is sent on the next tick of the same day. One missed by a whole day is not; it is in the next digest.

### 14.2 How it reaches someone

| The account | Reminder goes to | Needs |
| --- | --- | --- |
| Has a Sovereign identity linked | Core's bell, by `sv.app.notifications.send` to its `sub` | `TASKS_CORE_*`, and the app scope `notifications:send`, which an operator gives |
| Has none | **Nothing, for now.** Settings says reminders are not available, rather than letting someone turn on what will never arrive. No email in phase 1, on any server | — |

- **`@sovereignfs/sdk` is used for this and for checking core's notices,** and for nothing else; sign-in is better-auth's. An app token involves no person, so it needs none of the SDK's session or token stores.
- **Core's bell does not reach a phone or a closed browser:** core has no push yet ("No push in Phase 2"). The plugin had Web Push through the legacy platform, so this is a step back until core's relay exists. Settings says so.
- **An operator who has not given `notifications:send`:** Settings says reminders are unavailable on this instance. The job finds this from the error, logs it once, and tries again rarely.
- **A task's title goes to core** in its reminder. An operator cannot read a person's notifications there (core-app §4.1), but it is stored in one more place, and the Settings copy says so.

### 14.3 Exactly once, as near as can be

The job runs once a minute. Any process may run it, and **the database decides who sends:** each send is a conditional update, and only the process whose update returned a row sends. The digest sets `last_digest_on = today` where it is null or earlier. A reminder sets `reminder_sent_at` where it is null. No lock: nothing here needs one, and SQLite has none.

Core's `key` on the send (`digest-2026-11-04`, `due-<id>-<date>`) means sending again within a day is the same send. The plugin claimed, sent, and lost the notification if the send failed. Here a failed send **releases the claim** and the next tick tries again, and the key makes that safe even if the first send arrived and only its answer was lost.

### 14.4 The query

Zones are not portable SQL, so the job reads the distinct zones of accounts with reminders on, works out the local date and time of each in JavaScript, and runs one statement per zone, using a partial index over open tasks with a time and no reminder sent. The plugin looped with several statements per person. Sends are made with a small concurrency, and core's limits are respected: 600 a minute for the app and 60 an hour per person, with `429` and `Retry-After` honoured by leaving the rest to a later tick. One person's failure never stops the next person's.

Any change to a due date or time clears `reminder_sent_at`, through the store's one `setDue`; there is no other way to write them.

## 15. Export and import

One JSON file, from Settings, either way. That is the whole of portability: there is no bulk migration from the plugin, and core's account-level export is "later" (sdk §10).

```json
{ "format": "sovereign-tasks", "version": 1, "exportedAt": "2026-11-04T09:00:00Z",
  "lists": [ { "id": "…", "title": "…", "color": "blue", "position": "a0", "sort": "custom", "showCompleted": false,
               "tasks": [ { "id": "…", "parentId": null, "title": "…", "notes": null, "starred": false, "dueDate": "2026-11-08",
                            "dueTime": null, "seriesId": "…", "occursOn": "2026-11-08", "position": "a1", "completedAt": null, "createdAt": "…" } ] } ],
  "series": [ { "id": "…", "rule": "FREQ=WEEKLY;BYDAY=SA", "anchor": "2026-11-08" } ],
  "settings": { "reminders": true, "morningTime": "08:00" } }
```

- **Everything of theirs,** completed tasks included; not what was deleted, nothing about reminders having been sent, and no backup connection or credential.
- **Written deterministically:** ordered by id, so that two exports of the same data differ only in `exportedAt`. §16.4 relies on it.
- **Import is additive and in one transaction.** It never replaces anything, every id is made new, and a file that fails validation changes nothing. It says what it found ("3 lists, 214 tasks") and asks before writing: importing twice would otherwise silently double everything, which the plugin handled with a sentence beside the button. Existing settings are not overwritten.
- **Limits:** 50 MB, and the same limits on each field as anywhere else (§7). A file is untrusted input: rules go through §11.2. The file comes through a route handler reading a bounded stream, since a server action's body is limited to far less.
- **It reads the plugin's file too,** `{ pluginId: "fs.sovereign.tasks", schemaVersion: 1, data }`, so that people on the plugin have a way across without anything more. Epoch seconds become times, integers become positions, each series gets an anchor from its open occurrence, `views` and `reminderSentAt` are ignored, and `assigneeId` is dropped.

## 16. Backup to GitHub

A person can connect a GitHub repository of theirs, and Tasks commits their data to it, as a new file each time.

### 16.1 What a person does

In Settings, under Backup:

1. **Connect a repository** (§16.2).
2. **Choose a mode:**

| Mode | What it does |
| --- | --- |
| `manual` | Only when they press **Back up now** |
| `auto` | On a frequency they choose: every hour, every 6 hours, daily (the default) or weekly. **Back up now** still works |

3. See the state: the repository, the last backup with a link to the file on GitHub, the next, and what went wrong if something did. Change the mode or disconnect at any time.

### 16.2 Connecting, as Fjord does

The connection is Fjord Web's §7, for one repository per account:

- **Two ways in.** **The GitHub App** (`TASKS_GITHUB_APP_*`, preferred where the operator has set it up): the person installs it and chooses the repository; *Contents: read and write* and *Metadata: read* only; short-lived installation tokens, with no token kept. **A repository address and a fine-grained personal access token**, limited to that repository with *Contents: read and write*.
- **Checked before anything is kept,** in the order a person would fix things: GitHub accepts the token; it can see the repository; **the repository is private** (§16.5); the default branch has something in it; and the token can write, by `canWrite`, which tries something that changes nothing, since a repository's reported permissions are not to be trusted. Each refusal is a message of ours saying what to do, never GitHub's text, never the token. An empty repository is refused with "add a README first", as in Fjord.
- **Credentials at rest** are `src/crypto/`, as Fjord's: envelope encryption under `TASKS_ENCRYPTION_KEY`, bound to the row and purpose, with rotation by restart through `TASKS_ENCRYPTION_KEY_PREVIOUS`, and a server that refuses to start rather than lose one quietly. Without a key, Settings says why a repository cannot be connected.
- **A git host is reached only through `Provider`** (`src/providers/`), tested as Fjord's is: one contract, over a fake whose storage is a real git repository, an in-memory one the app is tested against, and GitHub's real answers recorded. Tasks needs a small part of it: `getRepository`, `canWrite`, `getHead` and `commit`. `TASKS_GITHUB_API_URL` covers an Enterprise Server. **Credentials never appear in an error, a log or a URL.**

### 16.3 What is committed

```
sovereign-tasks/2026-11-05_14-30-00.json
```

- **On the default branch,** under a folder `sovereign-tasks` at the repository's root, made by the first commit if it is not there. Other files in the repository are never touched.
- **The name is `YYYY-mm-dd_hh-mm-ss` in UTC,** when the backup was made, so that names sort in order whatever the account's time zone or daylight saving is doing. The extension is `json`.
- **The file is §15's export, exactly.** So a backup needs no tool of ours to read, and is imported as any other file: to restore, download it from GitHub and import it in Settings. Import is additive, so restoring is for an empty account, or knowing it adds; it says what it found before writing.
- **The commit** is one file, made the way Fjord makes one (blobs, a tree on the head's, a commit, a fast-forward), **never forced**, with the message `Tasks backup 2026-11-05 14:30:00 UTC`, authored by the identity of the token or App.
- **Nothing is ever deleted or rewritten.** Each backup is a new file, and Tasks does not prune. A person who wants fewer removes them in git.

### 16.4 Running it

- **Auto backups are a job,** in the same timer as §14. A connection has `next_backup_at`; a process claims it by a conditional update, moving it on, so that one process does it. The data is read in a short transaction and closed; GitHub is called outside it.
- **Nothing changed, nothing committed.** An auto backup compares a hash of the file, with `exportedAt` removed, against the last one's, and if they match it only records that it looked. Daily backups of a quiet account do not make daily commits. **Back up now** always commits, since someone asked. It is limited to once a minute.
- **A branch that moved** (`head_moved`) is read again and tried once more in the same run: nothing conflicts, since the path is new.
- **A write is never retried on a lost answer,** as in Fjord: the commit may have happened. The next backup is a new file, so the worst case is one file too many, and the hash check treats it as last-known only if the commit was confirmed.
- **Failures are kept and shown:** the kind of failure, when, and how many in a row. A network failure or rate limit tries again at the next due time. A token that stopped working, a repository gone, or one made public **stops auto backup**, says so in Settings, and tells the person by §14.2's channel once. It never spins against GitHub.
- **Size:** the 50 MB limit of §15 holds here too, so a backup is never a file that could not be imported. Over it, the backup is refused and says so.

### 16.5 Privacy

The file is **plain text**, with everything the person wrote, on GitHub's servers. So:

- **Only a private repository can be connected,** and each backup checks again, stopping if it has become public. The instance's operator does not choose this for anyone, and Settings says plainly what is being sent and where.
- **It is each person's own choice and own repository.** Nothing is backed up unless they connect one. An operator backing up the whole server is a different thing, and is their database's backup (§20).
- **Disconnecting** deletes the connection and its credential. **Deleting an account** does the same (§17). Neither touches the repository: what was committed is theirs, and remains. The account deletion screen says so.

### 16.6 Not in phase 1

Encrypting the file before it leaves (`age`, as Fjord's vaults do), a list of backups in the app with restore from there, GitLab or another host, and a choice of branch or folder.

## 17. Account deletion and signing out

**`People.deletePerson`** (`src/sovereign/people.ts`, as Fjord's) deletes everything of an account: tasks, lists and series, including what was soft-deleted; settings; the backup connection and its credential; rate counters; passkeys, two-factor, sessions and sign-ins; the account. It is one routine, safe to run again: the row linking a `sub` to the account goes last, so a run that stopped can find the account. A test seeds one row of every table and finds nothing of that account after. A new table that holds something of a person fails it until it is included, and each rule is seen to fail with it removed.

It is reached two ways:

- **From `/account`,** after the password or, for a Sovereign-only account, a fresh session. It says what will go, and that a backup repository will not.
- **From core's account-deleted notice,** when a Sovereign identity is linked: a signed token in a form, `POST`ed to `/api/sovereign/account-deleted`, checked by the SDK (`verifyAccountDeletedToken`), and answered `200` only once done, as app manifest §4 requires. Core retries for 30 days. An account that Sovereign was linked to with a password or a passkey is deleted whole, as the notice asks.

**Back-channel logout** is `/api/sovereign/backchannel-logout`, checked the same way, and ends all of the person's sessions. Both routes read a bounded form, count requests against one limit, refuse a replayed `jti`, and are 404 where Sovereign sign-in is not set up.

Removing the app's access in core leaves the data; the person can come back.

## 18. Sharing (phase 2)

Outlined here so phase 1 does not preclude it. It gets its own RFC before it is built.

- **A list can be shared with other accounts on this server,** as Fjord shares documents (its §12). No links and no guests. How an account is found is for the RFC: an instance can offer `directory.searchUsers` (the `directory` scope), and a server running alone cannot.
- **Roles:** one owner, and members. A member reads and edits tasks. Only the owner renames, deletes or shares the list. A member can leave; an owner must transfer or delete first. Ownership transfer is one transaction.
- **Assignment:** a task may be assigned to a member. Removing a member unassigns theirs. Assigning tells them, by §14.2.
- **What changes:** a `list_member` table; §7's scoping becomes "a member of the list" in the store's one place, with `owner_id` on a task replaced by the list's; and `position`, `sort` and `show_completed` on a list move to per-account. Reminders go to the assignee, or the owner if nobody. A backup holds what the account owns.
- **When an owner's account is deleted,** a shared list passes to its longest-standing member, and goes if it has none. A deleted member's assignments are cleared, and the tasks stay.
- **A recurring task on a shared list** is the open question for that RFC.

## 19. Data model and database

### 19.1 Database

**As Fjord Web's §14, and read that for the detail.** `TASKS_DB_DIALECT` is `sqld` (the default), `sqlite` or `postgres`, read in one place; nothing infers it from a URL.

| Dialect | Address | For |
| --- | --- | --- |
| `sqld` (**default**) | `TASKS_SQLD_URL`, with `TASKS_SQLD_ADMIN_URL` | Most installs. Namespaces `tasks` and `tasks_auth`. sqld 0.24.33 or later, since earlier ignore `x-namespace` |
| `sqlite` | `TASKS_SQLITE_URL`, `file:/data/tasks.db` | The smallest self-host: one container. Auth is `tasks_auth.db` beside it. Never on a network filesystem. Needs a glibc image |
| `postgres` | `TASKS_POSTGRES_URL` (or `_FILE`), `PGSSLROOTCERT`, `TASKS_POSTGRES_POOL_MAX` | An operator who prefers it, and what an instance gives. Schemas `tasks` and `tasks_auth` |

- **Drizzle, a schema and a migration set per dialect,** generated with `pnpm db:generate` and never written by hand or `push`ed, applied at start-up. CI fails if generating would write anything. A **parity test** checks that the two dialects declare the same tables, columns and indexes.
- **Portable by rule:** standard SQL only, values bound, raw SQL through one small helper. **No `LISTEN/NOTIFY`, no trigger, no extension.** The dialect is chosen at install time; moving between them is §15's file, per account.
- **No foreign keys and no cascades in the app store,** as in Fjord: `account_id` is in the other store, and SQLite's enforcement depends on a per-connection setting. Every deletion names what it deletes, in a transaction, which is what `People` (§17) tests.
- **At start-up,** in `instrumentation.ts`, before anything is served, and it does not start if it cannot. Concurrent starts are safe: PostgreSQL takes an advisory lock on one pinned connection, and SQLite retries. So the manifest declares `database: true`, with no pooling, as Fjord's does.
- **Tested on every form, from the first task.** A data-layer test runs on sqld, a `file:` database and PostgreSQL in CI, and one that passes on only one is not done. Tests read `TASKS_TEST_*` and never the app's variables, so that `pnpm test` can never wipe a developer's data.

### 19.2 Representations

One per type, through the column vocabulary (`src/db/schema/*/columns.ts`), so that no table names a dialect's own type:

| Value | Stored as |
| --- | --- |
| Id | Text, a UUID made by the app |
| Time | `epochMs`: a 64-bit integer, a `number` in JavaScript |
| Boolean | The vocabulary's word, `0/1` on SQLite and `boolean` on PostgreSQL |
| Date, time of day | Text, `YYYY-MM-DD` and `HH:MM` (§10) |
| Position | Text compared byte by byte: SQLite's default `BINARY`, and `COLLATE "C"` on PostgreSQL, which the vocabulary's `position` word declares |

### 19.3 Tables

Beyond better-auth's (`user`, `session`, `account`, `verification`, `two_factor`, `passkey`, `rate_limit`, in the auth store):

| Table | Holds |
| --- | --- |
| `account_settings` | `account_id` (primary key), `time_zone`, `reminders`, `morning_time`, `last_digest_on` |
| `list` | `id`, `owner_id`, `title`, `color`, `position`, `sort`, `show_completed`, `deleted_at`, `created_at`, `updated_at`. `CHECK`s on title's length, colour and sort |
| `task` | `id`, `owner_id`, `list_id`, `parent_id`, `title`, `notes`, `starred`, `due_date`, `due_time`, `series_id`, `occurs_on`, `position`, `completed_at`, `reminder_sent_at`, `deleted_at`, `created_at`, `updated_at` |
| `series` | `id`, `owner_id`, `rule`, `anchor`, `created_at` |
| `backup_connection` | `account_id` (primary key), `kind` (`token` or `app`), `repository`, `branch`, `credential_id`, `mode`, `frequency`, `next_backup_at`, `last_backup_at`, `last_backup_path`, `last_hash`, `failure_kind`, `failures`, `stopped_at`, `created_at` |
| `credential` | As Fjord's: `id`, `purpose`, `kek_id`, `wrapped_key`, `ciphertext`, `created_at`, `rewrapped_at` |
| `rate_bucket` | As Fjord's: a key, when the window began, a count. Back up now, core's notices and their replay |

On `task`:

- `CHECK (due_time IS NULL OR due_date IS NOT NULL)`, `CHECK (series_id IS NULL OR due_date IS NOT NULL)`, and `CHECK (parent_id IS NULL OR (due_date IS NULL AND series_id IS NULL AND NOT starred))`.
- **A partial unique index on `series_id` where it is set, `completed_at` is null and `deleted_at` is null: one open occurrence in a series.** This is what makes a double-tap unable to make two. Both dialects have partial indexes.
- Indexes follow the queries: open tasks by list and position, an account's starred tasks, and a partial index for the reminder job.

## 20. Security, deployment, testing

### Security

Beyond §7: a strict Content-Security-Policy with a per-request nonce and the usual hardening headers from `proxy.ts`; no `'unsafe-inline'` in `script-src`. Nothing third-party loads, and fonts are self-hosted at build. Task text is rendered as text, never as HTML. Logs hold no titles, notes, tokens or file contents: an id and a kind of failure. A security review of phase 1 is written up before its release, as Fjord's are.

### Licence

AGPL-3.0-or-later, since it bundles `@sovereignfs/ui`. A dependency's licence must be compatible.

### Deployment

One image, and three ways to run it, as Fjord:

```bash
# The smallest: one container, a file, no other service
docker run -v tasks:/data -e TASKS_DB_DIALECT=sqlite -e TASKS_SQLITE_URL=file:/data/tasks.db \
  -e TASKS_URL=https://tasks.example.com -e TASKS_AUTH_LOCAL=1 -e TASKS_AUTH_SECRET=… -e TASKS_ENCRYPTION_KEY=… ghcr.io/sovereignfs/tasks
```

- **`deploy/`** has Compose files for sqld (the default), a file and PostgreSQL, with a README and `.env.example`. `scripts/deploy-check.sh` brings each up from nothing in CI, and a fourth as an instance hosts it.
- **Hosted on an instance:** `sv app add`, from the manifest. Tasks remains a program of its own, and its only ties are `@sovereignfs/ui`, its sign-in through core, and the two conventions the toolkit reads.
- **The manifest,** changed from the scaffold's, as Fjord's is: `"database": true`; the redirect `/api/auth/callback/sovereign`; `backChannel` and `accountDeleted` as in §17; scopes `openid profile email`; an `icon` and a real `description`; `generate` of `TASKS_AUTH_SECRET` and `{ "name": "TASKS_ENCRYPTION_KEY", "bytes": 32 }`; and `core` of at least 0.62.0, for notifications. `src/sovereign-manifest.test.ts` holds it to the schema and the code.
- **What an operator of an instance sets:** `TASKS_AUTH_SIGNUP=open`, the app scope `notifications:send`, and the GitHub App if they want it. The README says so.
- **Releases:** a `vX.Y.Z` tag publishes the image for amd64 and arm64 to `ghcr.io`, as the scaffold's workflow does. A patch release carries no migration and no change to a setting.
- **The operator's backups are the database's:** a snapshot of the sqld volume, Litestream or `.backup` for a file, `pg_dump` for PostgreSQL. A person's backup (§16) is not a substitute, nor the reverse. `TASKS_ENCRYPTION_KEY` is kept with secrets, apart from those backups.

### Testing

- **Vitest,** with pure rules tested directly and the store on all three databases (§19.1). A rule that was hard to get right is seen to fail with it switched off.
- **Sign-in** against the fake Sovereign (§6). **Core's services** against `createFakeCore` from `@sovereignfs/sdk/testing`, including `core.fail(...)` for the reminder job, a lost answer included.
- **Backups** against `MemoryProvider` for the app, and the provider contract as §16.2 says.
- **Recurrence** with property tests, run under more than one `TZ`. **Time** by passing it in; no fake timers are needed.
- **Playwright** for what only a browser can show, and **the iOS Simulator** for gestures (§13.7).
- A dev **seed** covering overdue, due today, repeating, starred, subtasks at each state, long titles and an empty list, as the plugin's `scripts/seed.ts` did.

## 21. Open questions

Each has a recommendation, and this document is written as though it were accepted.

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | **Google Tasks import** (Takeout's JSON), the plugin's "v1.1 candidate"? | Phase 3. |
| 2 | **Nth weekday of a month.** The plugin deferred it as the hardest picker for the fewest cases. | Stay deferred to phase 3. The rule format already allows for it. |

## 22. Decision log

| Decision | Why | Rejected |
| --- | --- | --- |
| An app of the suite exactly like Fjord: runs alone or hosted (2026-11-05) | The owner's direction | Hosted only, as the scaffold makes it |
| Auth identical to Fjord: better-auth, local and Sovereign, linking by `sub` from a session | The owner's direction; one set of rules across the suite | The SDK's `nextAuth`, which needs a core |
| sqld, a file or PostgreSQL, through Drizzle, as Fjord (2026-11-05) | The owner's direction; running alone wants SQLite | PostgreSQL only, which this design first proposed |
| A recurring edit applies to that occurrence and later ones, with no prompt and no new row (2026-11-05) | The owner's direction, and what the model can honestly do | The plugin's three-way prompt; real future rows |
| Subtasks are copied to the next occurrence, unticked (2026-11-05) | A repeating checklist is the natural use | Starting the next with none, as the plugin did |
| Kanban, Visualizer and `tasks_views` dropped (2026-11-05) | Never built, and Kanban is its own product | Reserving a table for them |
| One JSON file is the whole of portability (2026-11-05) | The owner's direction | An operator's bulk migration from the plugin |
| Reminders are core's notifications only, for now; no email in phase 1, so an account with no Sovereign identity has none (2026-11-05) | The owner's direction: notifications are enough for now. See whether more is missed | Email alongside the bell; email for a server running alone |
| Backup is a person's own, to their own private GitHub repository, as a new timestamped file (2026-11-05) | The owner's direction; the file is the export, so needs no tool to read | Overwriting one file; a backup format of its own; allowing public repositories |
| Backup names are in UTC | They sort correctly through time zones and daylight saving | The account's local time |
| Auto backup commits only when something changed | A quiet account should not fill a repository with identical files | A commit on every tick |
| Owner named in the statement, with `owner_id` on every row | Closes the plugin's id-only writes for good, and can be tested for every action | A separate ownership check first; joining to the list |
| Fractional positions, through `fractional-indexing` (CC0) | One row per move; no rewriting; ready for two people | Integers with rewrite, as the plugin; integers with gaps and rebalancing |
| `series` table with `anchor`, and `occurs_on` on a task | Snoozing and lateness stop corrupting the schedule; the rule is in one place | The rule copied to every row, anchored on the current due date |
| One definition of today, on the server, from a stored zone | Removes three competing ones and client-only rendering of "overdue" | Deciding in the browser, as the plugin's Today did |
| Undo through `deleted_at`, on tasks and lists, purged in seven days | A swipe must not be able to lose something; no trash to design | Hard delete with confirmations (a swipe can't stop to ask); a real trash (more than this app is) |
| One route tree, forking only what is rendered | Sovereign's rule; ends the double mount and two data paths | Two trees by `matchMedia` |
| Actions return what they changed | Ends the timing bugs around `router.refresh()` | Optimistic state relying on a refresh arriving in time |
| Nothing persisted on the device | Shared computers; Sovereign's rule | IndexedDB cache |
| Claim, send with `key`, release on failure | Nothing lost, nothing doubled | Claim then send (loses it on failure); send then claim (doubles it) |
| Jobs in the web process | As Fjord decided: one image, one entry point; claims make replicas safe | A separate worker image; an external cron |
| Own file format, reading the plugin's | People on the plugin need a way across; the plugin's envelope names an id that no longer means anything | Keeping the plugin's envelope |
