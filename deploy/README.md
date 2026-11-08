# Running Tusk

Tusk is one image that runs on its own or hosted by a Sovereign instance. This folder is the first way: three setups, one for each form of
database. They are the same app; only where it keeps its data differs (`DESIGN.md` §22).

| Setup                  | Files                                    | The database                                         | For                                                                                                                                                             |
| ---------------------- | ---------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **sqld** (the default) | `compose.yaml`                           | An sqld service (libSQL's server), on its own volume | Most installs. The app holds no state, and operating it is the same as operating Sovereign                                                                      |
| **A file**             | `compose.file.yaml`                      | One SQLite file on a volume                          | The smallest: one container, one person or a small group. A second instance cannot share the file, and it must stay on a local disk, never a network filesystem |
| **PostgreSQL**         | `compose.yaml` + `compose.postgres.yaml` | PostgreSQL, or one you already run                   | An operator who prefers it, or has one                                                                                                                          |

## Start

```bash
cd deploy
cp .env.example .env     # then edit it: at least TUSK_URL, TUSK_AUTH_SECRET and TUSK_ENCRYPTION_KEY
docker compose up -d --build                                                   # sqld
docker compose -f compose.file.yaml up -d --build                              # a file
docker compose -f compose.yaml -f compose.postgres.yaml up -d --build          # PostgreSQL (Compose 2.24 or later)
```

Only the machine itself can reach the port (`127.0.0.1:3000`): put a reverse proxy with TLS in front of it, and set `TUSK_URL` to the address people use.
Passkeys, emailed links and the sign-in redirect are made from it, and the server refuses to start on an address that is not https (localhost aside).

The smallest setup of all is one `docker run`, with no Compose:

```bash
docker run -d -p 127.0.0.1:3000:3000 -v tusk:/data \
  -e TUSK_DB_DIALECT=sqlite -e TUSK_SQLITE_URL=file:/data/tusk.db \
  -e TUSK_URL=https://tusk.example.com -e TUSK_AUTH_LOCAL=1 \
  -e TUSK_AUTH_SECRET="$(openssl rand -base64 48)" -e TUSK_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  ghcr.io/sovereignfs/tusk
```

(Keep the two generated values: they are in no file, so make them once and put them in your own secrets.)

## What the server does when it starts

It checks its settings and stops, naming the one that is wrong and never its value. It then makes the places its database lives in (an sqld
namespace, a directory, a PostgreSQL schema), waits for a database that is still starting (up to `TUSK_DB_CONNECT_TIMEOUT_MS`, 30 seconds), applies
its own migrations, and starts. It does not start if it cannot, and `GET /api/health` answers 200 only when the database does. Migrations apply once
each, and a second process starting at the same time is safe.

It stops on SIGTERM within seconds and exits 143.

## Your own PostgreSQL

Skip `compose.postgres.yaml` and set, in `.env`:

```
TUSK_DB_DIALECT=postgres
TUSK_POSTGRES_URL=postgres://user:password@host:5432/tusk
```

(or `TUSK_POSTGRES_URL_FILE`, a file holding it). The app makes its own schemas, `tusk` and `tusk_auth`, in that database.

## On a Sovereign instance

`sv app add` hosts Tusk from `sovereign.manifest.json`, which is also the image's label: the instance builds nothing of its own, gives the app a database, and
tells it where it is. What it sets is the settings above under Tusk's own names: `TUSK_URL`, `TUSK_CORE_URL`, `TUSK_CORE_CLIENT_ID` and
`TUSK_CORE_CLIENT_SECRET` (or `_FILE`), the database (`TUSK_DB_DIALECT` and its address) and `PORT`, and it makes `TUSK_AUTH_SECRET` and `TUSK_ENCRYPTION_KEY`
once and keeps them. With `TUSK_AUTH_LOCAL` unset, people sign in through the instance only: there is no password, sign-up or reset to find.

**Set `TUSK_AUTH_SIGNUP=open`** there: the instance already decides who may sign in, and the default (`closed`: the first account only) would turn every
other person away. Mail (`TUSK_SMTP_*`) is not used when there is no password. The instance can end a person's sessions here, and delete their account, by
signed notices to `/api/sovereign/backchannel-logout` and `/api/sovereign/account-deleted`; both are answered only when they carry a token the instance
signed.

## The GitHub App (optional)

Without it a person connects a repository for backup with a token they make on GitHub. With it they install an App on one repository and Tusk keeps no token at
all: it signs for a token that lasts an hour when it backs up. You register the App once, on the account or organisation that runs the instance:

1. GitHub, _Settings_, _Developer settings_, _GitHub Apps_, _New GitHub App_. Name it (the name goes in its address: that is `TUSK_GITHUB_APP_SLUG`).
2. **Callback URL** and **Setup URL**: `<TUSK_URL>/api/backup/app/callback`. Turn on _Request user authorization (OAuth) during installation_ (without it GitHub
   sends no `code`, and a person cannot be shown to own the installation) and _Redirect on update_.
3. **Webhook**: active, URL `<TUSK_URL>/api/webhooks/github`, and a secret of your choosing (`TUSK_GITHUB_APP_WEBHOOK_SECRET`).
4. **Permissions**: _Repository permissions_, _Contents: Read and write_; _Metadata_ is read-only and always there. Nothing else. No events need subscribing to:
   GitHub always sends an App the _installation_ and _installation_repositories_ events, which are the ones Tusk uses.
5. **Where can this GitHub App be installed?** Any account, for an instance with many people; only yours, for your own.
6. Create it. Then _Generate a private key_ (`TUSK_GITHUB_APP_PRIVATE_KEY`, or `_FILE`), and _Generate a new client secret_ (`TUSK_GITHUB_APP_CLIENT_SECRET`); the _App ID_ and the
   _Client ID_ are at the top of the page.

Set the six `TUSK_GITHUB_APP_*` settings (`.env.example`) and `TUSK_URL`, and restart. Settings, Data then offers _Connect with GitHub_. A person must choose **one
repository** when GitHub asks where to install it, and it must be private; Tusk says what to fix if not. If the App is uninstalled, or the repository taken out of
it, GitHub tells Tusk by the webhook and the connection is removed. For a GitHub Enterprise Server set `TUSK_GITHUB_API_URL` too.

## Keys

There are three keys, and they are different things.

- **`TUSK_AUTH_SECRET`** signs sessions and tokens. Changing it signs everyone out. Make it once (`openssl rand -base64 48`) and keep it with your secrets.
- **`TUSK_ENCRYPTION_KEY`** seals the credentials people give Tusk (a repository's token) in the database. Without it a token cannot be kept, and the setting that
  connects one by token says so. A lost key means people connect their repositories again. **To change it**, put the new one in `TUSK_ENCRYPTION_KEY` and the old
  in `TUSK_ENCRYPTION_KEY_PREVIOUS`, start the server once (it moves what is stored to the new key), and then remove the old one.
- **A person's own key** is theirs: it seals their Desk in their browser, and you cannot recover it for them ([`docs/encryption.md`](../docs/encryption.md)).

**Operator-key mode (`TUSK_DB_ENCRYPTION=on`)** makes the server seal the content of every Desk and every workspace with `TUSK_ENCRYPTION_KEY` before it is
stored: names, titles, descriptions, checklist items, comments, label names, and what activity and notices say. A copy of the database, a stolen disk or a
backup of the volume holds none of it. **It does not hide anything from you:** the server has the key, so whoever runs it can read boards, and personal keys are
not offered to anyone while it is on. Structure, positions, due dates and times, and colours stay readable, because queries need them. Backups to git are made of
the opened content, so they are plain.

It never changes data silently. The server stops at start-up, naming where, if the setting and what is stored disagree (the mode on with plain content, off with
sealed content, or content sealed under a key it was not given), or if any account has a key of its own. To move an instance that already has data, **stop the
server**, set `TUSK_DB_ENCRYPTION=on` and `TUSK_ENCRYPTION_KEY`, and run, in the image:

```bash
docker compose exec tusk node tools/encrypt-data.mjs status   # what is plain and what is sealed; changes nothing
docker compose exec tusk node tools/encrypt-data.mjs seal     # seal what is plain, then start the server
docker compose exec tusk node tools/encrypt-data.mjs open     # the other way, before turning the mode off
```

It works in short batches and can be stopped and run again. To change the key, give the new one as `TUSK_ENCRYPTION_KEY` and the old one as
`TUSK_ENCRYPTION_KEY_PREVIOUS`: the server moves the content (and the stored tokens) at start-up, in as many replicas as you run, and you drop the old key after.
Keep the key: **without it the content cannot be read**, and nothing can recover it.

## Backups

The database is the whole of it, apart from the one key below.

- **sqld:** a snapshot of the `sqld-data` volume, taken with sqld stopped or by your usual volume backup.
- **A file:** a snapshot of the volume. For a running copy, `sqlite3 /data/tusk.db ".backup /backup/tusk.db"`, or continuous replication such as Litestream. The
  auth database, `tusk_auth.db`, is beside it and is part of it.
- **PostgreSQL:** `pg_dump`, or your usual process.

`TUSK_ENCRYPTION_KEY` seals the credentials that are stored (a repository connected for backup). Keep it with your secrets, **apart from the database
backups**: a lost key means connecting those repositories again. A person's own backup to a git repository is theirs, and is neither a substitute for these
nor the reverse.

## Updating

Pull or build the new image and `docker compose up -d`. Migrations apply when the new server starts. A patch release has none and changes no setting; a
minor may, and going back is restoring the backup you took before it.

## Checking a setup

`scripts/deploy-check.sh` brings each setup up from nothing, checks the database it is on, restarts it, and stops it with SIGTERM, and CI runs it. Its last setup, `sovereign`, is an instance hosting the app (secrets as files, a PostgreSQL of its own, a port that is not the image's): it checks that the image's label is the manifest, that sign-in offers Sovereign and no password, that the icon and the addresses of core's notices answer, and that it stops on SIGTERM:

```bash
eval "docker build $(pnpm exec sovereign-manifest docker-args) -t tusk:ci ."
TUSK_IMAGE=tusk:ci scripts/deploy-check.sh
```
