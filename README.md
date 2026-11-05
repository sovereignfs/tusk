# Tasks

A private task manager that runs on its own or on a [Sovereign](https://github.com/sovereignfs/sovereign) instance: a cleaner Google Tasks that you
run yourself. An offline-first PWA, with its own database, optional encryption that keeps the server from reading your tasks, and backup to a git
repository of yours.

**Status: being built.** It is a rewrite, from scratch, of the Sovereign tasks plugin, and nothing of the design is usable yet. [`DESIGN.md`](DESIGN.md) says
what it will do, [`ROADMAP.md`](ROADMAP.md) puts the work in order, and [`docs/epics/`](docs/epics/) holds the detail of each task.

## Run it on your machine

You need Node 24.15 or newer and [pnpm](https://pnpm.io).

```bash
pnpm install --frozen-lockfile
cp .env.example .env     # every setting is described in it
pnpm dev
```

`pnpm format:check`, `pnpm lint`, `pnpm typecheck` and `pnpm test` are what a change has to pass. [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`AGENTS.md`](AGENTS.md) say how work is done here.

## Licence

AGPL-3.0-or-later, since it bundles `@sovereignfs/ui`. See [`LICENSE`](LICENSE).
