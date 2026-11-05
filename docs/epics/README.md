# Epics

A domain-first map of the work. An epic groups the tasks of one domain, whichever phase they belong to. [`ROADMAP.md`](../../ROADMAP.md) is the same
tasks in the order they are built, with their priority and status. [`DESIGN.md`](../../DESIGN.md) is what they build; where a task and the design
disagree, the design wins and the task is corrected.

## Conventions

- **Task IDs are permanent:** `<epic>.<n>`, for example `3.4`. Use them in dependency lists and cross-references. They never appear in branch
  names, commit messages or PR titles.
- **One task, one branch, one draft PR.** A task is done when its "Accepts when" holds and its PR is merged.
- **Every task** has a Goal, a Design reference, what it Depends on, Technical detail, and Accepts when. Once done it gains **Done as**: how it was done, where, and what was left out.
- **On completion,** the task's heading here and its row in `ROADMAP.md` are marked ✅ in the same PR, and a change in behaviour adds a line to `CHANGELOG.md`.
- **Every task holds these without saying so:** a data-layer test passes on sqld, a `file:` database and PostgreSQL; a new action or route is in `src/access/routes.ts` with a test calling it as the wrong account; a new table of a person's is deleted by `People` (once task 2.8 is in); a screen works with a keyboard, in light and dark, and at a phone's width (once task 7.2 is in); a safeguard's test was seen to fail with it switched off.

_Status key: ✅ Done · ⏳ In progress · 📋 Planned · 🚧 Waits on a decision_

## Epics

| # | Epic | What it holds | Tasks |
| --- | --- | --- | --- |
| 1 | [Foundation](foundation.md) | Tooling, CI, configuration, the database, jobs, the shell, the image | 10 |
| 2 | [Accounts and sign-in](accounts.md) | Local and Sovereign sign-in, the account page, deleting, notices, hosting | 10 |
| 3 | [Lists and tasks](lists-and-tasks.md) | The store and access rules, lists, tasks, subtasks, order, undo, bulk | 11 |
| 4 | [Dates](dates.md) | One idea of today, due dates and times, overdue | 3 |
| 5 | [Recurrence](recurrence.md) | Rules, series, the next occurrence, editing | 5 |
| 6 | [Views](views.md) | Starred, search, Today | 3 |
| 7 | [Interface](interface.md) | The client store, three columns, the carousel, gestures, keyboard, accessibility | 6 |
| 8 | [Reminders](reminders.md) | Settings, sending through core, the digest, due-time reminders | 4 |
| 9 | [Portability](portability.md) | One-file export and import, and reading the plugin's file | 3 |
| 10 | [Backup](backup.md) | Credentials at rest, the GitHub provider, connecting, manual and auto backups | 7 |
| 11 | [Release](release.md) | Seed, documents, security review, releases, a real instance | 5 |
| 12 | [Sharing](sharing.md) | Phase 2: an RFC, then shared lists and assignment | 4 |
