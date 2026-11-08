# Roadmap

The order of work. **This file tracks progress; it does not define behaviour.** [`DESIGN.md`](DESIGN.md) says what Tusk does, and where it disagrees with this file, this file is stale and should be corrected. The detail of every task, with its technical notes and what makes it done, is in [`docs/epics/`](docs/epics/). How a task is run is in [`AGENTS.md`](AGENTS.md).

State as of 2026-11-08 (operator-key mode, 14.7, is done: `TUSK_DB_ENCRYPTION=on` seals the Desk's and every workspace's content); earlier, as of 2026-11-06: **Milestones A and B are done,** built as Tasks. On 2026-11-06 Tasks became **Tusk**, one app for a person's Desk and shared kanban boards (`DESIGN.md` §1, §5.2, §27), and this roadmap was replanned from row 30. **Milestone C makes the turn in the code: the name (15.1) and the Desk's tables (15.2) are done, the Tusk shell (7.8) and the Desk in it (3.12) are done, In progress (3.13) and Settings (2.7) are done: **Milestone C is done**, and so is the door for workspace writes (16.1): workspaces (16.2), their people (16.3) and a board with its lists (17.1) and the boards index (16.4) are done, cards in lists (18.1) the card dialog (18.2) and a board's settings (17.2) are done, and visibility, membership and joining (17.3) are done. **Milestones D and E are done** (labels, assignees, checklists, comments, the Inbox, activity, moving and cloning, search, publishing, and a seeded workspace); **Milestone F, the Desk, daily, is done** (repeats, starred, search, bulk select, the keyboard, the PWA and working offline). The developer assigns each task; the first row not done, with its dependencies met, is what the order recommends.

_Status key: ✅ Done · ⏳ In progress · 📋 Planned · 🚧 Waits on a decision · ➖ Superseded_

_Priority:_ **P0** nothing else can stand without it · **P1** the product · **P2** needed before the first release · **P3** can follow the first release if it must

## How this is ordered

Five questions decide it, in this order:

1. **What can everything else not stand on without?** The name and the Desk's tables first, since every later change would otherwise be made twice; then the shell; then the door for workspace writes and its role matrix (16.1), so that no board is written without the permission in the statement. Retrofitting the access rule is the expensive mistake, as it was for the Desk.
2. **What makes the new half usable soonest?** Two people sharing a board, with cards that move, is Milestone D. Everything after it is tested by use.
3. **What makes boards worth using together?** Labels, assignees, checklists, comments, activity, the Inbox and publishing: Milestone E. Due dates come here, since both halves need them.
4. **What makes the Desk a daily driver?** Repeats, search, the PWA and working offline: Milestone F. It comes after the boards because the Desk already works, offline, from Milestone B.
5. **What protects data, and makes it part of the suite and releasable?** Export, backup and encryption (G), the rest of Fjord's sign-in and hosting (H), then the phone's foundations, review and release (I).

The phone's own screens, the Planner, reminders and live boards are phase 2. The GitHub App (10.7) is P3: a token connects a repository without it.

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

One person, running it alone, keeps real lists in it. **Done** as Tasks, before the turn: lists and tasks with subtasks, order, undo, sort and star, synced over all three databases. Its last three tasks (the PWA, working offline and Settings) moved to Milestones C and F.

| #   | ID                             | Task                                    | Priority | Depends on     | Status |
| --- | ------------------------------ | --------------------------------------- | -------- | -------------- | ------ |
| 11  | [2.1](docs/epics/accounts.md)  | Local sign-in                           | P0       | 1.5, 1.8       | ✅     |
| 12  | [3.1](docs/epics/desk.md)      | Access rules and input parsing          | P0       | 1.5, 2.1       | ✅     |
| 13  | [13.1](docs/epics/sync.md)     | The change format and validators        | P0       | 3.1            | ✅     |
| 14  | [13.2](docs/epics/sync.md)     | The sync endpoint                       | P0       | 13.1           | ✅     |
| 15  | [13.3](docs/epics/sync.md)     | The local store and outbox              | P0       | 13.1           | ✅     |
| 16  | [13.4](docs/epics/sync.md)     | First load, sign-out and ended sessions | P0       | 13.2, 13.3     | ✅     |
| 17  | [3.2](docs/epics/desk.md)      | Positions                               | P0       | 1.5            | ✅     |
| 18  | [7.1](docs/epics/interface.md) | Desktop layout, over the local store    | P0       | 1.8, 13.3      | ✅     |
| 19  | [3.3](docs/epics/desk.md)      | Lists                                   | P1       | 3.2, 7.1, 13.4 | ✅     |
| 20  | [2.2](docs/epics/accounts.md)  | Landing page and the address `/`        | P1       | 2.1            | ✅     |
| 21  | [3.4](docs/epics/desk.md)      | Tasks                                   | P1       | 3.3            | ✅     |
| 22  | [11.1](docs/epics/release.md)  | Development seed                        | P1       | 3.4            | ✅     |
| 23  | [3.5](docs/epics/desk.md)      | Subtasks                                | P1       | 3.4            | ✅     |
| 24  | [3.6](docs/epics/desk.md)      | Manual order                            | P1       | 3.2, 3.4       | ✅     |
| 25  | [3.7](docs/epics/desk.md)      | Undo                                    | P1       | 3.3, 3.4       | ✅     |
| 26  | [13.7](docs/epics/sync.md)     | Keeping the history small               | P1       | 1.6, 13.2      | ✅     |
| 27  | [3.9](docs/epics/desk.md)      | Filter, sort and completed              | P1       | 3.4            | ✅     |
| 28  | [3.8](docs/epics/desk.md)      | Moving a task to another list           | P1       | 3.5            | ✅     |
| 29  | [3.10](docs/epics/desk.md)     | Star                                    | P1       | 3.4            | ✅     |

### Milestone C — The turn to Tusk

What was built as Tasks becomes the Desk of Tusk. **Done when** the app is Tusk in every name, the Desk works at `/desk` in the new shell with status, description and checklist, on all three forms and offline as before, and Settings opens from the avatar.

| #   | ID                             | Task                      | Priority | Depends on | Status |
| --- | ------------------------------ | ------------------------- | -------- | ---------- | ------ |
| 30  | [15.1](docs/epics/tusk.md)     | The name                  | P0       | —          | ✅     |
| 31  | [15.2](docs/epics/tusk.md)     | The Desk's tables         | P0       | 15.1       | ✅     |
| 32  | [7.8](docs/epics/interface.md) | The Tusk shell            | P0       | 7.1, 15.1  | ✅     |
| 33  | [3.12](docs/epics/desk.md)     | The Desk in the new shell | P1       | 7.8, 15.2  | ✅     |
| 34  | [3.13](docs/epics/desk.md)     | In progress               | P1       | 3.12       | ✅     |
| 35  | [2.7](docs/epics/accounts.md)  | Settings                  | P1       | 7.8        | ✅     |

### Milestone D — Workspaces and boards

The shared half, at its smallest. **Done when** two people in a workspace share a board, add lists and cards and drag them about, each seeing the other's changes, and a private board stays hidden from a third member.

| #   | ID                               | Task                                   | Priority | Depends on | Status |
| --- | -------------------------------- | -------------------------------------- | -------- | ---------- | ------ |
| 36  | [16.1](docs/epics/workspaces.md) | Operations, and who may do them        | P0       | 3.1, 15.2  | ✅     |
| 37  | [16.2](docs/epics/workspaces.md) | Workspaces                             | P1       | 7.8, 16.1  | ✅     |
| 38  | [16.3](docs/epics/workspaces.md) | A workspace's people                   | P1       | 16.2       | ✅     |
| 39  | [17.1](docs/epics/boards.md)     | A board and its lists                  | P1       | 16.2       | ✅     |
| 40  | [16.4](docs/epics/workspaces.md) | The boards index                       | P1       | 16.3, 17.1 | ✅     |
| 41  | [18.1](docs/epics/cards.md)      | Cards in lists                         | P1       | 17.1       | ✅     |
| 42  | [18.2](docs/epics/cards.md)      | The card dialog                        | P1       | 18.1       | ✅     |
| 43  | [17.2](docs/epics/boards.md)     | A board's settings, archive and delete | P1       | 17.1       | ✅     |
| 44  | [17.3](docs/epics/boards.md)     | Visibility, membership and joining     | P1       | 16.3, 17.2 | ✅     |

### Milestone E — Working together

What makes a board worth running as a team. **Done when** a team runs a board for a week: labelled, assigned, due and discussed cards, its activity, each person's Inbox, and a published copy for outsiders.

| #   | ID                                 | Task               | Priority | Depends on       | Status |
| --- | ---------------------------------- | ------------------ | -------- | ---------------- | ------ |
| 45  | [4.1](docs/epics/dates.md)         | One idea of today  | P1       | 1.5, 2.1         | ✅     |
| 46  | [4.2](docs/epics/dates.md)         | Due date and time  | P1       | 4.1, 15.2, 18.2  | ✅     |
| 47  | [18.3](docs/epics/cards.md)        | Labels             | P1       | 18.2             | ✅     |
| 48  | [18.4](docs/epics/cards.md)        | Assignees          | P1       | 17.3, 18.2       | ✅     |
| 49  | [18.5](docs/epics/cards.md)        | Checklist          | P1       | 18.2             | ✅     |
| 50  | [18.6](docs/epics/cards.md)        | Comments           | P1       | 18.2             | ✅     |
| 51  | [8.1](docs/epics/notifications.md) | The Inbox          | P1       | 16.3, 18.4, 18.6 | ✅     |
| 52  | [17.6](docs/epics/boards.md)       | Activity           | P1       | 17.1, 18.2       | ✅     |
| 53  | [18.7](docs/epics/cards.md)        | Moving and cloning | P1       | 18.3, 18.4, 18.5 | ✅     |
| 54  | [17.4](docs/epics/boards.md)       | Search on a board  | P2       | 17.1, 18.3, 18.4 | ✅     |
| 55  | [17.5](docs/epics/boards.md)       | Publishing         | P1       | 17.3, 18.5       | ✅     |
| 56  | [11.6](docs/epics/release.md)      | A seeded workspace | P1       | 17.5, 18.7       | ✅     |

### Milestone F — The Desk, daily

Everything that makes the Desk worth opening each day. **Done when** the Desk can replace the tasks plugin on a desktop: dates, repeats, search, bulk, the keyboard, installed as an app, and offline.

| #   | ID                               | Task                                       | Priority | Depends on     | Status |
| --- | -------------------------------- | ------------------------------------------ | -------- | -------------- | ------ |
| 57  | [4.3](docs/epics/dates.md)       | Overdue, and pinning to the top            | P1       | 3.6, 3.9, 4.2  | ✅     |
| 58  | [5.1](docs/epics/recurrence.md)  | The rule module                            | P1       | 4.1            | ✅     |
| 59  | [5.2](docs/epics/recurrence.md)  | Series and completing                      | P1       | 4.2, 5.1, 15.2 | ✅     |
| 60  | [13.5](docs/epics/sync.md)       | Convergence tests                          | P0       | 3.13, 5.2      | ✅     |
| 61  | [5.3](docs/epics/recurrence.md)  | The repeat picker                          | P1       | 5.2            | ✅     |
| 62  | [5.4](docs/epics/recurrence.md)  | Editing a recurring card                   | P1       | 5.2, 5.3       | ✅     |
| 63  | [5.5](docs/epics/recurrence.md)  | Reopening, moving and deleting occurrences | P1       | 3.7, 3.8, 5.4  | ✅     |
| 64  | [6.1](docs/epics/views.md)       | Starred                                    | P1       | 3.10, 3.12     | ✅     |
| 65  | [6.2](docs/epics/views.md)       | Search                                     | P1       | 3.12           | ✅     |
| 66  | [3.11](docs/epics/desk.md)       | Bulk select                                | P2       | 3.7, 3.8, 3.12 | ✅     |
| 67  | [7.6](docs/epics/interface.md)   | Keyboard                                   | P2       | 3.12, 18.1     | ✅     |
| 68  | [1.11](docs/epics/foundation.md) | The PWA                                    | P1       | 1.7, 1.8, 3.12 | ✅     |
| 69  | [13.6](docs/epics/sync.md)       | Working offline                            | P1       | 1.11, 13.4     | ✅     |

### Milestone G — Data is safe

A person's data can come in and go out, keeps itself safe in their own repository, and the Desk can be theirs alone to read. **Done when** a backup restores into an empty account, and a full journey on a personal key leaves no plain Desk field on the server.

| #   | ID                               | Task                                | Priority | Depends on                 | Status |
| --- | -------------------------------- | ----------------------------------- | -------- | -------------------------- | ------ |
| 70  | [9.1](docs/epics/portability.md) | Export                              | P1       | 2.7, 3.13, 4.2, 17.1, 18.6 | ✅     |
| 71  | [9.2](docs/epics/portability.md) | Import                              | P1       | 5.2, 9.1                   | ✅     |
| 72  | [10.1](docs/epics/backup.md)     | Credentials at rest                 | P1       | 1.5                        | ✅     |
| 73  | [10.2](docs/epics/backup.md)     | The provider, and GitHub            | P1       | 1.2                        | ✅     |
| 74  | [10.3](docs/epics/backup.md)     | Connecting with a token             | P1       | 2.7, 10.1, 10.2            | ✅     |
| 75  | [10.4](docs/epics/backup.md)     | Making a backup                     | P1       | 9.1, 10.3, 13.2            | ✅     |
| 76  | [10.5](docs/epics/backup.md)     | Modes, and the auto job             | P1       | 1.6, 10.4                  | ✅     |
| 77  | [14.1](docs/epics/encryption.md) | Keys and the field cipher           | P1       | 13.1                       | ✅     |
| 78  | [14.2](docs/epics/encryption.md) | Setting up a key                    | P1       | 2.1, 14.1                  | ✅     |
| 79  | [14.3](docs/epics/encryption.md) | Encrypting through the sync path    | P1       | 13.3, 14.2                 | ✅     |
| 80  | [14.4](docs/epics/encryption.md) | Turning it on later                 | P1       | 14.3                       | ✅     |
| 81  | [14.5](docs/epics/encryption.md) | Encrypted export, import and backup | P1       | 9.2, 10.4, 14.3            | ✅     |
| 82  | [14.7](docs/epics/encryption.md) | Operator-key mode                   | P2       | 10.1, 13.2, 14.2, 18.6     | ✅     |
| 83  | [9.3](docs/epics/portability.md) | Reading the tasks plugin's file     | P2       | 9.2                        | ✅     |

### Milestone H — Part of the suite

It signs in like Fjord in every way, an instance can host it, and a person can leave without taking shared work with them. **Done when** `deploy-check.sh sovereign` passes, and deleting an account hands its workspaces on.

| #   | ID                             | Task                              | Priority | Depends on      | Status |
| --- | ------------------------------ | --------------------------------- | -------- | --------------- | ------ |
| 84  | [2.3](docs/epics/accounts.md)  | Email: verification and reset     | P1       | 2.1, 15.1       | ✅     |
| 85  | [2.4](docs/epics/accounts.md)  | Two-factor and passkeys           | P1       | 2.1, 2.7        | ✅     |
| 86  | [2.8](docs/epics/accounts.md)  | People, and deleting an account   | P1       | 2.7, 16.3, 18.6 | ✅     |
| 87  | [2.5](docs/epics/accounts.md)  | Sovereign sign-in                 | P1       | 2.1, 15.1       | ✅     |
| 88  | [2.6](docs/epics/accounts.md)  | Linking a Sovereign identity      | P1       | 2.5, 2.7        | ✅     |
| 89  | [2.9](docs/epics/accounts.md)  | Notices from core                 | P1       | 2.5, 2.8        | ✅     |
| 90  | [2.10](docs/epics/accounts.md) | Hosting on an instance            | P1       | 1.10, 2.9       | ✅     |
| 91  | [10.6](docs/epics/backup.md)   | Failures                          | P1       | 8.1, 10.5       | ✅     |
| 92  | [10.7](docs/epics/backup.md)   | Connecting through the GitHub App | P3       | 10.6            | ✅     |

### Milestone I — First release

Ready for a phone, reviewed, documented, released, and on a real instance. **Done when** people have used it for a week and the tasks and kanban plugins can be retired.

| #   | ID                             | Task                              | Priority | Depends on                  | Status |
| --- | ------------------------------ | --------------------------------- | -------- | --------------------------- | ------ |
| 93  | [7.9](docs/epics/interface.md) | The phone's foundations           | P2       | 7.8, 17.1, 18.2             | ✅     |
| 94  | [7.7](docs/epics/interface.md) | Accessibility pass                | P2       | 3.11, 7.6, 7.9, 17.6, 18.7  | ✅     |
| 95  | [11.2](docs/epics/release.md)  | Documents                         | P2       | 2.10, 10.6, 14.7            | ✅     |
| 96  | [11.3](docs/epics/release.md)  | Security review                   | P2       | 2.9, 9.3, 10.6, 14.7, 17.5  | ✅     |
| 97  | [11.4](docs/epics/release.md)  | The release process               | P2       | 1.10                        | ✅     |
| 98  | [11.5](docs/epics/release.md)  | First release, on a real instance | P2       | 7.7, 11.2, 11.3, 11.4, 13.6 | 📋     |

## Phase 2

After the MVP. The tasks with IDs are planned in their epics, in the order they are listed (the Planner, epic 19: 19.1 to 19.3 are P1, 19.4 P2, 19.5 P3); the rest are outlined in `DESIGN.md` §25 and become tasks when phase 2 is planned.

| ID                                 | Task                                        | Depends on         | Status |
| ---------------------------------- | ------------------------------------------- | ------------------ | ------ |
| [7.2](docs/epics/interface.md)     | The Desk carousel and the boards on a phone | 7.9                | ✅     |
| [7.3](docs/epics/interface.md)     | The footer and its action button            | 7.2                | ✅     |
| [7.4](docs/epics/interface.md)     | Sheets and adaptive surfaces                | 7.2                | ✅     |
| [7.5](docs/epics/interface.md)     | Touch gestures                              | 7.2                | ✅     |
| [6.3](docs/epics/views.md)         | Today                                       | 4.3, 7.3           | ✅     |
| [6.4](docs/epics/views.md)         | Cards to swipe                              | 5.5, 6.3           | ✅     |
| [6.5](docs/epics/views.md)         | Review                                      | 6.4, 7.3           | ✅     |
| [8.2](docs/epics/notifications.md) | Notification settings for reminders         | 2.7, 4.1, 8.1      | ✅     |
| [8.3](docs/epics/notifications.md) | Channels: email and core                    | 2.3, 2.5, 8.1      | ✅     |
| [8.4](docs/epics/notifications.md) | Web Push                                    | 1.11, 8.2, 8.3     | ✅     |
| [8.5](docs/epics/notifications.md) | The daily brief                             | 1.6, 4.3, 8.2, 8.3 | ✅     |
| [8.6](docs/epics/notifications.md) | Due-time reminders                          | 8.5                | ✅     |
| [14.6](docs/epics/encryption.md)   | Reminders by times only                     | 8.4, 8.6, 14.3     | ✅     |
| [19.1](docs/epics/planner.md)      | The Planner: the feed                       | 4.2, 7.8, 18.4     | ✅     |
| [19.2](docs/epics/planner.md)      | The Planner: a day's block                  | 19.1               | 📋     |
| [19.3](docs/epics/planner.md)      | The Planner: adding from the feed           | 19.2               | 📋     |
| [19.4](docs/epics/planner.md)      | The Planner: repeating cards as previews    | 19.2, 5.2          | 📋     |
| [19.5](docs/epics/planner.md)      | Start and end times, and a card's length    | 19.2               | 📋     |

| What                                                          | Note                                        |
| ------------------------------------------------------------- | ------------------------------------------- |
| Boards offline, and live                                      | Under sync, with server-sent events (§25.4) |
| Invitations by email, and core's directory                    | §25.5                                       |
| Replies to comments                                           | §25.6                                       |
| The Desk as a board, and cards from boards and other services | §25.7                                       |
| Attachments                                                   | §25.8                                       |

## Phase 3 — Candidates

Not committed, not tasks yet. Each becomes one when it is chosen.

| What                                                  | Note                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Google Tasks and Trello import                        | Beside 9.2                                                                            |
| The last Friday of the month                          | A picker change; the rule format already allows it                                    |
| A key shared across the suite through core            | Waits on core's end-to-end encryption; the same age key can be pasted in today (§9.1) |
| Board templates, and search across boards             | —                                                                                     |
| A list of backups in the app, with restore from there | —                                                                                     |

## Superseded

Kept so that their IDs are never reused.

| ID                            | Task                     | Depends on | Status |
| ----------------------------- | ------------------------ | ---------- | ------ |
| [12.1](docs/epics/sharing.md) | RFC: sharing             | —          | ➖     |
| [12.2](docs/epics/sharing.md) | Membership (outline)     | —          | ➖     |
| [12.3](docs/epics/sharing.md) | Sharing a list (outline) | —          | ➖     |
| [12.4](docs/epics/sharing.md) | Assignment (outline)     | —          | ➖     |

## What can run alongside

The order is a recommendation, not a queue. These have no dependency between them, if two agents are working: 7.8 and 15.2 once 15.1 is in; 3.13 and 2.7; 16.3 and 17.1; 18.1 and 17.2; 4.1 and 18.2; 18.3, 18.4, 18.5 and 18.6; 17.6 and 8.1; 5.1 and 6.2; 10.1 and 10.2; 14.1 and 9.1; 2.3 and 2.5.
