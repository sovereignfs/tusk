# Roadmap

The order of work. **This file tracks progress; it does not define behaviour.** [`DESIGN.md`](DESIGN.md) says what Tasks does, and where it disagrees with this file, this file is stale and should be corrected. The detail of every task, with its technical notes and what makes it done, is in [`docs/epics/`](docs/epics/). How a task is run is in [`AGENTS.md`](AGENTS.md).

State as of 2026-11-05: **Milestone A is done** (1.1 to 1.10). The scaffold is gone; the manifest still names its sign-in paths, which 2.10 replaces. Milestone B is next, and its first task is local sign-in (2.1). The developer assigns each task; the first row not done, with its dependencies met, is what the order recommends.

_Status key: ✅ Done · ⏳ In progress · 📋 Planned · 🚧 Waits on a decision_

_Priority:_ **P0** nothing else can stand without it · **P1** the product · **P2** needed before the first release · **P3** can follow the first release if it must

## How this is ordered

Five questions decide it, in this order:

1. **What can everything else not stand on without?** Tooling, the database in its three forms, the access rule, and **the sync path**, so that no screen is written against anything else. Retrofitting offline-first, three databases or the owner rule is the expensive mistake.
2. **What makes it usable soonest?** A person running it alone needs nothing outside the app. Self-hosted lists and tasks come before a core is involved, so that it can be used from Milestone B, and everything after is tested by use.
3. **What is the daily value?** Dates, repeats, Today, cards and the phone come next, since that is why anyone would use it.
4. **What protects data people have started trusting it with?** Export lands in Milestone C, as soon as due dates do, since its format needs them. Import, backup and encryption are Milestone D.
5. **What makes it part of the suite, and releasable?** The rest of Fjord's sign-in, hosting and reminders, then review and release.

Reminders come in Milestone E, since they need Settings and email, and are worth little until the daily views are in use. Personal keys come before them all the same, so that reminders are built knowing what they cannot read; their encrypted form (14.6) follows them. The GitHub App (10.7) is P3: a token connects a repository without it, so the first release can go without it if it must.

## Phase 1 — the MVP

### Milestone A — Foundation

The repository can hold the app. Nothing a person would notice. **Done when** an empty database boots on all three forms from the image, and CI proves it.

| #   | ID                               | Task                                               | Priority | Depends on | Status |
| --- | -------------------------------- | -------------------------------------------------- | -------- | ---------- | ------ |
| 1   | [1.1](docs/epics/foundation.md)  | Repository conventions                             | P0       | —          | ✅     |
| 2   | [1.2](docs/epics/foundation.md)  | Format, lint and test tooling                      | P0       | 1.1        | ✅     |
| 3   | [1.3](docs/epics/foundation.md)  | Continuous integration                             | P0       | 1.2        | ✅     |
| 4   | [1.4](docs/epics/foundation.md)  | Configuration, start-up, and removing the scaffold | P0       | 1.2        | ✅     |
| 5   | [1.5](docs/epics/foundation.md)  | The database layer                                 | P0       | 1.4        | ✅     |
| 6   | [1.8](docs/epics/foundation.md)  | Design system boundary and shell                   | P0       | 1.2        | ✅     |
| 7   | [1.7](docs/epics/foundation.md)  | Security headers                                   | P0       | 1.4        | ✅     |
| 8   | [1.6](docs/epics/foundation.md)  | The job runner                                     | P0       | 1.5        | ✅     |
| 9   | [1.9](docs/epics/foundation.md)  | Browser tests                                      | P0       | 1.5        | ✅     |
| 10  | [1.10](docs/epics/foundation.md) | The image and deployment setups                    | P0       | 1.5, 1.6   | ✅     |

### Milestone B — First use, offline from the start

One person, running it alone, keeps real lists in it, and it works with the network off. **Done when** it can be installed and used on a desktop browser, offline and back, for tasks with no dates.

| #   | ID                                    | Task                                    | Priority | Depends on     | Status |
| --- | ------------------------------------- | --------------------------------------- | -------- | -------------- | ------ |
| 11  | [2.1](docs/epics/accounts.md)         | Local sign-in                           | P0       | 1.5, 1.8       | ✅     |
| 12  | [3.1](docs/epics/lists-and-tasks.md)  | Access rules and input parsing          | P0       | 1.5, 2.1       | 📋     |
| 13  | [13.1](docs/epics/sync.md)            | The change format and validators        | P0       | 3.1            | 📋     |
| 14  | [13.2](docs/epics/sync.md)            | The sync endpoint                       | P0       | 13.1           | 📋     |
| 15  | [13.3](docs/epics/sync.md)            | The local store and outbox              | P0       | 13.1           | 📋     |
| 16  | [13.4](docs/epics/sync.md)            | First load, sign-out and ended sessions | P0       | 13.2, 13.3     | 📋     |
| 17  | [3.2](docs/epics/lists-and-tasks.md)  | Positions                               | P0       | 1.5            | 📋     |
| 18  | [7.1](docs/epics/interface.md)        | Desktop layout, over the local store    | P0       | 1.8, 13.3      | 📋     |
| 19  | [3.3](docs/epics/lists-and-tasks.md)  | Lists                                   | P1       | 3.2, 7.1, 13.4 | 📋     |
| 20  | [2.2](docs/epics/accounts.md)         | Landing page and the address `/`        | P1       | 2.1            | 📋     |
| 21  | [3.4](docs/epics/lists-and-tasks.md)  | Tasks                                   | P1       | 3.3            | 📋     |
| 22  | [11.1](docs/epics/release.md)         | Development seed                        | P1       | 3.4            | 📋     |
| 23  | [3.5](docs/epics/lists-and-tasks.md)  | Subtasks                                | P1       | 3.4            | 📋     |
| 24  | [3.6](docs/epics/lists-and-tasks.md)  | Manual order                            | P1       | 3.2, 3.4       | 📋     |
| 25  | [3.7](docs/epics/lists-and-tasks.md)  | Undo                                    | P1       | 3.3, 3.4       | 📋     |
| 26  | [13.7](docs/epics/sync.md)            | Keeping the history small               | P1       | 1.6, 13.2      | 📋     |
| 27  | [3.9](docs/epics/lists-and-tasks.md)  | Filter, sort and completed              | P1       | 3.4            | 📋     |
| 28  | [3.8](docs/epics/lists-and-tasks.md)  | Moving a task to another list           | P1       | 3.5            | 📋     |
| 29  | [3.10](docs/epics/lists-and-tasks.md) | Star                                    | P1       | 3.4            | 📋     |
| 30  | [1.11](docs/epics/foundation.md)      | The PWA                                 | P1       | 1.7, 1.8       | 📋     |
| 31  | [13.6](docs/epics/sync.md)            | Working offline                         | P1       | 1.11, 13.4     | 📋     |
| 32  | [2.7](docs/epics/accounts.md)         | Settings                                | P1       | 2.1, 3.3       | 📋     |

### Milestone C — Daily driver

Everything that makes it worth opening each day, on a desktop and a phone. **Done when** it can replace the plugin for someone on one account. Export lands as soon as due dates do, so people's data can leave from here on.

| #   | ID                                    | Task                                                   | Priority | Depends on           | Status |
| --- | ------------------------------------- | ------------------------------------------------------ | -------- | -------------------- | ------ |
| 33  | [4.1](docs/epics/dates.md)            | One idea of today                                      | P1       | 1.5, 2.1             | 📋     |
| 34  | [4.2](docs/epics/dates.md)            | Due date and time                                      | P1       | 3.4, 4.1             | 📋     |
| 35  | [4.3](docs/epics/dates.md)            | Overdue, and pinning to the top                        | P1       | 3.6, 3.9, 4.2        | 📋     |
| 36  | [9.1](docs/epics/portability.md)      | Export                                                 | P1       | 2.7, 3.7, 3.10, 4.2  | 📋     |
| 37  | [5.1](docs/epics/recurrence.md)       | The rule module                                        | P1       | 4.1                  | 📋     |
| 38  | [5.2](docs/epics/recurrence.md)       | Series and completing                                  | P1       | 3.5, 4.2, 5.1        | 📋     |
| 39  | [13.5](docs/epics/sync.md)            | Convergence tests                                      | P0       | 3.5, 5.2, 13.2, 13.3 | 📋     |
| 40  | [5.3](docs/epics/recurrence.md)       | The repeat picker                                      | P1       | 5.2                  | 📋     |
| 41  | [5.4](docs/epics/recurrence.md)       | Editing a recurring task                               | P1       | 5.2, 5.3             | 📋     |
| 42  | [5.5](docs/epics/recurrence.md)       | Reopening, moving, cancelling and deleting occurrences | P1       | 3.7, 3.8, 5.4        | 📋     |
| 43  | [6.1](docs/epics/views.md)            | Starred                                                | P1       | 3.10, 4.2, 7.1       | 📋     |
| 44  | [6.2](docs/epics/views.md)            | Search                                                 | P1       | 3.5, 7.1             | 📋     |
| 45  | [7.2](docs/epics/interface.md)        | The mobile shell and carousel                          | P1       | 3.3, 3.4             | 📋     |
| 46  | [7.3](docs/epics/interface.md)        | The footer: switcher, add, Today                       | P1       | 7.2                  | 📋     |
| 47  | [7.4](docs/epics/interface.md)        | Sheets and adaptive surfaces                           | P1       | 7.2                  | 📋     |
| 48  | [6.3](docs/epics/views.md)            | Today                                                  | P1       | 3.7, 4.3, 7.3        | 📋     |
| 49  | [6.4](docs/epics/views.md)            | Cards                                                  | P1       | 5.5, 6.3             | 📋     |
| 50  | [6.5](docs/epics/views.md)            | Review                                                 | P1       | 6.4, 7.3             | 📋     |
| 51  | [7.5](docs/epics/interface.md)        | Touch gestures                                         | P1       | 3.6, 7.2             | 📋     |
| 52  | [7.6](docs/epics/interface.md)        | Keyboard                                               | P2       | 3.4, 3.9             | 📋     |
| 53  | [3.11](docs/epics/lists-and-tasks.md) | Bulk select                                            | P2       | 3.7, 3.8, 7.5        | 📋     |

### Milestone D — Data is safe

A person's data can come in and go out, keeps itself safe in their own repository, and can be theirs alone to read. **Done when** a backup restores into an empty account, and a full journey on a personal key leaves no plain field on the server.

| #   | ID                               | Task                                | Priority | Depends on       | Status |
| --- | -------------------------------- | ----------------------------------- | -------- | ---------------- | ------ |
| 54  | [9.2](docs/epics/portability.md) | Import                              | P1       | 5.2, 9.1         | 📋     |
| 55  | [10.1](docs/epics/backup.md)     | Credentials at rest                 | P1       | 1.5              | 📋     |
| 56  | [10.2](docs/epics/backup.md)     | The provider, and GitHub            | P1       | 1.2              | 📋     |
| 57  | [10.3](docs/epics/backup.md)     | Connecting with a token             | P1       | 2.7, 10.1, 10.2  | 📋     |
| 58  | [10.4](docs/epics/backup.md)     | Making a backup                     | P1       | 9.1, 10.3, 13.2  | 📋     |
| 59  | [10.5](docs/epics/backup.md)     | Modes, and the auto job             | P1       | 1.6, 10.4        | 📋     |
| 60  | [14.1](docs/epics/encryption.md) | Keys and the field cipher           | P1       | 13.1             | 📋     |
| 61  | [14.2](docs/epics/encryption.md) | Setting up a key                    | P1       | 2.1, 14.1        | 📋     |
| 62  | [14.3](docs/epics/encryption.md) | Encrypting through the sync path    | P1       | 13.3, 14.2       | 📋     |
| 63  | [14.4](docs/epics/encryption.md) | Turning it on later                 | P1       | 14.3             | 📋     |
| 64  | [14.5](docs/epics/encryption.md) | Encrypted export, import and backup | P1       | 9.2, 10.4, 14.3  | 📋     |
| 65  | [14.7](docs/epics/encryption.md) | Operator-key mode                   | P2       | 10.1, 13.2, 14.2 | 📋     |
| 66  | [9.3](docs/epics/portability.md) | Reading the plugin's file           | P2       | 9.2              | 📋     |

### Milestone E — Part of the suite

It signs in like Fjord in every way, an instance can host it, and it can remind people. **Done when** `deploy-check.sh sovereign` passes, and a reminder reaches the bell, a device by Push, and an inbox.

| #   | ID                               | Task                              | Priority | Depends on         | Status |
| --- | -------------------------------- | --------------------------------- | -------- | ------------------ | ------ |
| 67  | [2.3](docs/epics/accounts.md)    | Email: verification and reset     | P1       | 2.1                | 📋     |
| 68  | [2.4](docs/epics/accounts.md)    | Two-factor and passkeys           | P1       | 2.1, 2.7           | 📋     |
| 69  | [2.8](docs/epics/accounts.md)    | People, and deleting an account   | P1       | 2.7, 3.4           | 📋     |
| 70  | [2.5](docs/epics/accounts.md)    | Sovereign sign-in                 | P1       | 2.1                | 📋     |
| 71  | [2.6](docs/epics/accounts.md)    | Linking a Sovereign identity      | P1       | 2.5, 2.7           | 📋     |
| 72  | [2.9](docs/epics/accounts.md)    | Notices from core                 | P1       | 2.5, 2.8           | 📋     |
| 73  | [2.10](docs/epics/accounts.md)   | Hosting on an instance            | P1       | 1.10, 2.9          | 📋     |
| 74  | [8.1](docs/epics/reminders.md)   | The notification list and bell    | P1       | 7.1, 13.2          | 📋     |
| 75  | [10.6](docs/epics/backup.md)     | Failures                          | P1       | 8.1, 10.5          | 📋     |
| 76  | [8.2](docs/epics/reminders.md)   | Notification settings             | P1       | 2.7, 4.1           | 📋     |
| 77  | [8.3](docs/epics/reminders.md)   | Channels: email and core          | P1       | 2.3, 2.5, 8.1      | 📋     |
| 78  | [8.4](docs/epics/reminders.md)   | Web Push                          | P1       | 1.11, 8.2, 8.3     | 📋     |
| 79  | [8.5](docs/epics/reminders.md)   | The daily brief                   | P1       | 1.6, 4.3, 8.2, 8.3 | 📋     |
| 80  | [8.6](docs/epics/reminders.md)   | Due-time reminders                | P1       | 8.5                | 📋     |
| 81  | [14.6](docs/epics/encryption.md) | Reminders by times only           | P1       | 8.4, 8.6, 14.3     | 📋     |
| 82  | [10.7](docs/epics/backup.md)     | Connecting through the GitHub App | P3       | 10.6               | 📋     |

### Milestone F — First release

Reviewed, documented, released, and on a real instance. **Done when** someone has used it for a week and the plugin can be retired.

| #   | ID                             | Task                              | Priority | Depends on                  | Status |
| --- | ------------------------------ | --------------------------------- | -------- | --------------------------- | ------ |
| 83  | [7.7](docs/epics/interface.md) | Accessibility pass                | P2       | 3.11, 6.5, 7.4, 7.5, 7.6    | 📋     |
| 84  | [11.2](docs/epics/release.md)  | Documents                         | P2       | 2.10, 10.6, 14.7            | 📋     |
| 85  | [11.3](docs/epics/release.md)  | Security review                   | P2       | 2.9, 8.6, 9.3, 10.6, 14.7   | 📋     |
| 86  | [11.4](docs/epics/release.md)  | The release process               | P2       | 1.10                        | 📋     |
| 87  | [11.5](docs/epics/release.md)  | First release, on a real instance | P2       | 7.7, 11.2, 11.3, 11.4, 13.6 | 📋     |

## Phase 2 — Sharing

After the MVP, and it starts with an RFC.

| #   | ID                            | Task                     | Priority | Depends on | Status |
| --- | ----------------------------- | ------------------------ | -------- | ---------- | ------ |
| 88  | [12.1](docs/epics/sharing.md) | RFC: sharing             | —        | 11.5       | 📋     |
| 89  | [12.2](docs/epics/sharing.md) | Membership (outline)     | —        | 12.1       | 📋     |
| 90  | [12.3](docs/epics/sharing.md) | Sharing a list (outline) | —        | 12.2       | 📋     |
| 91  | [12.4](docs/epics/sharing.md) | Assignment (outline)     | —        | 12.3       | 📋     |

## Phase 3 — Candidates

Not committed, not tasks yet. Each becomes one when it is chosen.

| What                                                  | Note                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Google Tasks import                                   | Takeout's JSON; cheap beside 9.2 (`DESIGN.md` §25)                                    |
| The last Friday of the month                          | A picker change; the rule format already allows it (§25)                              |
| A key shared across the suite through core            | Waits on core's end-to-end encryption; the same age key can be pasted in today (§9.1) |
| A list of backups in the app, with restore from there | §19.6                                                                                 |

## What can run alongside

The order is a recommendation, not a queue. These have no dependency between them, if two agents are working: 1.6, 1.7 and 1.8 once 1.5 is in; 13.2 and 13.3; 3.2 and 7.1; 3.5, 3.9 and 3.10; 5.1 and 6.2; 7.3 and 7.4; 10.1 and 10.2; 2.3 and 2.5; 8.2 and 8.3.
