# Epic 10: Backup

## Status

📋 Planned

## Overview

A person connects a private GitHub repository and sets a mode, `manual` or `auto`, and Tasks commits `sovereign-tasks/YYYY-mm-dd_hh-mm-ss.json` to it. Connecting works as Fjord's does, and the file is the export of epic 9.

## Related

[`DESIGN.md`](../../DESIGN.md) §16 · Fjord's `clients/web/DESIGN.md` §7, `docs/epics/web-1a.md` 1a.5–1a.8, `src/providers/`, `src/crypto/`

## Tasks

#### 📋 10.1 — Credentials at rest

**Goal:** a credential can be stored so that a stolen database does not give it up.

**Design:** §16.2. **Depends on:** 1.5.

**Technical:** `src/crypto/`, as Fjord's, using Node's `crypto` only. AES-256-GCM with a random data key per credential, wrapped under the instance key; the id and purpose in the authenticated data of both layers, and the wrapping's also naming the key. `credential` table. `TASKS_ENCRYPTION_KEY` (or `_FILE`): 32 random bytes, in base64, URL-safe base64 or hex, known by a domain-separated fingerprint. Optional until something is stored. Rotation by restart with `TASKS_ENCRYPTION_KEY_PREVIOUS`, rewrapping at start-up, naming the key replaced. Stops at start-up when credentials exist and their key is absent, naming fingerprints.

**Accepts when:** a sealed value moved to another row or purpose is refused; rotation works from any replica, twice at once; a dropped key stops the server; nothing logs a secret, and each binding's test was seen to fail with it removed.

#### 📋 10.2 — The provider, and GitHub

**Goal:** the app reaches a git host through one small interface, tested against a real git repository.

**Design:** §16.2. **Depends on:** 1.2.

**Technical:** `src/providers/types.ts`: `getRepository` (including `private` and the default branch), `canWrite(ref, branch)`, `getHead`, `commit(ref, { branch, expectedHead, message, changes })`, a small part of Fjord's. Errors are ours: `unauthorized`, `forbidden`, `not_found`, `empty_repository`, `head_moved`, `too_large`, `rate_limited` (with when), `unavailable`, `invalid_request`. `src/providers/github/`: a commit is made as git makes one (blob, tree on the head's, commit, a fast-forward that is never forced); a read retried after a network failure or a 502, 503, 504; a write **never** retried; a timeout on everything; paths checked. `TASKS_GITHUB_API_URL`, https except on localhost. `src/providers/memory.ts`. `testing/contract.ts` runs against both, and `FakeGitHub`, whose storage is a real git repository; recorded answers by `scripts/record-github-fixtures.mjs`.

**Accepts when:** the contract passes on both; a moved branch gives `head_moved`, and nothing is written; a token never appears in an error, in a test that plants one.

#### 📋 10.3 — Connecting with a token

**Goal:** connect a repository with a fine-grained token, with mistakes explained.

**Design:** §16.2, §16.5, §19.3. **Depends on:** 9.1, 10.1, 10.2.

**Technical:** `backup_connection`, one per account. `src/backup/connection.ts`: parses an address (`https://github.com/o/r`, with or without `.git`, `git@github.com:o/r`, `o/r`), refusing another host or a password in it. Checked in order: token accepted; repository visible; **private**; default branch has something in it (else "add a README first"); `canWrite`. Each refusal is a message of ours. A token that fails leaves nothing behind. A token reaching more than it needs is accepted with a warning naming how many others it can reach. `POST`/`DELETE /api/backup/connection`, with `Origin` checked. The token is in one request and no response. A Backup section in `/settings`, saying plainly what will be sent and where. Disconnect deletes the connection and credential. Without a key, the section says why not. `People` (2.8) deletes both; the deletion screen says the repository is left alone.

**Accepts when:** each refusal has a test against `FakeGitHub`, on all three databases; a public repository cannot be connected; another account's connection is a 404; the token reaches no response, log or error.

#### 📋 10.4 — Making a backup

**Goal:** Back up now puts a file in the repository.

**Design:** §16.3. **Depends on:** 10.3.

**Technical:** `src/backup/run.ts`: `runBackup(accountId, now, trigger)`. Read the connection; read the token; `getRepository`, stopping if it has become public; build the export in a short transaction, closed before any call; refuse over 50 MB; path `sovereign-tasks/${YYYY-mm-dd_hh-mm-ss}.json` in UTC, from a pure `backupPath(now)`; `commit` on the head read, message `Tasks backup 2026-11-05 14:30:00 UTC`. On `head_moved`, read and try once more. Record `last_backup_at`, `last_backup_path` and `last_hash` on confirmed success. **Back up now:** `POST /api/backup/run`, limited to once a minute through `rate_bucket`, always commits, and shows a link to the file. Other files in the repository are never touched.

**Accepts when:** against `FakeGitHub`, a file appears at the right path with the export's bytes, in a real commit, on the default branch, with the rest of the tree unchanged; the file imports through 9.2; a moved head succeeds; no transaction is open during a call.

#### 📋 10.5 — Modes, and the auto job

**Goal:** `auto` runs on its frequency, and commits only when something changed.

**Design:** §16.1, §16.4. **Depends on:** 1.6, 10.4.

**Technical:** `mode` (`manual`, `auto`), `frequency` (`hourly`, `6h`, `daily`, `weekly`; default `daily`), `next_backup_at`. A control in the section, showing the last and next backup. A job per minute: selects due connections, capped per tick, claims each by a conditional update moving `next_backup_at` on, and runs them with small concurrency. An auto run compares `contentHash` with `last_hash` first: equal means no commit, only a record of when it looked. A switch to `manual` clears the next. `next_backup_at` is pure: `nextBackup(frequency, now)`, with a little spread so that a server's connections do not all fall on the same minute.

**Accepts when:** two runners make one commit; a quiet account's daily run makes no commit, and a change makes one the next day; `manual` is never run by the job; times are tested with the clock passed in.

#### 📋 10.6 — Failures

**Goal:** a backup that fails says so, and never spins against GitHub.

**Design:** §16.4. **Depends on:** 10.5.

**Technical:** `failure_kind`, `failures`, `stopped_at`. A network failure, `unavailable` or `rate_limited`: retried at the next due time, or when GitHub says. `unauthorized`, `forbidden`, `not_found`, a repository made public: **stops auto**, sets `stopped_at`, and tells the person once, by §14.2's channel where there is one. Settings always shows it, with what to do; a repaired token or **Back up now** resumes. A lost answer is `unavailable`, is never retried in the run, and leaves `last_hash` alone, so the worst case is one file too many.

**Accepts when:** each kind has a test; a stopped connection makes no calls on later ticks; a revoked token is reported in words, with none of GitHub's text and no token; a lost answer doesn't record success.

#### 📋 10.7 — Connecting through the GitHub App

**Goal:** connect without handling a token, where the operator has set it up.

**Design:** §16.2. **Depends on:** 10.6.

**Technical:** `TASKS_GITHUB_APP_*`, all or none. **Install on GitHub**, choosing one repository; on return, `state` checked against an `HttpOnly`, `SameSite=Lax` cookie, and the `code` traded for the person's token, used once to ask which repositories of that installation they can reach. No token kept: the credential store holds which installation; `InstallationTokens` signs a JWT (RS256, nine minutes) for an hour's token, kept in memory until five minutes before it expires. `POST /api/webhooks/github`, by signature alone, constant time, over exact bytes, capped: `installation` and `installation_repositories` disconnect what the App lost. The checks of 10.3 apply. `deploy/README.md` says how to register it.

**Accepts when:** the `state` check and the person's-own-repositories check each have a test seen to fail with them off; a removed installation disconnects; a token connection continues to work beside it. Real GitHub is checked by hand once, and the epic says so.
