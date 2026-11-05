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

#### 📋 11.6 — A seeded workspace

**Goal:** `pnpm seed` makes a workspace worth developing against, shared between two accounts.

**Design:** §24 Testing. **Depends on:** 17.5, 18.7.

**Technical:** `scripts/seed.ts` gains a second account (`seed2@example.test`) and a workspace owned by the first with the second as member: a public
board with lists, cards at every state (labelled, assigned, due, with checklists and comments, archived), a private board, an archived board and a
published one; activity and notices made through `applyOp`, as a person's would be. `--reset` and `--remove` cover them; it still refuses a database
that is not on this machine.

**Accepts when:** after `pnpm seed --reset`, both accounts see what the design says they should, and the published board opens signed out; running it
twice changes nothing.

#### 📋 11.2 — Documents

**Goal:** someone can run it, and someone can host it, from the documents alone.

**Design:** §24. **Depends on:** 2.10, 10.6, 14.7.

**Technical:** `README.md` replaced: what Tusk is, and every setting. `deploy/README.md`: the three ways, backups of each, the keys, operator-key mode,
updating and going back, registering the GitHub App. What an instance's operator sets: `TUSK_AUTH_SIGNUP=open`, SMTP, the App. A person's pages: the
Desk offline and what it can't hide (§8.6), what encryption covers and doesn't (§9, §9.6), workspaces and who sees what (§7.2), publishing, what a
backup holds and how to restore. `confluence/` in the workbench gains an entity page for this repository.

**Accepts when:** someone follows them, with no other help, from nothing to a running server on each form, and to a backup that restores; every setting
in `.env.example` is in the README, by a test.

#### 📋 11.3 — Security review

**Goal:** a written review of phase 1, with what was found fixed.

**Design:** §7, §24. **Depends on:** 2.9, 9.3, 10.6, 14.7, 17.5.

**Technical:** `docs/security-review-phase-1.md`, as Fjord's: what was checked, found, fixed and left. Access: every change and operation by every role
of 16.1's matrix, private boards in every read, refusals that read as not found; publishing (what a published page could leak, the token); adding people
by email (what it tells, its limit); sign-in, against Fjord's list; CSP; the service worker's cache; what is left on a device after sign-out; both
encryption modes, stating §9.6's limit; credentials; the backup path; import as untrusted input; notices; logs; dependencies through `pnpm audit`.
Checks become tests.

**Accepts when:** written up; nothing serious open; each fix has a test seen to fail without it.

#### 📋 11.4 — The release process

**Goal:** a release is a PR, and a tag on the commit CI vouched for.

**Design:** §24 Deployment. **Depends on:** 1.10.

**Technical:** `RELEASING.md` and `scripts/release.sh` (`check`, `prepare`, `propose`, `tag`, `verify`), from Fjord's, with its own tests. `prepare`
promotes `[Unreleased]`, bumps `package.json`, runs the gates and makes one commit; refuses a patch release if `migrations/` changed. `tag` waits for CI on
the merged commit. `publish.yml` uses the changelog as release notes, publishes `X.Y.Z`, `X.Y` and `latest` of `ghcr.io/sovereignfs/tusk`, attests
provenance, brings the published image up, and only then publishes the release.

**Accepts when:** a dry run makes a release candidate from start to finish; each refusal has a test against a throwaway repository.

#### 📋 11.5 — First release, on a real instance

**Goal:** `0.1.0`, hosted by a real instance, and used.

**Design:** §2. **Depends on:** 7.7, 11.2, 11.3, 11.4, 13.6.

**Technical:** cut `0.1.0`. Host it on a real instance with `sv app add`. Check by hand what could only be faked: sign-in, back-channel logout, account
deletion handing a workspace on; a real GitHub token, a backup, and the App; a day of the Desk offline and back; two people on one board for a week.
Bring a real tasks-plugin export across. Self-host it separately on a file database with a backup and a personal key. Anything found becomes a task. Then
record in the workbench's `confluence/` that it replaces the tasks and kanban plugins.

**Accepts when:** each of those has been done and written up in the epic, and people use it for a week before the plugins are retired.
