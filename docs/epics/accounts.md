# Epic 2: Accounts and sign-in

## Status

📋 Planned

## Overview

Sign-in identical to Fjord Web's: local accounts, a Sovereign core, or both, on better-auth. Everything Fjord tested about it is tested here. Also Settings, what a person leaves by, and what makes the app hostable by an instance.

## Related

[`DESIGN.md`](../../DESIGN.md) §6, §20, §23 · Fjord's `clients/web/DESIGN.md` §6, §17 and `docs/epics/web-1a.md` 1a.2–1a.4

## Tasks

#### 📋 2.1 — Local sign-in

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

#### 📋 2.2 — Landing page and the address `/`

**Goal:** `/` says what Tasks is to a visitor, and is the first list to someone signed in, at the same address.

**Design:** §14.1. **Depends on:** 2.1.

**Technical:** a static page from typed content, in `src/landing/`. `proxy.ts` rewrites `/` to `/home` when a session cookie is present, looking only at the cookie. `/home` checks the session, and until 3.3 is a placeholder; then it starts the app's shell (13.4), which opens the first list.

**Accepts when:** a visitor gets static HTML in light and dark at a phone's width; a signed-in person sees their list at `/`; a forged cookie gets the sign-in page, not data.

#### 📋 2.3 — Email: verification and reset

**Goal:** with SMTP set, addresses are verified and a forgotten password can be reset. Without it, neither is offered.

**Design:** §6. **Depends on:** 2.1.

**Technical:** `nodemailer` behind an interface in `src/mail/`, with a test mailer that a test can read, and templates. `TASKS_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD` (`_FILE`), `_FROM`; a host with no sender stops the server. With it, verification before first sign-in (the link signs in) and a single-use reset that ends every session. Without it, no screen offers a reset, and the endpoint is off.

**Accepts when:** each flow runs end to end against the test mailer; a reset link used twice is refused; a reset ends other sessions; without SMTP the reset endpoint answers as absent.

#### 📋 2.4 — Two-factor and passkeys

**Goal:** an authenticator app with backup codes, and passkeys.

**Design:** §6, §16. **Depends on:** 2.1, 2.7.

**Technical:** better-auth's `twoFactor` plugin and `@better-auth/passkey`. `qrcode.react` for the enrolment code. Ten single-use backup codes, turned on only once a code has been shown to work, each change asking for the password. Passkeys added, named, removed, and able to sign in with no password; the relying party comes from `TASKS_URL`.

**Accepts when:** done in a real browser with Playwright's virtual authenticator, on all three databases: enrol, sign in with each, recover with a backup code, a spent code refused.

#### 📋 2.5 — Sovereign sign-in

**Goal:** sign-in through a core, with a server that also works when that core is down.

**Design:** §6. **Depends on:** 2.1.

**Technical:**
- `TASKS_CORE_URL`, `TASKS_CORE_CLIENT_ID`, `TASKS_CORE_CLIENT_SECRET`: all or none, a partial set stops the server.
- better-auth's `genericOAuth` with discovery: PKCE S256, basic auth, a nonce, `requireIdTokenVerification`. Redirect `/api/auth/callback/sovereign`; scopes `openid profile email` in one constant the manifest test shares. `sub` is the account id; `email` and `name` are copied once. `encryptOAuthTokens`, `disableProviderLogout`.
- Refused with a code and a message, never bare JSON: `account_not_linked`, `SIGNUP_CLOSED`.
- `src/auth/testing/fake-sovereign.ts`: a strict OIDC provider (exact redirect, PKCE, secret, single-use codes, EdDSA). `scripts/record-sovereign-discovery.mjs`, and a test tying the fake to a recording of a real document.

**Accepts when:** sign-in works against the fake, in tests and in a browser; a token with a wrong signature, audience or nonce is refused; a core unreachable at start-up does not stop the server; a local account's email coming through Sovereign is refused.

#### 📋 2.6 — Linking a Sovereign identity

**Goal:** a local account can add Sovereign, under the rules that keep one person's identity from reaching another's account.

**Design:** §6. **Depends on:** 2.5, 2.7.

**Technical:** only from a signed-in session; only when Sovereign's email is the account's own, case aside; an identity already linked cannot link again; unlinking is a fresh-session action and never removes the last way in. Afterwards, Sovereign sign-in finds the account by `sub`, whatever its address later becomes. Fjord's `web-1a.md` 1a.4 is the list of tests.

**Accepts when:** each rule has a test seen to fail with it switched off, on all three databases.

#### 📋 2.7 — Settings

**Goal:** one place, from the avatar menu, with Profile, Preferences, Security and Lists, and room for the rest.

**Design:** §16. **Depends on:** 2.1, 3.3.

**Technical:** `/settings?section=`: a dialog over the page on a desktop and a full page on a phone, through a parallel route, as Fjord's `app/@modal/(.)account`. **Profile:** name, email, avatar. **Preferences:** theme, first day of the week, how Today opens. **Security:** password (asks for the old one, ends other sessions), and the places 2.4 and 2.6 fill. An account that came through Sovereign has no password, two-factor or passkey sections, and says so. **Lists:** each list's name and colour, reorder by dragging, delete, through 3.3's actions. Sections for Notifications and Data arrive with 8.2 and 9.1. `UserMenu` from `AppShell` opens it, with Sign out, and a way back to the instance when a core is set.

**Accepts when:** a local and a Sovereign-only account each see the right sections, and the sections' routes refuse the other kind; a list's colour changed here shows in the sidebar; Settings says plainly what needs a network.

#### 📋 2.8 — People, and deleting an account

**Goal:** one routine deletes everything of an account, and a person can run it.

**Design:** §20. **Depends on:** 2.7, 3.4.

**Technical:**
- `src/sovereign/people.ts`: `People.deletePerson(accountId)`: tasks, series, lists (soft-deleted included), list keys, reminder slots, notifications, push subscriptions, settings, backup connection and credential, rate counters, then passkeys, two-factor, sessions, sign-ins, and the account. The row linking a `sub` goes last, so a run that stopped can find the account. Each store's part in a transaction; the two stores cannot share one, so it is written to be run again.
- Settings > Data → Delete account: asks for the password, or a fresh session for a Sovereign-only account; says what goes, and that a backup repository does not. This device's local database goes too, and other devices learn at their next sync (13.4).
- `people.test.ts` seeds **one row of every table**, by asking the schema for the tables, so a table left out fails it.

**Accepts when:** after deletion nothing of that account is on any table, and the other account's rows are untouched; running it again does nothing and does not fail; a new table with `account_id` or `owner_id` fails the test until it is handled.

#### 📋 2.9 — Notices from core

**Goal:** a core can end a person's sessions and delete their account here.

**Design:** §20. **Depends on:** 2.5, 2.8.

**Technical:** `@sovereignfs/sdk`'s `verifyLogoutToken` and `verifyAccountDeletedToken`, imported in `src/sovereign/verifiers.ts` alone. `POST /api/sovereign/backchannel-logout` and `/api/sovereign/account-deleted`, rules in `src/sovereign/http.ts`: a bounded form (16 KiB), one rate limit for both, `400` to refuse, `503` when core could not be asked, `500` for a failure of ours, `200` for a deletion only once done. A replayed `jti` refused through `rate_bucket`. 404 where Sovereign is not set up. Logs the kind of error, never the token or the person. 

**Accepts when:** tests over `createFakeCore`'s real tokens: a good notice works, a replay, a wrong audience and an expired one do not; a browser test with the fake Sovereign signs someone out from the core's side.

#### 📋 2.10 — Hosting on an instance

**Goal:** `sv app add` can host it as it stands.

**Design:** §23 Deployment. **Depends on:** 1.10, 2.9.

**Technical:** `sovereign.manifest.json` as §23 says: `"database": true`, the redirect, `backChannel`, `accountDeleted`, scopes, `icon` (left public by the proxy), a real `description`, `generate` of `TASKS_AUTH_SECRET` and a 32-byte `TASKS_ENCRYPTION_KEY`, `core` of at least 0.62.0. VAPID keys are an operator's (8.4). `src/sovereign-manifest.test.ts` holds it to a copy of the JSON Schema and to the code it names. `deploy-check.sh sovereign`: given what `sv apply` gives an app, on a `PORT` that is not the default, on PostgreSQL from `_FILE` secrets, it comes up, offers Sovereign and no password, serves its icon with no session, and stops on `SIGTERM` in seconds. It accepts the secret in URL-safe base64 as generated.

**Accepts when:** the manifest passes `pnpm manifest:check` and its test; `deploy-check.sh sovereign` passes in CI; the image's label equals the file.
