# Roadmap

The order of work. **This file tracks progress; it does not define behaviour.** [`DESIGN.md`](DESIGN.md) says what Tasks does, and where it disagrees with this file, this file is stale and should be corrected. The detail of every task, with its technical notes and what makes it done, is in [`docs/epics/`](docs/epics/). How a task is run is in [`AGENTS.md`](AGENTS.md).

State as of 2026-11-05: **the design is a draft and nothing is built.** The repository holds the scaffold. The developer assigns each task; the first row not done, with its dependencies met, is what the order recommends.

_Status key: ✅ Done · ⏳ In progress · 📋 Planned · 🚧 Waits on a decision_

_Priority:_ **P0** nothing else can stand without it · **P1** the product · **P2** needed before the first release · **P3** can follow the first release if it must

## How this is ordered

Five questions decide it, in this order:

1. **What can everything else not stand on without?** Tooling, the database in its three forms, and the access rule, so that no line of the product is written without them. Retrofitting three databases or the owner-in-every-statement rule is the expensive mistake.
2. **What makes it usable soonest?** A person running it alone needs nothing outside the app. Self-hosted lists and tasks come before a core is involved, so that it can be used from Milestone B, and everything after is tested by use.
3. **What is the plugin's daily value?** Dates, repeats, Today and the phone come next, since that is why anyone would use it.
4. **What protects data people have started trusting it with?** Export lands in Milestone C, as soon as due dates do, since its format needs them. Import and backup are Milestone D.
5. **What makes it part of the suite, and releasable?** Sovereign sign-in and hosting, then reminders, which need them, then review and release.

Reminders come late, though the plugin had them, because they need Sovereign sign-in and nothing else needs them. Backup comes before Sovereign sign-in because a person running alone has only that to protect their data. The GitHub App (10.7) is P3: a token connects a repository without it, so the first release can go without it if it must.

## Phase 1

### Milestone A — Foundation

The repository can hold the app. Nothing a person would notice. **Done when** an empty database boots on all three forms from the image, and CI proves it.

| # | ID | Task | Priority | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | [1.1](docs/epics/foundation.md) | Repository conventions | P0 | — | 📋 |
| 2 | [1.2](docs/epics/foundation.md) | Format, lint and test tooling | P0 | 1.1 | 📋 |
| 3 | [1.3](docs/epics/foundation.md) | Continuous integration | P0 | 1.2 | 📋 |
| 4 | [1.4](docs/epics/foundation.md) | Configuration, start-up, and removing the scaffold | P0 | 1.2 | 📋 |
| 5 | [1.5](docs/epics/foundation.md) | The database layer | P0 | 1.4 | 📋 |
| 6 | [1.8](docs/epics/foundation.md) | Design system boundary and shell | P0 | 1.2 | 📋 |
| 7 | [1.7](docs/epics/foundation.md) | Security headers | P0 | 1.4 | 📋 |
| 8 | [1.6](docs/epics/foundation.md) | The job runner | P0 | 1.5 | 📋 |
| 9 | [1.9](docs/epics/foundation.md) | Browser tests | P0 | 1.5 | 📋 |
| 10 | [1.10](docs/epics/foundation.md) | The image and deployment setups | P0 | 1.5, 1.6 | 📋 |

### Milestone B — First use

One person, running it alone, keeps real lists in it. **Done when** it can be used on a desktop browser for tasks with no dates.

| # | ID | Task | Priority | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 11 | [2.1](docs/epics/accounts.md) | Local sign-in | P0 | 1.5, 1.8 | 📋 |
| 12 | [3.1](docs/epics/lists-and-tasks.md) | Access rules and input parsing | P0 | 1.5, 2.1 | 📋 |
| 13 | [3.2](docs/epics/lists-and-tasks.md) | Positions | P0 | 1.5 | 📋 |
| 14 | [7.1](docs/epics/interface.md) | Three columns and the client store | P0 | 1.8, 2.1 | 📋 |
| 15 | [3.3](docs/epics/lists-and-tasks.md) | Lists | P1 | 3.1, 3.2, 7.1 | 📋 |
| 16 | [2.2](docs/epics/accounts.md) | Landing page and the address `/` | P1 | 2.1 | 📋 |
| 17 | [3.4](docs/epics/lists-and-tasks.md) | Tasks | P1 | 3.3 | 📋 |
| 18 | [11.1](docs/epics/release.md) | Development seed | P1 | 3.4 | 📋 |
| 19 | [3.5](docs/epics/lists-and-tasks.md) | Subtasks | P1 | 3.4 | 📋 |
| 20 | [3.6](docs/epics/lists-and-tasks.md) | Manual order | P1 | 3.2, 3.4 | 📋 |
| 21 | [3.7](docs/epics/lists-and-tasks.md) | Undo and purge | P1 | 1.6, 3.3, 3.4 | 📋 |
| 22 | [3.9](docs/epics/lists-and-tasks.md) | Filter, sort and completed | P1 | 3.4 | 📋 |
| 23 | [3.8](docs/epics/lists-and-tasks.md) | Moving a task to another list | P1 | 3.5 | 📋 |
| 24 | [3.10](docs/epics/lists-and-tasks.md) | Star | P1 | 3.4 | 📋 |

### Milestone C — Daily driver

Everything that makes it worth opening each day, on a desktop and a phone. **Done when** it can replace the plugin for someone on one account. Export (row 28) lands as soon as due dates do, so people's data can leave from here on.

| # | ID | Task | Priority | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 25 | [4.1](docs/epics/dates.md) | One idea of today | P1 | 1.5, 2.1 | 📋 |
| 26 | [4.2](docs/epics/dates.md) | Due date and time | P1 | 3.4, 4.1 | 📋 |
| 27 | [4.3](docs/epics/dates.md) | Overdue, and pinning to the top | P1 | 3.6, 3.9, 4.2 | 📋 |
| 28 | [9.1](docs/epics/portability.md) | Export | P1 | 3.7, 3.10, 4.2 | 📋 |
| 29 | [5.1](docs/epics/recurrence.md) | The rule module | P1 | 4.1 | 📋 |
| 30 | [5.2](docs/epics/recurrence.md) | Series and completing | P1 | 3.5, 4.2, 5.1 | 📋 |
| 31 | [5.3](docs/epics/recurrence.md) | The repeat picker | P1 | 5.2 | 📋 |
| 32 | [5.4](docs/epics/recurrence.md) | Editing a recurring task | P1 | 5.2, 5.3 | 📋 |
| 33 | [5.5](docs/epics/recurrence.md) | Reopening, moving and deleting occurrences | P1 | 3.7, 3.8, 5.4 | 📋 |
| 34 | [6.1](docs/epics/views.md) | Starred | P1 | 3.10, 4.2, 7.1 | 📋 |
| 35 | [6.2](docs/epics/views.md) | Search | P1 | 3.5, 7.1 | 📋 |
| 36 | [6.3](docs/epics/views.md) | Today | P1 | 3.7, 4.3, 5.4, 7.1 | 📋 |
| 37 | [7.2](docs/epics/interface.md) | The mobile carousel | P1 | 3.3, 3.4, 6.1 | 📋 |
| 38 | [7.3](docs/epics/interface.md) | Sheets and adaptive surfaces | P1 | 7.2 | 📋 |
| 39 | [7.4](docs/epics/interface.md) | Touch gestures | P1 | 3.6, 7.2 | 📋 |
| 40 | [7.5](docs/epics/interface.md) | Keyboard | P2 | 3.4, 3.9 | 📋 |
| 41 | [3.11](docs/epics/lists-and-tasks.md) | Bulk select | P2 | 3.7, 3.8, 7.4 | 📋 |

### Milestone D — Data is safe

A person's data can come in and go out, and keeps itself safe in their own repository. **Done when** a backup restores into an empty account.

| # | ID | Task | Priority | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 42 | [9.2](docs/epics/portability.md) | Import | P1 | 5.2, 9.1 | 📋 |
| 43 | [10.1](docs/epics/backup.md) | Credentials at rest | P1 | 1.5 | 📋 |
| 44 | [10.2](docs/epics/backup.md) | The provider, and GitHub | P1 | 1.2 | 📋 |
| 45 | [10.3](docs/epics/backup.md) | Connecting with a token | P1 | 9.1, 10.1, 10.2 | 📋 |
| 46 | [10.4](docs/epics/backup.md) | Making a backup | P1 | 10.3 | 📋 |
| 47 | [10.5](docs/epics/backup.md) | Modes, and the auto job | P1 | 1.6, 10.4 | 📋 |
| 48 | [10.6](docs/epics/backup.md) | Failures | P1 | 10.5 | 📋 |
| 49 | [9.3](docs/epics/portability.md) | Reading the plugin's file | P2 | 9.2 | 📋 |
| 50 | [10.7](docs/epics/backup.md) | Connecting through the GitHub App | P3 | 10.6 | 📋 |

### Milestone E — Part of the suite

It signs in like Fjord in every way, an instance can host it, and it can remind people. **Done when** `deploy-check.sh sovereign` passes and a reminder reaches the fake core's bell.

| # | ID | Task | Priority | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 51 | [2.7](docs/epics/accounts.md) | The account page | P1 | 2.1 | 📋 |
| 52 | [2.3](docs/epics/accounts.md) | Email: verification and reset | P1 | 2.1 | 📋 |
| 53 | [2.4](docs/epics/accounts.md) | Two-factor and passkeys | P1 | 2.1, 2.7 | 📋 |
| 54 | [2.8](docs/epics/accounts.md) | People, and deleting an account | P1 | 2.7, 3.4 | 📋 |
| 55 | [2.5](docs/epics/accounts.md) | Sovereign sign-in | P1 | 2.1 | 📋 |
| 56 | [2.6](docs/epics/accounts.md) | Linking a Sovereign identity | P1 | 2.5, 2.7 | 📋 |
| 57 | [2.9](docs/epics/accounts.md) | Notices from core | P1 | 2.5, 2.8 | 📋 |
| 58 | [2.10](docs/epics/accounts.md) | Hosting on an instance | P1 | 1.10, 2.9 | 📋 |
| 59 | [8.1](docs/epics/reminders.md) | Reminder settings | P1 | 2.5, 4.1, 9.1 | 📋 |
| 60 | [8.2](docs/epics/reminders.md) | Sending through core | P1 | 2.5 | 📋 |
| 61 | [8.3](docs/epics/reminders.md) | The morning digest | P1 | 1.6, 4.3, 8.1, 8.2 | 📋 |
| 62 | [8.4](docs/epics/reminders.md) | Due-time reminders | P1 | 8.3 | 📋 |

### Milestone F — First release

Reviewed, documented, released, and on a real instance. **Done when** someone has used it for a week and the plugin can be retired.

| # | ID | Task | Priority | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 63 | [7.6](docs/epics/interface.md) | Accessibility pass | P2 | 3.11, 6.3, 7.3, 7.4, 7.5 | 📋 |
| 64 | [11.2](docs/epics/release.md) | Documents | P2 | 2.10, 10.6 | 📋 |
| 65 | [11.3](docs/epics/release.md) | Security review | P2 | 2.9, 8.4, 9.3, 10.6 | 📋 |
| 66 | [11.4](docs/epics/release.md) | The release process | P2 | 1.10 | 📋 |
| 67 | [11.5](docs/epics/release.md) | First release, on a real instance | P2 | 7.6, 11.2, 11.3, 11.4 | 📋 |

## Phase 2 — Sharing

Waits on the first release, and starts with an RFC.

| # | ID | Task | Priority | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 68 | [12.1](docs/epics/sharing.md) | RFC: sharing | — | 11.5 | 📋 |
| 69 | [12.2](docs/epics/sharing.md) | Membership (outline) | — | 12.1 | 📋 |
| 70 | [12.3](docs/epics/sharing.md) | Sharing a list (outline) | — | 12.2 | 📋 |
| 71 | [12.4](docs/epics/sharing.md) | Assignment (outline) | — | 12.3 | 📋 |

## Phase 3 — Candidates

Not committed, not tasks yet. Each becomes one when it is chosen.

| What | Note |
| --- | --- |
| Google Tasks import | Takeout's JSON; cheap beside 9.2 (`DESIGN.md` §21) |
| The last Friday of the month | A picker change; the rule format already allows it (§21) |
| Encrypted backups | `age`, as Fjord's vaults (§16.6) |
| A list of backups in the app, with restore from there | §16.6 |
| Reminders beyond core's bell | Email, or core's relay when it exists (§14.2) |

## What can run alongside

The order is a recommendation, not a queue. These have no dependency between them, if two agents are working: 1.7, 1.8 and 1.6 once 1.5 is in; 3.2 and 7.1; 3.5, 3.9 and 3.10; 5.1 and 6.2; 10.1 and 10.2; 2.3, 2.5 and 2.7; 8.2 beside 2.6.
