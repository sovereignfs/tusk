# Epic 11: Release

## Status

⏳ In progress: the seed (11.1) is done for the Desk; its workspaces (11.6) and the rest are left.

## Overview

What it takes to hand this to someone: something to develop against, documents an operator can follow, a review of its security, and a release that
replaces the tasks and kanban plugins.

## Related

[`DESIGN.md`](../../DESIGN.md) §24 · Fjord's `RELEASING.md`, `docs/security-review-phase-1.md`

## Tasks

#### ✅ 11.1 — Development seed

**Goal:** one command for a realistic account.

**Design:** §24 Testing. **Depends on:** 3.4.

**Technical:** `scripts/seed.ts`, through the store and not raw rows. Refuses a database that is not on this machine. Makes an account, and lists covering overdue, due today, upcoming, repeating, starred across lists, subtasks at 0%, part and 100%, long titles, completed, and an empty list. Idempotent; `--reset` removes only its own. Grows with features. `pnpm seed`.

**Accepts when:** run twice, it does not double; a non-local address is refused; the app looks as expected with it.

**Done as:** `pnpm seed` runs `scripts/seed.ts` through `jiti` (which reads TypeScript, so it is the app's own code and not a copy), against whatever database the environment names, and goes **through the store**: the account is made by better-auth with sign-up open for that one call, and the data by `applyMutation`, the endpoint's own, so it passes every check the app does. Every id is derived from the account and a name (UUIDv5) and every mutation has an id that is the same each time, so **running it again finds it all done and writes nothing** (the account's counter does not move; seen on all three databases). It refuses a database that is not on this machine (a file always is; a service when its host is `localhost`, `127.0.0.1`, `::1` or `*.localhost`, and for sqld both of its addresses), because it makes an account with a password written in the source (`SEED_PASSWORD`, for a development database and nothing else). `--reset` deletes **only the rows its plan names, owned by the account, and the account**, then makes them again; `--remove` only deletes; a list or a task a person made in the seed account stays, and so does any other account's (tested). It makes six lists (one empty, one of forty tasks to scroll, _My tasks_ with the id the app would make for it), a title of exactly 500 characters, notes of forty lines, open and completed tasks, and notes. Seen in a browser on a seeded database. 7 tests, passing on a file database, sqld and PostgreSQL 16, and the command was run for real: first, again, `--reset`, `--remove`, and refused on a PostgreSQL address that is not local. **It grows with the features**: what Today, subtasks, repeats and stars have to look at is added to `planSeed` by the task that builds it, and this list says which are not here yet: overdue, due today and upcoming (4.2), repeating (5.2), and starred across lists (3.10). Subtasks at none, part and all done were added by 3.5.

#### ✅ 11.6 — A seeded workspace

**Goal:** `pnpm seed` makes a workspace worth developing against, shared between two accounts.

**Design:** §24 Testing. **Depends on:** 17.5, 18.7.

**Technical:** `scripts/seed.ts` gains a second account (`seed2@example.test`) and a workspace owned by the first with the second as member: a public
board with lists, cards at every state (labelled, assigned, due, with checklists and comments, archived), a private board, an archived board and a
published one; activity and notices made through `applyOp`, as a person's would be. `--reset` and `--remove` cover them; it still refuses a database
that is not on this machine.

**Accepts when:** after `pnpm seed --reset`, both accounts see what the design says they should, and the published board opens signed out; running it
twice changes nothing.

**Done as:** `scripts/seed-workspace.ts` makes the workspace **Seed Studio**, owned by `seed@example.test` with `seed2@example.test` (a second account, made the same way and with the same development-only password) as a member. **Every change is `applyOp`, as one of the two people would have made it,** so that the activity (well over forty rows) and the notices are the ones the app writes and the checks are the app's: 69 steps, each with an `opId` derived from its place in the run, and every id derived from a name, so a second run finds every step done and changes nothing. It makes four boards: **Product roadmap** (public; lists Backlog, Doing and Done; four labels, one with no name; cards labelled, assigned to one and to both, due overdue, soon and far off, with a checklist part done, all done while the card is open and none done, comments from both people, one card moved, one cloned and one archived), **Hiring** (private: the owner sees it and the member does not), **Last year** (archived) and **Marketing site** (published, with a card that has a description, a label and a checklist). `pnpm seed` and `pnpm seed -- --reset` run it after the Desk's seed; `--remove` takes it away by deleting the workspace through the door (so everything below it goes with it in one transaction) and forgetting the `opId`s, then the second account; it still refuses a database that is not on this machine. Tests: after a run the owner sees all four boards and the member three, the private board is not there for the member, the archived one is archived, the public board has cards at every state; the published board is readable signed out with the work and none of the people; the member's Inbox has the four kinds of notice from the owner; running again changes not a row of any table; and removing leaves no row of any workspace table and no second account, and making it again gives the same counts. Also run by hand against a throwaway database: made, found, and reset. **Not as the epic said:** nothing; the repeating and starred shapes the Desk's seed lacks are still the Desk's to add (milestone F).

#### ✅ 11.2 — Documents

**Goal:** someone can run it, and someone can host it, from the documents alone.

**Design:** §24. **Depends on:** 2.10, 10.6, 14.7.

**Technical:** `README.md` replaced: what Tusk is, and every setting. `deploy/README.md`: the three ways, backups of each, the keys, operator-key mode,
updating and going back, registering the GitHub App. What an instance's operator sets: `TUSK_AUTH_SIGNUP=open`, SMTP, the App. A person's pages: the
Desk offline and what it can't hide (§8.6), what encryption covers and doesn't (§9, §9.6), workspaces and who sees what (§7.2), publishing, what a
backup holds and how to restore. `confluence/` in the workbench gains an entity page for this repository.

**Accepts when:** someone follows them, with no other help, from nothing to a running server on each form, and to a backup that restores; every setting
in `.env.example` is in the README, by a test.

**Done as, except being followed:** **`README.md`** is rewritten: what Tusk is, what is built and what is not (said plainly: operator-key encryption, reminders and push, the Planner, Today and Review, and the phone's own screens), how to run it (one `docker run`, then `deploy/README.md`, and from source), **every setting** in tables by group (the address and sign-in, the database, keys, backup to GitHub, mail and push and jobs), and links to the pages for people. **Four pages for the people who use it**, beside `working-offline.md`: `docs/encryption.md` (the key of your own, what it covers and does not, the server's own key, what §9.6 cannot do), `docs/workspaces.md` (the roles as a table, public and private, what an operator can read, deleting an account), `docs/publishing.md` (what a published page shows and never shows, the address, unpublishing) and `docs/backup.md` (export, a backup, token or App, restoring by import and what import does). **`deploy/README.md`** gained _Keys_ (the three, how to change the instance key, and that operator-key mode is not built and the server refuses it) beside what it had (the three ways, backups of each, updating and going back, the GitHub App, hosting by an instance); `.env.example` lost a duplicate block of the App's settings. **`src/readme.test.ts`** holds the settings to each other: every `TUSK_` name in `.env.example` is in the README, every one the code reads is in `.env.example` (or is its `_FILE` form), and the README names no setting that does not exist; each seen to fail when broken. **The workbench's `confluence/entities/tasks.md`** is written, indexed and logged (committed in the `sovereignfs` repository). **Not done, and said so:** the acceptance is that someone follows the documents from nothing to a running server on each form and a restoring backup, and **nobody has** (Docker would not pull its base image here, and the three forms were exercised by the tests, not by a person with the documents); operator-key mode, which the epic lists, is documented as absent because it is (task 14.7); and `deploy/README.md`'s section on a GitHub Enterprise Server is one sentence, from the setting's own description.

#### 📋 11.3 — Security review

**Goal:** a written review of phase 1, with what was found fixed.

**Design:** §7, §24. **Depends on:** 2.9, 9.3, 10.6, 14.7, 17.5.

**Technical:** `docs/security-review-phase-1.md`, as Fjord's: what was checked, found, fixed and left. Access: every change and operation by every role
of 16.1's matrix, private boards in every read, refusals that read as not found; publishing (what a published page could leak, the token); adding people
by email (what it tells, its limit); sign-in, against Fjord's list; CSP; the service worker's cache; what is left on a device after sign-out; both
encryption modes, stating §9.6's limit; credentials; the backup path; import as untrusted input; notices; logs; dependencies through `pnpm audit`.
Checks become tests.

**Accepts when:** written up; nothing serious open; each fix has a test seen to fail without it.

#### ✅ 11.4 — The release process

**Goal:** a release is a PR, and a tag on the commit CI vouched for.

**Design:** §24 Deployment. **Depends on:** 1.10.

**Technical:** `RELEASING.md` and `scripts/release.sh` (`check`, `prepare`, `propose`, `tag`, `verify`), from Fjord's, with its own tests. `prepare`
promotes `[Unreleased]`, bumps `package.json`, runs the gates and makes one commit; refuses a patch release if `migrations/` changed. `tag` waits for CI on
the merged commit. `publish.yml` uses the changelog as release notes, publishes `X.Y.Z`, `X.Y` and `latest` of `ghcr.io/sovereignfs/tusk`, attests
provenance, brings the published image up, and only then publishes the release.

**Accepts when:** a dry run makes a release candidate from start to finish; each refusal has a test against a throwaway repository.

**Done as:** from Fjord's, for one thing released. **`scripts/release.sh`** (`check`, `prepare`, `propose`, `tag`, `verify`; `publish` prints the two steps that replaced it), **`scripts/lib/release.sh`** (the output, rollback, changelog, preflight and the waiting on GitHub, the same as Fjord's) and **`scripts/release/tusk.sh`** (what is Tusk's: tag `vX.Y.Z`, `CHANGELOG.md` and `package.json` as the two files a release edits, `ci.yml` as the workflow that must be green on the merged commit, the gates, and the check of the published release). `prepare` cuts `chore/release-tusk-X.Y.Z` from an up-to-date `main`, promotes `[Unreleased]` with its date and compare links, bumps `package.json`, checks that the tag will start `publish.yml` and find its notes, **refuses a patch release if anything under `migrations/` changed since the previous release of that minor, and any release in which a released migration was edited or removed** (a journal that only gained entries is not an edit), runs the gates (install, format, lint, types, tests, the manifest, build) and makes one commit; it never pushes and puts the files, the branch and the uncommitted notes back if anything fails. `propose` opens a draft PR; `tag` waits for CI on the merged commit, tags it, watches the workflow, titles the release and verifies it (the notes on the page, Latest, the image for both platforms). **`.github/workflows/publish.yml`** is rewritten from Fjord Web's: it checks the app at the tag (the tag equals `package.json`'s version, the manifest, types, tests, build), builds the image for `linux/amd64` and `linux/arm64` on a runner of each kind and pushes each by digest alone, joins them as `X.Y.Z`, `X.Y` and `latest`, attests the build provenance, pulls the published image by digest and runs `deploy-check.sh file sovereign` against it, and only then publishes the GitHub release with the changelog's section as its notes; run by hand it builds and throws away. Its actions are pinned by commit, resolved from their tags. `package.json` now says `0.0.0` (nothing has been released, so the first release is `0.1.0`, as 11.5 says) and names its repository as `sovereignfs/tusk`, the app's name and the image's (the repository on GitHub is still `tasks`, which GitHub forwards once it is renamed; the compare links in the changelog use the new name); `CHANGELOG.md` has its `[Unreleased]` link at the foot. **`RELEASING.md`** says all of this, the version rules a patch, a minor and a major keep, and what is not proved. Tests: `scripts/test-release.sh` runs the script against 13 throwaway repositories (a bare origin and a clone, this working tree laid over it) with `gh` replaced by a recorder and the gates replaced by `TUSK_RELEASE_GATES` (a hook for these tests alone): 71 checks of every refusal (a bad version, not greater, no notes, an empty section, a wrong date, a dirty tree, not on `main`, `main` ahead of origin, a tag already on origin, no readable version, a workflow no tag starts, a patch release with a migration, an edited migration), of what `prepare` makes (the branch, one commit, the promoted notes and links, the bump, only two files, nothing pushed, and refusing to prepare twice), of a failing gate leaving nothing behind (the notes kept, the branch gone), of `propose` for real against the local origin (a draft PR into `main`, `main` unmoved) and `tag` as a dry run, and of a changelog section of thousands of lines. CI runs them, and shellcheck of the new scripts, in the scripts job. **Seen to fail with it broken:** the patch-release rule, the edited-migration rule and the rollback, each failing its own tests. **Not run, and said so:** `publish.yml` (it needs a tag and Actions; `actionlint` passes), `tag` for real (it needs `gh`, CI and a registry), `verify`, and the dry run of a release from start to finish against GitHub.

#### 📋 11.5 — First release, on a real instance

**Goal:** `0.1.0`, hosted by a real instance, and used.

**Design:** §2. **Depends on:** 7.7, 11.2, 11.3, 11.4, 13.6.

**Technical:** cut `0.1.0`. Host it on a real instance with `sv app add`. Check by hand what could only be faked: sign-in, back-channel logout, account
deletion handing a workspace on; a real GitHub token, a backup, and the App; a day of the Desk offline and back; two people on one board for a week.
Bring a real tasks-plugin export across. Self-host it separately on a file database with a backup and a personal key. Anything found becomes a task. Then
record in the workbench's `confluence/` that it replaces the tasks and kanban plugins.

**Accepts when:** each of those has been done and written up in the epic, and people use it for a week before the plugins are retired.
