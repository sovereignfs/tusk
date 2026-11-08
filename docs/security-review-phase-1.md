# Tusk, security review of phase 1

The review of task 11.3 ([`docs/epics/release.md`](epics/release.md)): what [`DESIGN.md`](../DESIGN.md) §7 and §24 promise and what the rules of
[`AGENTS.md`](../AGENTS.md) say, tried against the running app and not the code alone, what was found, what was done, and what was left. It is a record of one
review at one time (7 November 2026), in the manner of Fjord Web's (`sovereignfs/fjord`, `docs/security-review-phase-1.md`); the promises themselves stay in the
design. Each protection that holds is a test, and each test named below was seen to fail with the protection switched off.

**Who did it:** one reviewer, who wrote the code, with the tests and the app. That is a limit, and it is the first thing under _Not done_. Nothing here is an audit.

## Summary

One thing was found that mattered, and was fixed: **what a person searches for on the Desk was put in the address as a query string, which is sent to the server** on
a reload, a followed link and the first letter typed from another page, and so reached the server and any proxy's log, even for a Desk sealed with a key of its own
(finding 1). Nothing was found open in access, publishing, sign-in, the notices, the backup path or the GitHub App. What had been left unchecked as a whole is now
a test (findings 2 to 4), and what is left is listed.

## What was checked, and what was found

### 1. The Desk's search was in the address as a query string

`/desk?q=milk` is a request the server answers, so the text of a search reached the server's request log and any reverse proxy's access log. `AGENTS.md` says that a
plain field never reaches the server for a Desk with a key of its own and that no title, description or comment reaches a log for any; a search is made of what a person
wrote about their own cards, and was the one thing that did. **Fixed:** it is a fragment now, `/desk#q=milk`, which a browser never sends (`src/screens/search-query.ts`).
The address still names the search, so a reload and the back button keep it. Tested: the address is a fragment and never contains `?` (`search-query.test.ts`), and the
browser test fails on any request, from typing the first letter on another page to the last, whose address carries the text (`e2e/search.spec.ts`).

### 2. Access: every role, every operation, every read

The matrix of roles (`src/workspaces/roles.test.ts`) runs six people in six roles through **every operation the door takes** and every read, with the answer for each
written once in a table, on all three databases; a new operation without a row fails its last test. Refusals read as not found (a workspace that is not there is the
same answer as one that is not theirs), a private board is in no read for a person who cannot see it, and a person's id is always the session's and never the body's.
`src/access/routes.ts` lists every page and route with who may use it and is held to `app/` by a test, so a new route cannot exist unlisted: every route that changes
something refuses a request from another site, one with no origin and one whose origin is `null`, and a public route that changes something says what stands in for a
session. **No finding.** The review added nothing here because nothing was missing; it read the table against the design and they agree.

### 3. What is a person's is never cached

`e2e/headers.spec.ts` walks the table of routes and asks every page and every route for a signed-in account that has no parameter, and fails on any success that is not
`no-store`: a shared cache between the server and a browser would otherwise hold a person's Desk, boards or Inbox. **All hold.** (The one that did not say so was an
error with no body, which carries nothing, and is not asked.) The published page is `no-store` too, and the service worker keeps only the build's files and the shell,
by an allow-list, never an answer from `/api` (the browser tests of the shell look into the caches after a tour and after sign-out).

### 4. Where a sign-in route may send a person

Every route of the sign-in library that takes a return address (password sign-in and sign-up, a reset, a verification, the start of Sovereign sign-in and linking) was
given another site's address, a protocol-relative one, a backslash and `javascript:`, and **none sends anyone anywhere but here**; no mail carries a link to another
site. Tested (`src/auth/redirects.test.ts`), and seen to fail when another origin is trusted by mistake.

### 5. Sign-in, against Fjord's list

Sessions are cookies prefixed `tusk`, `HttpOnly`, `SameSite=Lax`, `Secure` over https; a request from another site is refused by the library's origin check, which is
switched on explicitly (it is off under `NODE_ENV=test`); sign-in, sign-up, reset and the second step are rate-limited in the database; no reply says whether an address
has an account except open sign-up with no mail, which has to; a password change ends the other sessions; a reset link is good once and ends every session; a second
factor locks after ten failures; a Sovereign identity is its `sub` and never matched to an account by an address; **it is linked only from a signed-in session, with a session made in the last ten minutes, and only when the address is the account's own**;
the last way in is never removed; an account that came in through Sovereign alone has no password route to attack. Each is a test (`auth.test.ts`, `mail.test.ts`,
`two-factor.test.ts`, `sovereign.test.ts`) seen to fail with the rule off. **No finding.**

### 6. Adding people by email

`member.add` tells **an owner** whether an address has an account (it must, or it cannot add them), and nobody else (a member, a viewer and an outsider are told the
operation is not there). It is limited to 30 a hour per person. That is an account lookup for anyone who owns a workspace, and a limited one; **recorded, not changed**.

### 7. Publishing

A published page is made by a read that selects no person, and the test finds none of a name, an address, an assignee, a comment or an activity in what it reads or in
its HTML; what a person wrote in a title, a description, a label or a list is escaped as text; a colour that is not `#rrggbb` is no colour; the token is 32 random
bytes; unpublishing deletes it for good; a deleted board's address is a 404; the page has a policy that allows no script, `noindex`, `no-store` and a rate. **No finding.**

### 8. Content security policy, headers, and what text can do

A nonce for each request, no inline script, handler or `eval` in production, nothing third-party, no framing, forms only here, HSTS over https, `nosniff`,
`no-referrer`. Nothing writes content as HTML (what people write is rendered as text). The browser tests fail on any blocked request. **No finding.**

### 9. Both encryption modes

**A key of your own** (the only one built): the server is checked to hold no plain Desk field for such an account after a full journey, refuses a plain field for it,
and a server-side rule that needs content says what it does when it cannot read. §9.6's limit stands and is in the user's documentation
([`docs/encryption.md`](encryption.md)): a key in a browser does not protect against a server that sends altered code. **The server-wide key (`TUSK_DB_ENCRYPTION=on`) was not built when this
was reviewed, and the server refused to start with it**, which was the review's finding for that half: nothing was reviewed because nothing was claimed. It has been
built since (task 14.7, `docs/epics/encryption.md`) and is checked as its own work, not by this review. The finding of §1 above was a hole in the first, found by asking what else reaches the server about a sealed Desk.

### 10. Credentials, the backup path and the GitHub App

A token is stored only through `src/crypto/` (envelope encryption, bound to its row and purpose), never as text in a column, and appears in no error, log or URL (tested
with a planted token through every failure of connecting and of a backup). A connection is checked before anything is kept, only a private repository is accepted and it is
checked again each time; a commit is never forced and a write is never retried on a lost answer. **The GitHub App** (new in this phase): the `state` must be the browser's
own cookie's, in constant time, and the person's own token must reach the installation, or nothing is connected (each seen to fail with it off); no token is kept, and an
installation token is held in memory only; the webhook is authenticated by its signature over the exact bytes, capped, and acts only on removal. **No finding.**

### 11. Import as untrusted input

A file is read by one validator shared by the browser and the server, bounded (50 MB, every field within its limits), refused whole if any part is wrong and then changes
nothing; keys that name an object's prototype are refused; it always creates and never replaces; people are matched by address to accounts and dropped otherwise. **No finding.**

### 12. Notices from the instance

Core's two notices are checked by the SDK (type, signature against core's keys, issuer, audience, age, event, `jti`), once each (a replay is refused through the database),
from a bounded form, rate-limited, `404` where no core is set; the person is found by the `sub` and nobody else is touched. Tested against the SDK's own fake core and a
browser test that signs a person out from the instance's side. **No finding.**

### 13. After sign-out

Signing out deletes the person's working copy and the key from the device, and the identity the offline shell keeps, **after** ending the session (a sign-out that cannot reach
the server leaves things as they were, not a person who thinks they have left with a session still open). Tested (`signout.test.ts`) and in the browser. **No finding.**

### 14. Logs and errors

Every log line was listed (`console.*` in the app): the database in use (its name and host, no credential), the jobs by name and kind, the notices and webhook by kind, and
start-up problems that name a setting and never its value. No title, description, comment, token, address or key is in any. (One start-up message still said _Tasks_ after the
rename: **fixed**.) An error from a call to GitHub is one of the provider's codes built from the status, never from what the host wrote.

### 15. Dependencies

`pnpm audit --prod`: **no known vulnerability** in what ships. `pnpm audit` over everything finds two moderate, both in tools that do not ship: `esbuild` (through the migration
generator) and `minimatch` (through the linter). **Recorded, not changed**: they are not in the image, and move with those tools. Licences were chosen to be compatible with AGPL-3.0-or-later when each dependency was added (`AGENTS.md`) and were **not re-audited in this review**; the browser test tool added for accessibility is MPL-2.0 and a development dependency.

## Left

- **A review by someone else.** This was done by the person who wrote it, and it is not a penetration test.
- **Open sign-up with no mail has to say an address is taken**, or a person cannot tell why it failed (with mail verification it says nothing). By design.
- **Sign-in limits depend on a proxy that sets the client's address** (`X-Forwarded-For`); behind one that does not, every visitor shares a limit. The deploy guide says to put a
  proxy with TLS in front, and it should say this; it is the operator's.
- **Rate limits** are fixed windows (up to twice the limit across an edge), by account and not by network address for most routes. The numbers are constants.
- **`/api/health` is public** and says the database's dialect; the deployment checks use it and it holds nothing secret.
- **A published address is a capability**: anyone who has it can open it and pass it on, and it is the whole of the access control. The documentation says so.
- **Whoever runs the server can read boards**, whatever their visibility, until the server-wide key is built, and then still (it does not protect against the operator).
- **The VoiceOver pass and a real instance** (tasks 7.7 and 11.5) are by hand, and not done.
- **Not reviewed, because it does not exist yet:** reminders and push (and their key), the Planner, live updates, the phone's own screens.
