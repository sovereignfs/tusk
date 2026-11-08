# Tusk

One app for the work you do alone and the work you share, that runs on its own or on a [Sovereign](https://github.com/sovereignfs/sovereign) instance.

- **The Desk** is yours: a private list of things to do, as plain as Google Tasks, that works with no connection and that you can encrypt so that the
  server cannot read it.
- **Workspaces** hold boards you share with others: lists of cards that are assigned, labelled, discussed and moved along, kept private to their
  members or published for anyone to read.
- **Backups** go to a private git repository of yours, by hand or on a schedule. Everything can be exported and imported.

It is a web app that installs like any other (a PWA), with its own database (an sqld service, a SQLite file or PostgreSQL), and people sign in with a
password, a passkey and an authenticator app, through a Sovereign instance, or both. It replaces the Sovereign tasks and kanban plugins; none of their code
is carried over.

## What is here, and what is not

**Built:** the Desk (lists, cards, checklists, due dates, repeats, search, bulk actions, undo, sort and filters, keyboard), working offline and syncing;
workspaces and boards (roles, labels, assignees, comments, activity, the Inbox, publishing); sign-in (password, passkey, authenticator app, email
verification and reset, Sovereign, linking); a key of your own for the Desk; backup to GitHub (by token or by a GitHub App) and export and import; account
deletion; the phone's foundations and an accessibility pass.

**Planner:** a feed of days, before and after today, of the cards that have a date and are yours (your Desk's and the board cards assigned to you), with a line for now, cards as long as they are, repeats shown ahead, and a quick add from an empty day or a free slot. **Phone:** a footer of five with an action that fits where you are, a carousel of the Desk's lists, touch gestures on a card, and Today and Review as swipe views. **Notifications:** a bell beside your avatar and a page of its own hold what you are told (read and dismissed one at a time), and the Inbox is the cards assigned to you. A notice can also go out by email, to a Sovereign core's bell, and by Web Push (`TUSK_VAPID_*`, which also need `TUSK_ENCRYPTION_KEY`), for the kinds you choose.

**Notifications also:** a daily brief and a reminder at a due time (for a Desk with a key of your own, from times only). **Not built:** boards that work offline and update live, and a board's columns as a carousel. [`ROADMAP.md`](ROADMAP.md) has
each, and [`DESIGN.md`](DESIGN.md) says what they will do. The latest release is `0.1.0` ([`CHANGELOG.md`](CHANGELOG.md)); [`RELEASING.md`](RELEASING.md) says how one is made.

## Run it

You need Docker, a domain with TLS in front of it, and three values: the address people use, a secret to sign sessions, and a key for stored credentials.

```bash
docker run -d -p 127.0.0.1:3000:3000 -v tusk:/data \
  -e TUSK_DB_DIALECT=sqlite -e TUSK_SQLITE_URL=file:/data/tusk.db \
  -e TUSK_URL=https://tusk.example.com -e TUSK_AUTH_LOCAL=1 \
  -e TUSK_AUTH_SECRET="$(openssl rand -base64 48)" -e TUSK_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  ghcr.io/sovereignfs/tusk
```

Keep the two generated values: they are in no file. The first account to sign up is the instance's; later sign-ups are refused unless
`TUSK_AUTH_SIGNUP=open`. **[`deploy/README.md`](deploy/README.md)** is the guide for the three ways to run it (an sqld service, a file, PostgreSQL), a
reverse proxy, backups of the instance, updating and going back, registering a GitHub App, and being hosted by a Sovereign instance.

On your machine, to work on it: Node 24.15 or newer and [pnpm](https://pnpm.io), then

```bash
pnpm install --frozen-lockfile
cp .env.example .env     # and set TUSK_DB_DIALECT=sqlite and TUSK_SQLITE_URL=file:./data/tusk.db, which needs no service
pnpm dev
```

## Every setting

Every setting is an environment variable named `TUSK_…`, and the server stops at start-up, naming the one that is wrong and never its value, if one is. A
secret may be given as a file, `NAME_FILE=/path`, so that it is never in the process list. [`.env.example`](.env.example) is the same list as a file to copy;
a test keeps the two in step.

### The address, and signing in

| Setting                         | What                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TUSK_URL`                      | The address people use: https (http for localhost), no path. Links, cookies, passkeys and the redirect to Sovereign are made from it. Required with any way of signing in |
| `TUSK_AUTH_LOCAL`               | `1` turns on email and password, passkeys and an authenticator app. Off, their pages and routes do not exist                                                              |
| `TUSK_AUTH_SECRET`              | 32 characters or more, to sign sessions and tokens. `openssl rand -base64 48`. Required with any way of signing in                                                        |
| `TUSK_AUTH_SIGNUP`              | `closed` (the default): only the first account. `open`: anyone who can reach the page. An instance that hosts Tusk sets `open`                                            |
| `TUSK_AUTH_PASSWORD_MIN_LENGTH` | The shortest password, 8 to 128. Default 10                                                                                                                               |
| `TUSK_CORE_URL`                 | Sign in through a Sovereign instance: its address (its OIDC issuer), https. With the next two, all or none                                                                |
| `TUSK_CORE_CLIENT_ID`           | Tusk's client at that instance                                                                                                                                            |
| `TUSK_CORE_CLIENT_SECRET`       | Its secret. The redirect address registered there is `<TUSK_URL>/api/auth/callback/sovereign`                                                                             |

### The database

| Setting                      | What                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `TUSK_DB_DIALECT`            | `sqld` (the default), `sqlite` or `postgres`. Nothing guesses it from an address                                                      |
| `TUSK_SQLD_URL`              | With `sqld`: the service's address                                                                                                    |
| `TUSK_SQLD_ADMIN_URL`        | With `sqld`: its admin address, which makes the namespaces `tusk` and `tusk_auth`                                                     |
| `TUSK_SQLITE_URL`            | With `sqlite`: `file:/data/tusk.db`. The sign-in store is `tusk_auth.db` beside it. A local disk, never a network filesystem          |
| `TUSK_POSTGRES_URL`          | With `postgres`: the address, which may carry the password (or `TUSK_POSTGRES_URL_FILE`). It makes the schemas `tusk` and `tusk_auth` |
| `TUSK_POSTGRES_POOL_MAX`     | With `postgres`: the most connections the app holds, 2 or more. Default 10                                                            |
| `TUSK_DB_CONNECT_TIMEOUT_MS` | How long to wait for a database that is still starting. Default 30000                                                                 |
| `TUSK_MIGRATIONS_DIR`        | Where the migrations are, if not beside the server (the image sets it)                                                                |

`PGSSLROOTCERT` is PostgreSQL's own variable, for a root certificate when TLS is used.

### Keys

| Setting                        | What                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TUSK_ENCRYPTION_KEY`          | 32 random bytes (base64, URL-safe base64 or hex): `openssl rand -base64 32`. It seals the credentials people give Tusk (a repository's token). Without it a token cannot be kept. Keep it apart from the database backups: a lost key means connecting those repositories again                                                                                  |
| `TUSK_ENCRYPTION_KEY_PREVIOUS` | When changing the key: the old one, until the server has started once with both                                                                                                                                                                                                                                                                                  |
| `TUSK_DB_ENCRYPTION`           | `off`. `on` seals the content of the Desk and of every workspace with the key above before it is stored, so a copy of the database holds none of it (you, the operator, can still read it). It never converts silently: the server stops if the setting and the stored data disagree, and `node tools/encrypt-data.mjs seal` moves the data (`deploy/README.md`) |

### Backup to GitHub

| Setting                          | What                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TUSK_GITHUB_API_URL`            | Where GitHub's API is, for an Enterprise Server: `https://host/api/v3`. Tokens are sent there, so https. Default `https://api.github.com`                    |
| `TUSK_GITHUB_APP_ID`             | The GitHub App's number. The six `TUSK_GITHUB_APP_…` settings are all or none, and need `TUSK_URL`. With them a person connects a repository without a token |
| `TUSK_GITHUB_APP_SLUG`           | Its name in GitHub's addresses                                                                                                                               |
| `TUSK_GITHUB_APP_CLIENT_ID`      | Its OAuth client, to ask GitHub who a person is when they come back from installing it                                                                       |
| `TUSK_GITHUB_APP_CLIENT_SECRET`  | Its secret                                                                                                                                                   |
| `TUSK_GITHUB_APP_WEBHOOK_SECRET` | Signs what GitHub tells Tusk (an installation removed)                                                                                                       |
| `TUSK_GITHUB_APP_PRIVATE_KEY`    | Its private key, PEM: the `.pem` GitHub gave, as a file (`TUSK_GITHUB_APP_PRIVATE_KEY_FILE`, recommended), or the text with `\n` for the line breaks         |

### Mail, push and jobs

| Setting                  | What                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TUSK_SMTP_HOST`         | Outgoing mail. With a host (and `TUSK_SMTP_FROM`), an address is confirmed by a link before its first sign-in and a forgotten password is reset by one. Without, neither exists |
| `TUSK_SMTP_PORT`         | Default 587                                                                                                                                                                     |
| `TUSK_SMTP_USER`         | The user, if the server asks                                                                                                                                                    |
| `TUSK_SMTP_PASSWORD`     | Its password (or `TUSK_SMTP_PASSWORD_FILE`)                                                                                                                                     |
| `TUSK_SMTP_FROM`         | The sender, `Tusk <tusk@example.com>`. Required with a host                                                                                                                     |
| `TUSK_VAPID_PUBLIC_KEY`  | Web Push: all three or none, and `TUSK_ENCRYPTION_KEY` too, which seals what each device gives. `npx web-push generate-vapid-keys`                                              |
| `TUSK_VAPID_PRIVATE_KEY` | The private half                                                                                                                                                                |
| `TUSK_VAPID_SUBJECT`     | A `mailto:` or https address that identifies you to the push services                                                                                                           |
| `TUSK_WORKER`            | `on` (the default) runs the background jobs (backups, clean-up) in this process. When several processes share a database, set `off` on all but one                              |

## Using it

These are for the people who use it, and say what it does not do:

- [Working offline](docs/working-offline.md): what works with no connection, what needs one, and where it stops.
- [Encryption](docs/encryption.md): the key of your own, what it covers and what it does not.
- [Workspaces and who sees what](docs/workspaces.md): roles, public and private boards, and what removing someone does.
- [Publishing a board](docs/publishing.md): what a published page shows and what it can never show.
- [Backups, export and import](docs/backup.md): what a backup holds, how to restore, and what is left where.

## Working on it

`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` are what a change has to pass, and `pnpm e2e` runs the browser tests.
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md) say how work is done here, [`DESIGN.md`](DESIGN.md) what it is, [`ROADMAP.md`](ROADMAP.md) the
order of work, and [`docs/epics/`](docs/epics/) the detail of each task.

## Licence

AGPL-3.0-or-later, since it bundles `@sovereignfs/ui`. See [`LICENSE`](LICENSE).
