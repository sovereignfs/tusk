# Epic 14: Encryption

## Status

⏳ In progress: 14.1 is done.

## Overview

Two mutually exclusive modes. A person's own age key, opt-in, so that the server cannot read their Desk (boards are shared and the server reads them); or an operator's `.env` setting, where the server encrypts the content of the Desk and of every workspace, and personal keys are switched off. The field format is in epic 13 from the start; this epic is everything else.

## Related

[`DESIGN.md`](../../DESIGN.md) §9, §25.2 · Fjord's `clients/web/DESIGN.md` §19 question 14, `src/keys/`

## Tasks

#### ✅ 14.1 — Keys and the field cipher

**Goal:** the cryptography, in the browser, tested alone.

**Design:** §9.2. **Depends on:** 13.1.

**Technical:** `src/keys/`. `age-encryption` (BSD-3-Clause) to generate and parse identities and to wrap list keys. Web Crypto for AES-256-GCM per field, with a random nonce, and the row id, table and field name as additional data. `list_key` table. **First confirm** that `age-encryption` can hold an identity as a non-extractable `CryptoKey` on each browser supported; if not, record what is stored instead and what that gives up.

**Accepts when:** an identity made here decrypts with the real `age` binary, and one made by `age-keygen` works here; a ciphertext moved to another row or field is refused, seen to fail with the binding removed; a Fjord identity works.

**Done as:** in **`src/cipher/`, not `src/keys/`**, which is the page's keyboard (7.6); `DESIGN.md` §5.1 says so. `age-encryption` 0.3.1 (BSD-3-Clause, exact-pinned; it depends only on the noble libraries) is the one new dependency, and `esbuild` 0.28.2 is a dev dependency (already in the lockfile through Vite) for the browser test. **`identity.ts`**: `createIdentity` (an X25519 identity and its recipient); `parseIdentity` reads the file `age-keygen` writes or the key alone, **works the public part out from the secret and never trusts a `# public key:` comment**, and refuses an empty paste, more than one key, a post-quantum key (it cannot be held as a browser key) and anything with a bad checksum, each for its own reason; `keyFile` writes the form `age-keygen` writes; `identityCryptoKey` makes the identity a **non-extractable** browser key (PKCS #8 from the 32 bytes, which `bech32.ts` decodes with the checksum checked). **`list-key.ts`**: `newListKey` (32 random bytes), `wrapListKey` (an age file to the recipient, as base64url) and `unwrapListKey`, which opens with the identity as text or as a browser key and **says `wrong_key` when none of the file's recipients is the identity, apart from `malformed` for a value that is damaged**, so that a person who gave the wrong key is not told their data is broken. **`field.ts`**: AES-256-GCM per field with a random 96-bit nonce and **the table, the row id and the field name in the authenticated data**, which is a JSON array (so no choice of table, id or field reads as another); the form is base64url of `version (1) ‖ nonce (12) ‖ ciphertext ‖ tag (16)`, which is the alphabet the sync validator already takes and well inside its size rule for the longest field; a value is JSON, so a string, number, boolean or null returns as it went; a changed, moved or re-keyed value is `cannot_open` (AES-GCM cannot say which, and nothing pretends it does) and one not in the form `malformed`. An error carries a kind and nothing else: no value, key, binding or ciphertext. **`device.ts`** has the primitives of what a device keeps, and **the finding the epic asked for:** in the browsers run here, **Chromium (156) stores a non-extractable X25519 key in IndexedDB and gives it back, and WebKit (27.2) stores `null` without saying so** (while non-extractable AES-GCM and HKDF keys store in both). So a device **asks** (`canStoreX25519`, a self-contained probe that leaves nothing behind) and keeps the identity as a key where it can, and **where it cannot, the identity sealed under a non-extractable AES-GCM device key** (`newDeviceKey`, `sealIdentity`, `openIdentity`). **What that gives up:** script running in the page can ask the device key to open the identity, so XSS can read it where it could only have used the other kind, and someone who copies the profile off the disk finds both halves; it keeps the key out of plain sight on disk and nothing more. Task 14.2 does the keeping, and this is what it records. Tests: base64url and bech32 (BIP-173 vectors); an identity made here read by the **real `age`** (`age-keygen -y` on the file saved gives the recipient; `age` encrypts to our recipient and we open it; we encrypt and `age -d` opens it); an `age-keygen` file read here (and a fixture kept in the repository, so that the check is made without the binary, which is what a Fjord identity is too); every refusal; the browser key (hidden, same recipient, opens what the real age made); a list key wrapped and opened as text and as a browser key, `wrong_key` against `malformed`, and the real `age` opening the wrapped file; the field (every kind of value, the form, different each time, no plaintext in it, **every byte flipped, truncated and extended**, the version, the longest title through the validator's size rule, no secret in an error); the device's sealed identity; and **a browser test in Chromium and WebKit that bundles `src/cipher/` as it would be shipped and runs the whole of it in the page**, including the device key either way. **Each part of the binding was seen to fail with it removed** from the authenticated data (the table, the row and the field, each on its own, and the data altogether), and so were the version check, `wrong_key`, the public part coming from the secret and one spelling for one ciphertext. CI installs `age` (`apt-get install age`) and **`src/cipher/testing.ts` fails in CI if it is missing**, so the check is never quietly not made; on a machine without it those tests are skipped. **Left out:** the `list_key` table (§23.3) is not made here, since nothing uses it until the sync path does: it is task 14.3's, with the deletion of a person's rows that goes with it. **Not verified:** a Fjord identity as such (there is none here; it is the same format, and an `age-keygen` one is the proof); Firefox, which is not a supported browser.

#### 📋 14.2 — Setting up a key

**Goal:** the choice at sign-up, and unlocking a new device.

**Design:** §9.1, §9.2. **Depends on:** 2.1, 14.1.

**Technical:** a step after first sign-in, for both sign-in methods: Create, Upload or Skip, not offered in operator-key mode. Create shows and downloads the key, and needs a confirmation that it was saved before going on. Upload takes a file or paste. `account_settings.encryption` and `recipient`. On another device, a page asks for the key, shows no data, and remembers it until sign-out. A wrong key is told apart from a corrupt row.

**Accepts when:** in a browser test, a person sets up, signs out, signs in, gives the key, and sees their Desk; boards and the Inbox show without it; without the key nothing is displayed; Skip leaves plain mode.

#### 📋 14.3 — Encrypting through the sync path

**Goal:** an account with a key stores only ciphertext.

**Design:** §9.2, §9.4. **Depends on:** 13.3, 14.2.

**Technical:** `commit` seals fields before the outbox, and a pull opens them for the store's readers. A new list gets a new list key, wrapped to `recipient`. Moving a card to another list re-seals its fields under that list's key. The server refuses plain fields for a `personal` account. Mirrors stay null. Performance checked at 10,000 cards: decrypt lazily by list if needed, without changing the format.

**Accepts when:** **after a full journey, a test reads every server table for that account and finds no plain field**; the convergence suite (13.5) passes with encrypted accounts; moving a card keeps it readable; a large account opens without visible delay.

#### 📋 14.4 — Turning it on later

**Goal:** an existing account can move to a personal key, one way.

**Design:** §9.3. **Depends on:** 14.3.

**Technical:** in Settings > Data. `encryption = moving`; the browser re-seals rows in batches through sync, resumably, even if closed part way; `personal` once done, after which plain fields are refused. Two devices at once: the other is told to give the key. The screen says earlier backups and dumps remain readable.

**Accepts when:** interrupted and resumed, it finishes with no plain field left and no edit lost; offline edits from another device arriving during the move end up encrypted.

#### 📋 14.5 — Encrypted export, import and backup

**Goal:** portability on a personal-key account.

**Design:** §9.4, §21.3. **Depends on:** 9.2, 10.4, 14.3.

**Technical:** export already runs in the browser, and warns that it is plain. Import seals before sending. The server's backup writes the same shape with `"encrypted": true`, ciphertext per field and the wrapped list keys, and importing it needs the key, unsealing and resealing under new ids. Backup stops with a message when an account moves to a key, until the person confirms what stays readable.

**Accepts when:** a backup of an encrypted account contains no plain field, and restores into a new account with the key; without it, import says the key is needed.

#### 📋 14.6 — Reminders by times only (phase 2)

**Goal:** an encrypted Desk still gets reminders.

**Design:** §25.2. **Depends on:** 8.4, 8.6, 14.3.

**Technical:** `reminder_slot`. The browser computes the next 14 days of slots from the Desk's cards and zone, and replaces them on change; a slot holds a time and nothing else. The job claims due slots and pushes `{ kind: "wake" }`. The service worker reads IndexedDB, opens the fields, and shows the title or counts, with a fallback where it can't, and "Nothing due after all" otherwise. The bell, email and core's bell say only "You have cards due". Settings explains, and says a device silent for 14 days stops getting reminders.

**Accepts when:** a slot's row has no way back to a card, by inspection of the table; a Push shows the title in Chromium and on the iOS Simulator, by hand; email says nothing of the card.

#### 📋 14.7 — Operator-key mode

**Goal:** `TUSK_DB_ENCRYPTION=on` encrypts content on the server, the Desk's and every workspace's, on all three forms.

**Design:** §9.5. **Depends on:** 10.1, 13.2, 14.2, 18.6.

**Technical:** for the Desk, sealing on write and opening on pull in `src/sync/`; for workspaces, sealing each content column (§9.5) on write in `src/workspaces/` and opening it on read, and in activity's and notices' `details`; both through `src/crypto/`, bound to the row and field, with rotation by `TUSK_ENCRYPTION_KEY_PREVIOUS`. Structure, positions, due dates, archive and delete times and colours stay readable, which the docs state. Personal keys not offered; the sign-up page says the operator manages encryption and can read data. **Start-up refuses** a conflict with what is stored: on, with personal accounts or plain fields; off, with sealed fields. `scripts/encrypt-data.mjs`, shipped in the image, moves existing data, explicitly and resumably. Backup decrypts, so its files are plain.

**Accepts when:** a dump of the database holds no title, description, comment, name or checklist item of the Desk or of a board, on each form; each start-up refusal has a test, and names the problem; the convergence suite and the workspace role matrix pass in this mode; a published board renders; rotation works with two processes.
