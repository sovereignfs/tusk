# Tasks — design

**Status:** draft, written from a review of the legacy plugin and of Fjord Web, and from the owner's user flows (2026-11-05). Nothing here is
implemented; the repository is still the scaffold (§5.2). Where this file and a contract Sovereign publishes disagree, the contract wins (`AGENTS.md`,
Source of truth). §24 holds anything still waiting on a decision, and §25 what has been decided and why.

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
- **It never makes you wait.** The app works from what is on the device, online or not. Syncing and resolving conflicts happen in the
  background, and a person should not feel them (§8).
- **Private by default.** A person's lists are visible to that person alone. Anyone can choose to hold their own key, so that the operator
  cannot read their tasks (§9). Sharing is something they choose, one list at a time, and comes after the MVP.
- **The data stays where its owner puts it.** On their server, on their devices, and in a repository of theirs if they connect one (§19). No
  telemetry, no third-party service, nothing loaded from another site.
- **A person can leave.** They can take everything with them in one file (§18), and deleting their account deletes what is held of them (§20).

What it is not: a project management tool, a team inbox, a Kanban board, or a place for assistants to write without being asked.

## 2. Phases

| Phase          | What it delivers                                                                                                                                                                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1, the MVP** | Everything one person needs: accounts and settings, lists, tasks and subtasks, due dates, recurrence, Today, Starred, Review, search, bulk actions, keyboard, reminders by bell, Push and email, one-file export and import, backup to a git repository, working offline, an installable PWA, and opt-in encryption. Runs alone or hosted on an instance. |
| **2**          | Sharing a list with other accounts, and assigning tasks. The plugin specified this and never built it.                                                                                                                                                                                                                                                    |
| **3**          | Candidates, none committed: Google Tasks import, "the last Friday of the month", a shared key held through core.                                                                                                                                                                                                                                          |

### What is carried over from the plugin

The plugin's requirement IDs are not used here: tasks get IDs of their own in the roadmap. This table is how to check nothing was lost.

| Plugin                                                                 | What                                                             | Here                                                                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| TSK-01–05                                                              | Lists and tasks, colour, cascade, title and notes                | §10, §11. Colour stays a fixed set of swatches                                                |
| TSK-06, 07                                                             | Subtasks one level deep; completing a parent completes them      | §11.2                                                                                         |
| TSK-08                                                                 | Manual order by dragging                                         | §11.3, with a different way of storing order                                                  |
| TSK-09                                                                 | Show or hide completed, per list                                 | §11.4                                                                                         |
| TSK-10–14                                                              | Sharing, roles, ownership, assignment                            | §21 (phase 2)                                                                                 |
| TSK-15, 16                                                             | Due date and time, overdue                                       | §12                                                                                           |
| TSK-17, 18                                                             | Filters, search                                                  | §11.4, §14.5                                                                                  |
| TSK-19–21                                                              | Keyboard shortcuts, bulk delete and move                         | §15.5, §15.6                                                                                  |
| TSK-22, 23, 25                                                         | Recurrence, the next occurrence on completion, the pattern shown | §13                                                                                           |
| TSK-24                                                                 | "This / this and following / all" when editing a recurring task  | **Dropped:** an edit applies to this occurrence and every later one, with no question (§13.4) |
| TSK-26–28                                                              | Star, move to a list, the Starred view                           | §11, §14.3                                                                                    |
| TSK-29                                                                 | Account-level export, import and deletion                        | Deletion: §20. The rest is §18's one file                                                     |
| TSK-30                                                                 | Today's Agenda                                                   | §14.2, with different swipes                                                                  |
| TSK-31                                                                 | One-file export and import in Settings                           | §18                                                                                           |
| —                                                                      | Reminders and the morning digest                                 | §17                                                                                           |
| —                                                                      | The mobile carousel, sheets and reorder                          | §15                                                                                           |
| `tasks_views`, Kanban, Visualizer                                      | Reserved, never built                                            | **Dropped.** `fs.sovereign.kanban` is a product of its own                                    |
| Tenants, `sdk.db`, the plugin manifest, the scheduler, the Apps drawer | The legacy runtime's                                             | Gone with it (§5)                                                                             |

## 3. User journeys

1. **First visit, alone.** Someone runs the image with the short setup of §23. They register, are offered encryption (§9), and find one list, _My
   tasks_, with the cursor in "Add a task". Sign-up is then closed unless the operator opened it (§6).
2. **First visit, on an instance.** A person opens Tasks from the launcher, signs in through core, is offered encryption, and finds the same.
3. **Capture.** They type a title and press Enter. It appears at the top straight away, online or not. They add another without touching the mouse.
4. **Work a list.** They tick things off, drag them into order, and open one to add notes, a date or subtasks, which opens in the right sidebar.
5. **Open on a phone.** Today's modal opens: what is starred, due or overdue. They go through it as a list or as cards. They close it and see the
   carousel of lists. The footer switches list, adds a task to the list on screen, and brings Today back.
6. **Start the day.** They are told "3 tasks due today · 2 overdue" (§17). It opens Today.
7. **Prioritise.** From the list switcher they choose "Review all tasks" and swipe through everything, starring what matters and cancelling what
   no longer does. They can stop at any point and carry on later (§14.4).
8. **Something that repeats.** "Water the plants" repeats every Saturday. Ticking it off makes next Saturday's. Renaming it renames this one and
   every later one, and makes nothing new.
9. **On a train.** They add and tick tasks with no signal. Nothing is different. It syncs when it can.
10. **Keep a copy.** In Settings they connect a private git repository, perhaps their Fjord repository, and choose daily. Each day something changed, a
    new file appears under `sovereign-tasks/` (§19).
11. **Leave or move.** They download one file holding everything and import it elsewhere, or delete their account and Tasks deletes what it holds.

## 4. Terminology

| Term                   | Meaning                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Account**            | Someone who can sign in to this Tasks. Known by its id, whichever way they sign in (§6). "Person" means the same, in prose |
| **List**               | A named, coloured group of tasks. Belongs to one account in phase 1                                                        |
| **Task**               | A row in a list. A top-level task can have subtasks                                                                        |
| **Subtask**            | A task with a parent: a title, notes and a tick, and nothing else (§11.2)                                                  |
| **Due date, due time** | When a task is due, as written on a calendar, in no time zone (§12)                                                        |
| **Today**              | The account's own calendar day (§12) and also the view of what needs attention (§14.2); the context says which             |
| **Review**             | A pass over all a person's tasks, or one list's, to prioritise them (§14.4)                                                |
| **Series**             | A repeating rule, and the occurrences made from it (§13)                                                                   |
| **Occurrence**         | One task in a series. At most one is open at a time                                                                        |
| **Change**             | One write to one row, as a device sends it to the server (§8.2)                                                            |
| **Personal key**       | An age key a person holds, which makes their tasks unreadable to the server (§9)                                           |
| **Backup**             | One file committed to the connected repository (§19)                                                                       |

User-facing text says "list" and "task", never "item"; "app", never "client" or "plugin".

## 5. Architecture

```
       browser (a PWA)                                server (one image, one process)
 ┌──────────────────────────────┐              ┌──────────────────────────────────────────┐
 │ UI (React 19, @sovereignfs/ui)│              │ Next.js: the shell, routes                │
 │   reads and writes ▼         │  /api/sync   │ better-auth (§6)                          │
 │ Local store (IndexedDB)      │ ◀──────────▶ │ sync: checks and stamps changes (§8)      │
 │ Outbox, sync in background   │   changes    │ jobs: reminders, backups, purge           │
 │ Keys, if encrypted (§9)      │              └───┬──────────┬───────────────┬───────────┘
 │ Service worker: shell, Push  │                  │          │               │
 └──────────────────────────────┘   SQLite (sqld or file)  GitHub REST   a Sovereign core,
                                    or PostgreSQL (§22)    API (§19)     if one is set
```

The stack, sign-in and database are Fjord Web's, on purpose, so that operating either is operating both. The data flow is new to the suite, because
offline-first asks for it:

- **The browser holds a working copy, and the UI reads only that.** The server is the authority that every device converges on, not something a
  screen waits for (§8).
- **Next.js with React 19**, a long-running server and not serverless, because the jobs are background work. Signed-in screens are client components
  over the local store. The server renders the shell and the landing page.
- **SQLite by default, in production too, and PostgreSQL if the operator prefers** (§22).
- **Jobs run in the web process**, on a timer started from `instrumentation.ts`, with `TASKS_WORKER=off` for all but one process if several share a database. Fjord decided against a separate worker (2026-10-31), for the same reason: a single container wants it, and a second entry point is a second bundle for no behaviour. Every job claims its work in the database (§17.3), so a second process running it is safe anyway.
- **The server talks to GitHub and to core.** The browser never does, and no credential reaches it.
- **What can be pure is pure:** the next occurrence, what Today shows, a position between two others, what "today" is, and what a user action changes. They take the time as an argument, so they are tested with no clock and no database, and run the same in the browser and on the server.

### 5.1 Where things go

As Fjord Web's. `app/` for routes, and `src/` for everything else, with tests beside the code.

| Path                                                                                   | What                                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `app/`                                                                                 | Routes: the shell, the landing page, sign-in, and `/api/*`                                                          |
| `src/db/`                                                                              | Configuration, the clients, the schemas per dialect, migrations at start-up (§22)                                   |
| `src/auth/`                                                                            | better-auth, its settings, the screens, the fake Sovereign for tests (§6)                                           |
| `src/access/`                                                                          | The list of every page and route with who may use it, and the parsers (§7)                                          |
| `src/sync/`                                                                            | The change format and validators (shared), the server's apply and pull, and the browser's outbox and sync loop (§8) |
| `src/local/`                                                                           | The browser's store over IndexedDB, and its queries (§8)                                                            |
| `src/actions/`                                                                         | What each user action changes: pure, run in the browser, producing changes                                          |
| `src/crypto/`                                                                          | Credentials at rest (§19.2) and the operator-key mode (§9.5), on the server                                         |
| `src/keys/`                                                                            | Personal keys, list keys and the field cipher, in the browser (§9)                                                  |
| `src/recurrence.ts`, `src/time.ts`, `src/position.ts`, `src/today.ts`, `src/review.ts` | The pure rules                                                                                                      |
| `src/notifications/`                                                                   | The notification list, the channels and the jobs (§17)                                                              |
| `src/portability/`                                                                     | The file format, and reading the plugin's (§18)                                                                     |
| `src/backup/`                                                                          | The connection and the job (§19)                                                                                    |
| `src/providers/`                                                                       | The git host interface, GitHub's implementation, an in-memory one (§19.2)                                           |
| `src/sovereign/`                                                                       | What an instance tells the app, and `People` (§20)                                                                  |
| `src/mail/`                                                                            | The SMTP mailer (§6, §17)                                                                                           |
| `src/pwa/`, `src/sw/`                                                                  | The manifest's details, and the service worker's source (§15.7)                                                     |
| `src/ui/`                                                                              | The design system's client boundary, and `AppShell`                                                                 |
| `migrations/`                                                                          | The generated SQL: `sqlite/`, `postgres/`, `auth/`                                                                  |
| `deploy/`                                                                              | The Compose setups for sqld, a file and PostgreSQL, their README and `.env.example`                                 |
| `sovereign.manifest.json`                                                              | What an instance reads to host the app (§23)                                                                        |

### 5.2 What happens to the scaffold

`npm create @sovereignfs app` made an app that is hosted or nothing: sign-in through the SDK, PostgreSQL through `pg`, `lib/`. Its `lib/auth.ts`, `lib/stores.ts`, `lib/sovereign.ts`, `lib/db.ts`, `lib/migrate.ts`, `lib/crypto.ts`, `lib/config.ts`, `app/auth/`, its notes example and `migrations/001_init.sql` are replaced. Its manifest, Dockerfile and publish workflow are kept and changed as §23 says. This is the first task of the roadmap.

## 6. Authentication

**Identical to Fjord Web's §6, and read that for the detail.** The flows, the rules and the tests are the same; this section records what it means here, with `TASKS_` for `FJORD_`.

Built on **better-auth 1.7**, in a store of its own (§22), with its own migrations. Which methods are offered is set by the environment, so an instance can run either or both:

| Method        | Enabled by                                                                        | What                                                                                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local**     | `TASKS_AUTH_LOCAL=1`                                                              | Email and password, passkeys, and an authenticator app with ten backup codes. Off means off: `/sign-in`, `/sign-up` and `/api/auth` answer 404                                                                                        |
| **Sovereign** | `TASKS_CORE_URL`, `TASKS_CORE_CLIENT_ID`, `TASKS_CORE_CLIENT_SECRET`, all or none | OIDC against a core, through `genericOAuth`: authorization code with PKCE S256, the ID token verified against the keys discovery points to. Redirect address `<TASKS_URL>/api/auth/callback/sovereign`; scopes `openid profile email` |

- **The server refuses to start on a setting that is wrong:** a short `TASKS_AUTH_SECRET`, a non-https `TASKS_URL` (localhost aside), a partial set of `TASKS_CORE_*`, an SMTP host with no sender.
- **Who may sign up** is `TASKS_AUTH_SIGNUP`: `closed` by default, where the first account is made and then sign-up is refused, by the server; or `open`. One policy for both methods, in the user-creation hook. A self-hoster who forgets is not an open registration; an instance sets `open`, since there the instance decides who may sign in.
- **Email is optional.** With `TASKS_SMTP_*`, an address must be verified before first sign-in and a forgotten password is reset by a single-use link. Without it, sign-up is immediate and no screen offers a reset.
- **A Sovereign account is identity, not authorization.** Identity is its `sub`, stored as the better-auth account id. `email` and `name` are copied when the account is made and not overwritten after.
- **No implicit linking.** A Sovereign login whose email is a local account's is refused, until the person links the two from a signed-in session, and only when the addresses match. Unlinking can never remove an account's last way to sign in.
- **Signing out is local.** Ending a Tasks session does not end the Sovereign one.
- **Two-factor is the password's.** A person with Tasks two-factor who links Sovereign is not asked for the Tasks code when signing in through it.
- **Tested the same way:** auth flows over real requests through `auth.handler` on all three databases, a strict fake Sovereign, a recording of a real instance's discovery document, and every security behaviour seen to fail with it switched off.

**The owner of everything is the better-auth user id** (`account_id`), not `sub`. It is in the other store, so it is not a foreign key, as in Fjord. The `sub` is looked up only for what needs it: a notification through core (§17.2) and a notice from core (§20).

Signing in needs a network. Once signed in on a device, the session cookie is not re-checked to read what is on that device: the app opens offline, and the next sync finds out if the session ended (§8.5).

## 7. Access

**The rule: every write names the account in the statement that makes it.** Not a check first and a write after.

```ts
db.update(task)
  .set({ fields, seq })
  .where(and(eq(task.id, id), eq(task.ownerId, accountId)));
```

No row affected means the row is not there for this account, and the answer is the same whether it does not exist or belongs to someone else.

This closes the plugin's most serious flaw. There, an action took `(taskId, listId)`, checked the caller owned `listId`, and then updated by `taskId` alone. Anyone who knew another person's task id could change or delete it by passing a list of their own. The same shape was in `updateTask`, `toggleComplete`, `toggleFavorite`, `setDueDate`, `setRecurrenceRule`, `deleteTask`, `moveTask`, `bulkDeleteTasks`, `bulkMoveTasks`, `reorderTasks` and `getSubtasks`.

With offline-first, nearly every write comes through one door, `POST /api/sync` (§8.3), so this is checked in one place and tested hard:

- **The server trusts nothing a device says about ownership.** A change to a row of another account is refused, and so is a `list_id` or `parent_id` that points at one. Row ids being made by the client means a device could try to claim an id another account uses: inserting one is refused, not merged.
- **Who may call what is written down once:** `src/access/routes.ts` lists every page and route with who may use it, and `routes.test.ts` holds it to the files, as in Fjord Web. A test seeds two accounts and sends each kind of change as the wrong one, and asserts nothing changed.
- **A route that changes something checks `Origin`** against `TASKS_URL`.
- **Input is parsed at the edge.** Shared validators (§8.2) run on a device before a change is queued, and on the server for what it can read: a title is 1 to 500 characters, notes up to 20,000, ids are UUIDs, a date is a real date, a time is `HH:MM`, a rule passes §13.2. On an encrypted account the server can check only structure and size, and the browser's checks are a convenience (§9.4).
- **Limits exist so one account cannot fill the server:** 200 lists and 50,000 tasks an account, a size per field, and a rate on `/api/sync`.

## 8. Sync and offline

The design goal is that **a person does not feel any of this.** The app never waits for the network to show or change a task, shows no conflict dialogs, and needs no "saving" indicator. Settings shows when it last synced, for anyone who wants to know.

### 8.1 The model

- **The UI reads and writes the local store,** IndexedDB through `idb`, one database per account, named for it. A write is applied there at once, and the screen updates from that.
- **Each write also goes in an outbox,** in the same IndexedDB transaction. The sync loop sends it.
- **The server is a referee:** it checks a change is allowed, stamps it with an order, stores it and hands it to the other devices. It does not need to understand a task beyond its structure, which is what lets it work on encrypted data (§9).

### 8.2 Changes

A user action is a pure function in `src/actions/`, run in the browser, that turns "complete this task" into changes to rows. Completing a parent with two open subtasks that repeats is one **mutation** holding several changes: the task, the subtasks, and the next occurrence and its copied subtasks.

```json
{
  "mutationId": "…",
  "changes": [
    {
      "table": "task",
      "id": "…",
      "listId": "…",
      "parentId": null,
      "position": "a1",
      "fields": { "title": { "v": "Water the plants" }, "completedAt": { "v": 1793000000000 } }
    }
  ]
}
```

- **Ids are made by the client,** so a new task exists at once and everything can refer to it offline. A mutation's id makes replaying it harmless: the server records what it has applied.
- **Only what changed is sent:** a field, not a row. That is what makes conflicts mostly vanish (§8.4).
- **A field's value is plain or ciphertext** (`{ "v": … }` or `{ "c": "…" }`), and everything above that is the same either way.
- **Validators are one module,** used by the browser before it queues and by the server when it can read.
- **The structural part is checked by the server whatever the mode:** the list is the account's; a subtask's parent is the account's, top-level, and in the same list.

### 8.3 The endpoint

`POST /api/sync`, with the session cookie and `Origin` checked. A request carries the outbox and a cursor; an answer carries what was applied, what was refused, and the changes since the cursor.

- **Order is a per-account counter.** Applying a mutation is one short transaction: increment `account_settings.seq`, stamp each changed field and row with it, record the mutation. It works alike on all three databases, and the increment serialises one account's writes without holding anyone else up.
- **Pull** returns rows whose `seq` is past the cursor, paged. A new device starts at zero, which is the snapshot (§8.5).
- **A device syncs** after a write (debounced), on load, when the tab regains focus, when it comes back online, every few minutes while open, and through the Background Sync API where there is one. One tab syncs at a time (Web Locks); others see the store change (BroadcastChannel).
- **Retrying is safe,** since a mutation applies once, and a lost answer is just a retry.
- **A protocol version** travels with each request. A device too old is told to update, and the service worker does so; its outbox is kept.

### 8.4 Conflicts

Resolved by rule, in the background, with nothing asked:

| What happened                                                   | What results                                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Two devices change different fields of a task                   | Both changes stand                                                                                               |
| Two devices change the same field                               | The one that reached the server later wins                                                                       |
| One device edits a task another deleted                         | The edit restores it: losing someone's words is worse than a deleted task coming back                            |
| Both delete                                                     | Deleted                                                                                                          |
| Two devices move a task to one position                         | Both keep the key; ties break by id, so every device shows one order                                             |
| Two devices complete a repeating task                           | They make the same next occurrence, since its id derives from the series and the date, and it arrives once       |
| Two devices complete it on different days, so next dates differ | Two open occurrences arrive. The device that sees it deletes the later one, by a rule every device applies alike |
| A task is added to a list another device deleted                | The list is restored                                                                                             |

A refusal the server gives (a limit, a change it cannot accept) is the only thing that reaches the person: the change is undone locally with a toast saying why. The later-arrival rule can silently overwrite an edit made on another device; that is the accepted cost of having no conflict dialogs, and fields are small enough for it to be rare.

### 8.5 First load, sign-out, and an ended session

- **First load on a device** needs a network. It pulls the snapshot in pages, and shows what it has as it arrives, the first list first.
- **Later loads** paint from IndexedDB at once. There is no spinner to see a list you have already seen, on any network.
- **Signing out deletes the local database,** after trying to send the outbox, and warning if it cannot and there are unsent changes.
- **A session that ended elsewhere** (a password reset, core's logout) is found at the next sync: the app shows sign-in and displays no data, and keeps the outbox for the same account to send once it signs back in.
- **Persistent storage is requested** (`navigator.storage.persist()`), so that a browser is less likely to evict what is here.

### 8.6 What cannot be hidden

Stated plainly here and in the user's documentation:

- **Signing in, first load on a device, and Settings actions** (account, security, import, export, backup) need a network. They say so when offline; the rest of the app is unaffected.
- **On iPhone, sync happens only while the app is open.** Safari has no Background Sync.
- **Reminders are sent by the server,** which knows only what has synced. One can arrive for a task completed offline.
- **A browser can evict storage.** Unsynced edits could be lost if it does, in spite of asking it not to.
- **A shared computer** holds a signed-in person's tasks until they sign out.

### 8.7 Keeping the history small

Deleted rows are hard-deleted after seven days (§11.5), and leave a tombstone of id and `seq` so that devices learn of it. Tombstones and applied-mutation records go after 90 days. A device whose cursor is older than that gets a fresh snapshot, sending its outbox first.

## 9. Encryption

Two modes, mutually exclusive. By default neither is on, and everything is stored as plain text.

|                    | Personal key                                                       | Operator key                                |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------- |
| Chosen by          | Each person, opt-in                                                | The operator, by `.env`                     |
| Who can read tasks | Only that person's devices                                         | The server, and so the operator             |
| Protects against   | Reading the database, dumps and backups, including by the operator | A stolen database or dump, not the operator |
| When it is on      | Other people on the server are unaffected                          | Personal keys are not offered to anyone     |

### 9.1 Choosing a personal key

After registering or first signing in, a person is offered it, and can skip. If they skip, their tasks are plain text, and Settings > Data can turn it on later (§9.3). It is one way: to go back, they export and start a new account.

- **Create** makes an age identity in the browser, and makes them save it first: download the key file, and confirm they did. **Nobody can recover it.** Losing the key and every device loses the tasks.
- **Upload** takes an existing age identity, by file or by pasting. **The same key can be used across the suite:** a person's Fjord identity, for example, is the same format. Sharing one through core, for an instance connected by OAuth, waits on core, whose end-to-end encryption is listed as "later"; nothing here prevents it.

On a new device they give the key once, and it is remembered until sign-out (below). A person with no key to hand can still sign in, and sees a page asking for it, with no data.

### 9.2 How it works

- **The age key wraps a data key per list, and a list key encrypts fields** with AES-256-GCM, bound to the row and the field, so that the server cannot move a value to another row or field unnoticed. age itself is used only for wrapping, since its overhead is too much per field. `age-encryption` (BSD-3-Clause) does this in the browser; Fjord does the same in WebAssembly, which brings more than this needs. Per-list keys are what makes sharing possible later: a list key is wrapped for another member.
- **Encrypted:** all content. Titles, notes, list names and colours, rules, dates, stars, completion, review and dismissal times, and sort settings.
- **Readable by the server:** ids, a task's list and parent, positions, delete markers, sync counters, the size and timing of changes, and the account itself (email, sessions, time zone, settings). So an operator can see how many tasks someone has, how they nest, and when they change, and not what they say.
- **Unlocking is once per device.** Keys are kept in IndexedDB as non-extractable browser keys where the platform supports that, until sign-out. There are no repeated prompts, offline works, and Push can show titles. An unlocked device can read the tasks, so anyone with that device can too.

### 9.3 Turning it on later

The browser re-encrypts everything it has, in resumable batches through the ordinary sync path, with the account marked as moving. Once done, the server refuses plain fields for that account. **What was already written elsewhere stays readable:** older database backups, and files committed to a backup repository before this. Settings says so at the time.

### 9.4 What changes for an encrypted account

Because of §8, most of the app needs nothing from the server. What differs:

| Thing                             | With a personal key                                                      |
| --------------------------------- | ------------------------------------------------------------------------ |
| Search, Today, counts, recurrence | Nothing: already in the browser                                          |
| Server validation                 | Structure and size only                                                  |
| Moving a task to another list     | The browser re-encrypts its fields under that list's key                 |
| Export                            | Made in the browser, as plain JSON in the person's hands, with a warning |
| Import                            | Read and encrypted in the browser                                        |
| Auto backup                       | The file holds ciphertext and wrapped keys (§19.3)                       |
| Reminders                         | By times only (§17.5)                                                    |

### 9.5 The operator key

`TASKS_DB_ENCRYPTION=on`, with `TASKS_ENCRYPTION_KEY`.

- **It is server-side field encryption, not the database's own,** because PostgreSQL has no built-in equivalent and it must behave the same on all three forms. Each field is sealed with the same AES-GCM binding as §9.2, through `src/crypto/`, with rotation by `TASKS_ENCRYPTION_KEY_PREVIOUS`. Devices exchange plain fields with the server over TLS, and hold them in IndexedDB as in plain mode.
- **The server can decrypt,** so reminders, backups and everything else work as in plain mode. A due date, due time and completion time stay readable in their own columns (§22.3), since the reminder job has to query them.
- **Personal keys are not offered,** and the sign-up page and docs say that the operator manages encryption and can read data.
- **It never converts silently,** per Sovereign's rule. The server refuses to start if the setting conflicts with what is stored: on, with accounts holding personal keys or with plain fields; off, with sealed fields. Moving existing data takes an explicit command shipped in the image.
- **Backup files are plain** (§19.3), since the server decrypts to make them.

### 9.6 What this does not do

A personal key protects what is stored. It does not protect against an operator who serves altered JavaScript that takes the key, since the browser runs what the server sends. This is true of every web app that encrypts in the browser, and the docs say so.

## 10. Lists

- Create with the + in the sidebar, and name it. A first visit makes _My tasks_, so there is always somewhere to type.
- Rename, recolour, reorder and delete in Settings > Lists (§16). Dragging a row in the sidebar also reorders.
- Colour is one of the six swatches (`black`, `grey`, `green`, `blue`, `amber`, `red`), mapped to `--sv-*` tokens. New lists are `black`. It is the one splash of colour in a monochrome interface, and appears only as the small dot.
- Deleting a list asks first (`ConfirmDialog`), naming how many open tasks it holds, and takes its tasks with it. It can be undone (§11.5).
- Deleting a list's completed tasks is one action, from the list's menu.
- The sidebar shows the count of open top-level tasks at the right of each row, from the local store.

## 11. Tasks

### 11.1 A task

The same as the plugin's: a title, optional notes (plain text; shown as written, with links not made live in phase 1), a star, a due date and optional due time, optionally a repeat, and subtasks. A new task goes at the top of its list.

Moving a task to another list takes its subtasks with it, and the task goes to the top of the destination.

### 11.2 Subtasks

One level deep. The plugin's spec said "at the app layer", and `createTask` did not actually check. Here both the action and the server check it: a parent must be top-level and in the same list. A subtask has a title, notes and a tick. It has no due date, star or repeat, which keeps Today and reminders about top-level tasks.

Completing a parent completes its open subtasks, and leaves the completion time of those already done (the plugin overwrote them). Reopening a parent reopens nothing. Ticking the last subtask does not complete the parent: finishing the parts is often not finishing the thing. A row shows progress as a small ring.

### 11.3 Order

Order is a **position**: a string that sorts between its neighbours (fractional indexing, compared byte by byte: §22.2). Moving a task writes one row. The plugin stored integers, and every drag rewrote every row in the list. One row per move is what makes order survive two offline devices at all.

Under "Custom" order, tasks that are overdue or due today float to the top of the list (a partition, not a change to their position), and are in position order among themselves. Dragging is computed against what is on the screen, then translated to a position between the visible neighbours; that is the bug the plugin carried for months (§15.8).

### 11.4 Seeing a list

- **Filter:** All, Active, Overdue. Completed tasks are a collapsible section at the bottom, whose open or closed state is remembered per list.
- **Sort:** Custom, Date created, Due date, Title. **Remembered per list,** unlike the plugin, which reset it on every navigation. Dragging is available only under Custom.

### 11.5 Delete, and undo

The plugin's deletes were final, including its swipe-down in Today, which deleted at once with no confirmation, because the card's animation had already committed. Here **every delete offers Undo** in a toast, for about ten seconds.

Deleting sets `deleted_at`, on a task or a list alike. Undo clears it. A job removes rows deleted more than seven days ago (§8.7). There is no trash to browse: this is the smallest thing that makes a mistake recoverable. Account deletion and that job are the only hard deletes.

## 12. Dates and time

The plugin had three ideas of "today": the server's local date in some paths, the browser's in others, and a stored zone in the reminder job. Here there is one function, `todayFor(zone, now)` in `src/time.ts`, used everywhere:

- **A due date and time are floating:** "Saturday at 09:00" as written on a calendar, stored as `YYYY-MM-DD` and `HH:MM` text, in no zone. They compare as strings, which sort chronologically. Someone who flies somewhere still has it due Saturday at 09:00 where they are. Google Tasks behaves this way, and so did the plugin.
- **In the browser, the zone is the browser's,** so the screen always agrees with the person's own clock, online or not.
- **On the server, the zone is `account_settings.time_zone`,** for jobs. The browser reports it on load, and it is updated when it differs. It is validated, and an invalid one falls back to UTC. (The plugin captured it only when notification settings were saved, so a person who moved kept getting their digest in the old zone.)
- **Displayed in the browser's locale:** "Today", "Tomorrow", "Mar 5", and times in the locale's 12- or 24-hour form.

The due date picker offers Today, Tomorrow and Next week, then `Calendar` from `@sovereignfs/ui` (the plugin's own month grid predates it), and a time once a date is set. Time zone is not something anyone is asked about.

## 13. Recurrence

### 13.1 The model

A series is a rule and an anchor date. **One occurrence is open at a time**, as in the plugin and in Google Tasks: completing it makes the next. Occurrences are ordinary tasks, so they filter, sort and show up in Today with no special cases.

Completing is one mutation (§8.2), made once: a double-tap finds the task already complete and does nothing. The plugin had no guard: complete, reopen and complete again made two next occurrences. **The next occurrence's id derives from the series and its date** (a UUIDv5), so that two devices arrive at the same row (§8.4).

The next occurrence copies the title, notes, star, due time and list, but not a dismissal or review time, takes the same position, and has **its subtasks copied, unticked**. If the rule has ended (`UNTIL` or `COUNT`), there is none.

### 13.2 The rule

Stored as an RFC 5545 `RRULE` string with no `DTSTART`, computed with the `rrule` package, inside `src/recurrence.ts` alone, in the browser.

The plugin passed whatever string the browser sent to the database, where a bad one failed only at the moment someone completed the task. Here a validator parses a rule against an allow-list: `FREQ` (daily to yearly), `INTERVAL` (1 to 999), `BYDAY` (plain weekdays, weekly only), and one of `UNTIL` or `COUNT`. Nothing else, 200 characters at most.

The picker offers: Daily, Weekdays, Weekly, Monthly, Yearly, and Custom (every N units, on chosen weekdays, ending on a date or after N). The task row shows a short form ("Weekly", "Every 2 weeks") and the detail the full one ("every week on Monday, Wednesday").

`rrule` works in UTC, so a date crossing into it must go through `Date.UTC` and come back through `getUTC*`. Doing otherwise moves `BYDAY` matches by a day east of Greenwich, as the plugin learned. Tests run under more than one `TZ`.

### 13.3 What the next date is

**A task done late does not leave a trail.** The plugin's daily task, ticked a week late, made one due yesterday. Ticked again, the day before, and so on. The next occurrence is the first one, counted from the anchor, after whichever is later: its due date, or today.

Setting a repeat on a task with no due date gives it one: the first date the rule matches from today. The plugin silently never made a next occurrence for such a task, and its interface did not say so.

### 13.4 Editing

**An edit to a recurring task updates it in place, applies to that occurrence and every later one from that moment, and duplicates nothing.** There is no prompt. No row is added by editing, and completed occurrences are history and are never changed.

| Edit                                        | What happens                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Title, notes, star, due time, subtasks      | The open occurrence changes, and the next is copied from it                                                                                                                    |
| The rule                                    | The series' rule is replaced, and the anchor set to this occurrence's date                                                                                                     |
| The due date                                | This occurrence moves and the series moves with it: the anchor becomes the new date, and a weekly rule on one weekday moves to the new weekday. Every later occurrence follows |
| "Does not repeat", or clearing the due date | The series ends, and this stays as a one-off                                                                                                                                   |

The plugin's prompt looked like a choice, but with one open occurrence there were no future rows to choose between. "This task only" was not true, since the next occurrence copied the edit anyway. "This and following" was in effect the same one row. "All" went back and rewrote completed rows' titles.

### 13.5 Reopening, moving, cancelling, deleting

- **Reopening** a completed occurrence when the next is untouched removes that next occurrence, so Undo after a tick leaves things as they were. If the next has been changed, the reopened task leaves the series and becomes a one-off, and nothing is lost.
- **Moving** an occurrence to another list moves the series with it, since the next is copied from it.
- **Cancelling,** a swipe in Today or Review (§14.2), skips this occurrence: it is deleted, with Undo, and the next is made.
- **Deleting,** in the detail, ends the series, because nothing is left to make the next from, and Undo brings it back. A job removes a series with no occurrence left.

## 14. Views

### 14.1 Addresses

| Address                       | What                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/`                           | A landing page for someone not signed in, static, as in Fjord. Signed in, the first list, by a rewrite in `proxy.ts` |
| `/sign-in`, `/sign-up`        | §6                                                                                                                   |
| `/lists/<id>`                 | A list. `?task=<id>` opens a task's detail, so it can be linked to and reloaded                                      |
| `/today`                      | §14.2                                                                                                                |
| `/starred`                    | §14.3                                                                                                                |
| `/review`, `/review/<listId>` | §14.4                                                                                                                |
| `/search?q=`                  | §14.5                                                                                                                |
| `/settings?section=`          | §16                                                                                                                  |

A list that is not there for this account says so, with a way back. No route depends on an id being unable to collide with a word, which the plugin's `/tasks/[listId]` relied on for `starred`.

### 14.2 Today

A virtual list: every open top-level task that is overdue, due today, or starred, across the account's lists. Overdue first (oldest first), then due today (by time, no time last), then starred (by title). A task in more than one of those shows once. Computed in the browser, by `todayFor` and a pure function.

On a phone it is a full-screen modal. On a desktop it is the content column, reached from the sidebar. Either way, a **List | Cards** toggle (`SegmentedControl`) chooses how to go through it, and the choice is remembered on the device.

**Cards** are a `SwipeStack`, one at a time, with buttons always shown, since a gesture is never the only way (§15.5):

| Gesture | Button  | What it does                                                                                                       |
| ------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| Up      | Done    | Completes it (a repeat makes its next)                                                                             |
| Down    | Cancel  | Deletes it, with Undo. On a repeating task, skips this occurrence and makes the next (§13.5)                       |
| Left    | Dismiss | Hides it from Today until tomorrow, with Undo. Its due date and status do not change, and it stays in its own list |
| Right   | Star    | Sets the star, and leaves the due date alone. It leaves the stack for this pass                                    |

**Dismiss** is the snooze this view has: a `dismissedOn` date on the task, which Today compares with today, in the device's own local day. It reaches the person's other devices, and works offline and on an encrypted account like any field. The next day it is simply back, so nothing has to clear it. It affects only Today: the task still shows in its list, Starred, search and Review, and reminders and the daily brief still count it, since it is still due.

**When it opens by itself, on a phone:** on launch and after 30 minutes or more away. It does not when opening from a notification or a link to a particular task, or when there is nothing in it, or on coming back from a brief switch to another app. It is an overlay on the carousel, not a navigation: closing it shows the list that was underneath. `/today` opens it directly. A desktop opens on a list as usual.

### 14.3 Starred

A virtual list of starred top-level tasks, by due date with undated last, each showing its list. It owns no row and takes no new tasks, drags or bulk actions; everything else about a row works as in a list. One component, not a fork. Reached from the sidebar, and on a phone from the list switcher.

### 14.4 Review

A pass over every open top-level task to prioritise them, for when Today is not the question. **The cards and swipes are Today's** (§14.2): up done, down cancel, left dismiss, right star.

- **Reached** from "Review all tasks" at the top of the list switcher on a phone, a Review row under Today and Starred on a desktop, and "Review this list" in any list's menu.
- **Any swipe marks a task reviewed** (`reviewed_at`). Dismiss here means only that: it moves on, and does not hide the task from Today. Cards come least-recently-reviewed first, with never-reviewed first of all, so a person can stop at any point and carry on later without seeing the same ones again.
- **It shows the count left,** and says when they have been through everything, with a way to start again.
- **A date is not changed from a card,** in Today or here. The card's title opens the detail for that.

### 14.5 Search

Titles and notes, across the account's lists, including subtasks shown under their parent's name, newest change first. **It runs in the browser, on the local store,** on any encryption mode, offline as well. So it needs no server query, full Unicode case folding is free, and none of the plugin's flaws can recur: there, `%` matched everything, and 50 rows of the whole tenant were taken before filtering to the person's own.

## 15. Interface

### 15.1 Principles

Everything comes from `@sovereignfs/ui` and its `--sv-*` tokens: monochrome, with colour only on a list's dot. What is reusable and missing is added there, in `sovereign`, not built here (the plugin's `CalendarGrid` and its own overlays were this mistake). The design system comes through `src/ui`, as in Fjord Web.

**One set of routes.** The plugin rendered two different component trees depending on `matchMedia`, each with its own data. Sovereign's rule is the fix: **never fork a navigation decision by viewport; fork only what is rendered.** Addresses and data are the same at every width. Today opening by itself on a phone (§14.2) is an overlay, not a navigation, which keeps this true.

### 15.2 Desktop

Above 768px, two rows:

```
┌──────────────────────────────────────────────────────────────┐
│ ▣ Tasks                                            🔔  (avatar)│  header
├────────────┬───────────────────────────────┬─────────────────┤
│ Today       │ Personal                 ⋯  │  (right sidebar)  │
│ Starred     │ Add a task…                 │  a task's detail, │
│ Review      │ ☐ Water the plants  Sat  ☆ │  hidden until one │
│ MY LISTS  + │ ☐ Call the bank          ☆ │  is opened        │
│ ● Personal 4│ ▾ Completed (1)             │                   │
└────────────┴───────────────────────────────┴─────────────────┘
```

- **Header:** the logo and app name on the left, the notification bell and the avatar on the right. The avatar opens `UserMenu`: Settings, Sign out, and when a core is set, a way back to it. The design system's `Header` requires a launcher slot that an app has no use for, so the shell is our own `AppShell` unless `Header` gains an option; decided in its task.
- **Main:** `ThreeColumnLayout`: sidebar, content, right sidebar. **It shows two columns at first.** Clicking a task renders its detail in the right sidebar, as in the plugin.
- **Dimensions,** matched to the Shopper screenshot: a sidebar of about 280px, content filling the rest with about 24px of padding, a right sidebar of 360px. The layout's defaults are 280 and 360. These are measured from the screenshot against the legacy shell's 64px rail, and Shopper's source was not to hand to confirm them. The screenshot's icon rail is the legacy shell's, and is replaced by the header.
- **Sidebar:** Today, Starred and Review pinned, then the lists, each with its colour dot on the left and task count at the right end. The + beside "My lists" adds one.

### 15.3 Mobile

At 768px and under, three rows: header, carousel, footer.

- **Header:** `MobileHeader`, as in legacy Sovereign: logo and app name on the left; bell and avatar on the right. The avatar opens the same menu.
- **Main:** `SwipableMobileCarousel`, with `useCarouselRouteSync` mapping a slide to an address: **one slide per list.** Swiping changes the address.
- **Footer:** `MobileFooter`, three buttons. Its centre slot is the launcher's, given our own icon and action:

| Button | What it does                                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Left   | Opens a sheet for switching lists quickly: "Review all tasks", Starred, then the lists with dot and count                                                |
| Middle | Adds a task, in a sheet, with the list on screen already chosen as the target. It can be changed. From a view with no list behind it, the list used last |
| Right  | Opens Today's modal                                                                                                                                      |

Task detail and list actions are `Sheet`s. Date and repeat pickers use the design system's adaptive surface (`Popover` above, `Drawer` under). Neighbouring slides are already in the local store, so a swipe never shows a spinner.

### 15.4 A row

A checkbox, the title, the list dot where lists are mixed, the due date (in the danger colour when overdue), a repeat icon, subtask progress and a star. Clicking the row opens the detail; the controls in it keep their own click. The detail edits title and notes, saving as you leave the field, and shows the date, repeat, list, subtasks and Delete.

### 15.5 Gestures, keyboard, and access

**A gesture is always a shortcut for something visible.** On a touch screen:

- Swiping horizontally moves between lists. It belongs to the carousel.
- **Reordering starts from a visible handle** at the row's edge, with a long press. The plugin tried a long press anywhere on the row, which fought the carousel, then an invisible handle, then a toast explaining the invisible handle.
- Long-pressing the row body enters selection.
- Row swipe-to-reveal (Done, Delete) uses `useSwipeReveal`, from a zone that does not fight the star.

With a keyboard, attached to the page and ignored while typing or with a modifier held: `n` new task, `j` and `k` or arrows to move, `e` to complete, `Enter` to open, `[` and `]` for the previous and next list, `Esc` to clear a selection, `?` to list them.

Accessibility is a condition of each task's being done, not a later pass (the plugin left it to a v1.0 that never came): WCAG 2.2 AA, keyboard reordering through dnd-kit's `KeyboardSensor` plus Move up and Move down in a row's menu, labelled icon buttons, real focus handling in sheets and dialogs, and honouring reduced motion.

### 15.6 Bulk

Ctrl- or cmd-click, or a long press, starts selection, since the row's checkbox already means complete. A bar shows the count, with Complete, Move to list, Delete and Cancel (Complete is new). Each is one mutation.

### 15.7 PWA

Fully installable, on desktop and phone. **Fjord has neither a manifest nor a service worker;** the model is Sovereign core (`apps/core/app/manifest.ts`, `src/sw/source.ts`).

- **`app/manifest.ts`:** name, icons (with a maskable one), `display: standalone`, theme colours. On an instance, the instance's branding is not used: it is an app called Tasks.
- **The service worker** (`src/sw/source.ts`, served at `/sw.js`) caches only **the app shell, by allow-list:** a versioned set of built files and icons, and the one shell page, which holds nothing of a person. Task data is never in a cache: it is in IndexedDB (§8), named per account and deleted at sign-out. Sovereign's rule that a worker never stores a per-user page holds. A test evaluates the worker and fails if anything else gets in.
- **It also handles** Push (§17.2) and Background Sync (§8.3). A new version activates at the next load, keeping the outbox.
- **Install:** the browser's own prompt where it has one, and a line in Settings saying how on iPhone, since Push there needs it.

### 15.8 What the plugin paid to learn

Each of these cost a release there. They are written here so they are not paid for twice.

- **Drag indices are against what is rendered,** never the full array: filters, sort and the pin to the top all make the two differ.
- **dnd-kit's auto-scroll will scroll the carousel sideways** in the middle of a reorder unless told to scroll only vertical containers (`canScroll`). Each `DndContext` needs an explicit `id`, or SSR and hydration disagree.
- **`transform` on an ancestor makes it the containing block for `position: fixed`,** so a `Drawer` inside it renders squashed. Use `backface-visibility` if a sticky element needs its own layer.
- **`overscroll-behavior-y: none`, not `contain`,** on scrolling columns: in WebKit `contain` keeps the element's own bounce, and a sticky header rides down with it. Chromium does not show this; test on real WebKit.
- **`<Link replace>` to the same path with another search param does nothing** on a mounted route. Closing the detail uses `router.replace`.
- **Sticky headers need an opaque background and a `z-index` above the rows',** which set their own on mobile for swiping.
- **A one-time hint needs its claim set synchronously** if several instances of a component can mount at once.
- **A self-rendered mobile footer must publish its height,** or `Sheet` and `Drawer` slide beneath it. `MobileFooter` now does this itself; check it.
- **Touch behaviour is not testable in Chromium's tooling.** A change to gestures or scrolling is checked in the iOS Simulator, and says so in its PR.

## 16. Settings

One place, from the avatar menu, at `/settings?section=`: a dialog over the page on a desktop and a full page on a phone, as Fjord's `/account` is (`app/@modal`). It replaces separate account and settings pages.

| Section           | What                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Profile**       | Name, email, avatar                                                                                                                                                |
| **Preferences**   | Theme, first day of the week, and how Today opens on this device                                                                                                   |
| **Security**      | Password, two-factor, passkeys, linking Sovereign, as Fjord's. An account that came through Sovereign has no password, two-factor or passkey sections, and says so |
| **Lists**         | Each list's name and colour; change the order; delete                                                                                                              |
| **Notifications** | Enable Push on this device; email reminders on or off; the daily brief's time; due-time reminders on or off (§17)                                                  |
| **Data**          | Export and import (§18); backup (§19); encryption (§9); last synced; delete account (§20)                                                                          |

Settings shows only what can work here: no Push without VAPID keys, no email without SMTP, no encryption choice in operator-key mode, each with a sentence saying why. All of it but Lists needs a network.

## 17. Reminders and notifications

### 17.1 What is sent

Off until a person turns it on in Settings. Then:

- **A daily brief,** once per local day at or after their time: "3 tasks due today · 2 overdue", linking to `/today`. Nothing on a day with nothing to say.
- **A reminder at a task's due time,** one per task, linking to the task.

A due time passed while the app was down is sent on the next tick of the same day. One missed by a whole day is not; it is in the next brief.

### 17.2 Channels

**The app's own notification list is always there.** A `notification` row per notice, read by the header's bell through `NotificationsPanel` from `@sovereignfs/ui`, and brought down by sync so that the bell works offline. This works on a server running alone, and needs no core. Each account keeps its latest 200, for 30 days.

Then, each by its own switch:

| Channel         | Needs                                                                                                | What it does                                                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web Push**    | `TASKS_VAPID_PUBLIC_KEY`, `TASKS_VAPID_PRIVATE_KEY`, `TASKS_VAPID_SUBJECT`                           | Through `web-push` and the service worker, per device (`push_subscription`), turned on from that device. Dead subscriptions (410, 404) are removed. Legacy's `runtime/src/push.ts` is the model. On iPhone it needs the PWA installed |
| **Email**       | `TASKS_SMTP_*`                                                                                       | The mailer of §6. Each message links to Settings to turn it off                                                                                                                                                                       |
| **Core's bell** | A linked Sovereign identity, `TASKS_CORE_*`, and the app scope `notifications:send` from an operator | `sv.app.notifications.send` to the `sub`. Automatic when hosted. Without the scope it is logged once and tried rarely, and everything else still works                                                                                |

- **`@sovereignfs/sdk` is used for this and for checking core's notices,** and for nothing else; sign-in is better-auth's. It is assumed an app token needs none of the SDK's session or token stores: the first task to use it confirms that.
- **A task's title leaves the database by these routes.** A Push payload is encrypted to the device, but email goes through the mail provider, and core stores its notifications. Settings says so.
- **One channel failing does not stop another** (`Promise.allSettled`, as legacy does).

### 17.3 Exactly once, as near as can be

The job runs once a minute. Any process may run it, and **the database decides who sends:** each send is a conditional update, and only the process whose update returned a row sends. The brief sets `last_digest_on = today` where it is null or earlier. A reminder sets `reminder_sent_at` where it is null. No lock: nothing here needs one, and SQLite has none.

The notification row and its fan-out follow. Core's `key` (`digest-2026-11-04`, `due-<id>-<date>`) means sending there again within a day is the same send. The plugin claimed, sent, and lost the notification if the send failed. Here the row is written in the claim's transaction, so the bell always gets it, and a channel that fails is retried on the next tick a few times, then given up, since Push and email have no such key and a doubled reminder is worse than a late one.

### 17.4 The query

Zones are not portable SQL, so the job reads the distinct zones of accounts with reminders on, works out the local date and time of each in JavaScript, and runs one statement per zone, using a partial index over open tasks with a time and no reminder sent. It reads `due_date`, `due_time` and `completed_at`, which the server mirrors from the fields of an account that is not personally encrypted (§22.3). Sends are made with a small concurrency. For core, its limits are respected: 600 a minute for the app and 60 an hour per person, with `429` and `Retry-After` honoured by leaving the rest to a later tick. One person's failure never stops the next person's.

When the server applies a change to a due date or time, it clears `reminder_sent_at`, so it fires again.

### 17.5 On an encrypted account

The server cannot read a due date, so **the browser uploads times only:** `reminder_slot` rows of when to notify, in UTC, computed from the tasks and the zone, for the next 14 days, replaced whenever they change. A slot has no link to any task, and a daily brief is a slot too.

- **Push wakes the device.** The service worker reads IndexedDB, decrypts, and shows the title, or the brief's counts. If nothing is due after all, it shows "Nothing due after all": browsers require a visible notification for a push.
- **The bell, email and core's bell say only "You have tasks due"**, linking to `/today`.
- **The operator can see those times,** and not what they are for. A device that has not synced for 14 days stops getting reminders, and Settings says so at the time it is turned on.

## 18. Export and import

One JSON file, from Settings, either way. That is the whole of portability: there is no bulk migration from the plugin, and core's account-level export is "later" (sdk §10).

```json
{
  "format": "sovereign-tasks",
  "version": 1,
  "exportedAt": "2026-11-04T09:00:00Z",
  "lists": [
    {
      "id": "…",
      "title": "…",
      "color": "blue",
      "position": "a0",
      "sort": "custom",
      "showCompleted": false,
      "tasks": [
        {
          "id": "…",
          "parentId": null,
          "title": "…",
          "notes": null,
          "starred": false,
          "dueDate": "2026-11-08",
          "dueTime": null,
          "seriesId": "…",
          "position": "a1",
          "completedAt": null,
          "reviewedAt": null,
          "createdAt": "…"
        }
      ]
    }
  ],
  "series": [{ "id": "…", "rule": "FREQ=WEEKLY;BYDAY=SA", "anchor": "2026-11-08" }],
  "settings": { "morningTime": "08:00" }
}
```

- **Made and read in the browser,** from the local store and into it, so that it works the same on any encryption mode. Plain JSON in the person's hands, with a warning if the account is encrypted.
- **Everything of theirs,** completed tasks included; not what was deleted, nothing about reminders having been sent or today's dismissals, and no key, backup connection or credential.
- **Written deterministically:** ordered by id, so that two exports of the same data differ only in `exportedAt`.
- **Import is additive.** It never replaces anything, every id is made new, and a file that fails validation changes nothing. It says what it found ("3 lists, 214 tasks") and asks before writing: importing twice would otherwise silently double everything. Existing settings are not overwritten. It goes to `POST /api/import` as one request and one transaction, encrypted first on an encrypted account.
- **Limits:** 50 MB, and the same limits on each field as anywhere else (§7). A file is untrusted input: rules go through §13.2.
- **It reads the plugin's file too,** `{ pluginId: "fs.sovereign.tasks", schemaVersion: 1, data }`, so that people on the plugin have a way across without anything more. Epoch seconds become times, integers become positions, each series gets an anchor from its open occurrence, `views` and `reminderSentAt` are ignored, and `assigneeId` is dropped.

## 19. Backup to git

A person can opt in to connecting a git repository of theirs, and Tasks commits their data to it, as a new file each time.

### 19.1 What a person does

In Settings > Data:

1. **Connect a repository** (§19.2).
2. **Choose a mode:**

| Mode     | What it does                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| `manual` | Only when they press **Back up now**                                                                              |
| `auto`   | On a frequency they choose: every hour, every 6 hours, daily (the default) or weekly. **Back up now** still works |

3. See the state: the repository, the last backup with a link to the file, the next, and what went wrong if something did. Change the mode or disconnect at any time.

**The repository can be a Fjord repository or anything else.** In a Fjord repository, `sovereign-tasks/` is an ordinary folder outside every vault (Fjord's spec §2), so nothing is needed from Fjord and `fjord verify` is not disturbed. There is no deeper tie: reusing Fjord's stored connection would couple two apps that can run apart. The first provider is GitHub; `Provider` leaves room for others.

### 19.2 Connecting, as Fjord does

The connection is Fjord Web's §7, for one repository per account:

- **Two ways in.** **The GitHub App** (`TASKS_GITHUB_APP_*`, preferred where the operator has set it up): the person installs it and chooses the repository; _Contents: read and write_ and _Metadata: read_ only; short-lived installation tokens, with no token kept. **A repository address and a fine-grained personal access token**, limited to that repository with _Contents: read and write_.
- **Checked before anything is kept,** in the order a person would fix things: GitHub accepts the token; it can see the repository; **the repository is private** (§19.5); the default branch has something in it; and the token can write, by `canWrite`, which tries something that changes nothing, since a repository's reported permissions are not to be trusted. Each refusal is a message of ours saying what to do, never GitHub's text, never the token. An empty repository is refused with "add a README first", as in Fjord.
- **Credentials at rest** are `src/crypto/`, as Fjord's: envelope encryption under `TASKS_ENCRYPTION_KEY`, bound to the row and purpose, with rotation by restart through `TASKS_ENCRYPTION_KEY_PREVIOUS`, and a server that refuses to start rather than lose one quietly. Without a key, Settings says why a repository cannot be connected.
- **A git host is reached only through `Provider`** (`src/providers/`), tested as Fjord's is: one contract, over a fake whose storage is a real git repository, an in-memory one the app is tested against, and GitHub's real answers recorded. Tasks needs a small part of it: `getRepository`, `canWrite`, `getHead` and `commit`. `TASKS_GITHUB_API_URL` covers an Enterprise Server. **Credentials never appear in an error, a log or a URL.**

### 19.3 What is committed

```
sovereign-tasks/2026-11-05_14-30-00.json
```

- **On the default branch,** under a folder `sovereign-tasks` at the repository's root, made by the first commit if it is not there. Other files in the repository are never touched.
- **The name is `YYYY-mm-dd_hh-mm-ss` in UTC,** when the backup was made, so that names sort in order whatever the account's time zone or daylight saving is doing. The extension is `json`.
- **The file is made on the server,** so that auto backups need no device. For a plain or operator-key account, it is §18's export exactly: a person can read it, and imports it as any other file. **For a personal-key account, the same shape holds ciphertext for each field and the wrapped list keys** (`"encrypted": true`), so the backup is as private as the database, and importing it needs the key.
- **To restore,** download it and import it in Settings. Import is additive, so restoring is for an empty account, or knowing it adds; it says what it found before writing.
- **The commit** is one file, made the way Fjord makes one (blobs, a tree on the head's, a commit, a fast-forward), **never forced**, with the message `Tasks backup 2026-11-05 14:30:00 UTC`, authored by the identity of the token or App.
- **Nothing is ever deleted or rewritten.** Each backup is a new file, and Tasks does not prune. A person who wants fewer removes them in git.

### 19.4 Running it

- **Auto backups are a job,** in the same timer as §17. A connection has `next_backup_at`; a process claims it by a conditional update, moving it on, so that one process does it. The data is read in a short transaction and closed; GitHub is called outside it.
- **Nothing changed, nothing committed.** An auto backup compares the account's `seq` with the one at the last backup, and if they match it only records that it looked. Daily backups of a quiet account do not make daily commits. **Back up now** always commits, since someone asked. It is limited to once a minute.
- **A backup holds what has synced.** A device's unsent changes are in the next one.
- **A branch that moved** (`head_moved`) is read again and tried once more in the same run: nothing conflicts, since the path is new.
- **A write is never retried on a lost answer,** as in Fjord: the commit may have happened. The next backup is a new file, so the worst case is one file too many.
- **Failures are kept and shown:** the kind of failure, when, and how many in a row. A network failure or rate limit tries again at the next due time. A token that stopped working, a repository gone, or one made public **stops auto backup**, says so in Settings, and adds a notification (§17.2). It never spins against GitHub.
- **Size:** the 50 MB limit of §18 holds here too, so a backup is never a file that could not be imported. Over it, the backup is refused and says so.

### 19.5 Privacy

Unless the account has a personal key, the file is **plain text**, with everything the person wrote, on GitHub's servers. So:

- **Only a private repository can be connected,** and each backup checks again, stopping if it has become public. This is so even in a Fjord repository with encrypted vaults, where this folder is still plain text. Settings says plainly what is being sent and where.
- **It is each person's own choice and own repository.** Nothing is backed up unless they connect one. An operator backing up the whole server is a different thing, and is their database's backup (§23).
- **Disconnecting** deletes the connection and its credential. **Deleting an account** does the same (§20). Neither touches the repository: what was committed is theirs, and remains. The account deletion screen says so.

### 19.6 Not in phase 1

A list of backups in the app with restore from there, GitLab or another host, and a choice of branch or folder.

## 20. Account deletion and signing out

**`People.deletePerson`** (`src/sovereign/people.ts`, as Fjord's) deletes everything of an account: tasks, lists and series, including what was soft-deleted; list keys, reminder slots, notifications, push subscriptions; settings; the backup connection and its credential; rate counters; passkeys, two-factor, sessions and sign-ins; the account. It is one routine, safe to run again: the row linking a `sub` to the account goes last, so a run that stopped can find the account. A test seeds one row of every table and finds nothing of that account after. A new table that holds something of a person fails it until it is included.

It is reached two ways:

- **From Settings > Data,** after the password or, for a Sovereign-only account, a fresh session. It says what will go, and that a backup repository will not. This device's local database goes too. Other devices find out at their next sync, and delete theirs.
- **From core's account-deleted notice,** when a Sovereign identity is linked: a signed token in a form, `POST`ed to `/api/sovereign/account-deleted`, checked by the SDK (`verifyAccountDeletedToken`), and answered `200` only once done, as app manifest §4 requires. Core retries for 30 days. An account that Sovereign was linked to with a password or a passkey is deleted whole, as the notice asks.

**Back-channel logout** is `/api/sovereign/backchannel-logout`, checked the same way, and ends all of the person's sessions. Both routes read a bounded form, count requests against one limit, refuse a replayed `jti`, and are 404 where Sovereign sign-in is not set up.

Removing the app's access in core leaves the data; the person can come back.

## 21. Sharing (phase 2)

After the MVP. Outlined here so phase 1 does not preclude it. It gets its own RFC before it is built.

- **A list can be shared with other accounts on this server,** as Fjord shares documents (its §12). No links and no guests. How an account is found is for the RFC: an instance can offer `directory.searchUsers` (the `directory` scope), and a server running alone cannot.
- **Roles:** one owner, and members. A member reads and edits tasks. Only the owner renames, deletes or shares the list. A member can leave; an owner must transfer or delete first.
- **Assignment:** a task may be assigned to a member. Removing a member unassigns theirs. Assigning sends a notification.
- **What changes:** a `list_member` table; §7's check becomes "a member of the list"; sync's cursor covers lists shared with an account; and order, sort and show-completed move to per-account.
- **With encryption:** the list key is wrapped for each member's public key (§9.2). A member with no key is the RFC's question.
- **When an owner's account is deleted,** a shared list passes to its longest-standing member, and goes if it has none. A deleted member's assignments are cleared, and the tasks stay.
- **A recurring task on a shared list** is also for that RFC.

## 22. Data model and database

### 22.1 Database

**As Fjord Web's §14, and read that for the detail.** `TASKS_DB_DIALECT` is `sqld` (the default), `sqlite` or `postgres`, read in one place; nothing infers it from a URL.

| Dialect              | Address                                                                       | For                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `sqld` (**default**) | `TASKS_SQLD_URL`, with `TASKS_SQLD_ADMIN_URL`                                 | Most installs. Namespaces `tasks` and `tasks_auth`. sqld 0.24.33 or later, since earlier ignore `x-namespace`                |
| `sqlite`             | `TASKS_SQLITE_URL`, `file:/data/tasks.db`                                     | The smallest self-host: one container. Auth is `tasks_auth.db` beside it. Never on a network filesystem. Needs a glibc image |
| `postgres`           | `TASKS_POSTGRES_URL` (or `_FILE`), `PGSSLROOTCERT`, `TASKS_POSTGRES_POOL_MAX` | An operator who prefers it, and what an instance gives. Schemas `tasks` and `tasks_auth`                                     |

- **Drizzle, a schema and a migration set per dialect,** generated with `pnpm db:generate` and never written by hand or `push`ed, applied at start-up. CI fails if generating would write anything. A **parity test** checks that the two dialects declare the same tables, columns and indexes.
- **Portable by rule:** standard SQL only, values bound, raw SQL through one small helper. **No `LISTEN/NOTIFY`, no trigger, no extension.** The dialect is chosen at install time; moving between them is §18's file, per account.
- **No foreign keys and no cascades in the app store,** as in Fjord: `account_id` is in the other store, and SQLite's enforcement depends on a per-connection setting. Every deletion names what it deletes, in a transaction, which is what `People` (§20) tests.
- **At start-up,** in `instrumentation.ts`, before anything is served, and it does not start if it cannot. Concurrent starts are safe: PostgreSQL takes an advisory lock on one pinned connection, and SQLite retries. So the manifest declares `database: true`, with no pooling, as Fjord's does.
- **Tested on every form, from the first task.** A data-layer test runs on sqld, a `file:` database and PostgreSQL in CI, and one that passes on only one is not done. Tests read `TASKS_TEST_*` and never the app's variables, so that `pnpm test` can never wipe a developer's data.

### 22.2 Representations

One per type, through the column vocabulary (`src/db/schema/*/columns.ts`), so that no table names a dialect's own type:

| Value             | Stored as                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Id                | Text, a UUID made by the client                                                                                                         |
| Time              | `epochMs`: a 64-bit integer, a `number` in JavaScript                                                                                   |
| Boolean           | The vocabulary's word, `0/1` on SQLite and `boolean` on PostgreSQL                                                                      |
| Date, time of day | Text, `YYYY-MM-DD` and `HH:MM` (§12)                                                                                                    |
| Position          | Text compared byte by byte: SQLite's default `BINARY`, and `COLLATE "C"` on PostgreSQL, which the vocabulary's `position` word declares |
| Fields            | JSON as text: a map of field name to `{ v }` or `{ c }`, plus the `seq` that last wrote it                                              |

### 22.3 Tables

Beyond better-auth's (`user`, `session`, `account`, `verification`, `two_factor`, `passkey`, `rate_limit`, in the auth store). A synced row has **structural columns the server uses, and a `fields` column it mostly does not.**

| Table    | Structural columns                                                                                                                                              | Fields                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `list`   | `id`, `owner_id`, `position`, `deleted_at`, `seq`, `created_at`                                                                                                 | `title`, `color`, `sort`, `showCompleted`                                                                 |
| `task`   | `id`, `owner_id`, `list_id`, `parent_id`, `position`, `deleted_at`, `seq`, `created_at`, `reminder_sent_at`, and mirrors `due_date`, `due_time`, `completed_at` | `title`, `notes`, `starred`, `dueDate`, `dueTime`, `seriesId`, `completedAt`, `reviewedAt`, `dismissedOn` |
| `series` | `id`, `owner_id`, `list_id`, `deleted_at`, `seq`, `created_at`                                                                                                  | `rule`, `anchor`                                                                                          |

- **The mirrors exist only for the reminder job.** The server copies them from `fields` when it can read them, and they are null on a personal-key account. They stay readable under the operator key (§9.5).
- **`CHECK`s on content are gone,** since the server cannot always read it. Validators hold those rules (§8.2).
- **The partial index for the reminder job:** open tasks with a time and no reminder sent. Others follow the queries: rows by account and `seq`, for pull.

| Other table         | Holds                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account_settings`  | `account_id` (primary key), `seq`, `time_zone`, `first_day_of_week`, `theme`, `reminders`, `email_reminders`, `morning_time`, `last_digest_on`, `encryption` (`none`, `moving`, `personal`), `recipient` (the age public key)                   |
| `list_key`          | `list_id`, `account_id`, `wrapped` (an age file), `seq`                                                                                                                                                                                         |
| `applied_mutation`  | `id`, `account_id`, when (§8.7)                                                                                                                                                                                                                 |
| `tombstone`         | `id`, `table`, `account_id`, `seq`, when (§8.7)                                                                                                                                                                                                 |
| `notification`      | `id`, `account_id`, `kind`, `title`, `body`, `url`, `read_at`, `seq`, `created_at`, and channels still to try                                                                                                                                   |
| `push_subscription` | `id`, `account_id`, `endpoint`, `p256dh`, `auth`, `created_at`                                                                                                                                                                                  |
| `reminder_slot`     | `id`, `account_id`, `at`, `claimed_at` (§17.5)                                                                                                                                                                                                  |
| `backup_connection` | `account_id` (primary key), `kind` (`token` or `app`), `repository`, `branch`, `credential_id`, `mode`, `frequency`, `next_backup_at`, `last_backup_at`, `last_backup_path`, `last_seq`, `failure_kind`, `failures`, `stopped_at`, `created_at` |
| `credential`        | As Fjord's: `id`, `purpose`, `kek_id`, `wrapped_key`, `ciphertext`, `created_at`, `rewrapped_at`                                                                                                                                                |
| `rate_bucket`       | As Fjord's: a key, when the window began, a count. Sync, Back up now, core's notices and their replay                                                                                                                                           |

**The browser's store** holds the same three synced tables, with their fields decrypted in memory only when read, plus the outbox, the cursor, keys if encrypted, and what the app remembers on this device.

## 23. Security, deployment, testing

### Security

Beyond §7: a strict Content-Security-Policy with a per-request nonce and the usual hardening headers from `proxy.ts`, with `worker-src 'self'` and `connect-src 'self'`; no `'unsafe-inline'` in `script-src`. Nothing third-party loads, and fonts are self-hosted at build. Task text is rendered as text, never as HTML, which matters more with keys in the page. Logs hold no titles, notes, tokens or file contents: an id and a kind of failure. A security review of phase 1 is written up before its release, as Fjord's are.

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
- **The manifest,** changed from the scaffold's, as Fjord's is: `"database": true`; the redirect `/api/auth/callback/sovereign`; `backChannel` and `accountDeleted` as in §20; scopes `openid profile email`; an `icon` and a real `description`; `generate` of `TASKS_AUTH_SECRET` and `{ "name": "TASKS_ENCRYPTION_KEY", "bytes": 32 }`; and `core` of at least 0.62.0, for notifications. `src/sovereign-manifest.test.ts` holds it to the schema and the code.
- **What an operator of an instance sets:** `TASKS_AUTH_SIGNUP=open`, the app scope `notifications:send`, VAPID keys, SMTP, and the GitHub App if they want it. The README says so.
- **Releases:** a `vX.Y.Z` tag publishes the image for amd64 and arm64 to `ghcr.io`, as the scaffold's workflow does. A patch release carries no migration and no change to a setting. A change to the sync protocol raises its version, and devices update (§8.3).
- **The operator's backups are the database's:** a snapshot of the sqld volume, Litestream or `.backup` for a file, `pg_dump` for PostgreSQL. A person's backup (§19) is not a substitute, nor the reverse. `TASKS_ENCRYPTION_KEY` is kept with secrets, apart from those backups.

### Testing

- **Vitest,** with pure rules tested directly, the server's sync on all three databases (§22.1), and the browser's store against `fake-indexeddb`. A rule that was hard to get right is seen to fail with it switched off.
- **Sync** with simulated devices: several local stores, one server, random orderings of offline edits, asserting that all converge on the same state. The most important test in the repository.
- **Encryption:** the server is checked to never hold a plain field for a personal-key account, by reading its tables after a full journey. A value moved to another row or field is refused.
- **Sign-in** against the fake Sovereign (§6). **Core's services** against `createFakeCore` from `@sovereignfs/sdk/testing`, including `core.fail(...)`, a lost answer included.
- **Backups** against `MemoryProvider` for the app, and the provider contract as §19.2 says.
- **Recurrence** with property tests, run under more than one `TZ`. **Time** by passing it in; no fake timers are needed.
- **Playwright,** including with the network off, for what only a browser can show, and **the iOS Simulator** for gestures, Push and offline (§15.8).
- A dev **seed** covering overdue, due today, repeating, starred, subtasks at each state, long titles and an empty list, as the plugin's `scripts/seed.ts` did.

## 24. Open questions

None at present. New ones go here, each with a recommendation, until they are decided and moved to §25.

## 25. Decision log

| Decision                                                                                                                               | Why                                                                                                                                       | Rejected                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| An app of the suite exactly like Fjord: runs alone or hosted (2026-11-05)                                                              | The owner's direction                                                                                                                     | Hosted only, as the scaffold makes it                                                                                  |
| Auth identical to Fjord: better-auth, local and Sovereign, linking by `sub` from a session                                             | The owner's direction; one set of rules across the suite                                                                                  | The SDK's `nextAuth`, which needs a core                                                                               |
| sqld, a file or PostgreSQL, through Drizzle, as Fjord (2026-11-05)                                                                     | The owner's direction; running alone wants SQLite                                                                                         | PostgreSQL only, which this design first proposed                                                                      |
| Offline-first from the first screen, in the MVP (2026-11-05)                                                                           | The owner's direction: sync and conflicts in the background with no effect on the experience. Retrofitting it would be close to a rewrite | Server actions and a client cache, which this design first proposed; offline as a later release                        |
| Browser actions produce field-level changes; the server checks structure and stamps order, rather than running the same logic          | It is the only form that also works on ciphertext, and it unifies the modes                                                               | The same operations run on both sides, which an encrypted account cannot do                                            |
| Later arrival wins per field, an edit restores a delete, and nothing asks                                                              | The owner's direction: no conflict UI. Fields are small, so overwrites are rare                                                           | CRDTs for text, far more than notes need; conflict dialogs                                                             |
| Our own small sync, not a library                                                                                                      | It has to work over sqld, a file and PostgreSQL, on ciphertext, with AGPL-compatible parts, and it is small given §8.2                    | Replicache, PowerSync, ElectricSQL                                                                                     |
| Opt-in personal key, wrapping per-list keys that encrypt fields (2026-11-05)                                                           | The owner's direction: the operator cannot read it. Per-list keys leave sharing possible                                                  | age per field (too large); one key for everything (no way to share)                                                    |
| Personal key at sign-up or later, one way                                                                                              | Keeps the states simple; going back is export and a new account                                                                           | Sign-up only; on and off at will                                                                                       |
| Unlocked once per device, until sign-out                                                                                               | The owner's direction: no felt difference. Offline and Push titles need it                                                                | Fjord's passphrase and idle lock                                                                                       |
| Times only for reminders on an encrypted account                                                                                       | The closest to "everything encrypted" that still reminds                                                                                  | Readable due dates; no reminders                                                                                       |
| An `.env` operator key, which disables personal keys (2026-11-05)                                                                      | The owner's direction. Built as field encryption, the only way alike on three forms                                                       | Dropping it, which was recommended, since the operator can read regardless; having both at once                        |
| The app's own bell, Web Push and email, each switchable, and core's bell when hosted (2026-11-05)                                      | The owner's direction; works on a server running alone                                                                                    | Core's bell only                                                                                                       |
| Mobile opens on Today on fresh opens, with exceptions (2026-11-05)                                                                     | The owner's direction, without interrupting a quick switch of apps or a link to a task                                                    | Every time the app comes to the foreground                                                                             |
| Cards: up done, down cancel, left dismiss, right star, alike in Today and Review (2026-11-05)                                          | The owner's direction. One set of gestures to learn                                                                                       | Snooze by moving the date and "keep for today", which this design first took from the plugin; different swipes in each |
| Cancel deletes with Undo, and on a repeating task skips this occurrence (2026-11-05)                                                   | The owner's direction. Nothing else needs a "cancelled" state                                                                             | A kept "cancelled" status                                                                                              |
| Dismiss hides a task from Today until tomorrow, by a `dismissedOn` field, with its date and status untouched, and an Undo (2026-11-05) | The owner's direction. It needs no clearing and syncs like any field                                                                      | Until Today is next opened; moving the due date; a "dismissed until" time of day                                       |
| Dismiss affects only Today: reminders and the brief still count the task, and it shows in its list, Starred and search (2026-11-05)    | It is still due, and a person should still be told                                                                                        | Keeping a dismissed task quiet for the day                                                                             |
| In Review, a left swipe only marks a task reviewed, and does not hide it from Today (2026-11-05)                                       | Review goes through everything; hiding things from Today would be a surprising side effect                                                | The same effect as Today's Dismiss                                                                                     |
| A next occurrence and an export carry no dismissal (2026-11-05)                                                                        | It belongs to one task on one day                                                                                                         | Copying it                                                                                                             |
| Google Tasks import and the last Friday of the month wait for phase 3 (2026-11-05)                                                     | Neither is needed to replace the plugin; the rule format already allows the second                                                        | Doing them in the MVP                                                                                                  |
| No snooze that moves a date, and so no `occurs_on`                                                                                     | A task's date is its schedule, since Dismiss leaves it alone. Date edits move the series                                                  | A separate scheduled date                                                                                              |
| Review orders by `reviewed_at`, with entry from the switcher, the sidebar and a list's menu                                            | It can be stopped and resumed. Entry points are visible, not a hidden gesture                                                             | Long-pressing a footer button                                                                                          |
| One Settings, from the avatar                                                                                                          | The owner's direction; one place to look                                                                                                  | Separate account and settings pages                                                                                    |
| A desktop of two rows and three columns, at Shopper's dimensions                                                                       | The owner's direction                                                                                                                     | The plugin's full-height columns                                                                                       |
| Recurring edits apply to that occurrence and later ones, with no prompt and no new row (2026-11-05)                                    | The owner's direction, and what the model can honestly do                                                                                 | The plugin's three-way prompt; real future rows                                                                        |
| Subtasks are copied to the next occurrence, unticked (2026-11-05)                                                                      | A repeating checklist is the natural use                                                                                                  | Starting the next with none, as the plugin did                                                                         |
| Kanban, Visualizer and `tasks_views` dropped (2026-11-05)                                                                              | Never built, and Kanban is its own product                                                                                                | Reserving a table for them                                                                                             |
| One JSON file is the whole of portability (2026-11-05)                                                                                 | The owner's direction                                                                                                                     | An operator's bulk migration from the plugin                                                                           |
| Backup is a person's own, opt-in, to their own private repository, as a new timestamped file (2026-11-05)                              | The owner's direction; the file is the export, so needs no tool to read                                                                   | Overwriting one file; a backup format of its own; allowing public repositories                                         |
| A Fjord repository works as is, with no integration                                                                                    | The folder is valid in Fjord's format, and the apps stay independent                                                                      | Reusing Fjord's stored connection                                                                                      |
| Backup names are in UTC                                                                                                                | They sort correctly through time zones and daylight saving                                                                                | The account's local time                                                                                               |
| Auto backup commits only when something changed                                                                                        | A quiet account should not fill a repository with identical files                                                                         | A commit on every tick                                                                                                 |
| Owner named in the statement, with `owner_id` on every row                                                                             | Closes the plugin's id-only writes for good, and can be tested                                                                            | A separate ownership check first; joining to the list                                                                  |
| Fractional positions, through `fractional-indexing` (CC0)                                                                              | One row per move; survives offline devices                                                                                                | Integers with rewrite, as the plugin; integers with gaps and rebalancing                                               |
| `series` table with `anchor`                                                                                                           | Lateness stops corrupting the schedule; the rule is in one place                                                                          | The rule copied to every row, anchored on the current due date                                                         |
| One function for today, with the browser's zone in the browser and the stored one in jobs                                              | Removes the plugin's three                                                                                                                | Deciding by the server's clock                                                                                         |
| Undo through `deleted_at`, on tasks and lists, purged in seven days                                                                    | A swipe must not be able to lose something; no trash to design                                                                            | Hard delete with confirmations (a swipe can't stop to ask); a real trash (more than this app is)                       |
| One route tree, forking only what is rendered                                                                                          | Sovereign's rule; ends the double mount and two data paths                                                                                | Two trees by `matchMedia`                                                                                              |
| Task data in IndexedDB, never in the service worker's cache, deleted at sign-out                                                       | Offline needs it on the device; keeping it out of the cache holds Sovereign's worker rule                                                 | The plugin's cache with no wipe of its own; nothing on the device, which this design first proposed                    |
| PWA modelled on Sovereign core                                                                                                         | Fjord has no manifest or worker to follow                                                                                                 | —                                                                                                                      |
| Claim and write the notification in one transaction, then fan out                                                                      | The bell never misses one; a failed channel can retry                                                                                     | Claim then send (loses it on failure); send then claim (doubles it)                                                    |
| Jobs in the web process                                                                                                                | As Fjord decided: one image, one entry point; claims make replicas safe                                                                   | A separate worker image; an external cron                                                                              |
| Own file format, reading the plugin's                                                                                                  | People on the plugin need a way across; the plugin's envelope names an id that no longer means anything                                   | Keeping the plugin's envelope                                                                                          |
