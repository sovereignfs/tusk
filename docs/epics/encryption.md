# Epic 14: Encryption

## Status

📋 Planned

## Overview

Two mutually exclusive modes. A person's own age key, opt-in, so that the server cannot read their tasks; or an operator's `.env` setting, where the server encrypts fields and personal keys are switched off. The field format is in epic 13 from the start; this epic is everything else.

## Related

[`DESIGN.md`](../../DESIGN.md) §9, §17.5 · Fjord's `clients/web/DESIGN.md` §19 question 14, `src/keys/`

## Tasks

#### 📋 14.1 — Keys and the field cipher

**Goal:** the cryptography, in the browser, tested alone.

**Design:** §9.2. **Depends on:** 13.1.

**Technical:** `src/keys/`. `age-encryption` (BSD-3-Clause) to generate and parse identities and to wrap list keys. Web Crypto for AES-256-GCM per field, with a random nonce, and the row id, table and field name as additional data. `list_key` table. **First confirm** that `age-encryption` can hold an identity as a non-extractable `CryptoKey` on each browser supported; if not, record what is stored instead and what that gives up.

**Accepts when:** an identity made here decrypts with the real `age` binary, and one made by `age-keygen` works here; a ciphertext moved to another row or field is refused, seen to fail with the binding removed; a Fjord identity works.

#### 📋 14.2 — Setting up a key

**Goal:** the choice at sign-up, and unlocking a new device.

**Design:** §9.1, §9.2. **Depends on:** 2.1, 14.1.

**Technical:** a step after first sign-in, for both sign-in methods: Create, Upload or Skip, not offered in operator-key mode. Create shows and downloads the key, and needs a confirmation that it was saved before going on. Upload takes a file or paste. `account_settings.encryption` and `recipient`. On another device, a page asks for the key, shows no data, and remembers it until sign-out. A wrong key is told apart from a corrupt row.

**Accepts when:** in a browser test, a person sets up, signs out, signs in, gives the key, and sees their tasks; without the key nothing is displayed; Skip leaves plain mode.

#### 📋 14.3 — Encrypting through the sync path

**Goal:** an account with a key stores only ciphertext.

**Design:** §9.2, §9.4. **Depends on:** 13.3, 14.2.

**Technical:** `commit` seals fields before the outbox, and a pull opens them for the store's readers. A new list gets a new list key, wrapped to `recipient`. Moving a task to another list re-seals its fields under that list's key. The server refuses plain fields for a `personal` account. Mirrors stay null. Performance checked at 10,000 tasks: decrypt lazily by list if needed, without changing the format.

**Accepts when:** **after a full journey, a test reads every server table for that account and finds no plain field**; the convergence suite (13.5) passes with encrypted accounts; moving a task keeps it readable; a large account opens without visible delay.

#### 📋 14.4 — Turning it on later

**Goal:** an existing account can move to a personal key, one way.

**Design:** §9.3. **Depends on:** 14.3.

**Technical:** in Settings > Data. `encryption = moving`; the browser re-seals rows in batches through sync, resumably, even if closed part way; `personal` once done, after which plain fields are refused. Two devices at once: the other is told to give the key. The screen says earlier backups and dumps remain readable.

**Accepts when:** interrupted and resumed, it finishes with no plain field left and no edit lost; offline edits from another device arriving during the move end up encrypted.

#### 📋 14.5 — Encrypted export, import and backup

**Goal:** portability on a personal-key account.

**Design:** §9.4, §19.3. **Depends on:** 9.2, 10.4, 14.3.

**Technical:** export already runs in the browser, and warns that it is plain. Import seals before sending. The server's backup writes the same shape with `"encrypted": true`, ciphertext per field and the wrapped list keys, and importing it needs the key, unsealing and resealing under new ids. Backup stops with a message when an account moves to a key, until the person confirms what stays readable.

**Accepts when:** a backup of an encrypted account contains no plain field, and restores into a new account with the key; without it, import says the key is needed.

#### 📋 14.6 — Reminders by times only

**Goal:** an encrypted account is still reminded.

**Design:** §17.5. **Depends on:** 8.4, 8.6, 14.3.

**Technical:** `reminder_slot`. The browser computes the next 14 days of slots from the tasks and zone, and replaces them on change; a slot holds a time and nothing else. The job claims due slots and pushes `{ kind: "wake" }`. The service worker reads IndexedDB, opens the fields, and shows the title or counts, with a fallback where it can't, and "Nothing due after all" otherwise. The bell, email and core's bell say only "You have tasks due". Settings explains, and says a device silent for 14 days stops getting reminders.

**Accepts when:** a slot's row has no way back to a task, by inspection of the table; a Push shows the title in Chromium and on the iOS Simulator, by hand; email says nothing of the task.

#### 📋 14.7 — Operator-key mode

**Goal:** `TASKS_DB_ENCRYPTION=on` encrypts fields on the server, on all three forms.

**Design:** §9.5. **Depends on:** 10.1, 13.2, 14.2.

**Technical:** sealing on write and opening on pull in `src/sync/`, through `src/crypto/`, bound to the row and field, with rotation by `TASKS_ENCRYPTION_KEY_PREVIOUS`. Mirrors stay readable, which the docs state. Personal keys not offered; the sign-up page says the operator manages encryption and can read data. **Start-up refuses** a conflict with what is stored: on, with personal accounts or plain fields; off, with sealed fields. `scripts/encrypt-data.mjs`, shipped in the image, moves existing data, explicitly and resumably. Backup decrypts, so its files are plain.

**Accepts when:** a dump of the database holds no title or note, on each form; each start-up refusal has a test, and names the problem; the convergence suite passes in this mode; rotation works with two processes.
