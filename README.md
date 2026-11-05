# Tusk

One app for the work you do alone and the work you share, that runs on its own or on a [Sovereign](https://github.com/sovereignfs/sovereign)
instance. **The Desk** is yours: a private, offline-first list of things to do, as plain as Google Tasks, which you can encrypt so that the server cannot
read it. **Workspaces** hold boards you share with others: kanban lists of cards that are assigned, labelled, discussed and moved along, kept private to
their members or published for anyone to read. Backups go to a git repository of yours.

**Status: being built.** It replaces the Sovereign tasks and kanban plugins, and none of their code is carried over. It was started as _Tasks_, and the
code still uses that name until the rename lands. [`DESIGN.md`](DESIGN.md) says what it will do, [`ROADMAP.md`](ROADMAP.md) puts the work in order, and
[`docs/epics/`](docs/epics/) holds the detail of each task.

## Run it on your machine

You need Node 24.15 or newer and [pnpm](https://pnpm.io).

```bash
pnpm install --frozen-lockfile
cp .env.example .env     # every setting is described in it
# A database file needs no service. Put these in .env, or export them:
#   TASKS_DB_DIALECT=sqlite
#   TASKS_SQLITE_URL=file:./data/tasks.db
pnpm dev
```

The settings are `TASKS_…` until the rename, and `TUSK_…` after it. The default database is an sqld service, and PostgreSQL is the third form.
`pnpm db:dev sqld` or `pnpm db:dev postgres` starts either one in Docker and says which variables to set. `pnpm seed` makes an account worth looking at.

`pnpm format:check`, `pnpm lint`, `pnpm typecheck` and `pnpm test` are what a change has to pass. [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`AGENTS.md`](AGENTS.md) say how work is done here.

## Licence

AGPL-3.0-or-later, since it bundles `@sovereignfs/ui`. See [`LICENSE`](LICENSE).
