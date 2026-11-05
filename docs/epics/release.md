# Epic 11: Release

## Status

📋 Planned

## Overview

What it takes to hand this to someone: something to develop against, documents an operator can follow, a review of its security, and a release that replaces the plugin.

## Related

[`DESIGN.md`](../../DESIGN.md) §23 · Fjord's `RELEASING.md`, `docs/security-review-phase-1.md`

## Tasks

#### 📋 11.1 — Development seed

**Goal:** one command for a realistic account.

**Design:** §23 Testing. **Depends on:** 3.4.

**Technical:** `scripts/seed.ts`, through the store and not raw rows. Refuses a database that is not on this machine. Makes an account, and lists covering overdue, due today, upcoming, repeating, starred across lists, subtasks at 0%, part and 100%, long titles, completed, and an empty list. Idempotent; `--reset` removes only its own. Grows with features. `pnpm seed`.

**Accepts when:** run twice, it does not double; a non-local address is refused; the app looks as expected with it.

#### 📋 11.2 — Documents

**Goal:** someone can run it, and someone can host it, from the documents alone.

**Design:** §23. **Depends on:** 2.10, 10.6, 14.7.

**Technical:** `README.md` replaced: what it is, and every setting. `deploy/README.md`: the three ways, backups of each, the keys, operator-key mode, updating and going back, registering the GitHub App, making VAPID keys. What an instance's operator sets: `TASKS_AUTH_SIGNUP=open`, the app scope `notifications:send`, VAPID, SMTP, the App. A person's pages: what offline can't hide (§8.6), what encryption does and doesn't do (§9.6), what a backup holds and how to restore. `confluence/` in the workbench gains an entity page for this repository.

**Accepts when:** someone follows them, with no other help, from nothing to a running server on each form, and to a backup that restores; every setting in `.env.example` is in the README, by a test.

#### 📋 11.3 — Security review

**Goal:** a written review of phase 1, with what was found fixed.

**Design:** §7, §23. **Depends on:** 2.9, 8.6, 9.3, 10.6, 14.7.

**Technical:** `docs/security-review-phase-1.md`, as Fjord's: what was checked, found, fixed and left. Access (every change by the wrong account); sign-in, against Fjord's list; CSP; the service worker's cache; what is left on a device after sign-out; both encryption modes, stating §9.6's limit; credentials; the backup path (public repositories, a token in errors), and the GitHub App if it is in by then; import as untrusted input; notices; logs; dependencies through `pnpm audit`. Checks become tests.

**Accepts when:** written up; nothing serious open; each fix has a test seen to fail without it.

#### 📋 11.4 — The release process

**Goal:** a release is a PR, and a tag on the commit CI vouched for.

**Design:** §23 Deployment. **Depends on:** 1.10.

**Technical:** `RELEASING.md` and `scripts/release.sh` (`check`, `prepare`, `propose`, `tag`, `verify`), from Fjord's, with its own tests. `prepare` promotes `[Unreleased]`, bumps `package.json`, runs the gates and makes one commit; refuses a patch release if `migrations/` changed. `tag` waits for CI on the merged commit. `publish.yml` uses the changelog as release notes, publishes `X.Y.Z`, `X.Y` and `latest`, attests provenance, brings the published image up, and only then publishes the release.

**Accepts when:** a dry run makes a release candidate from start to finish; each refusal has a test against a throwaway repository.

#### 📋 11.5 — First release, on a real instance

**Goal:** `0.1.0`, hosted by a real instance, and used.

**Design:** §2. **Depends on:** 7.7, 11.2, 11.3, 11.4, 13.6.

**Technical:** cut `0.1.0`. Host it on a real instance with `sv app add`, giving `notifications:send`. Check by hand what could only be faked: sign-in, a reminder in core's bell, back-channel logout, account deletion; a real GitHub token, a backup, and the App; Push on a real phone, and a day of use offline and back. Bring a real plugin export across. Self-host it separately on a file database with a backup and a personal key. Anything found becomes a task. Then record in the workbench's `confluence/` that it replaces the plugin.

**Accepts when:** each of those has been done and written up in the epic, and someone uses it for a week before the plugin is retired.
