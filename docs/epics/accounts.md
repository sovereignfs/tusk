# Epic 2: Accounts and sign-in

## Status

⏳ In progress: 2.1 and 2.2 are done, under the name Tasks.

## Overview

Sign-in identical to Fjord Web's: local accounts, a Sovereign core, or both, on better-auth. Everything Fjord tested about it is tested here. Also
Settings, what a person leaves by (which now hands shared work on to the people still using it), and what makes the app hostable by an instance.

## Related

[`DESIGN.md`](../../DESIGN.md) §6, §19, §22, §24 · Fjord's `clients/web/DESIGN.md` §6, §17 and `docs/epics/web-1a.md` 1a.2–1a.4

## Tasks

#### ✅ 2.1 — Local sign-in

**Goal:** someone can make the first account, sign in and sign out.

**Design:** §6. **Depends on:** 1.5, 1.8.

**Technical:**

- `better-auth` and `@better-auth/drizzle-adapter`, pinned to one `~1.7` version, in the auth store, with its own migrations in `migrations/auth/` and tables in `src/db/schema/*/auth.ts`.
- `src/auth/config.ts`: `TASKS_AUTH_LOCAL`, `TASKS_AUTH_SECRET` (32 characters or more), `TASKS_URL`, `TASKS_AUTH_SIGNUP` (`closed` by default). A wrong setting stops the server.
- `src/auth/server.ts`; `app/api/auth/[...all]/route.ts`. `src/auth/session.ts`: `requireAccount()`, returning the account id, which everything after this uses.
- Sign-up policy in the user-creation hook, so that it holds for every path: with `closed`, the first account and then refused, with code `SIGNUP_CLOSED`.
- Off means off: `/sign-in`, `/sign-up` and `/api/auth` answer 404. Screens from the design system, `force-dynamic`, and no message says whether an address has an account.
- `UserMenu` in `AppShell`, with Sign out; the rest of sign-out's work is 13.4.
- `src/auth/test-support.ts`: tests go through `auth.handler` with real cookies and `Origin`, not a mock.

**Accepts when:** sign up, sign in and sign out work in a browser and over real requests on all three databases; a second sign-up is refused by the server on `closed`; the origin check and the lockout are each seen to fail with them switched off.

**Done as:** adapted from Fjord Web's sign-in, with Tasks' names, `better-auth` and its Drizzle adapter pinned to `~1.7.16`. `src/auth/config.ts` is read by `loadConfig` with the other settings, so the server stops on a wrong one, naming it and never its value: `TASKS_AUTH_LOCAL` (1 or 0; anything else is refused, not guessed), `TASKS_AUTH_SECRET` or `_FILE` (32 characters or more), `TASKS_URL` (required once local sign-in is on), `TASKS_AUTH_SIGNUP` (`closed` by default) and `TASKS_AUTH_PASSWORD_MIN_LENGTH` (10, from 8 to 128; not in the epic, taken from Fjord). The auth store has its first migration, `auth_tables`, for `user`, `session`, `account`, `verification` and `rate_limit`, with a Drizzle config and a folder per dialect under `migrations/auth/`; `pnpm db:generate` writes all four and CI's check covers them, the parity test covers them, and `runMigrations` no longer has an `optional` mode now that the auth store has migrations to apply. `createAuth` takes settings and a database and nothing global; the sign-up policy is in the user-creation hook, so it holds for every path, and refuses with `403` and code `SIGNUP_CLOSED`. Sessions are cookies prefixed `tasks`, `HttpOnly`, `SameSite=Lax`, `Secure` over https; the origin check is on explicitly (better-auth turns it off under `NODE_ENV=test`); rate limits are counted in the database. `requireAccount()` returns the better-auth user id and sends a visitor to `/sign-in`. Off means off: `/api/auth` answers 404 from its handler, and `/sign-in` and `/sign-up` from the proxy, which rewrites them to the page that is not found (a page cannot do it itself: the root loading state has already sent a 200 by the time `notFound()` runs). Screens use the design system's auth components through `src/ui`; no message says whether an address has an account (a wrong password and an unknown address were seen to answer the same, in the API and in a browser). `AccountMenu` in `AppShell`'s `account` slot has Sign out, which ends the session; clearing the local copy of a person's tasks is 13.4's. Tests: in `src/auth`, 10 over real requests through `auth.handler` on a fresh auth store, with real cookies and an `Origin` (a first account; a hash and not the password; the cookie's flags; later sign-ups refused with the code and nothing created; sign-in and sign-out, and a replayed cookie after sign-out; the rate limit; a hostile and a missing `Origin`; a short password; open sign-up with each account separate and a taken address refused); 5 of the settings; 2 of the route when off and when on; one of the proxy; and 4 in Chromium and WebKit. The whole suite ran, passing, on sqld, a file and PostgreSQL 16, and the browser tests on all three. Seen to fail: the origin check switched off, the rate limit switched off, and the sign-up policy removed, each failing exactly its own test and no other. Not as the epic said: the "lockout" is the per-address rate limit (three tries in ten seconds, then 429), since account lockout in better-auth belongs to two-factor, which is 2.4; and the auth tables keep their foreign keys with `ON DELETE CASCADE` as Fjord's do, since the rule against them is for the app store (DESIGN.md §22.1) and better-auth relies on them to remove a person's sessions and accounts. Two-factor and passkeys add their tables and `two_factor_enabled` with 2.4. Not done: `src/access/routes.ts` and its test of who may call a route, which is 3.1 (`/api/auth` is public when sign-in is on and absent when it is off, and the route test says so); the `?next=` return address, which is not needed until there is a page to return to; the manifest's sign-in paths, which 2.10 replaces. It has not run on GitHub: nothing is pushed.

#### ✅ 2.2 — Landing page and the address `/`

**Goal:** `/` says what Tasks is to a visitor, and is the first list to someone signed in, at the same address.

**Design:** §17.11. **Depends on:** 2.1.

**Technical:** a static page from typed content, in `src/landing/`. `proxy.ts` rewrites `/` to `/home` when a session cookie is present, looking only at the cookie. `/home` checks the session, and until 3.3 is a placeholder; then it starts the app's shell (13.4), which opens the first list.

**Accepts when:** a visitor gets static HTML in light and dark at a phone's width; a signed-in person sees their list at `/`; a forged cookie gets the sign-in page, not data.

**Done as:** `src/landing/content.ts` is the page's words, typed, and a test refuses any that promise what is not built (encryption, reminders, sharing, backup, repeat, push, subtasks); `Landing` is a server component with no client code in it, so it is the same HTML before any script and with none (seen in a browser with JavaScript off): a heading, a lead, _Sign in_ where sign-in is set up at all, _Create an account_ only where the server would take one, and three short statements of what is so today. `app/page.tsx` is that page inside the shell. **`proxy.ts` rewrites `/` to `/home` when a session cookie is present**, looking only at the cookie (`src/auth/cookie.ts`, which the proxy can import because it has no Node in it, and which a test holds to the name better-auth sets, with and without the `Secure` prefix) and not for an empty value, another name or another page; the address stays `/`. `/home` checks the session itself and shows the first list, in the sidebar's order, from the working copy (`HomeScreen`), so **a forged cookie gets the sign-in page and no data** (seen in a browser), and so does a cookie the server has ended. Signing in, signing out, and the link on a missing list now go to `/`. The placeholder text "Tasks is being built" is gone, and the browser tests that used it as the sign that the app was there look for the lists instead. The proxy is tested for each case above; 4 browser tests in Chromium and WebKit (a visitor with no script, an account offered only where it can be made, the first list at `/` and the front page again after signing out, a forged cookie), and the dark and phone-width tests of the shell cover the page as before. Looked at in a screenshot. One thing the rewrite changed: closing a task's detail replaces the address with the _path of the page_, which is `/home` when the page was opened there by address and `/` when it was reached at the front, so a link to `/home?task=` stays at `/home`.

#### 📋 2.3 — Email: verification and reset

**Goal:** with SMTP set, addresses are verified and a forgotten password can be reset. Without it, neither is offered.

**Design:** §6. **Depends on:** 2.1, 15.1.

**Technical:** `nodemailer` behind an interface in `src/mail/`, with a test mailer that a test can read, and templates. `TUSK_SMTP_HOST`, `_PORT`,
`_USER`, `_PASSWORD` (`_FILE`), `_FROM`; a host with no sender stops the server. With it, verification before first sign-in (the link signs in) and a
single-use reset that ends every session. Without it, no screen offers a reset, and the endpoint is off.

**Accepts when:** each flow runs end to end against the test mailer; a reset link used twice is refused; a reset ends other sessions; without SMTP the
reset endpoint answers as absent.

#### 📋 2.4 — Two-factor and passkeys

**Goal:** an authenticator app with backup codes, and passkeys.

**Design:** §6, §19. **Depends on:** 2.1, 2.7.

**Technical:** better-auth's `twoFactor` plugin and `@better-auth/passkey`. `qrcode.react` for the enrolment code. Ten single-use backup codes, turned
on only once a code has been shown to work, each change asking for the password. Passkeys added, named, removed, and able to sign in with no password;
the relying party comes from `TUSK_URL`. In Settings > Security.

**Accepts when:** done in a real browser with Playwright's virtual authenticator, on all three databases: enrol, sign in with each, recover with a backup
code, a spent code refused.

#### 📋 2.5 — Sovereign sign-in

**Goal:** sign-in through a core, with a server that also works when that core is down.

**Design:** §6. **Depends on:** 2.1, 15.1.

**Technical:**

- `TUSK_CORE_URL`, `TUSK_CORE_CLIENT_ID`, `TUSK_CORE_CLIENT_SECRET`: all or none, a partial set stops the server.
- better-auth's `genericOAuth` with discovery: PKCE S256, basic auth, a nonce, `requireIdTokenVerification`. Redirect `/api/auth/callback/sovereign`;
  scopes `openid profile email` in one constant the manifest test shares. `sub` is the account id; `email` and `name` are copied once.
  `encryptOAuthTokens`, `disableProviderLogout`.
- Refused with a code and a message, never bare JSON: `account_not_linked`, `SIGNUP_CLOSED`.
- `src/auth/testing/fake-sovereign.ts`: a strict OIDC provider (exact redirect, PKCE, secret, single-use codes, EdDSA).
  `scripts/record-sovereign-discovery.mjs`, and a test tying the fake to a recording of a real document.

**Accepts when:** sign-in works against the fake, in tests and in a browser; a token with a wrong signature, audience or nonce is refused; a core
unreachable at start-up does not stop the server; a local account's email coming through Sovereign is refused.

#### 📋 2.6 — Linking a Sovereign identity

**Goal:** a local account can add Sovereign, under the rules that keep one person's identity from reaching another's account.

**Design:** §6. **Depends on:** 2.5, 2.7.

**Technical:** only from a signed-in session; only when Sovereign's email is the account's own, case aside; an identity already linked cannot link
again; unlinking is a fresh-session action and never removes the last way in. Afterwards, Sovereign sign-in finds the account by `sub`, whatever its
address later becomes. Fjord's `web-1a.md` 1a.4 is the list of tests. In Settings > Security.

**Accepts when:** each rule has a test seen to fail with it switched off, on all three databases.

#### 📋 2.7 — Settings

**Goal:** one dialog, from the avatar menu, with Profile, Security, Preferences, Notifications, Data and Activity, each filled as far as what exists.

**Design:** §19. **Depends on:** 7.8.

**Technical:** `/account?section=`: a `Dialog` over the page on a desktop and a full page on a phone, through a parallel route, as Fjord's
`app/@modal/(.)account`, with a section list beside the content. **Profile:** name, email, avatar (what workspaces see). **Security:** password (asks
for the old one, ends other sessions), signed-in devices with sign-out elsewhere, and the places 2.4 and 2.6 fill. An account that came through
Sovereign has no password, two-factor or passkey parts, and says so. **Preferences:** theme, first day of the week, the sort of My workspaces (16.4).
**Notifications:** filled by 8.1. **Data:** last synced, and the places 9.1, 10.3, 14.2, 17.5 and 2.8 fill. **Activity:** filled by 17.6, and the
devices' last sign-in. `UserMenu` opens it: a header of name and email, Settings, Sign out, and a way back to the instance when a core is set. Each
section says when it needs a network. `account_settings` gains `first_day_of_week` and `workspace_sort`, saved through `PATCH /api/settings`.

**Accepts when:** a local and a Sovereign-only account each see the right parts, and the routes behind them refuse the other kind; the dialog opens over
the Desk and over a board and closes back to them; an address with a section opens it there; a preference saved here holds on a second device.

#### 📋 2.8 — People, and deleting an account

**Goal:** one routine deletes everything of an account, hands on what is shared, and a person can run it.

**Design:** §22. **Depends on:** 2.7, 16.3, 18.6.

**Technical:**

- `src/sovereign/people.ts`: `People.deletePerson(accountId)`. **The Desk:** every list, card, item and series (soft-deleted included), list keys,
  tombstones and applied mutations. **Workspaces:** for each where they are the only owner, the longest-standing other member becomes owner (raising a
  `workspace_passed` notice), and one with nobody else is deleted with its boards; then the person is removed from every workspace and board and
  unassigned, as 16.3's removal does. Their comments, cards and activity stay, resolving to "Deleted account". **The rest:** notices for and about them,
  settings, the backup connection and credential, rate counters, then passkeys, two-factor, sessions, sign-ins, and the account. The row linking a `sub`
  goes last, so a run that stopped can find the account. Each store's part in transactions; the two stores cannot share one, so it is written to be run
  again.
- Settings > Data → Delete account: asks for the password, or a fresh session for a Sovereign-only account; says what goes, which workspaces pass to
  whom, and that a backup repository does not. This device's local database goes too; other devices learn at their next sync.
- `people.test.ts` seeds **one row of every table** for the person and for a second person sharing a workspace and a board with them, by asking the
  schema for the tables, so a table left out fails it.

**Accepts when:** after deletion nothing of that account is on any table; a workspace they solely owned now has the other person as owner, with their
boards, cards and the deleted person's comments intact; a workspace with nobody else is gone; running it again does nothing and does not fail; a new
table with an account column fails the test until it is handled.

#### 📋 2.9 — Notices from core

**Goal:** a core can end a person's sessions and delete their account here.

**Design:** §22. **Depends on:** 2.5, 2.8.

**Technical:** `@sovereignfs/sdk`'s `verifyLogoutToken` and `verifyAccountDeletedToken`, imported in `src/sovereign/verifiers.ts` alone.
`POST /api/sovereign/backchannel-logout` and `/api/sovereign/account-deleted`, rules in `src/sovereign/http.ts`: a bounded form (16 KiB), one rate limit
for both, `400` to refuse, `503` when core could not be asked, `500` for a failure of ours, `200` for a deletion only once done. A replayed `jti`
refused through `rate_bucket`. 404 where Sovereign is not set up. Logs the kind of error, never the token or the person.

**Accepts when:** tests over `createFakeCore`'s real tokens: a good notice works, a replay, a wrong audience and an expired one do not; a browser test
with the fake Sovereign signs someone out from the core's side.

#### 📋 2.10 — Hosting on an instance

**Goal:** `sv app add` can host it as it stands.

**Design:** §24 Deployment. **Depends on:** 1.10, 2.9.

**Technical:** `sovereign.manifest.json` as §24 says: prefix `tusk`, `"database": true`, the redirect, `backChannel`, `accountDeleted`, scopes, `icon`
(left public by the proxy), a real description, `generate` of `TUSK_AUTH_SECRET` and a 32-byte `TUSK_ENCRYPTION_KEY`. `src/sovereign-manifest.test.ts`
holds it to a copy of the JSON Schema and to the code it names. `deploy-check.sh sovereign`: given what `sv apply` gives an app, on a `PORT` that is not
the default, on PostgreSQL from `_FILE` secrets, it comes up, offers Sovereign and no password, serves its icon with no session, serves a published
board, and stops on `SIGTERM` in seconds.

**Accepts when:** the manifest passes `pnpm manifest:check` and its test; `deploy-check.sh sovereign` passes in CI; the image's label equals the file.
