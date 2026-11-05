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

`scripts/deploy-check.sh` brings each setup up from nothing, checks the database it is on, restarts it, and stops it with SIGTERM, and CI runs it:

```bash
eval "docker build $(pnpm exec sovereign-manifest docker-args) -t tusk:ci ."
TUSK_IMAGE=tusk:ci scripts/deploy-check.sh
```
