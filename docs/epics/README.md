# Epics

A domain-first map of the work. An epic groups the tasks of one domain, whichever phase they belong to. [`ROADMAP.md`](../../ROADMAP.md) is the same
tasks in the order they are built, with their priority and status. [`DESIGN.md`](../../DESIGN.md) is what they build; where a task and the design
disagree, the design wins and the task is corrected.

## Conventions

- **Task IDs are permanent:** `<epic>.<n>`, for example `3.4`. Use them in dependency lists and cross-references. They never appear in branch
  names, commit messages or PR titles, and an ID is never reused, even for a task that was superseded.
- **One task, one branch, one draft PR.** A task is done when its "Accepts when" holds and its PR is merged.
- **Every task** has a Goal, a Design reference, what it Depends on, Technical detail, and Accepts when. Once done it gains **Done as**: how it was
  done, where, and what was left out.
- **A Done as is history.** It is written in the words, names and `DESIGN.md` section numbers of the day it was done. Tasks done before 2026-11-06 were
  built as Tasks (lists, tasks, subtasks, `TASKS_`), and their Done as say so; their **Design** line is kept current.
- **On completion,** the task's heading here and its row in `ROADMAP.md` are marked ✅ in the same PR, and a change in behaviour adds a line to
  `CHANGELOG.md`.
- **Every task holds these without saying so:** a data-layer test passes on sqld, a `file:` database and PostgreSQL; a new route is in
  `src/access/routes.ts` with a test calling it as the wrong account; a new kind of Desk change works offline, and passes the convergence suite (once
  13.5 is in) and on an encrypted Desk (once 14.3 is in); a new kind of workspace operation or read has its row in the role matrix (16.1); a new table
  of a person's is handled by `People` (once 2.8 is in); a screen works with a keyboard, in light and dark, and at a phone's width (once 7.9 is in); a
  safeguard's test was seen to fail with it switched off.

_Status key: ✅ Done · ⏳ In progress · 📋 Planned · 🚧 Waits on a decision · ➖ Superseded_

## Epics

| #   | Epic                                        | What it holds                                                                                  | Tasks |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----- |
| 1   | [Foundation](foundation.md)                 | Tooling, CI, configuration, the database, jobs, the shell, the image, the PWA                  | 11    |
| 2   | [Accounts and sign-in](accounts.md)         | Local and Sovereign sign-in, Settings, deleting and handing on, notices, hosting               | 10    |
| 3   | [The Desk](desk.md)                         | Access rules, lists, cards, checklist, order, undo, status, the Desk's screen, bulk            | 13    |
| 4   | [Dates](dates.md)                           | One idea of today, due dates and times on both halves, overdue                                 | 3     |
| 5   | [Recurrence](recurrence.md)                 | Rules, series, the next occurrence, editing                                                    | 5     |
| 6   | [Views of the Desk](views.md)               | Starred, search; Today, swipe cards and Review on the phone (phase 2)                          | 5     |
| 7   | [Interface](interface.md)                   | The shell, the phone's foundations, keyboard, accessibility; the phone's own screens (phase 2) | 9     |
| 8   | [Inbox and notifications](notifications.md) | The Inbox; reminders, Push and email (phase 2)                                                 | 6     |
| 9   | [Portability](portability.md)               | Export and import of the Desk, a board, a workspace or everything; the tasks plugin's file     | 3     |
| 10  | [Backup](backup.md)                         | Credentials at rest, the GitHub provider, connecting, manual and auto backups                  | 7     |
| 11  | [Release](release.md)                       | Seed, documents, security review, releases, a real instance                                    | 6     |
| 12  | [Sharing](sharing.md)                       | Superseded by epics 16 to 18                                                                   | 4     |
| 13  | [Sync and offline](sync.md)                 | The change format, the endpoint, the local store, convergence, working offline                 | 7     |
| 14  | [Encryption](encryption.md)                 | Personal keys for the Desk, encrypted sync, reminders by times, the operator-key mode          | 7     |
| 15  | [The turn to Tusk](tusk.md)                 | The name, and the Desk's tables                                                                | 2     |
| 16  | [Workspaces](workspaces.md)                 | Operations and roles, workspaces, their people, the boards index                               | 4     |
| 17  | [Boards](boards.md)                         | A board and its lists, settings, visibility and joining, search, publishing, activity          | 6     |
| 18  | [Cards on a board](cards.md)                | Cards in lists, the card dialog, labels, assignees, checklist, comments, moving and cloning    | 7     |
| 19  | [The Planner](planner.md)                   | The feed of days, a day's block, adding from it, repeats as previews, start and end times      | 5     |
